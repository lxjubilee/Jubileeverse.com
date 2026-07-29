using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace ArticleImageStudio;

// A WPF host around a real WebView2 (Edge/Chromium) browser. You log in to
// ChatGPT by hand in the embedded browser — a genuine browser, so Cloudflare's
// human-check passes normally — and the session cookies persist in the app's
// own data folder. The app then drives YOUR authenticated session with injected
// JavaScript to submit each job's image prompt, waits for the image, and posts
// it back to JubileeVerse.
//
// Ported from JubiLujah.com/tools/ArticleImageStudio. The browser-automation
// half is unchanged; the DATA half is different, because the two sites store
// articles differently:
//
//   JubiLujah    — app/web/public/articles/articles.json + core/articles/*.md
//   JubileeVerse — Postgres (image_generation_jobs), reached over the Express API
//
// So this build never touches article files. It pulls the worklist from
// GET  /api/v1/images/studio/worklist and hands each finished image to
// POST /api/v1/images/studio/{jobId}/ingest, which writes the file into
// server/public/images/generated/ and moves the job to `in_review` — leaving the
// cockpit's existing approve/reject gate exactly where it was. Nothing this app
// does auto-approves an image.
//
// NOTE: this automates the ChatGPT web UI, which may conflict with OpenAI's
// Terms of Use. It runs against your own logged-in session at your direction.
// The compliant alternatives already wired into this repo are the DALL-E 3 path
// in server.js and the local ComfyUI/FLUX path in scripts/generate-article-images.js.
public partial class MainWindow : Window
{
    private string _root = "";
    private string _toolDir = "";
    private string _configFile = "";
    private string _userDataFolder = "";

    private string _apiBase = "http://localhost:3107";
    private string _apiToken = "";

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(120) };

    private bool _ready;
    private bool _connected;
    private bool _running;
    private bool _homeRetried;
    private CancellationTokenSource? _cts;
    private TaskCompletionSource<string>? _imageMsg;

    // Durable "already generated" tracking is the job's own image_status on the
    // server (it leaves `pending` once an image is ingested, and survives
    // restarts). This session set is a second guard so a run never loops on the
    // same job even if a post hiccups.
    private readonly HashSet<string> _completedIds = new();

    private const string CHATGPT = "https://chatgpt.com/";

    // Appended to every prompt so ChatGPT renders a wide hero image, not a square.
    private const string AspectSuffix =
        "\n\nIMPORTANT: Produce this image in a 16:9 widescreen landscape aspect ratio " +
        "(wide horizontal orientation — not square, not portrait).";

    public MainWindow()
    {
        InitializeComponent();
        ResolvePaths();
        LoadConfig();
        Loaded += async (_, _) => await InitAsync();
    }

    // ---- paths -------------------------------------------------------------
    // Walks up from the binary looking for THIS repo's marker (server/server.js).
    //
    // The JubiLujah original fell back to a hardcoded `W:\JubiLujah.com` when it
    // found nothing, which would have made a stray copy write into that repo.
    // Here an unresolved root is a hard stop instead — it disables generation and
    // says so, rather than guessing at a path.
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
        _userDataFolder = Path.Combine(_toolDir, ".webview2");
        Directory.CreateDirectory(_userDataFolder);
    }

    // ---- config (git-ignored; holds the API base + bearer token) ------------
    private void LoadConfig()
    {
        try
        {
            if (!File.Exists(_configFile)) return;
            var cfg = JsonNode.Parse(File.ReadAllText(_configFile));
            var b = cfg?["apiBase"]?.GetValue<string>();
            var t = cfg?["token"]?.GetValue<string>();
            if (!string.IsNullOrWhiteSpace(b)) { _apiBase = b.TrimEnd('/'); ApiBase.Text = _apiBase; }
            if (!string.IsNullOrWhiteSpace(t)) { _apiToken = t; ApiToken.Password = t; }
        }
        catch { /* a malformed config just means "start from defaults" */ }
    }

    private void BtnSaveCfg_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            ReadApiFieldsFromUi();
            var cfg = new JsonObject { ["apiBase"] = _apiBase, ["token"] = _apiToken };
            File.WriteAllText(_configFile, cfg.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            Log("Settings saved → studio.config.json (git-ignored).");
        }
        catch (Exception ex) { Log("Could not save settings: " + ex.Message); }
    }

    private void ReadApiFieldsFromUi()
    {
        _apiBase = (ApiBase.Text ?? "").Trim().TrimEnd('/');
        _apiToken = ApiToken.Password ?? "";
    }

    private async void BtnConnect_Click(object sender, RoutedEventArgs e) => await ConnectAsync();

    // Verifies the token and permission up front, so a failure shows here rather
    // than midway through a batch.
    private async Task<bool> ConnectAsync()
    {
        ReadApiFieldsFromUi();
        if (_apiToken.Length == 0) { Log("Paste a bearer token first (a privileged account with image:generate)."); return false; }
        try
        {
            var body = await ApiGet("/api/v1/images/counts");
            var counts = JsonNode.Parse(body);
            _connected = true;
            Log($"Connected to {_apiBase} — pending {counts?["pending"]?.GetValue<int>() ?? 0}, " +
                $"in_review {counts?["in_review"]?.GetValue<int>() ?? 0}, " +
                $"approved {counts?["approved"]?.GetValue<int>() ?? 0}.");
            await LoadPendingAsync();
            return true;
        }
        catch (Exception ex)
        {
            _connected = false;
            Log("Connect failed: " + ex.Message);
            return false;
        }
    }

    // ---- http helpers ------------------------------------------------------
    private HttpRequestMessage Req(HttpMethod m, string path)
    {
        var r = new HttpRequestMessage(m, _apiBase + path);
        r.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiToken);
        return r;
    }

    private async Task<string> ApiGet(string path)
    {
        using var res = await _http.SendAsync(Req(HttpMethod.Get, path));
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode) throw new Exception($"{(int)res.StatusCode} {res.ReasonPhrase} — {Trim(text)}");
        return text;
    }

    // Raw bytes, not base64 JSON — the server's global express.json() cap is
    // 100kb, and the ingest route parses application/octet-stream instead.
    private async Task<string> ApiPostBytes(string path, byte[] bytes, CancellationToken ct)
    {
        using var req = Req(HttpMethod.Post, path);
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        req.Content = content;
        using var res = await _http.SendAsync(req, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode) throw new Exception($"{(int)res.StatusCode} {res.ReasonPhrase} — {Trim(text)}");
        return text;
    }

    private static string Trim(string s) => s.Length > 240 ? s.Substring(0, 240) + "…" : s;

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

            if (_root.Length == 0)
                Log("⚠ Could not locate the JubileeVerse repo (no server/server.js above this binary). " +
                    "Generation is disabled — run the app from inside the repo.");
            else
                Log($"Ready. Repo: {_root}");

            Log("Images are posted to the API and land in server/public/images/generated/.");
            Log("Log in to ChatGPT in the browser, then Connect and generate.");

            if (_apiToken.Length > 0) await ConnectAsync();
            else Log("No saved token — paste one and click Connect.");
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

    // ---- pending list ------------------------------------------------------
    private List<JobItem> _items = new();

    private async Task LoadPendingAsync()
    {
        _items.Clear();
        PendingList.Items.Clear();
        if (!_connected) { Log("Not connected — click Connect."); return; }
        try
        {
            var status = ChkShowAll.IsChecked == true ? "all" : "pending";
            var body = await ApiGet("/api/v1/images/studio/worklist?status=" + status);
            var arr = JsonNode.Parse(body) as JsonArray;
            if (arr == null) return;
            foreach (var n in arr)
            {
                if (n == null) continue;
                var item = new JobItem
                {
                    Id = n["id"]?.GetValue<string>() ?? "",
                    Title = n["title"]?.GetValue<string>() ?? "(untitled)",
                    Prompt = n["prompt"]?.GetValue<string>() ?? "",
                    HasImage = n["has_image"]?.GetValue<bool>() ?? false,
                };
                // A job with no prompt has nothing to send to ChatGPT.
                if (item.Id.Length == 0 || string.IsNullOrWhiteSpace(item.Prompt)) continue;
                _items.Add(item);
                PendingList.Items.Add((item.HasImage ? "✓ " : "• ") + item.Title);
            }
            Log($"{_items.Count} job(s) listed.");
        }
        catch (Exception ex) { Log("Could not load the worklist: " + ex.Message); }
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

    private async void BtnReload_Click(object sender, RoutedEventArgs e) => await LoadPendingAsync();

    private async void BtnGenNext_Click(object sender, RoutedEventArgs e)
    {
        if (!EnsureReady()) return;
        // The next job still missing an image.
        var next = _items.FirstOrDefault(x => !x.HasImage);
        if (next == null) { Log("Nothing left to generate — every job has an image."); return; }
        await RunBatch(new() { next });
    }

    private async void BtnGenAll_Click(object sender, RoutedEventArgs e)
    {
        if (!EnsureReady()) return;
        var pending = _items.Where(x => !x.HasImage).ToList();
        if (pending.Count == 0) { Log("Nothing pending. (Tick 'Show all' + select to regenerate one.)"); return; }
        await RunBatch(pending);
    }

    private void BtnStop_Click(object sender, RoutedEventArgs e)
    {
        ChkAutoAll.IsChecked = false;
        _cts?.Cancel();
        Log("Stopping after the current image…");
    }

    // Checked → generate every remaining image back-to-back, no clicking.
    // Unchecked while running → stop.
    private async void ChkAutoAll_Click(object sender, RoutedEventArgs e)
    {
        if (ChkAutoAll.IsChecked == true)
        {
            if (_running) return;
            if (!EnsureReady()) { ChkAutoAll.IsChecked = false; return; }
            var pending = _items
                .Where(x => !x.HasImage && !_completedIds.Contains(x.Id))
                .ToList();
            if (pending.Count == 0)
            {
                Log("Nothing pending — every job already has an image.");
                ChkAutoAll.IsChecked = false;
                return;
            }
            Log($"Auto mode ON — generating {pending.Count} pending image(s) with no clicking…");
            await RunBatch(pending);
            ChkAutoAll.IsChecked = false; // finished or stopped
        }
        else
        {
            _cts?.Cancel(); // unchecking stops the run
        }
    }

    // Manual fallback: grab whatever generated image is showing right now and
    // submit it — wired to the selected job, or the next pending one.
    private async void BtnDownload_Click(object sender, RoutedEventArgs e)
    {
        if (!EnsureReady()) return;
        BtnDownload.IsEnabled = false;
        try
        {
            var all = await GetImageList();
            var src = all.LastOrDefault();
            if (src == null) { Log("No finished image found on the page to download."); return; }

            JobItem? target = null;
            var i = PendingList.SelectedIndex;
            if (i >= 0 && i < _items.Count) target = _items[i];
            else target = _items.FirstOrDefault(x => !x.HasImage);

            if (target == null) { Log("No job to attach this image to."); return; }

            Log($"Manual download → {target.Title}");
            var ok = await SaveImage(src, target, CancellationToken.None);
            if (ok) await LoadPendingAsync();
        }
        catch (Exception ex) { Log("Manual download failed: " + ex.Message); }
        finally { BtnDownload.IsEnabled = true; }
    }

    private bool EnsureReady()
    {
        if (!_ready) { Log("Browser not ready yet."); return false; }
        if (_root.Length == 0) { Log("Repo root unresolved — refusing to run."); return false; }
        if (!_connected) { Log("Not connected to the API — click Connect first."); return false; }
        return true;
    }

    // ---- batch driver ------------------------------------------------------
    private async Task RunBatch(List<JobItem> jobs)
    {
        if (_running) { Log("Already running — Stop (or uncheck Auto) first."); return; }
        _running = true;
        _cts = new CancellationTokenSource();
        SetBusy(true);
        int done = 0, skipped = 0, inThread = 0;
        try
        {
            for (int i = 0; i < jobs.Count; i++)
            {
                _cts.Token.ThrowIfCancellationRequested();
                var job = jobs[i];
                // Never regenerate one already done (this session or a prior run).
                if (_completedIds.Contains(job.Id) || job.HasImage)
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
                    _completedIds.Add(job.Id);
                    if (++inThread >= 10)
                    {
                        Log("  Reached 10 images in this conversation — the next one starts a new thread.");
                        inThread = 0;
                    }
                    // Pause before the next image.
                    if (i < jobs.Count - 1)
                    {
                        var wait = _rng.Next(1000, 10001);
                        Log($"  Pausing {wait / 1000.0:0.0}s before the next image…");
                        await Task.Delay(wait, _cts.Token);
                    }
                }
            }
        }
        catch (OperationCanceledException) { Log("Stopped."); }
        catch (Exception ex) { Log("Error: " + ex.Message); }
        finally
        {
            _running = false;
            SetBusy(false);
            await LoadPendingAsync();
            Log($"\nFinished. {done} generated" + (skipped > 0 ? $", {skipped} skipped (already done)" : "") + ".");
            if (done > 0) Log("They are in the cockpit's in_review queue — approve or reject them there.");
        }
    }

    private async Task<bool> GenerateOne(JobItem job, bool newThread, CancellationToken ct)
    {
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

        // Submit (with the 16:9 landscape directive appended).
        var submit = Json(await Wv.CoreWebView2.ExecuteScriptAsync(SubmitScript(job.Prompt + AspectSuffix)));
        Log($"  submit result: {submit}");
        if (submit == "no-composer") { Log("  ✗ Could not find the chat box to type into."); return false; }

        Log("  Waiting for the image to finish generating…");
        var src = await WaitForNewImage(baseline, ct);
        if (src == null) { Log("  ✗ No finished image detected (ChatGPT may have asked a question, refused, or its layout changed)."); return false; }
        Log("  ✓ Image finished — downloading…");

        return await SaveImage(src, job, ct);
    }

    // Waits for a generated image that (a) was not already present before we
    // submitted, and (b) holds the same URL across two consecutive polls — i.e.
    // generation has settled, not a streaming/placeholder frame.
    private async Task<string?> WaitForNewImage(HashSet<string> baseline, CancellationToken ct)
    {
        var deadline = DateTime.UtcNow.AddMinutes(6);
        string? last = null;
        int stable = 0, polls = 0;
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
            if (++polls % 5 == 0)
                Log($"    …still waiting ({current.Count} image(s) on page, ~{(int)(deadline - DateTime.UtcNow).TotalSeconds}s left)");
            await Task.Delay(3000, ct);
        }
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
    // them via a web message, and hand them to the API — which writes the file
    // and moves the job to `in_review`.
    private async Task<bool> SaveImage(string src, JobItem job, CancellationToken ct)
    {
        _imageMsg = new TaskCompletionSource<string>();
        await Wv.CoreWebView2.ExecuteScriptAsync(FetchScript(src));
        var b64 = await WaitForMessage(TimeSpan.FromSeconds(60), ct);
        if (b64 == null) { Log("  Failed to download the image bytes."); return false; }

        try
        {
            var bytes = Convert.FromBase64String(b64);
            var body = await ApiPostBytes($"/api/v1/images/studio/{job.Id}/ingest", bytes, ct);
            var res = JsonNode.Parse(body);
            var savedPath = res?["image_url"]?.GetValue<string>() ?? "(unknown path)";
            var savedBytes = res?["bytes"]?.GetValue<int>() ?? bytes.Length;
            Log($"  Saved {savedPath}  ({savedBytes:N0} bytes) → {job.Title}");
            Log("  Job moved to in_review — approve it in the cockpit.");
            return true;
        }
        catch (Exception ex)
        {
            Log("  ✗ API rejected the image: " + ex.Message);
            return false;
        }
    }

    // ---- navigation + messaging helpers ------------------------------------
    // Best-effort navigation: waits for the "completed" event but never hangs on
    // it — after the timeout it proceeds, and WaitForComposer confirms the page
    // is actually usable. (A hang here was what left the app stuck/disabled.)
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

    private static string ComposerPresentScript() =>
        "(function(){var b=document.querySelector('#prompt-textarea')||document.querySelector('div[contenteditable=\"true\"]');return b?'yes':'no';})();";

    private static string SubmitScript(string prompt) =>
        "(function(){var P=" + J(prompt) + ";" +
        "var box=document.querySelector('#prompt-textarea')||document.querySelector('div[contenteditable=\"true\"]');" +
        "if(!box)return 'no-composer';box.focus();" +
        "try{document.execCommand('selectAll',false,null);document.execCommand('insertText',false,P);}catch(e){}" +
        "if(!box.textContent||box.textContent.trim()===''){box.textContent=P;}" +
        "box.dispatchEvent(new Event('input',{bubbles:true}));" +
        "setTimeout(function(){var btn=document.querySelector('button[data-testid=\"send-button\"]')||document.querySelector('button[aria-label=\"Send prompt\"]');" +
        "if(btn){btn.click();}else{box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));}},450);" +
        "return 'submitted';})();";

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
        BtnGenAll.IsEnabled = !busy;
        BtnDownload.IsEnabled = !busy;
        BtnStop.IsEnabled = busy;
    }

    private void Log(string msg)
    {
        if (!Dispatcher.CheckAccess()) { Dispatcher.Invoke(() => Log(msg)); return; }
        LogBox.AppendText(msg + "\n");
        LogBox.ScrollToEnd();
    }

    private class JobItem
    {
        public string Id = "";
        public string Title = "";
        public string Prompt = "";
        public bool HasImage;
    }
}
