/**
 * Inspire Family — Persona Router
 *
 * Loads persona system prompts from .personas/ and routes each persona
 * to its designated AI model. Each persona has a primary and secondary model:
 *
 *   1. Jubilee Inspire  → Primary: Grok-2 (xAI — orchestration)     | Secondary: Claude Opus 4.6 (Anthropic — deep strategy)
 *   2. Melody Inspire   → Primary: MiniMax M2.5 (OpenRouter)        | Secondary: Claude Opus 4.6 (Anthropic — deep synthesis)
 *   3. Zariah Inspire   → Primary: Deepseek Chat (Deepseek)        | Secondary: Claude Sonnet 4.5 (fallback review)
 *   4. Elias Inspire    → Primary: Kimi K2.5 (MoonshotAI)          | Secondary: Claude Opus 4.6 (extended synthesis)
 *   5. Eliana Inspire   → Primary: GPT-4o (OpenAI)                 | Secondary: Kimi K2.5 (MoonshotAI — long-context research)
 *   6. Caleb Inspire    → Primary: MiniMax M2.5 (OpenRouter)       | Secondary: Grok-2 (xAI — audience behavior/routing)
 *   7. Imani Inspire    → Primary: GPT-4o (OpenAI)                 | Secondary: Grok-2 (xAI — alignment/drift control)
 *   8. Zev Inspire      → Primary: GLM-4 (Zhipu AI)               | Secondary: Claude Opus 4.6 (covenant synthesis)
 *   9. Amir Inspire     → Primary: MiniMax (OpenRouter)            | Secondary: Grok-2 (xAI — global coordination)
 *  10. Nova Inspire     → Primary: GPT-4o (OpenAI)                 | Secondary: Claude Opus 4.6 (long-form narrative refinement)
 *  11. Santiago Inspire → Primary: Kimi K2.5 (MoonshotAI)          | Secondary: Grok-2 (xAI — anomaly detection)
 *  12. Tahoma Inspire   → Primary: Grok-2 (xAI)                    | Secondary: Claude Sonnet 4.5 (narrative backup)
 *
 * Usage:
 *   const router = new PersonaRouter();
 *   const result = await router.invoke('jubilee', userPrompt);
 *   const result = await router.invoke('melody', userPrompt, { tier: 'secondary' });
 *   const result = await router.invoke('zariah', contentToReview);
 */

const fs = require('fs');
const path = require('path');
const { buildAnthropicClient } = require('./anthropic-client');
const https = require('https');

const PERSONAS_DIR = path.join(__dirname, '..', '.personas');

// Model assignments per persona — each has a primary and secondary model
const PERSONA_CONFIG = {
    jubilee: {
        primary:   { provider: 'grok',      model: 'grok-2-latest' },             // Orchestration, executive coordination, PM
        secondary: { provider: 'anthropic', model: 'claude-opus-4-6' },           // Deep content, theology, long-form strategy
        file: 'inspire.jubilee.md',
    },
    melody: {
        primary:   { provider: 'openrouter', model: 'minimax/minimax-m2.5' },      // Music, creative, emotional, worship content
        secondary: { provider: 'anthropic',  model: 'claude-opus-4-6' },           // Theological depth, long-form synthesis
        file: 'inspire.melody.md',
    },
    zariah: {
        primary:   { provider: 'deepseek',  model: 'deepseek-chat' },              // Doctrinal review, logical consistency
        secondary: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' }, // Fallback structural review
        file: 'inspire.zariah.md',
    },
    elias: {
        primary:   { provider: 'kimi',      model: 'kimi-k2-5' },                  // Long-context analysis, research
        secondary: { provider: 'anthropic', model: 'claude-opus-4-6' },            // Extended synthesis, argument modeling
        file: 'inspire.elias.md',
    },
    eliana: {
        primary:   { provider: 'openai',    model: 'gpt-4o' },                     // Engineering, code, architecture
        secondary: { provider: 'kimi',      model: 'kimi-k2-5' },                  // Long-context analysis, research support
        file: 'inspire.eliana.md',
    },
    caleb: {
        primary:   { provider: 'openrouter', model: 'minimax/minimax-m2.5' },      // Evangelistic messaging, conversion copy, clarity (MiniMax M2.5 via OpenRouter)
        secondary: { provider: 'grok',       model: 'grok-2-latest' },             // Audience behavior modeling, release sequencing
        file: 'inspire.caleb.md',
    },
    imani: {
        primary:   { provider: 'openai', model: 'gpt-4o' },                        // Revival, emotional intensity, call-and-response
        secondary: { provider: 'grok',   model: 'grok-2-latest' },                 // Alignment moderation, drift prevention
        file: 'inspire.imani.md',
    },
    zev: {
        primary:   { provider: 'zhipu',     model: 'glm-4' },                      // Hebrew/Greek linguistics, covenant context (upgrade to GLM-5 when available)
        secondary: { provider: 'anthropic', model: 'claude-opus-4-6' },            // Long-form covenant synthesis
        file: 'inspire.zev.md',
    },
    amir: {
        primary:   { provider: 'openrouter', model: 'minimax/minimax-01' },        // Multilingual, cross-cultural, global strategy (via OpenRouter)
        secondary: { provider: 'grok',       model: 'grok-2-latest' },             // Real-time global coordination
        file: 'inspire.amir.md',
    },
    nova: {
        primary:   { provider: 'openai',    model: 'gpt-4o' },                     // Visual reasoning, symbol, creative narrative
        secondary: { provider: 'anthropic', model: 'claude-opus-4-6' },            // Long-form narrative structural refinement
        file: 'inspire.nova.md',
    },
    santiago: {
        primary:   { provider: 'kimi',  model: 'kimi-k2-5' },                      // High-iteration stress testing, edge case simulation (ref: "Giga Potato" in persona file)
        secondary: { provider: 'grok',  model: 'grok-2-latest' },                  // Real-time anomaly detection
        file: 'inspire.santiago.md',
    },
    tahoma: {
        primary:   { provider: 'grok',      model: 'grok-2-latest' },              // Cultural context, reconciliation
        secondary: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' }, // Narrative backup
        file: 'inspire.tahoma.md',
    },
};

class PersonaRouter {
    constructor() {
        // Anthropic client (Jubilee secondary, Melody secondary, Zariah secondary, Elias secondary, Zev secondary, Nova secondary, Tahoma secondary)
        //
        // Shares the standard credential chain, so CLAUDE_CODE now leads where
        // this used to prefer PRIMARY — and, more to the point, an OAuth token
        // is sent as a Bearer token instead of as x-api-key, which 401s.
        // Null when nothing is configured; callers already guard on that.
        this._anthropic = buildAnthropicClient();

        // Deepseek API key (Zariah primary)
        // NOTE: DEEPSEEK_EMAIL / DEEPSEEK_PASSWORD are web login credentials only.
        // The Deepseek API requires a separate API key generated from their dashboard.
        // Set DEEPSEEK_API_KEY in .env to enable Zariah.
        this._deepseekKey = process.env.DEEPSEEK_API_KEY || null;

        // Kimi (MoonshotAI) API key (Elias primary — long-context analytical model)
        this._kimiKey = process.env.KIMI_API_KEY || null;

        // OpenAI API key (Eliana primary + secondary)
        this._openaiKey = process.env.OPENAI_API_KEY_PRIMARY || process.env.OPENAI_API_KEY_BACKUP || null;

        // Grok API key (Jubilee primary, Caleb secondary, Imani secondary, Amir secondary, Santiago secondary, Tahoma primary)
        this._grokKey = process.env.GROK_API_KEY_PRIMARY || process.env.GROK_API_KEY_BACKUP || null;

        // Zhipu AI API key (Zev primary — Hebrew/Greek linguistics, GLM model)
        // Generate from: https://open.bigmodel.cn/usercenter/apikeys
        this._zhipuKey = process.env.ZHIPU_API_KEY || null;

        // OpenRouter API key (Melody primary, Caleb primary, Amir primary — MiniMax models via OpenRouter gateway)
        this._openrouterKey = process.env.OPENROUTER_API_KEY || null;

        // Arcee AI API key (Imani primary — Trinity Large expressive/revival model)
        // Generate from: https://app.arcee.ai
        this._arceeKey = process.env.ARCEE_API_KEY || null;

        // Persona prompt cache
        this._promptCache = {};
    }

    /**
     * Load and cache a persona's system prompt from .personas/<file>
     * Strips credential reference lines as a safety net.
     * @param {string} filename
     * @returns {string}
     */
    _loadPersonaPrompt(filename) {
        if (this._promptCache[filename]) return this._promptCache[filename];
        const filePath = path.join(PERSONAS_DIR, filename);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Persona file not found: ${filePath}`);
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        // Strip any credential reference lines (safety net)
        const cleaned = raw
            .split('\n')
            .filter(line => !/process\.env\.(DEEPSEEK|GROK|ANTHROPIC)/i.test(line))
            .join('\n')
            .trim();
        this._promptCache[filename] = cleaned;
        return cleaned;
    }

    /**
     * Route a prompt to the correct AI model for the given persona.
     *
     * @param {string} personaName  — 'jubilee' | 'melody' | 'zariah' | 'elias' | 'eliana' | 'tahoma'
     * @param {string} userPrompt   — the content request or task
     * @param {Object} [options]
     * @param {string} [options.tier='primary']  — 'primary' | 'secondary'
     * @param {number} [options.maxTokens=4096]  — max output tokens
     * @returns {Promise<{persona, tier, model, provider, text}>}
     */
    async invoke(personaName, userPrompt, options = {}) {
        const config = PERSONA_CONFIG[personaName.toLowerCase()];
        if (!config) {
            throw new Error(`Unknown persona: "${personaName}". Available: ${Object.keys(PERSONA_CONFIG).join(', ')}`);
        }

        const tier = options.tier === 'secondary' ? 'secondary' : 'primary';
        const modelConfig = config[tier];
        const maxTokens = options.maxTokens || 4096;
        const systemPrompt = config.file ? this._loadPersonaPrompt(config.file) : null;

        let text;
        switch (modelConfig.provider) {
            case 'anthropic':
                text = await this._callAnthropic(modelConfig.model, systemPrompt, userPrompt, maxTokens);
                break;
            case 'deepseek':
                text = await this._callDeepseek(modelConfig.model, systemPrompt, userPrompt, maxTokens);
                break;
            case 'kimi':
                text = await this._callKimi(modelConfig.model, systemPrompt, userPrompt, maxTokens);
                break;
            case 'openai':
                text = await this._callOpenAI(modelConfig.model, systemPrompt, userPrompt, maxTokens);
                break;
            case 'grok':
                text = await this._callGrok(modelConfig.model, systemPrompt, userPrompt, maxTokens);
                break;
            case 'zhipu':
                text = await this._callZhipu(modelConfig.model, systemPrompt, userPrompt, maxTokens);
                break;
            case 'openrouter':
                text = await this._callOpenRouter(modelConfig.model, systemPrompt, userPrompt, maxTokens);
                break;
            case 'arcee':
                text = await this._callArcee(modelConfig.model, systemPrompt, userPrompt, maxTokens);
                break;
            default:
                throw new Error(`Unknown provider: ${modelConfig.provider}`);
        }

        return { persona: personaName, tier, model: modelConfig.model, provider: modelConfig.provider, text };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Provider implementations
    // ─────────────────────────────────────────────────────────────────────────

    async _callAnthropic(model, systemPrompt, userPrompt, maxTokens) {
        if (!this._anthropic) throw new Error('Anthropic API key not configured (ANTHROPIC_API_KEY_PRIMARY)');
        const params = {
            model,
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: userPrompt }],
        };
        if (systemPrompt) params.system = systemPrompt;
        const response = await this._anthropic.messages.create(params);
        return response.content[0].text;
    }

    async _callDeepseek(model, systemPrompt, userPrompt, maxTokens) {
        if (!this._deepseekKey) {
            throw new Error(
                'Deepseek API key not configured. Set DEEPSEEK_API_KEY in .env.\n' +
                'Note: DEEPSEEK_EMAIL / DEEPSEEK_PASSWORD are web login credentials only — ' +
                'the API requires a separate API key from https://platform.deepseek.com/api_keys'
            );
        }

        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: userPrompt });

        const body = JSON.stringify({ model, messages, max_tokens: maxTokens });

        return new Promise((resolve, reject) => {
            const reqOptions = {
                hostname: 'api.deepseek.com',
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this._deepseekKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            };

            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject(new Error(`Deepseek API ${res.statusCode}: ${JSON.stringify(parsed)}`));
                        } else {
                            resolve(parsed.choices[0].message.content);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse Deepseek response: ${data}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    async _callKimi(model, systemPrompt, userPrompt, maxTokens) {
        if (!this._kimiKey) {
            throw new Error('Kimi API key not configured. Set KIMI_API_KEY in .env.');
        }

        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: userPrompt });

        const body = JSON.stringify({ model, messages, max_tokens: maxTokens });

        return new Promise((resolve, reject) => {
            const reqOptions = {
                hostname: 'api.moonshot.cn',
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this._kimiKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            };

            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject(new Error(`Kimi API ${res.statusCode}: ${JSON.stringify(parsed)}`));
                        } else {
                            resolve(parsed.choices[0].message.content);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse Kimi response: ${data}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    async _callOpenAI(model, systemPrompt, userPrompt, maxTokens) {
        if (!this._openaiKey) {
            throw new Error('OpenAI API key not configured (OPENAI_API_KEY_PRIMARY)');
        }

        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: userPrompt });

        const body = JSON.stringify({ model, messages, max_tokens: maxTokens });

        return new Promise((resolve, reject) => {
            const reqOptions = {
                hostname: 'api.openai.com',
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this._openaiKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            };

            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject(new Error(`OpenAI API ${res.statusCode}: ${JSON.stringify(parsed)}`));
                        } else {
                            resolve(parsed.choices[0].message.content);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse OpenAI response: ${data}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    async _callGrok(model, systemPrompt, userPrompt, maxTokens) {
        if (!this._grokKey) throw new Error('Grok API key not configured (GROK_API_KEY_PRIMARY)');

        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: userPrompt });

        const body = JSON.stringify({ model, messages, max_tokens: maxTokens });

        return new Promise((resolve, reject) => {
            const reqOptions = {
                hostname: 'api.x.ai',
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this._grokKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            };

            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject(new Error(`Grok API ${res.statusCode}: ${JSON.stringify(parsed)}`));
                        } else {
                            resolve(parsed.choices[0].message.content);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse Grok response: ${data}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    async _callZhipu(model, systemPrompt, userPrompt, maxTokens) {
        if (!this._zhipuKey) {
            throw new Error('Zhipu AI API key not configured. Set ZHIPU_API_KEY in .env. Generate at: https://open.bigmodel.cn/usercenter/apikeys');
        }

        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: userPrompt });

        const body = JSON.stringify({ model, messages, max_tokens: maxTokens });

        return new Promise((resolve, reject) => {
            const reqOptions = {
                hostname: 'open.bigmodel.cn',
                path: '/api/paas/v4/chat/completions',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this._zhipuKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            };

            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject(new Error(`Zhipu API ${res.statusCode}: ${JSON.stringify(parsed)}`));
                        } else {
                            resolve(parsed.choices[0].message.content);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse Zhipu response: ${data}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    async _callOpenRouter(model, systemPrompt, userPrompt, maxTokens) {
        if (!this._openrouterKey) {
            throw new Error('OpenRouter API key not configured. Set OPENROUTER_API_KEY in .env.');
        }

        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: userPrompt });

        const body = JSON.stringify({ model, messages, max_tokens: maxTokens });

        return new Promise((resolve, reject) => {
            const reqOptions = {
                hostname: 'openrouter.ai',
                path: '/api/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this._openrouterKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            };

            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject(new Error(`OpenRouter API ${res.statusCode}: ${JSON.stringify(parsed)}`));
                        } else {
                            resolve(parsed.choices[0].message.content);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse OpenRouter response: ${data}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    async _callArcee(model, systemPrompt, userPrompt, maxTokens) {
        if (!this._arceeKey) {
            throw new Error('Arcee AI API key not configured. Set ARCEE_API_KEY in .env. Generate at: https://app.arcee.ai');
        }

        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: userPrompt });

        const body = JSON.stringify({ model, messages, max_tokens: maxTokens });

        return new Promise((resolve, reject) => {
            const reqOptions = {
                hostname: 'api.arcee.ai',
                path: '/v2/chat/completions',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this._arceeKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            };

            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject(new Error(`Arcee API ${res.statusCode}: ${JSON.stringify(parsed)}`));
                        } else {
                            resolve(parsed.choices[0].message.content);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse Arcee response: ${data}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    /**
     * Check which personas are ready (have their required API keys configured).
     * Shows both primary and secondary model readiness.
     * @returns {Object} status map
     */
    status() {
        const hasAnthropic = !!this._anthropic;
        const hasDeepseek  = !!this._deepseekKey;
        const hasKimi      = !!this._kimiKey;
        const hasOpenAI    = !!this._openaiKey;
        const hasGrok      = !!this._grokKey;

        const hasZhipu      = !!this._zhipuKey;
        const hasOpenRouter = !!this._openrouterKey;
        const hasArcee      = !!this._arceeKey;

        const providerReady = {
            anthropic:  hasAnthropic,
            deepseek:   hasDeepseek,
            kimi:       hasKimi,
            openai:     hasOpenAI,
            grok:       hasGrok,
            zhipu:      hasZhipu,
            openrouter: hasOpenRouter,
            arcee:      hasArcee,
        };

        const result = {};
        for (const [name, config] of Object.entries(PERSONA_CONFIG)) {
            const primaryReady   = providerReady[config.primary.provider];
            const secondaryReady = providerReady[config.secondary.provider];
            result[name] = {
                ready: primaryReady,
                primary: {
                    model:    config.primary.model,
                    provider: config.primary.provider,
                    ready:    primaryReady,
                },
                secondary: {
                    model:    config.secondary.model,
                    provider: config.secondary.provider,
                    ready:    secondaryReady,
                },
            };
        }
        return result;
    }
}

module.exports = PersonaRouter;
