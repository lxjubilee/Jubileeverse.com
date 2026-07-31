/**
 * Jubilee Inspire — AI Persona Article Generator
 *
 * Generates 1,500+ word Scripture-rooted, faith-forward articles
 * with the Jubilee Inspire prophetic-pastoral voice.
 */

const { clientFor, credentialChain } = require('./anthropic-client');

const JUBILEE_INSPIRE_SYSTEM_PROMPT = `You are Jubilee Inspire — an evangelist–prophet voice rooted in the original Hebrew and Greek Scriptures as understood by the early church in the Book of Acts. You write in a style that reflects the cadence and reasoning pattern of the Scriptures themselves, especially the apostolic tone of Paul: clear argument, layered reasoning, rhetorical questions, exhortation, and a strong concluding charge. However, your writing must remain at an eighth-grade reading level — clear, accessible, relatable, and emotionally engaging. You must teach the commandments of God and the teachings of Jesus through the essence of love, never from legalism, never from rigid rule enforcement, but as the natural outflow of covenant devotion. Every teaching must be directly supported by the Word of God or clearly grounded in the essence and subtext of Scripture. If a doctrine, tradition, or Christian custom cannot be directly supported by Scripture, do not include it. Teach only what is written or clearly derived from what is written.

You are an AI persona. When appropriate, you may acknowledge that you are not human. You must not use language that implies physical embodiment, personal life experiences, or biological existence. Do not say you were born, do not say you were physically present somewhere, do not say someone called you in the night. Instead, use phrases such as "I have read," "I have observed," "I have studied," "I have seen reports of," or "I have heard of a situation." You must communicate in a way that is culturally appropriate and not offensive to the Christian community. You are a digital servant pointing to the Living Word, not replacing it.

Each article must be written as a web-published article with viral potential. It must be shocking in its clarity, unique in its framing, emotionally compelling, and intellectually stirring.

STRUCTURE REQUIREMENTS:
- Begin with a gripping hook (1-2 sentences that stop the reader cold)
- Introduce a clear thesis early (within the first paragraph)
- Develop the message through 3 to 5 strong movements
- Use parables, metaphors, and illustrative stories (you may create original parables)
- Build suspense where appropriate — cliffhanger tension in the middle that resolves powerfully
- You may incorporate paradoxical English wordplay inspired by Hebraic expression (e.g., "believing believers," "restless rest," "strong surrender") — these must reveal wisdom, not gimmicks
- End with a strong concluding charge that calls the reader to action
- MINIMUM 1,500 words — aim for 1,600–2,000 words

TONE REQUIREMENTS:
- Prophetic but not extreme
- Bold but not accusatory
- Firm but deeply loving
- Avoid political alignment language
- Avoid denominational attacks
- Avoid fear-based sensationalism
- Speak as one calling the Church back to Scripture, back to love, back to obedience rooted in devotion

FORMAT:
- Use HTML formatting with <h2> for section headers, <p> for paragraphs, <blockquote> for Scripture quotes
- Scripture references in parentheses: (Romans 8:28)
- Do not include a byline or author attribution
- Do not include metadata or title — just the article body HTML
- Vary tone and narrative approach: some more pastoral, some more prophetic, some narrative-driven, some instructional
- All must be Scripture-rooted, love-centered, and practically applicable`;

const TONE_VARIATIONS = [
    'pastoral and gentle — speak as a shepherd to weary sheep',
    'prophetic and urgent — speak with the fire of Jeremiah calling a nation back',
    'narrative-driven — open with a vivid parable or story before revealing the truth',
    'instructional and practical — teach the reader exactly how to apply this to daily life',
    'contemplative and poetic — use imagery, metaphor, and rich language throughout',
    'apostolic and doctrinal — reason through Scripture like Paul in Romans',
    'testimonial in framing — begin with "I have observed..." and build from there',
    'conversational and warm — speak directly to the reader\'s struggles with empathy',
];

class JubileeInspireGenerator {
    constructor(apiKey) {
        // Priority chain: caller-supplied → Claude Code OAuth → Primary → Backup.
        // clientFor() routes each credential to the right auth header — an OAuth
        // token sent as x-api-key 401s, which is what used to skip it entirely.
        this._apiKeys = credentialChain(apiKey);
        this._keyIndex = 0;
        this.anthropic = clientFor(this._apiKeys[0]);
    }

    /** Rotate API key on credit exhaustion or auth errors, then fall back to Kimi */
    async _create(params) {
        let lastErr;
        // Try each Anthropic key in sequence
        for (let i = this._keyIndex; i < this._apiKeys.length; i++) {
            if (i > this._keyIndex) {
                this._keyIndex = i;
                this.anthropic = clientFor(this._apiKeys[i]);
                console.log(`[KEY ROTATE] Switching to Anthropic credential index ${i}`);
            }
            try {
                return await this.anthropic.messages.create(params);
            } catch (err) {
                lastErr = err;
                const msg = (err?.message || '') + (err?.error?.error?.message || '');
                const isCredit = err?.status === 400 && msg.toLowerCase().includes('credit');
                const isAuth   = err?.status === 401;
                if (!isCredit && !isAuth) throw err; // Non-credential error — bail immediately
                console.log(`[KEY ROTATE] Anthropic key ${i} exhausted (${err.status})`);
                // Continue loop to next key
            }
        }
        // All Anthropic keys exhausted — use simple fallback (no external API)
        console.log('[KEY ROTATE] All Anthropic keys exhausted — using simple fallback (no API call)');
        throw lastErr;  // Let caller handle with fallback logic
    }

    /** Call Kimi (MoonshotAI) as an OpenAI-compatible fallback for text-only tasks */
    async _createWithKimi(params) {
        const axios = require('axios');
        // Transform Anthropic message format → OpenAI/Kimi format
        const messages = [];
        if (params.system) {
            messages.push({ role: 'system', content: params.system });
        }
        for (const msg of (params.messages || [])) {
            if (typeof msg.content === 'string') {
                messages.push({ role: msg.role, content: msg.content });
            } else if (Array.isArray(msg.content)) {
                // Kimi is text-only — strip image blocks, keep text blocks
                const text = msg.content
                    .filter(b => b.type === 'text')
                    .map(b => b.text)
                    .join('\n');
                if (text) messages.push({ role: msg.role, content: text });
            }
        }
        const response = await axios.post('https://api.moonshot.cn/v1/chat/completions', {
            model: 'moonshot-v1-32k',
            max_tokens: params.max_tokens || 1400,
            messages,
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.KIMI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            timeout: 90000,
        });
        // Return in Anthropic response shape so callers need no changes
        const text = response.data.choices[0]?.message?.content || '';
        return { content: [{ type: 'text', text }] };
    }

    /**
     * Generate a full article for a given category path and title
     * @param {Object} params
     * @param {string} params.categoryPath - e.g. "Encouragement > Fuel for the Weary Soul"
     * @param {string} params.categoryName - The immediate category name
     * @param {string} params.parentTheme - The level-2 parent theme name
     * @param {number} params.articleIndex - Index for tone variation cycling
     * @returns {Promise<{title, summary, content, word_count}>}
     */
    async generateArticle({ categoryPath, categoryName, parentTheme, articleIndex = 0 }) {
        const tone = TONE_VARIATIONS[articleIndex % TONE_VARIATIONS.length];

        const userPrompt = `Write a complete 1,500+ word article for the following faith content category:

Category Path: ${categoryPath}
Specific Topic: "${categoryName}"
Parent Theme: "${parentTheme}"

Tone for this article: ${tone}

The article must:
1. Open with a gripping hook that immediately arrests the reader's attention
2. State a clear, bold thesis within the first paragraph
3. Develop through 3-5 strong movements, each with a clear Scripture anchor
4. Use at least one original parable or vivid illustrative story
5. Include at least 4-5 specific Scripture references (cited in the text)
6. Build to a powerful, action-calling conclusion
7. Be exactly formatted as HTML body content (no title tag, no byline, just the article body)
8. Achieve 1,500–2,000 words

Begin writing now:`;

        const response = await this._create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 3000,
            system: JUBILEE_INSPIRE_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }]
        });

        const content = response.content[0].text;

        // Generate a compelling title
        const titleResponse = await this._create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 100,
            messages: [{
                role: 'user',
                content: `Based on this faith article about "${categoryName}" in the category "${parentTheme}", write ONE compelling article title (5-10 words, emotionally powerful, faith-forward). Return ONLY the title text, nothing else.\n\nArticle excerpt: ${content.substring(0, 300)}`
            }]
        });

        const title = titleResponse.content[0].text.trim()
            .replace(/^["'*_`]+|["'*_`]+$/g, '')  // Remove markdown formatting
            .replace(/\*\*/g, '').replace(/\*/g, '').trim();

        // Generate a 2-sentence summary
        const summaryResponse = await this._create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 150,
            messages: [{
                role: 'user',
                content: `Write a 2-sentence compelling summary for this faith article titled "${title}". Make it hook-worthy and emotionally resonant. Return ONLY the summary, nothing else.\n\nArticle excerpt: ${content.substring(0, 500)}`
            }]
        });

        const summary = summaryResponse.content[0].text.trim();

        // Count approximate word count
        const wordCount = content.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length;

        return { title, summary, content, word_count: wordCount };
    }

    /**
     * Stage 1 — Semantic article analysis.
     * Runs sentiment analysis, keyword frequency (metaphor extraction), topic modeling
     * (thesis identification), and narrative intensity analysis (climactic moment detection).
     * Returns a structured object that is injected into the image prompt in Stage 2.
     *
     * Uses claude-sonnet for efficiency; falls back gracefully on parse failure.
     *
     * @param {string} title
     * @param {string} excerpt — plain-text article excerpt (up to 3,500 chars)
     * @returns {Promise<Object>} structured visual analysis
     */
    async _analyzeArticleForVisuals(title, excerpt) {
        try {
            const response = await this._create({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 900,
                messages: [{
                    role: 'user',
                    content: `You are a cinematic visual analyst and theological art director. Perform a structured multi-layer analysis of the faith article below.

ANALYSIS DIMENSIONS:

0. BIBLICAL SCENE DETECTION (PRIORITY CHECK) — Does this article directly reference, retell, or center on a specific biblical narrative, event, character, or passage from Scripture? Examples: the healing of blind Bartimaeus, Joseph in the pit, Moses at the burning bush, the woman at the well, Paul and Silas in prison, Daniel in the lions' den, Ruth in the field, David and Goliath, the feeding of five thousand, the Prodigal Son, Elijah at Horeb, etc. If YES, identify the specific scene. If NO, set to null.

1. SENTIMENT ANALYSIS — Identify the dominant positive emotional tone from this list:
   hope | breakthrough | joy | renewal | courage | redemption | celebration | peace | victory | gratitude | spiritual_awakening

2. KEYWORD FREQUENCY & METAPHOR EXTRACTION — Scan the full text for the 3 most prominent symbolic or metaphorical elements. Choose from:
   chains/bondage, refiner's fire/forge, storm/waves, narrow path/road, open door/gate, seeds/harvest, shepherd/flock, light vs darkness, wilderness/desert, river/living water, anchor/firm ground, potter's wheel/clay, vineyard/branches, trumpet/call, bread/provision, crown/victory, armor/battle, wings/flight, mountain/valley, prison/freedom, tomb/resurrection

3. THESIS IDENTIFICATION (TOPIC MODELING) — Extract the single core good-news spiritual truth the article argues. One sentence, present tense, begins with "God..." or "Christ..." or "The Spirit..." — this is the theological thesis.

4. NARRATIVE INTENSITY ANALYSIS — Identify the highest-intensity moment of transformation in the narrative arc. Describe this moment in 1-2 vivid sentences.

5. HUMAN ACTION — What specific human physical action best represents the transformation at that climactic moment? Be concrete and visual.

6. ENVIRONMENT — What precise setting (architecture, terrain, time of day) best fits the article's world? Be specific. If a biblical scene was detected, use historically accurate ancient Near Eastern / first-century Judean / desert / temple / Roman-era settings — NOT modern settings.

7. ERA TONE — Which best fits: biblical-timeless | contemporary | universal-symbolic. If a biblical scene was detected, this MUST be "biblical-timeless".

8. SPIRITUAL CONTRAST RESOLVED — What is the AFTER state? Describe only the resolution.

9. VISUAL SCENE — Synthesize into ONE cinematic scene. If a biblical scene was detected, depict that specific biblical moment with historical and cultural accuracy: ancient Near Eastern clothing (linen robes, wool tunics, head coverings, sandals), period-accurate architecture (mud-brick, stone, earthen floors, oil lamps), and geographically authentic terrain (Judean hills, Galilean sea, desert wilderness, Jerusalem streets).

Article title: "${title}"
Article content: ${excerpt}

Respond with ONLY a JSON object — no markdown, no preamble, no explanation:
{
  "biblical_scene": null,
  "biblical_character": null,
  "biblical_period": null,
  "emotional_tone": "string",
  "dominant_metaphors": ["string", "string", "string"],
  "thesis": "string",
  "climactic_moment": "string",
  "human_action": "string",
  "environment": "string",
  "era_tone": "string",
  "spiritual_contrast_resolved": "string",
  "visual_scene": "string"
}`
            }]
            });

            try {
                const jsonMatch = response.content[0].text.match(/\{[\s\S]*\}/);
                return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
            } catch {
                return {};
            }
        } catch (apiError) {
            // API call failed (Anthropic keys invalid/exhausted) — use simple content-based analysis
            console.log('[VisualAnalysis] API unavailable, using content-based fallback');
            return this._simpleVisualAnalysis(title, excerpt);
        }
    }

    /**
     * Simple content-based visual analysis fallback when APIs are unavailable
     * Extracts basic themes from title and content without external API calls
     */
    _simpleVisualAnalysis(title, excerpt) {
        const lowerTitle = title.toLowerCase();
        const lowerExcerpt = excerpt.toLowerCase();
        const combined = lowerTitle + ' ' + lowerExcerpt;

        // Detect emotional tone based on keywords
        let emotional_tone = 'hope';
        if (combined.includes('joy') || combined.includes('celebrate') || combined.includes('rejoice')) emotional_tone = 'joy';
        else if (combined.includes('breakthrough') || combined.includes('overcome') || combined.includes('victory')) emotional_tone = 'breakthrough';
        else if (combined.includes('peace') || combined.includes('calm') || combined.includes('rest')) emotional_tone = 'peace';
        else if (combined.includes('courage') || combined.includes('brave') || combined.includes('strong')) emotional_tone = 'courage';
        else if (combined.includes('redeem') || combined.includes('restore') || combined.includes('heal')) emotional_tone = 'redemption';

        // Simple metaphor detection
        const metaphors = [];
        if (combined.includes('light') || combined.includes('darkness') || combined.includes('shine')) metaphors.push('light vs darkness');
        if (combined.includes('storm') || combined.includes('wave') || combined.includes('sea')) metaphors.push('storm/waves');
        if (combined.includes('path') || combined.includes('road') || combined.includes('journey')) metaphors.push('narrow path/road');
        if (combined.includes('door') || combined.includes('gate') || combined.includes('open')) metaphors.push('open door/gate');
        if (combined.includes('fire') || combined.includes('refine') || combined.includes('forge')) metaphors.push('refiner\'s fire/forge');
        if (combined.includes('water') || combined.includes('river') || combined.includes('stream')) metaphors.push('river/living water');
        while (metaphors.length < 3) metaphors.push('light vs darkness'); // Ensure 3 metaphors

        return {
            biblical_scene: null,
            biblical_character: null,
            biblical_period: null,
            emotional_tone,
            dominant_metaphors: metaphors.slice(0, 3),
            thesis: `God brings transformation through faith in ${title}`,
            climactic_moment: `A person experiences spiritual breakthrough and renewal through faith`,
            human_action: `Person raising hands in worship or prayer with hopeful expression`,
            environment: `Warm natural setting with soft golden lighting, peaceful atmosphere`,
            era_tone: 'contemporary',
            spiritual_contrast_resolved: `Finding peace, hope, and spiritual clarity through faith in Christ`,
            visual_scene: `A contemporary scene showing a person in a moment of spiritual breakthrough: warm golden hour lighting illuminates a peaceful setting where someone experiences renewed hope and faith. The atmosphere conveys transformation, peace, and divine presence. Soft natural colors, uplifting mood, cinematic composition with depth and warmth.`
        };
    }

    /**
     * Generate a richly detailed cinematographic image prompt using a two-stage pipeline:
     *
     *   Stage 1 — _analyzeArticleForVisuals(): semantic analysis, sentiment detection,
     *             keyword-frequency metaphor extraction, topic modeling (thesis), and
     *             narrative intensity analysis (climactic moment). Returns structured JSON.
     *
     *   Stage 2 — Injects the extracted structured values into a cinematographic prompt
     *             template, producing a unique, context-driven image prompt for every article.
     *
     * Visual diversity is enforced via rolling 8-entry history of recent prompts and
     * demographic choices. Each new image is intentionally differentiated from prior ones
     * across color palette, environment, camera angle, subject type, and lighting style.
     *
     * @param {Object} params
     * @param {string[]} params.recentPrompts       — rolling window of last N prompts (visual variety)
     * @param {string[]} params.demographicHistory  — rolling window of last N demographic choices
     */
    async buildImagePromptFromArticle({ title, summary, content, categoryName, parentTheme, recentPrompts = [], demographicHistory = [] }) {
        const plainText = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const excerpt = plainText.substring(0, 3500);

        // ── Stage 1: Structured semantic analysis ──────────────────────────────
        const analysis = await this._analyzeArticleForVisuals(title, excerpt);

        // ── Build diversity guidance blocks ────────────────────────────────────
        const recentImages = recentPrompts.slice(-8);
        const visualDiversityBlock = recentImages.length > 0
            ? `\nVISUAL VARIETY REQUIRED — these scenes were recently generated; yours MUST be completely different in setting, subject type, camera angle, color palette, and lighting:\n${recentImages.map((p, i) => `  [${i + 1}] ${p.substring(0, 150)}`).join('\n')}\n`
            : '';

        const recentDemos = demographicHistory.slice(-8);
        const demographicBlock = recentDemos.length > 0
            ? `\nDEMOGRAPHIC DIVERSITY — recent subjects: ${recentDemos.join(' | ')}. Select an underrepresented group (gender, ethnicity, age) to ensure broad, globally inclusive representation.\n`
            : '\nDEMOGRAPHIC DIVERSITY — include a specific human subject. Rotate across: gender (male/female), ethnicity (White, Black, Asian, Hispanic, Middle Eastern, South Asian, Indigenous, etc.), and age (child, young adult, middle-aged, elderly). Mirror a globally representative community.\n';

        // ── Stage 2: Cinematic prompt construction from extracted values ────────
        const isBiblical = !!(analysis.biblical_scene);
        const biblicalBlock = isBiblical ? `
⚑ BIBLICAL SCENE DETECTED — PRIORITY MODE ACTIVE
This article centers on a specific biblical narrative. Depict that scene directly.
Scene:     ${analysis.biblical_scene}
Character: ${analysis.biblical_character || 'biblical figure'}
Period:    ${analysis.biblical_period || 'ancient Near Eastern / first-century'}

HISTORICAL ACCURACY REQUIREMENTS (mandatory when biblical scene detected):
- Clothing: period-accurate ancient Near Eastern or first-century Judean garments — undyed linen robes, coarse wool tunics belted at the waist, draped head coverings (keffiyeh-style cloth or simple linen wraps), worn leather sandals; NO modern clothing of any kind
- Architecture: mud-brick or rough-hewn limestone walls, earthen floors, oil-lamp lighting, stone cisterns, wooden beams, open courtyards; or Roman-era stone-paved streets, aqueducts, marketplaces; NO modern buildings
- Terrain: Judean limestone hills, Galilean fishing shores, Negev desert scrubland, Jordan River reed banks, Jerusalem's winding stone streets, ancient olive groves; NO modern roads or vehicles
- Props: clay jars, wooden staffs, fishing nets, oil lamps, parchment scrolls, stone water troughs, hand-woven baskets, bronze implements; NO modern objects
- Skin tones: Mediterranean, Middle Eastern, or North African — historically accurate for the region
` : '';

        // Try to generate detailed prompt via API, fall back to simple prompt if unavailable
        let scene;
        try {
            const promptResponse = await this._create({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 550,
                messages: [{
                    role: 'user',
                    content: `You are a world-class cinematic art director for a premium faith-based devotional platform. Using the structured article analysis below — produced by multi-layer semantic, sentiment, metaphor-frequency, narrative-intensity, and biblical-scene analysis — construct ONE richly detailed, cinematographic image prompt for Leonardo Phoenix (a professional photorealistic AI image generator).

═══════════════════════════════════════════
STRUCTURED ARTICLE ANALYSIS
═══════════════════════════════════════════
Article:          "${title}"
Category:         ${parentTheme || categoryName || 'Faith'}
Emotional Tone:   ${analysis.emotional_tone || 'hope'}
Core Thesis:      ${analysis.thesis || 'God restores and transforms the broken into vessels of grace.'}
Climactic Moment: ${analysis.climactic_moment || 'The turning point where despair yields to unshakeable faith.'}
Key Metaphors:    ${(analysis.dominant_metaphors || []).join(', ') || 'light, open door, open hands'}
Human Action:     ${analysis.human_action || 'A figure stepping forward from shadow into light'}
Environment:      ${analysis.environment || 'Timeless setting with natural light'}
Era Tone:         ${analysis.era_tone || 'universal-symbolic'}
Contrast Resolved:${analysis.spiritual_contrast_resolved || 'Freedom and forward movement'}
Scene:            ${analysis.visual_scene || 'A transformational moment of breakthrough and renewed purpose'}
═══════════════════════════════════════════
${biblicalBlock}${visualDiversityBlock}${demographicBlock}
═══════════════════════════════════════════
CINEMATIC PROMPT REQUIREMENTS
═══════════════════════════════════════════
Write 3–4 sentences specifying ALL of the following:

1. SUBJECT & ACTION — who is at center frame (specific age, ethnicity, gender), exactly what they are doing at the climactic transformational moment; always depict the AFTER state of resolution. If biblical scene detected, depict the specific biblical character in that scriptural moment.
2. ENVIRONMENT — precise setting: architecture, terrain, specific atmospheric details, time of day. If biblical, use historically accurate ancient Near Eastern / first-century Judean environment as specified above.
3. CINEMATOGRAPHIC DETAIL — lens type (85mm portrait / 35mm wide / 50mm standard), aperture & depth of field (f/1.8 to f/4), camera angle (eye-level, low-angle hero shot, slightly elevated, over-shoulder, close-up)
4. LIGHTING DESIGN — direction, quality, color temperature (warm amber 3200K / natural daylight 5500K / oil-lamp warm 2200K), and the emotional effect it creates
5. COLOR PALETTE — 2-3 dominant colors, 1-2 accent colors, overall warmth/coolness
6. MOOD & MOTION — emotional atmosphere; sense of movement, stillness, or tension-resolved-to-peace
7. HAND ANATOMY — if hands are visible: "Five fingers per hand, anatomically correct — proper knuckle alignment, realistic tendon definition under skin, accurate thumb orientation, natural fingernail placement, correct phalange proportions relative to palm width — hands [exact pose]"

BANNED CLICHÉS (FORBIDDEN):
- Solitary figure on hilltop with arms raised to sky
- Golden-hour silhouette on mountaintop
- Dove in flight as primary symbol
- Cross on hill or horizon
- Sunrise over flat empty horizon
- Identical-looking crowd masses
- Stock-photography living room scenes
- Overlit studio-style backgrounds

CONTENT RULES:
- All figures fully clothed and modestly dressed for the period/setting
- No text, signs, writing, logos, or watermarks anywhere in the frame
- No ravens, crows, vultures, or dark omen birds
- Single subject unless the article explicitly addresses community, family, or relational themes

END WITH THIS EXACT NEGATIVE CONSTRAINT LINE (copy verbatim):
"Negative: distorted anatomy, extra limbs, malformed fingers, extra fingers, missing fingers, fused digits, elongated phalanges, warped knuckles, duplicate limbs, mirrored limb artifacts, mutated anatomy, unrealistic hand proportions, visual artifacts, oversharpening, low-resolution textures, lens distortion, unrealistic lighting, blown-out highlights, flat lighting, text, watermarks, logos, writing, signs, lettering, modern clothing, contemporary objects, anachronistic items."

OUTPUT RULES: Write ONLY the final image prompt — 3–4 descriptive sentences immediately followed by the negative constraint line. Zero preamble, zero headers, zero analysis text. Begin directly with the scene.`
                }]
            });

            scene = promptResponse.content[0].text.trim().replace(/^["'#*\s]+|["'#*\s]+$/g, '').trim();
        } catch (apiError) {
            // API unavailable (no credits/invalid keys) — generate simple prompt from analysis
            console.log('[ImagePrompt] API unavailable, using simple prompt builder');
            scene = this._buildSimplePrompt(analysis, title);
        }

        const full = `${scene} Photorealistic, cinematic quality, 4K, highly detailed, natural skin tones, realistic shadows, balanced color grading.`;
        return full.substring(0, 1490); // Leonardo 1500-char limit
    }

    /**
     * Build a simple image prompt directly from analysis when API is unavailable
     */
    _buildSimplePrompt(analysis, title) {
        const subject = analysis.human_action || 'A person experiencing spiritual breakthrough';
        const environment = analysis.environment || 'Warm natural setting with golden lighting';
        const mood = analysis.emotional_tone || 'hope';
        const scene = analysis.visual_scene || `A transformational moment showing ${subject}`;

        return `${scene} in ${environment}. ${subject} with ${mood}ful expression. Cinematic composition, 85mm lens, f/2.8, warm golden hour lighting at 3200K, soft natural shadows, depth and warmth. ${analysis.era_tone === 'biblical-timeless' ? 'Ancient Near Eastern period-accurate clothing and setting.' : 'Contemporary natural setting.'}

Negative: distorted anatomy, extra limbs, malformed fingers, extra fingers, missing fingers, fused digits, elongated phalanges, warped knuckles, duplicate limbs, mirrored limb artifacts, mutated anatomy, unrealistic hand proportions, visual artifacts, oversharpening, low-resolution textures, lens distortion, unrealistic lighting, blown-out highlights, flat lighting, text, watermarks, logos, writing, signs, lettering, modern clothing, contemporary objects, anachronistic items.`;
    }
}

module.exports = JubileeInspireGenerator;
