using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;

namespace ArticleImageStudio;

// A WPF host around a real WebView2 (Edge/Chromium) browser. You log in to
// ChatGPT by hand in the embedded browser — a genuine browser, so Cloudflare's
// human-check passes normally — and the session cookies persist in the app's
// own data folder. The app then drives YOUR authenticated session with injected
// JavaScript to submit each article's image prompt, waits for the image, and
// writes it back beside the article.
//
// Ported from JubiLujah.com/tools/ArticleImageStudio. The browser-automation
// half is unchanged. The DATA half has now moved twice:
//
//   JubiLujah    — app/web/public/articles/articles.json + core/articles/*.md
//   (was here)   — Postgres image_generation_jobs over the Express API
//   JubileeVerse — the five category folders of .md articles on the article drive
//
// The five categories each get a tab. A tab lists the articles in its folder
// whose `image_file` frontmatter field is still empty, generates from that
// article's own `image_prompt`, converts to WebP and writes <slug>.webp into
// folder, and fills `image_file` in. No database, no server, no API token.
//
// NOTE on the approval gate: the previous API build posted images into the
// cockpit's `in_review` queue, so nothing it produced went live unreviewed.
// This build writes straight to the article drive, so the review step is now
// yours — look at the images before the articles publish.
//
// NOTE: this automates the ChatGPT web UI, which may conflict with OpenAI's
// Terms of Use. It runs against your own logged-in session at your direction.
// The compliant alternatives already wired into this repo are the DALL-E 3 path
// in server.js and the local ComfyUI/FLUX path in scripts/generate-article-images.js.
public partial class MainWindow : Window
{
    // The five JubileeVerse channels. Slugs are the live directory names on the
    // article drive and are not guessable — celebration-mishpakhah carries "kh",
    // and torah-hebraic does not carry the word "insights".
    private static readonly (string Slug, string Display, string Office)[] Categories =
    {
        ("covenant-identity",      "Covenant & Identity",      "Apostolic"),
        ("teshuvah-restoration",   "Teshuvah & Restoration",   "Prophetic"),
        ("shalom-salvation",       "Shalom & Salvation",       "Evangelistic"),
        ("celebration-mishpakhah", "Celebration & Mishpakhah", "Shepherd"),
        ("torah-hebraic",          "Torah & Hebraic Insights", "Teaching"),
    };

    // The tracking index that lives at the root of every category folder. The
    // article drive is the only tracker: this file is the worklist, and the .md
    // frontmatter beside it is the source it is rebuilt from.
    private const string IndexFileName = "articles.json";

    private const string DefaultArticlesRoot = @"J:\jubileeverse.com\articles";

    private string _root = "";
    private string _toolDir = "";
    private string _configFile = "";
    private string _userDataFolder = "";
    private string _articlesRoot = DefaultArticlesRoot;

    private bool _ready;
    private bool _running;
    private bool _homeRetried;
    private CancellationTokenSource? _cts;
    private TaskCompletionSource<string>? _imageMsg;

    // Second guard so a run never loops on the same article even if a write
    // hiccups. The durable record is the article's own image_file field.
    private readonly HashSet<string> _completedPaths = new(StringComparer.OrdinalIgnoreCase);

    // Per-category article lists, keyed by slug.
    private readonly Dictionary<string, List<Article>> _byCategory = new();

    private const string CHATGPT = "https://chatgpt.com/";

    // Appended to every prompt so ChatGPT renders a wide hero image, not a
    // square. The frontmatter prompt already ends with "16:9"; this restates it
    // as an instruction, which the web UI honours far more reliably.
    //
    // ONE LINE, deliberately. This used to start with "\n\n" and that was a bug:
    // the composer is a ProseMirror contenteditable, execCommand('insertText')
    // splits on the blank line into separate paragraphs, and only the LAST
    // paragraph survived to be sent. The article's prompt was silently dropped
    // and ChatGPT received nothing but the aspect-ratio instruction, which is
    // not a request for anything and failed the turn. Never reintroduce a
    // newline here, and see SubmitScript for the guard that now catches it.
    private const string AspectSuffix =
        " IMPORTANT: produce this image in a 16:9 widescreen landscape aspect ratio, " +
        "wide horizontal orientation, not square and not portrait.";

    public MainWindow()
    {
        InitializeComponent();
        ResolvePaths();
        LoadConfig();
        ArticlesRoot.Text = _articlesRoot;
        Loaded += async (_, _) => await InitAsync();
    }

    // ---- paths -------------------------------------------------------------
    // Walks up from the binary looking for THIS repo's marker (server/server.js).
    // An unresolved root is not fatal any more: the article drive is a separate
    // volume, so the repo is only needed for the config file's home.
    private void ResolvePaths()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "server", "server.js"))) break;
            dir = dir.Parent;
        }
        _root = dir?.FullName ?? "";
        _toolDir = _root.Length > 0
            ? Path.Combine(_root, "server", "tools", "ArticleImageStudio")
            : AppContext.BaseDirectory;
        _configFile = Path.Combine(_toolDir, "studio.config.json");

        // The WebView2 profile must live on a LOCAL disk. The tool directory is
        // normally on a mapped network share (W: -> \\HDC-INSPIRESERVER\Websites),
        // and Chromium does not support a user data folder on a network path: the
        // browser process faults with STATUS_IN_PAGE_ERROR (0xc0000006) the moment
        // the share goes stale, which kills the pane and then the app. Keep the
        // cookie store next to the user's other local app data instead.
        _userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "JubileeVerse", "ArticleImageStudio", "webview2");
        Directory.CreateDirectory(_userDataFolder);

        // One-time migration so an existing ChatGPT login survives the move.
        try
        {
            var legacy = Path.Combine(_toolDir, ".webview2", "EBWebView");
            var moved = Path.Combine(_userDataFolder, "EBWebView");
            if (Directory.Exists(legacy) && !Directory.Exists(moved))
                CopyTree(legacy, moved);
        }
        catch { /* a fresh login is an acceptable fallback */ }
    }

    // Recursive directory copy. Used only for the one-time profile migration off
    // the network share; files the browser has locked are skipped rather than
    // failing the whole copy.
    private static void CopyTree(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var file in Directory.GetFiles(from))
        {
            try { File.Copy(file, Path.Combine(to, Path.GetFileName(file)), overwrite: true); }
            catch { }
        }
        foreach (var sub in Directory.GetDirectories(from))
            CopyTree(sub, Path.Combine(to, Path.GetFileName(sub)));
    }

    // ---- config (git-ignored) ----------------------------------------------
    private void LoadConfig()
    {
        try
        {
            if (!File.Exists(_configFile)) return;
            var cfg = JsonNode.Parse(File.ReadAllText(_configFile));
            var a = cfg?["articlesRoot"]?.GetValue<string>();
            if (!string.IsNullOrWhiteSpace(a)) _articlesRoot = a.TrimEnd('\\', '/');
        }
        catch { /* a malformed config just means "start from defaults" */ }
    }

    private void BtnSaveCfg_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            ReadRootFromUi();
            var cfg = new JsonObject { ["articlesRoot"] = _articlesRoot };
            File.WriteAllText(_configFile, cfg.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            Log("Settings saved → studio.config.json (git-ignored).");
        }
        catch (Exception ex) { Log("Could not save settings: " + ex.Message); }
    }

    private void ReadRootFromUi() => _articlesRoot = (ArticlesRoot.Text ?? "").Trim().TrimEnd('\\', '/');

    // ---- init WebView2 with a persistent profile (this is the cookie store) -
    private async Task InitAsync()
    {
        try
        {
            // White (not the default black) so a slow/blank first paint never
            // shows as a black page.
            Wv.DefaultBackgroundColor = System.Drawing.Color.White;
            var env = await CoreWebView2Environment.CreateAsync(userDataFolder: _userDataFolder);
            await Wv.EnsureCoreWebView2Async(env);
            Wv.CoreWebView2.WebMessageReceived += OnWebMessage;
            // If the very first load fails or lands blank, retry once so the app
            // always comes up on ChatGPT rather than a black/blank page.
            Wv.CoreWebView2.NavigationCompleted += (s, e) =>
            {
                var url = Wv.CoreWebView2.Source ?? "";
                if (!_homeRetried && (!e.IsSuccess || url.Length == 0 || url.StartsWith("about:")))
                {
                    _homeRetried = true;
                    Wv.CoreWebView2.Navigate(CHATGPT);
                }
            };
            Wv.CoreWebView2.Navigate(CHATGPT);
            _ready = true;

            Log("Images are written into <category>/images/ and linked from each article's image_file.");
            Log("Log in to ChatGPT in the browser, then pick a category tab and generate.");
            ScanAll();
        }
        catch (Exception ex)
        {
            Log("Init failed: " + ex.Message);
            MessageBox.Show(
                "WebView2 failed to start. Make sure the WebView2 Runtime is installed " +
                "(it ships with Edge on Windows 11).\n\n" + ex.Message,
                "Image Studio", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    // ---- scanning the five category folders --------------------------------
    private ListBox ListFor(string slug) => slug switch
    {
        "covenant-identity"      => LstCovenant,
        "teshuvah-restoration"   => LstTeshuvah,
        "shalom-salvation"       => LstShalom,
        "celebration-mishpakhah" => LstCelebration,
        _                        => LstTorah,
    };

    // Not FirstOrDefault(...).Display: the tuple elements are declared
    // non-nullable, so a miss would hand back a null the compiler believes
    // cannot be null. An explicit loop keeps this honest under <Nullable>enable.
    private static string DisplayFor(string slug)
    {
        foreach (var c in Categories) if (c.Slug == slug) return c.Display;
        return slug;
    }

    private static string OfficeFor(string slug)
    {
        foreach (var c in Categories) if (c.Slug == slug) return c.Office;
        return "";
    }

    private string SelectedSlug()
    {
        if (Tabs.SelectedItem is TabItem t && t.Tag is string s) return s;
        return Categories[0].Slug;
    }

    private void BtnScan_Click(object sender, RoutedEventArgs e) { ReadRootFromUi(); ScanAll(); }
    private void BtnReload_Click(object sender, RoutedEventArgs e) => ScanAll();

    private void Tabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        // Only react to the TabControl itself, not to selection inside a ListBox.
        if (!ReferenceEquals(e.OriginalSource, Tabs)) return;
        if (!_ready) return;
        var slug = SelectedSlug();
        var n = _byCategory.TryGetValue(slug, out var list) ? list.Count(a => !a.HasImage) : 0;
        Log($"— {DisplayFor(slug)}: {n} article(s) pending.");
    }

    private void ScanAll()
    {
        ReadRootFromUi();
        if (!Directory.Exists(_articlesRoot))
        {
            Log($"⚠ Articles root not found: {_articlesRoot}");
            Log("  Set the correct path above and click Scan categories.");
            foreach (var c in Categories) { _byCategory[c.Slug] = new(); ListFor(c.Slug).Items.Clear(); }
            return;
        }

        int totalPending = 0, totalDone = 0, missingDirs = 0;
        foreach (var (slug, display, _) in Categories)
        {
            var dir = Path.Combine(_articlesRoot, slug);
            var list = new List<Article>();

            if (!Directory.Exists(dir))
            {
                missingDirs++;
                Log($"  ⚠ {display}: folder missing ({slug})");
            }
            else
            {
                // Recursive, because the article drive uses two layouts: flat
                // .md files at the top of a category, and nested taxonomy
                // folders whose _meta.json declares "fileName": "article.md".
                // The images/ folder is skipped so generated output is never
                // mistaken for source.
                foreach (var file in Directory.EnumerateFiles(dir, "*.md", SearchOption.AllDirectories).OrderBy(f => f))
                {
                    var rel = Path.GetRelativePath(dir, file);
                    if (rel.StartsWith("images" + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
                    var art = ReadArticle(file, slug, dir);
                    if (art != null) list.Add(art);
                }
            }

            _byCategory[slug] = list;
            totalPending += list.Count(a => !a.HasImage);
            totalDone += list.Count(a => a.HasImage);
            RenderList(slug);
            // Reconcile the tracking index with what is actually on disk.
            WriteIndex(slug);
        }

        Log($"Scanned {_articlesRoot} — {totalPending} pending, {totalDone} already imaged" +
            (missingDirs > 0 ? $", {missingDirs} folder(s) missing." : ".") +
            $" {IndexFileName} refreshed in each category.");
    }

    private void RenderList(string slug)
    {
        var box = ListFor(slug);
        box.Items.Clear();
        if (!_byCategory.TryGetValue(slug, out var list)) return;
        var showAll = ChkShowAll.IsChecked == true;
        foreach (var a in list)
        {
            if (a.HasImage && !showAll) continue;
            box.Items.Add((a.HasImage ? "✓ " : "• ") + a.Title);
        }
        if (box.Items.Count == 0)
            box.Items.Add(list.Count == 0 ? "(no articles in this folder)" : "(all articles have an image)");
    }

    // Articles currently shown in a category's list box, in display order, so a
    // selection index maps back to the right article.
    private List<Article> VisibleIn(string slug)
    {
        if (!_byCategory.TryGetValue(slug, out var list)) return new();
        var showAll = ChkShowAll.IsChecked == true;
        return list.Where(a => showAll || !a.HasImage).ToList();
    }

    // ---- frontmatter -------------------------------------------------------
    // Deliberately line-based rather than a YAML dependency: the frontmatter is
    // machine-written by the article pipeline, one `key: "value"` per line.
    private static readonly Regex FieldRx =
        new(@"^(?<key>[a-z_]+):\s*""(?<val>.*)""\s*$", RegexOptions.Compiled);

    private static Article? ReadArticle(string path, string slug, string categoryDir)
    {
        try
        {
            var text = File.ReadAllText(path);
            if (!text.StartsWith("---")) return null;
            var end = text.IndexOf("\n---", 3, StringComparison.Ordinal);
            if (end < 0) return null;

            var f = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var line in text.Substring(0, end).Split('\n'))
            {
                var m = FieldRx.Match(line.TrimEnd('\r'));
                if (m.Success) f[m.Groups["key"].Value] = m.Groups["val"].Value;
            }
            string Get(string k) => f.TryGetValue(k, out var v) ? v : "";

            // Nested articles are all called article.md, so the filename alone
            // would name every generated image article.webp and collide. In that
            // layout the containing folder is the slug, which is what the
            // _meta.json beside it uses.
            var baseName = Path.GetFileNameWithoutExtension(path);
            var articleSlug = baseName.Equals("article", StringComparison.OrdinalIgnoreCase)
                ? (new DirectoryInfo(Path.GetDirectoryName(path)!).Name)
                : baseName;
            if (Get("slug").Length > 0) articleSlug = Get("slug");

            return new Article
            {
                Path = path,
                RelFile = Path.GetRelativePath(categoryDir, path).Replace('\\', '/'),
                Slug = articleSlug,
                Category = slug,
                Title = Get("title").Length > 0 ? Get("title") : articleSlug,
                Author = Get("author"),
                Office = Get("office"),
                DateUpdated = Get("date_updated"),
                VelocityTier = Get("velocity_tier"),
                Status = Get("status"),
                Prompt = Get("image_prompt"),
                ImageFile = Get("image_file"),
            };
        }
        catch { return null; }
    }

    // ---- the articles.json tracking index ----------------------------------
    // Written at the root of each category folder. Rebuilt from the .md files on
    // every scan so the two can never drift, and rewritten after each generated
    // image so the pending count is always current on disk.
    private void WriteIndex(string slug)
    {
        if (!_byCategory.TryGetValue(slug, out var list)) return;
        var dir = Path.Combine(_articlesRoot, slug);
        if (!Directory.Exists(dir)) return;

        var arr = new JsonArray();
        foreach (var a in list)
        {
            arr.Add(new JsonObject
            {
                ["slug"] = a.Slug,
                ["title"] = a.Title,
                ["file"] = a.RelFile,
                ["author"] = a.Author,
                ["office"] = a.Office,
                ["date_updated"] = a.DateUpdated,
                ["velocity_tier"] = a.VelocityTier,
                ["status"] = a.Status,
                ["image_prompt"] = a.Prompt,
                ["image_file"] = a.ImageFile,
                ["image_status"] = a.HasImage ? "generated" : "pending",
            });
        }

        var doc = new JsonObject
        {
            ["category"] = DisplayFor(slug),
            ["category_slug"] = slug,
            ["office"] = OfficeFor(slug),
            ["updated"] = DateTime.Now.ToString("yyyy-MM-dd"),
            ["counts"] = new JsonObject
            {
                ["total"] = list.Count,
                ["generated"] = list.Count(a => a.HasImage),
                ["pending"] = list.Count(a => !a.HasImage),
            },
            ["articles"] = arr,
        };

        try
        {
            File.WriteAllText(Path.Combine(dir, IndexFileName),
                doc.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n",
                new UTF8Encoding(false));
        }
        catch (Exception ex) { Log($"  ⚠ Could not write {slug}/{IndexFileName}: {ex.Message}"); }
    }

    // Writes the rendered filename into image_file, leaving every other byte of
    // the article alone. The key always exists in a spec-conformant article, so
    // a missing key means the file is not one of ours and is left untouched.
    private static bool WriteImageFile(string path, string fileName)
    {
        var text = File.ReadAllText(path);
        var end = text.IndexOf("\n---", 3, StringComparison.Ordinal);
        if (end < 0) return false;

        var head = text.Substring(0, end);
        var tail = text.Substring(end);
        var rx = new Regex(@"^image_file:\s*"".*""\s*$", RegexOptions.Multiline);
        if (!rx.IsMatch(head)) return false;

        head = rx.Replace(head, $"image_file: \"{fileName}\"", 1);
        File.WriteAllText(path, head + tail, new UTF8Encoding(false));
        return true;
    }

    // ---- buttons -----------------------------------------------------------
    // Locks the "generation location" to the page you're on — meant for your
    // ChatGPT Projects → Images page, so every generation conversation is created
    // inside that project. If you're inside a chat within the project, it
    // normalizes back to the project's new-chat page.
    private async void BtnUseLocation_Click(object sender, RoutedEventArgs e)
    {
        if (!_ready) return;
        // Read the LIVE address from the page. ChatGPT is a single-page app, so
        // CoreWebView2.Source lags behind client-side navigation (clicking a
        // project/chat in the sidebar) — window.location.href is always current.
        var src = Json(await Wv.CoreWebView2.ExecuteScriptAsync("window.location.href"));
        if (string.IsNullOrWhiteSpace(src)) src = Wv.CoreWebView2.Source ?? "";
        var m = Regex.Match(src, @"^(https://chatgpt\.com/g/g-p-[^/]+)/");
        if (m.Success) src = m.Groups[1].Value + "/project";
        if (!string.IsNullOrWhiteSpace(src)) { LocationUrl.Text = src; Log("Generation location set → " + src); }
    }

    private async void BtnGenNext_Click(object sender, RoutedEventArgs e)
    {
        if (!EnsureReady()) return;
        var slug = SelectedSlug();
        var visible = VisibleIn(slug);
        var i = ListFor(slug).SelectedIndex;

        Article? next = (i >= 0 && i < visible.Count && !visible[i].HasImage)
            ? visible[i]
            : _byCategory[slug].FirstOrDefault(a => !a.HasImage && a.Prompt.Length > 0);

        if (next == null) { Log($"Nothing pending in {DisplayFor(slug)}."); return; }
        await RunBatch(new() { next });
    }

    private async void BtnGenCategory_Click(object sender, RoutedEventArgs e)
    {
        if (!EnsureReady()) return;
        var slug = SelectedSlug();
        var pending = Pending(slug);
        if (pending.Count == 0) { Log($"Nothing pending in {DisplayFor(slug)}."); return; }
        Log($"\n=== {DisplayFor(slug)} — {pending.Count} image(s) ===");
        await RunBatch(pending);
    }

    private async void BtnGenAllCats_Click(object sender, RoutedEventArgs e)
    {
        if (!EnsureReady()) return;
        var all = new List<Article>();
        foreach (var c in Categories) all.AddRange(Pending(c.Slug));
        if (all.Count == 0) { Log("Nothing pending in any category."); return; }
        Log($"\n=== All five categories — {all.Count} image(s) ===");
        await RunBatch(all);
    }

    private List<Article> Pending(string slug) =>
        _byCategory.TryGetValue(slug, out var list)
            ? list.Where(a => !a.HasImage && a.Prompt.Length > 0 && !_completedPaths.Contains(a.Path)).ToList()
            : new();

    private void BtnStop_Click(object sender, RoutedEventArgs e)
    {
        ChkAutoAll.IsChecked = false;
        _cts?.Cancel();
        Log("Stopping after the current image…");
    }

    // What an auto run covers: every category when "All Tabs" is ticked,
    // otherwise just the tab in front of the user. Categories are walked in
    // declaration order, so the sweep is predictable rather than starting from
    // whichever tab happened to be selected.
    private List<Article> AutoScope(out string label)
    {
        if (ChkAllTabs.IsChecked == true)
        {
            var all = new List<Article>();
            foreach (var c in Categories) all.AddRange(Pending(c.Slug));
            label = $"all {Categories.Length} tabs";
            return all;
        }

        var slug = SelectedSlug();
        label = DisplayFor(slug);
        return Pending(slug);
    }

    // Shared by both checkboxes so the two can never disagree about scope.
    // Clears both boxes when it finishes, whether that was completion or a stop.
    private async Task StartAuto()
    {
        if (_running) return;
        if (!EnsureReady()) { ClearAutoBoxes(); return; }

        var pending = AutoScope(out var label);
        if (pending.Count == 0)
        {
            Log($"Nothing pending in {label}.");
            ClearAutoBoxes();
            return;
        }

        Log($"Auto mode ON — {label}, {pending.Count} image(s), no clicking…");
        await RunBatch(pending);
        ClearAutoBoxes();
    }

    // Assigning IsChecked raises Checked/Unchecked, not Click, so resetting the
    // boxes here never re-enters the handlers below.
    private void ClearAutoBoxes()
    {
        ChkAutoAll.IsChecked = false;
        ChkAllTabs.IsChecked = false;
    }

    // Checked → generate every pending image in scope back-to-back, no
    // clicking. Unchecked while running → stop.
    private async void ChkAutoAll_Click(object sender, RoutedEventArgs e)
    {
        if (ChkAutoAll.IsChecked == true) await StartAuto();
        else _cts?.Cancel(); // unchecking stops the run
    }

    // "All Tabs" is the scope switch for the auto run, and starts it as well:
    // ticking one box to sweep the whole library is the point of the control.
    // Scope is fixed once a run is under way, so mid-run ticks are refused
    // rather than silently ignored.
    private async void ChkAllTabs_Click(object sender, RoutedEventArgs e)
    {
        if (ChkAllTabs.IsChecked == true)
        {
            if (_running)
            {
                Log("A run is already under way — stop it first to change scope.");
                ChkAllTabs.IsChecked = false;
                return;
            }
            ChkAutoAll.IsChecked = true; // keep the pair reading true together
            await StartAuto();
        }
        else
        {
            _cts?.Cancel(); // unchecking stops the run
        }
    }

    // Manual fallback: grab whatever generated image is showing right now and
    // attach it — to the selected article, or the next pending one in this tab.
    private async void BtnDownload_Click(object sender, RoutedEventArgs e)
    {
        if (!EnsureReady()) return;
        BtnDownload.IsEnabled = false;
        try
        {
            var all = await GetImageList();
            var src = all.LastOrDefault();
            if (src == null) { Log("No finished image found on the page."); return; }

            var slug = SelectedSlug();
            var visible = VisibleIn(slug);
            var i = ListFor(slug).SelectedIndex;
            var target = (i >= 0 && i < visible.Count)
                ? visible[i]
                : _byCategory[slug].FirstOrDefault(a => !a.HasImage);

            if (target == null) { Log("No article to attach this image to."); return; }

            Log($"Manual attach → {target.Title}");
            if (await SaveImage(src, target, CancellationToken.None)) ScanAll();
        }
        catch (Exception ex) { Log("Manual attach failed: " + ex.Message); }
        finally { BtnDownload.IsEnabled = true; }
    }

    private bool EnsureReady()
    {
        if (!_ready) { Log("Browser not ready yet."); return false; }
        ReadRootFromUi();
        if (!Directory.Exists(_articlesRoot)) { Log($"Articles root not found: {_articlesRoot}"); return false; }
        return true;
    }

    // ---- batch driver ------------------------------------------------------
    private async Task RunBatch(List<Article> jobs)
    {
        if (_running) { Log("Already running — Stop (or uncheck Auto) first."); return; }
        _running = true;
        _cts = new CancellationTokenSource();
        SetBusy(true);
        int done = 0, skipped = 0, failed = 0, inThread = 0, consecutiveFailures = 0;
        string lastCat = "";
        try
        {
            for (int i = 0; i < jobs.Count; i++)
            {
                _cts.Token.ThrowIfCancellationRequested();
                var job = jobs[i];

                if (job.Category != lastCat)
                {
                    lastCat = job.Category;
                    Log($"\n--- {DisplayFor(job.Category)} ---");
                }

                // Never regenerate one already done (this session or a prior run).
                if (_completedPaths.Contains(job.Path) || job.HasImage)
                {
                    Log($"[{i + 1}/{jobs.Count}] {job.Title} — already has an image, skipping.");
                    skipped++;
                    continue;
                }

                // Start a new conversation for the first image, and a fresh one
                // after every 10 images in the current thread.
                bool newThread = inThread == 0;
                Log($"\n[{i + 1}/{jobs.Count}] {job.Title}");
                var ok = await GenerateOne(job, newThread, _cts.Token);
                if (ok)
                {
                    done++;
                    consecutiveFailures = 0;
                    _completedPaths.Add(job.Path);
                    if (++inThread >= 10)
                    {
                        Log("  Reached 10 images in this conversation — the next one starts a new thread.");
                        inThread = 0;
                    }
                    if (i < jobs.Count - 1)
                    {
                        // Image generation is far heavier than a text turn, and
                        // hammering it is what earns a "Something went wrong".
                        var wait = _rng.Next(20000, 45001);
                        Log($"  Pausing {wait / 1000.0:0.0}s before the next image…");
                        await Task.Delay(wait, _cts.Token);
                    }
                }
                else
                {
                    failed++;
                    // Three failures in a row is not bad luck. It is almost always
                    // a quota or a capacity problem, and grinding through the
                    // remaining articles would just burn them all against the same
                    // wall and mark none of them done.
                    if (++consecutiveFailures >= 3)
                    {
                        Log("\n  ✗ Three failures in a row — stopping the run.");
                        Log("    This is usually an image quota or a temporary ChatGPT capacity problem.");
                        Log("    Nothing was lost: every article that failed is still marked pending.");
                        break;
                    }
                    var cool = 60000;
                    Log($"  Cooling down {cool / 1000}s after a failure before trying the next one…");
                    await Task.Delay(cool, _cts.Token);
                }
            }
        }
        catch (OperationCanceledException) { Log("Stopped."); }
        catch (Exception ex) { Log("Error: " + ex.Message); }
        finally
        {
            _running = false;
            SetBusy(false);
            ScanAll();
            Log($"\nFinished. {done} generated"
                + (failed > 0 ? $", {failed} failed" : "")
                + (skipped > 0 ? $", {skipped} skipped (already done)" : "") + ".");
            if (done > 0) Log("Nothing here is reviewed automatically — look at the images before these publish.");
        }
    }

    private async Task<bool> GenerateOne(Article job, bool newThread, CancellationToken ct)
    {
        if (job.Prompt.Length == 0) { Log("  ✗ No image_prompt in the frontmatter — skipping."); return false; }

        if (newThread)
        {
            var loc = string.IsNullOrWhiteSpace(LocationUrl.Text) ? CHATGPT : LocationUrl.Text.Trim();
            Log($"  Opening a new conversation ({loc})…");
            await NavigateAndWait(loc, ct);
        }
        else
        {
            Log("  Continuing in the same conversation…");
        }
        if (!await WaitForComposer(ct)) { Log("  ✗ Chat box never appeared — are you logged in? (composer not found)"); return false; }

        // Remember which images are already on the page so we only accept a NEW one.
        var baseline = new HashSet<string>(await GetImageList());
        Log($"  Sending prompt… ({baseline.Count} image(s) already on the page)");

        // Flatten to a single line before sending. The composer treats a newline
        // as a paragraph break and only the last paragraph survives, so any
        // multi-line prompt would arrive truncated.
        var oneLine = Regex.Replace(job.Prompt, @"\s+", " ").Trim();
        var submit = Json(await Wv.CoreWebView2.ExecuteScriptAsync(SubmitScript(oneLine + AspectSuffix)));
        Log($"  submit result: {submit}");
        if (submit == "no-composer") { Log("  ✗ Could not find the chat box to type into."); return false; }
        if (submit.StartsWith("mismatch", StringComparison.Ordinal))
        {
            // Nothing was sent. Sending a fragment is worse than sending nothing:
            // it burns a turn and produces an image for the wrong description.
            Log("  ✗ The composer did not receive the full prompt, so nothing was sent.");
            return false;
        }

        Log("  Waiting for the image to finish generating…");
        var src = await WaitForNewImage(baseline, ct);
        if (src == null) { Log("  ✗ No finished image detected (ChatGPT may have asked a question, refused, or its layout changed)."); return false; }
        Log("  ✓ Image finished — downloading…");

        return await SaveImage(src, job, ct);
    }

    // Waits for a generated image that (a) was not already present before we
    // submitted, and (b) holds the same URL across two consecutive polls — i.e.
    // generation has settled, not a streaming/placeholder frame.
    //
    // It also watches for ChatGPT's own failure state. When a turn dies with
    // "Something went wrong. Please try again." no image is ever coming, and the
    // old code could not tell that apart from a slow render: it sat out the full
    // six-minute deadline on a turn that had already failed, then reported a
    // generic timeout. Now the failure is detected within a poll, retried once
    // on the page's own Retry button, and surfaced honestly if it fails again.
    private async Task<string?> WaitForNewImage(HashSet<string> baseline, CancellationToken ct)
    {
        var deadline = DateTime.UtcNow.AddMinutes(6);
        string? last = null;
        int stable = 0, polls = 0, retries = 0;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();

            var current = await GetImageList();
            var newest = current.LastOrDefault(s => !baseline.Contains(s));
            if (newest != null)
            {
                if (newest == last) stable++;
                else { last = newest; stable = 1; }
                if (stable >= 2) return newest; // unchanged across two checks → done
            }

            // Only look for the failure banner while no image has appeared: once
            // one is rendering, a stale banner further up the thread is irrelevant.
            if (newest == null && Json(await Wv.CoreWebView2.ExecuteScriptAsync(ErrorPresentScript())) == "yes")
            {
                if (retries == 0)
                {
                    retries++;
                    Log("    ChatGPT reported \"Something went wrong\" — pressing its Retry once…");
                    await Wv.CoreWebView2.ExecuteScriptAsync(ClickRetryScript());
                    await Task.Delay(6000, ct);
                    continue;
                }
                Log("    ✗ ChatGPT failed this turn again after a retry.");
                return null;
            }

            if (++polls % 5 == 0)
                Log($"    …still waiting ({current.Count} image(s) on page, ~{(int)(deadline - DateTime.UtcNow).TotalSeconds}s left)");
            await Task.Delay(3000, ct);
        }
        Log("    ✗ Timed out waiting for the image.");
        return null;
    }

    private async Task<List<string>> GetImageList()
    {
        var r = await Wv.CoreWebView2.ExecuteScriptAsync(ListImagesScript());
        try
        {
            var arr = JsonNode.Parse(r) as JsonArray;
            return arr?.Select(x => x!.GetValue<string>()).ToList() ?? new();
        }
        catch { return new(); }
    }

    // Fetch the image bytes inside the page (keeps the auth session), receive
    // them via a web message, re-encode to WebP, write <slug>.webp into the
    // category's images/ folder, and record the filename in the article's
    // image_file field.
    private async Task<bool> SaveImage(string src, Article job, CancellationToken ct)
    {
        _imageMsg = new TaskCompletionSource<string>();
        await Wv.CoreWebView2.ExecuteScriptAsync(FetchScript(src));
        var b64 = await WaitForMessage(TimeSpan.FromSeconds(60), ct);
        if (b64 == null) { Log("  Failed to download the image bytes."); return false; }

        try
        {
            var original = Convert.FromBase64String(b64);
            var imagesDir = Path.Combine(_articlesRoot, job.Category, "images");
            Directory.CreateDirectory(imagesDir);

            // Convert as soon as it lands. ChatGPT hands back multi-megabyte
            // PNG/JPEG; WebP is a fraction of that for the same picture, and
            // storing one format keeps every consumer from having to care which
            // extension a given article happens to use.
            var (bytes, ext) = ToWebp(original, out var note);
            if (note.Length > 0) Log("  " + note);

            var fileName = job.Slug + ext;
            var dest = Path.Combine(imagesDir, fileName);
            await File.WriteAllBytesAsync(dest, bytes, ct);

            // Remove a previous render of this article in another format, or
            // the folder accumulates an orphan .jpg beside every new .webp.
            foreach (var stale in StaleSiblings(imagesDir, job.Slug, fileName))
            {
                try { File.Delete(stale); Log($"  Removed superseded {Path.GetFileName(stale)}"); }
                catch { /* not worth failing the save over */ }
            }

            if (!WriteImageFile(job.Path, fileName))
            {
                Log($"  ⚠ Wrote {dest} but could not find an image_file field to update in {job.Slug}.md");
                return false;
            }

            job.ImageFile = fileName;
            // Keep the on-disk tracker current after every single image, so a
            // run that is stopped or crashes still leaves an accurate index.
            WriteIndex(job.Category);
            var saved = original.Length > 0 ? 100 - (int)(bytes.LongLength * 100 / original.LongLength) : 0;
            Log($"  Saved images/{fileName}  ({bytes.Length:N0} bytes"
                + (ext == WebpExt ? $", {saved}% smaller than the {original.Length:N0} byte original)" : ")"));
            Log($"  image_file recorded in {Path.GetFileName(job.Path)} and {job.Category}/{IndexFileName}");
            return true;
        }
        catch (Exception ex)
        {
            Log("  ✗ Could not save the image: " + ex.Message);
            return false;
        }
    }

    // ---- image conversion --------------------------------------------------

    private const string WebpExt = ".webp";

    /// <summary>
    /// WebP quality for saved article images. 82 is visually indistinguishable
    /// from the source on photographic content and lands around a tenth of the
    /// bytes; higher buys nothing a reader can see.
    /// </summary>
    private const int WebpQuality = 82;

    /// <summary>
    /// Re-encode a downloaded image as WebP.
    ///
    /// Falls back to the original bytes, under their true extension, if the
    /// encode fails or comes out no smaller. Losing a generated image to a
    /// conversion problem would cost a GPU render and silently drop the article
    /// out of the queue, so the original always wins over nothing.
    /// </summary>
    /// <returns>The bytes to write and the extension to write them under.</returns>
    private static (byte[] Bytes, string Ext) ToWebp(byte[] source, out string note)
    {
        note = "";
        try
        {
            using var image = SixLabors.ImageSharp.Image.Load(source);
            using var ms = new MemoryStream();
            image.Save(ms, new SixLabors.ImageSharp.Formats.Webp.WebpEncoder
            {
                Quality = WebpQuality,
                FileFormat = SixLabors.ImageSharp.Formats.Webp.WebpFileFormatType.Lossy,
            });
            var webp = ms.ToArray();

            if (webp.Length == 0 || webp.Length >= source.Length)
            {
                note = $"WebP came out {webp.Length:N0} bytes vs {source.Length:N0} original; keeping the original.";
                return (source, SniffExtension(source));
            }
            return (webp, WebpExt);
        }
        catch (Exception ex)
        {
            note = "WebP conversion failed (" + ex.Message + "); saving the original instead.";
            return (source, SniffExtension(source));
        }
    }

    /// <summary>
    /// The real extension for a byte buffer, from its magic number. Never trust
    /// the URL: ChatGPT serves these from blob/CDN paths that carry no format.
    /// </summary>
    private static string SniffExtension(byte[] b)
    {
        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return ".png";
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return ".jpg";
        if (b.Length >= 12
            && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
            && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return WebpExt;
        return ".jpg";
    }

    /// <summary>
    /// Other renders of the same article sitting beside the one just written —
    /// a `.jpg` left over from before the WebP switch, for instance.
    /// </summary>
    private static IEnumerable<string> StaleSiblings(string imagesDir, string slug, string keep)
    {
        foreach (var ext in new[] { ".jpg", ".jpeg", ".png", WebpExt })
        {
            var name = slug + ext;
            if (string.Equals(name, keep, StringComparison.OrdinalIgnoreCase)) continue;
            var path = Path.Combine(imagesDir, name);
            if (File.Exists(path)) yield return path;
        }
    }

    // ---- navigation + messaging helpers ------------------------------------
    // Best-effort navigation: waits for the "completed" event but never hangs on
    // it — after the timeout it proceeds, and WaitForComposer confirms the page
    // is actually usable.
    private async Task NavigateAndWait(string url, CancellationToken ct)
    {
        var tcs = new TaskCompletionSource<bool>();
        void handler(object? s, CoreWebView2NavigationCompletedEventArgs e) => tcs.TrySetResult(e.IsSuccess);
        Wv.CoreWebView2.NavigationCompleted += handler;
        try
        {
            Wv.CoreWebView2.Navigate(url);
            await Task.WhenAny(tcs.Task, Task.Delay(25000, ct));
        }
        catch (OperationCanceledException) { }
        finally
        {
            Wv.CoreWebView2.NavigationCompleted -= handler;
        }
    }

    private async Task<bool> WaitForComposer(CancellationToken ct)
    {
        var deadline = DateTime.UtcNow.AddSeconds(40);
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            if (Json(await Wv.CoreWebView2.ExecuteScriptAsync(ComposerPresentScript())) == "yes") return true;
            await Task.Delay(1000, ct);
        }
        return false;
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var text = e.TryGetWebMessageAsString();
            var node = JsonNode.Parse(text);
            var type = node?["type"]?.GetValue<string>();
            if (type == "image") _imageMsg?.TrySetResult(node!["b64"]!.GetValue<string>());
            else if (type == "error") { Log("  page fetch error: " + node?["message"]?.GetValue<string>()); _imageMsg?.TrySetResult(""); }
        }
        catch { /* ignore malformed messages from the page */ }
    }

    private async Task<string?> WaitForMessage(TimeSpan timeout, CancellationToken ct)
    {
        var msg = _imageMsg!;
        var completed = await Task.WhenAny(msg.Task, Task.Delay(timeout, ct));
        if (completed == msg.Task)
        {
            var v = await msg.Task;
            return string.IsNullOrEmpty(v) ? null : v;
        }
        return null;
    }

    // ---- injected scripts --------------------------------------------------
    private static string J(string s) => JsonSerializer.Serialize(s);

    // True when the newest turn carries ChatGPT's failure banner. Anchored to a
    // visible Retry button rather than to the phrase alone, so an old failure
    // scrolled further up the conversation cannot trigger a false positive.
    private static string ErrorPresentScript() =>
        "(function(){var b=document.querySelectorAll('button');" +
        "for(var i=b.length-1;i>=0;i--){var t=(b[i].innerText||'').trim();" +
        "if(/^retry$/i.test(t)){var r=b[i].getBoundingClientRect();" +
        "if(r.width>0&&r.height>0)return 'yes';}}" +
        "return 'no';})();";

    private static string ClickRetryScript() =>
        "(function(){var b=document.querySelectorAll('button');" +
        "for(var i=b.length-1;i>=0;i--){var t=(b[i].innerText||'').trim();" +
        "if(/^retry$/i.test(t)){b[i].click();return 'clicked';}}" +
        "return 'none';})();";

    private static string ComposerPresentScript() =>
        "(function(){var b=document.querySelector('#prompt-textarea')||document.querySelector('div[contenteditable=\"true\"]');return b?'yes':'no';})();";

    // Types the prompt into the composer and sends it, but only after reading the
    // composer back and confirming it actually holds what we meant to send.
    //
    // The read-back is the important part. Without it, a composer that silently
    // dropped or mangled the text still got Enter pressed, and ChatGPT received
    // a fragment. That failure was invisible: the old script returned the string
    // 'submitted' whether or not the text had survived. It now refuses to press
    // send on a mismatch and hands the actual composer contents back for the log.
    private static string SubmitScript(string prompt) =>
        "(function(){var P=" + J(prompt) + ";" +
        "var box=document.querySelector('#prompt-textarea')||document.querySelector('div[contenteditable=\"true\"]');" +
        "if(!box)return 'no-composer';box.focus();" +
        "try{document.execCommand('selectAll',false,null);document.execCommand('insertText',false,P);}catch(e){}" +
        "var read=function(){return (box.innerText||box.textContent||'').replace(/\\s+/g,' ').trim();};" +
        "var got=read();" +
        "if(got.length===0){try{box.textContent=P;got=read();}catch(e){}}" +
        "box.dispatchEvent(new Event('input',{bubbles:true}));" +
        "var head=P.slice(0,40).replace(/\\s+/g,' ').trim();" +
        "if(got.indexOf(head)!==0)return 'mismatch|want:'+head+'|got:'+got.slice(0,90);" +
        "setTimeout(function(){var btn=document.querySelector('button[data-testid=\"send-button\"]')||document.querySelector('button[aria-label=\"Send prompt\"]');" +
        "if(btn){btn.click();}else{box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));}},450);" +
        "return 'submitted|'+got.length+' chars';})();";

    // Returns every finished, LARGE image on the page, in DOM order (last =
    // most recent). We detect by size rather than URL: ChatGPT serves generated
    // images from signed URLs that don't match any fixed pattern, but the
    // generated image is always the big, fully-loaded one — UI chrome (avatars,
    // icons, inline SVGs) is small and gets filtered out by the size gate.
    private static string ListImagesScript() =>
        "(function(){var out=[];var imgs=document.querySelectorAll('img');" +
        "for(var i=0;i<imgs.length;i++){var im=imgs[i];var s=im.currentSrc||im.src||'';" +
        "if(!s||s.indexOf('data:image/svg')===0)continue;" +
        "if(im.complete&&(im.naturalWidth||0)>=400&&(im.naturalHeight||0)>=400){out.push(s);}}" +
        "return out;})();";

    private static string FetchScript(string src) =>
        "(function(){var SRC=" + J(src) + ";" +
        "fetch(SRC).then(function(r){return r.arrayBuffer();}).then(function(buf){var b=new Uint8Array(buf);var bin='';var c=0x8000;" +
        "for(var i=0;i<b.length;i+=c){bin+=String.fromCharCode.apply(null,b.subarray(i,i+c));}" +
        "window.chrome.webview.postMessage(JSON.stringify({type:'image',b64:btoa(bin)}));})" +
        ".catch(function(e){window.chrome.webview.postMessage(JSON.stringify({type:'error',message:String(e)}));});return 'fetching';})();";

    // ExecuteScriptAsync returns a JSON-encoded value; decode string results.
    private static string Json(string result)
    {
        try { return JsonSerializer.Deserialize<string>(result) ?? ""; }
        catch { return ""; }
    }

    private static readonly Random _rng = new();

    // ---- ui plumbing -------------------------------------------------------
    private void SetBusy(bool busy)
    {
        BtnGenNext.IsEnabled = !busy;
        BtnGenCategory.IsEnabled = !busy;
        BtnGenAllCats.IsEnabled = !busy;
        BtnDownload.IsEnabled = !busy;
        BtnScan.IsEnabled = !busy;
        BtnStop.IsEnabled = busy;
        // Both auto boxes stay live while busy: unticking either is how the
        // user stops a run, so disabling them would trap it.
    }

    private void Log(string msg)
    {
        if (!Dispatcher.CheckAccess()) { Dispatcher.Invoke(() => Log(msg)); return; }
        LogBox.AppendText(msg + "\n");
        LogBox.ScrollToEnd();
    }

    private class Article
    {
        public string Path = "";          // absolute path to the .md
        public string RelFile = "";       // path relative to the category folder
        public string Slug = "";
        public string Category = "";
        public string Title = "";
        public string Author = "";
        public string Office = "";
        public string DateUpdated = "";
        public string VelocityTier = "";
        public string Status = "";
        public string Prompt = "";
        public string ImageFile = "";
        public bool HasImage => ImageFile.Length > 0;
    }
}
