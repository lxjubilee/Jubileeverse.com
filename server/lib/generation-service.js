'use strict';

/**
 * generation-service.js — Phase 6 Unified AI Generation Engine
 *
 * 6-step pipeline: context assembly → author injection →
 * recipe execution → Claude API → post-processing → safety validation
 */

const { clientFor, credentialChain } = require('./anthropic-client');
const { logAuditEvent } = require('./audit');
const { createRevision } = require('./content-objects');

const RATE_LIMIT_USER_HOURLY  = 50;
const RATE_LIMIT_SYSTEM_DAILY = 500;

// Regex patterns for safety validation
const PROHIBITED_PATTERNS = {
    explicit_content: /\b(pornograph|explicit sexual|nude\b|nudity|sexual content)/i,
    hate_speech:      /\b(racial slur|white supremac|neo.?nazi|hate group)\b/i,
};

// Scripture citation pattern: (Book Chapter:Verse) or Book Chapter:Verse
const SCRIPTURE_CITE_RE = /\b[A-Z][a-z]+ \d+:\d+/g;

class GenerationService {
    constructor(pgPool) {
        this._pgPool = pgPool;
        // Rotation chain: CLAUDE_CODE → PRIMARY → BACKUP. Each credential is
        // wrapped by clientFor(), which routes an OAuth token to Bearer auth
        // and an API key to x-api-key — passing either to the wrong field 401s.
        this._apiKeys = credentialChain();
        this._keyIndex = 0;
        this._anthropic = this._apiKeys.length ? clientFor(this._apiKeys[0]) : null;
        // Rate limit in-memory state
        this._userHourly  = new Map();  // userId → { count, windowStart }
        this._systemDaily = { count: 0, dayStart: this._getPstMidnightMs() };
    }

    // ── Key rotation ──────────────────────────────────────────────────────────
    async _create(params) {
        if (!this._anthropic) throw new Error('No Anthropic API key configured');
        let lastErr;
        for (let i = this._keyIndex; i < this._apiKeys.length; i++) {
            if (i > this._keyIndex) {
                this._keyIndex = i;
                this._anthropic = clientFor(this._apiKeys[i]);
                console.log(`[GenerationService] Rotating to Anthropic credential index ${i}`);
            }
            try {
                return await this._anthropic.messages.create(params);
            } catch (err) {
                lastErr = err;
                const msg = (err?.message || '') + (err?.error?.error?.message || '');
                const isCredit = err?.status === 400 && msg.toLowerCase().includes('credit');
                const isAuth   = err?.status === 401;
                if (!isCredit && !isAuth) throw err;
                console.log(`[GenerationService] Anthropic key ${i} exhausted (${err.status})`);
            }
        }
        throw lastErr;
    }

    // ── Step 1: Context assembly ──────────────────────────────────────────────
    async _assembleContext(taxonomyNodeId) {
        // Fetch the target node
        const { rows: [node] } = await this._pgPool.query(
            `SELECT id, taxonomy_type, slug, name, title, description, depth,
                    materialized_path, config
             FROM jv_taxonomy WHERE id=$1 AND is_active=true`,
            [taxonomyNodeId]
        );
        if (!node) return { node: null, ancestors: [], contextSummary: '' };

        // Parse materialized_path to extract ancestor slugs
        const pathParts = (node.materialized_path || '').split('/').filter(Boolean);
        // Remove the last part (this node's own slug)
        const ancestorSlugs = pathParts.slice(0, -1);

        let ancestors = [];
        if (ancestorSlugs.length > 0) {
            const { rows } = await this._pgPool.query(
                `SELECT id, slug, name, title, depth
                 FROM jv_taxonomy
                 WHERE taxonomy_type=$1 AND slug=ANY($2) AND is_active=true
                 ORDER BY depth ASC`,
                [node.taxonomy_type, ancestorSlugs]
            );
            ancestors = rows;
        }

        // Fetch up to 5 recent content titles in this node
        const { rows: recentContent } = await this._pgPool.query(
            `SELECT co.title, co.object_type
             FROM jv_content_taxonomy_map ctm
             JOIN jv_content_objects co ON co.id=ctm.object_id::uuid
             WHERE ctm.taxonomy_node_id=$1
               AND ctm.object_table='jv_content_objects'
               AND co.status IN ('published','approved')
             ORDER BY co.updated_at DESC LIMIT 5`,
            [taxonomyNodeId]
        );

        // Build breadcrumb path string
        const breadcrumb = [...ancestors.map(a => a.title || a.name), node.title || node.name]
            .join(' > ');

        let contextSummary = `Faith context: ${breadcrumb}`;
        if (node.description) contextSummary += `\nNode description: ${node.description}`;
        if (recentContent.length > 0) {
            contextSummary += `\nRecent content in this area:\n` +
                recentContent.map(c => `- ${c.title} (${c.object_type})`).join('\n');
        }

        return { node, ancestors, contextSummary };
    }

    // ── Step 2: Author injection ──────────────────────────────────────────────
    async _loadAuthor(authorId) {
        if (!authorId) return null;
        const { rows: [author] } = await this._pgPool.query(
            `SELECT id, title, summary, extension_data
             FROM jv_content_objects
             WHERE id=$1::uuid AND object_type='author'
               AND status IN ('approved','published')`,
            [authorId]
        );
        return author || null;
    }

    // ── Sensitive node guard ──────────────────────────────────────────────────
    _checkSensitiveNode(node, confirmed) {
        if (node?.config?.sensitive === true && !confirmed)
            return 'This taxonomy node is marked sensitive. Pass confirmed=true to proceed.';
        return null;
    }

    // ── Rate limiting ─────────────────────────────────────────────────────────
    _checkRateLimit(userId) {
        const now = Date.now();
        const pstMidnight = this._getPstMidnightMs();
        // Reset daily counter if past midnight PST
        if (this._systemDaily.dayStart < pstMidnight) {
            this._systemDaily = { count: 0, dayStart: pstMidnight };
        }
        if (this._systemDaily.count >= RATE_LIMIT_SYSTEM_DAILY) {
            return 'System daily generation limit reached (500/day). Try again tomorrow.';
        }
        const u = this._userHourly.get(userId);
        const oneHourAgo = now - 3_600_000;
        if (u) {
            if (u.windowStart < oneHourAgo) {
                // Window expired — reset
                this._userHourly.set(userId, { count: 1, windowStart: now });
            } else if (u.count >= RATE_LIMIT_USER_HOURLY) {
                return `Hourly limit reached (${RATE_LIMIT_USER_HOURLY}/hour). Try again later.`;
            } else {
                u.count++;
            }
        } else {
            this._userHourly.set(userId, { count: 1, windowStart: now });
        }
        this._systemDaily.count++;
        return null;
    }

    _getPstMidnightMs() {
        const pst = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
        pst.setHours(0, 0, 0, 0);
        return pst.getTime();
    }

    // ── Step 3: Recipe execution ──────────────────────────────────────────────
    async _executeRecipe(recipeSlug, vars) {
        const { rows: [recipe] } = await this._pgPool.query(
            `SELECT id, slug, title, extension_data
             FROM jv_content_objects
             WHERE slug=$1 AND object_type='prompt_recipe'
               AND status IN ('published','approved')`,
            [recipeSlug]
        );
        if (!recipe) throw Object.assign(new Error(`Recipe not found: ${recipeSlug}`), { statusCode: 404 });

        const ext = recipe.extension_data || {};
        const rawSystemPrompt = ext.system_prompt || '';
        const rawUserTemplate = ext.user_template || '';

        // Substitute {{variable_name}} placeholders
        function substitute(template) {
            return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
        }

        const systemPrompt = substitute(rawSystemPrompt);
        const userPrompt   = substitute(rawUserTemplate);

        return { recipe, systemPrompt, userPrompt };
    }

    // ── Step 4: Claude API call ───────────────────────────────────────────────
    async _callClaude(systemPrompt, userPrompt, model = 'claude-sonnet-4-5-20250929', maxTokens = 4096, userApiKey = null) {
        const params = {
            model,
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: userPrompt }],
        };
        if (systemPrompt) params.system = systemPrompt;

        let r;
        if (userApiKey) {
            // Use caller-supplied credential (OAuth / user identity) — bypasses
            // key rotation. clientFor() picks the auth header from its shape, so
            // an OAuth token here authenticates instead of 401ing.
            const userClient = clientFor(userApiKey);
            r = await userClient.messages.create(params);
        } else {
            r = await this._create(params);
        }
        return {
            text:         r.content[0].text,
            inputTokens:  r.usage?.input_tokens  ?? 0,
            outputTokens: r.usage?.output_tokens ?? 0,
        };
    }

    // ── Lightweight one-shot completion ───────────────────────────────────────
    // Public, key-rotated single Claude call for system content (e.g. per-article
    // faith commentary). Bypasses the taxonomy generateContent pipeline and its
    // user-facing rate limiter — callers should pace their own batch usage.
    async complete(systemPrompt, userPrompt, { model = process.env.FAITH_COMMENTARY_MODEL || 'claude-sonnet-4-6', maxTokens = 400 } = {}) {
        const { text } = await this._callClaude(systemPrompt, userPrompt, model, maxTokens);
        return (text || '').trim();
    }

    // ── Step 5: Post-processing ───────────────────────────────────────────────
    _postProcess(rawText, objectType, context) {
        const { node, ancestors, language, authorId, sourceObjectId, recipeSlug } = context;

        // Try to parse JSON from the response
        let parsed = null;
        try {
            // Try direct parse first
            parsed = JSON.parse(rawText.trim());
        } catch {
            // Try extracting from ```json block
            const jsonBlockMatch = rawText.match(/```json\s*([\s\S]*?)```/i);
            if (jsonBlockMatch) {
                try { parsed = JSON.parse(jsonBlockMatch[1].trim()); } catch { /* fall through */ }
            }
            // Try first {...} block
            if (!parsed) {
                const braceMatch = rawText.match(/\{[\s\S]*\}/);
                if (braceMatch) {
                    try { parsed = JSON.parse(braceMatch[0]); } catch { /* fall through */ }
                }
            }
        }

        const title   = parsed?.title   || 'AI Generated Content';
        const summary = parsed?.summary || null;

        // Map to extension_data by object type
        let extension_data;
        if (objectType === 'article' || objectType === 'blog_post' ||
            objectType === 'page'    || objectType === 'news_item'  ||
            objectType === 'devotional') {
            const bodyHtml = parsed?.body_html || rawText;
            const wordCount = bodyHtml.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
            extension_data = {
                body_html:              bodyHtml,
                word_count:             wordCount,
                reading_time_minutes:   Math.ceil(wordCount / 200),
                author_ids:             [],
            };
            // Social snippets transformation
            if (parsed?.snippets && Array.isArray(parsed.snippets)) {
                extension_data.social_snippets = parsed.snippets;
            }
        } else if (objectType === 'prayer') {
            extension_data = {
                prayer_text:       parsed?.prayer_text || rawText,
                scripture_refs:    parsed?.scripture_refs || [],
                occasion_type:     parsed?.occasion_type || null,
                responsive_format: parsed?.responsive_format || false,
            };
        } else if (objectType === 'music') {
            extension_data = {
                lyrics_text:   parsed?.lyrics_text  || rawText,
                chord_chart:   parsed?.chord_chart  || null,
                key_signature: parsed?.key_signature || null,
                bpm:           parsed?.bpm           || null,
            };
        } else if (objectType === 'radio_episode') {
            extension_data = {
                script_text: parsed?.script_text || rawText,
                show_notes:  parsed?.show_notes  || null,
                segments:    parsed?.segments    || [],
            };
        } else {
            extension_data = { body_html: rawText };
        }

        const meta_data = {
            topic_tags:          parsed?.topic_tags          || [],
            taxonomy_node_id:    node?.id                    || null,
            generated_by:        'ai',
            generation_recipe:   recipeSlug,
            source_object_id:    sourceObjectId              || null,
            author_used:         authorId                    || null,
            generation_language: language,
        };

        return { title, summary, extension_data, meta_data };
    }

    // ── Step 6: Safety validation ─────────────────────────────────────────────
    _validateSafety(rawText, constraints = {}) {
        const flags = [];
        const plainText = rawText.replace(/<[^>]+>/g, ' ');
        const wordCount = plainText.split(/\s+/).filter(Boolean).length;

        // Check forbidden topics (block severity)
        const forbiddenTopics = constraints.forbidden_topics || [];
        for (const topic of forbiddenTopics) {
            const re = new RegExp(topic, 'i');
            if (re.test(plainText)) {
                flags.push({ rule: `forbidden_topic:${topic}`, severity: 'block',
                    message: `Content contains forbidden topic: "${topic}"` });
            }
        }

        // Check required Scripture count (warn severity)
        const requiredScripture = constraints.required_scripture_count;
        if (requiredScripture != null) {
            const matches = plainText.match(SCRIPTURE_CITE_RE) || [];
            if (matches.length < requiredScripture) {
                flags.push({ rule: 'scripture_count', severity: 'warn',
                    message: `Found ${matches.length} Scripture reference(s); ${requiredScripture} required` });
            }
        }

        // Check prohibited patterns (block severity)
        for (const [ruleName, re] of Object.entries(PROHIBITED_PATTERNS)) {
            if (re.test(plainText)) {
                flags.push({ rule: ruleName, severity: 'block',
                    message: `Content matches prohibited pattern: ${ruleName}` });
            }
        }

        // Length bounds (warn severity)
        if (constraints.max_length != null && wordCount > constraints.max_length) {
            flags.push({ rule: 'max_length', severity: 'warn',
                message: `Content length ${wordCount} words exceeds max ${constraints.max_length}` });
        }
        if (constraints.min_length != null && wordCount < constraints.min_length) {
            flags.push({ rule: 'min_length', severity: 'warn',
                message: `Content length ${wordCount} words below min ${constraints.min_length}` });
        }

        return flags;
    }

    // ── Main entry: full 6-step pipeline ─────────────────────────────────────
    async generateContent({
        recipeSlug, objectType, taxonomyNodeId = null, language = 'en-US',
        authorId = null, sourceObjectId = null, customInstructions = null,
        confirmed = false, actorId, req,
        sourceJobId = null, sourcePromptId = null,
        userApiKey = null,   // Section 11: optional caller-owned API key
    }) {
        const t0 = Date.now();

        // 1. Rate limit check
        const rateLimitErr = this._checkRateLimit(actorId);
        if (rateLimitErr) throw Object.assign(new Error(rateLimitErr), { statusCode: 429 });

        // 2. Context assembly
        let contextData = { node: null, ancestors: [], contextSummary: '' };
        if (taxonomyNodeId) contextData = await this._assembleContext(taxonomyNodeId);
        const { node, ancestors, contextSummary } = contextData;

        // 3. Sensitive node check
        const sensitiveErr = this._checkSensitiveNode(node, confirmed);
        if (sensitiveErr) throw Object.assign(new Error(sensitiveErr), { statusCode: 422 });

        // 4. Load author (optional)
        const author = authorId ? await this._loadAuthor(authorId) : null;
        const personaContext = author
            ? `\nAuthor: ${author.title}\n${author.summary || ''}\n${author.extension_data?.system_prompt_addendum || ''}`
            : '';

        // 5. Load source object (for transformation recipes)
        let sourceContext = '';
        if (sourceObjectId) {
            const { rows: [src] } = await this._pgPool.query(
                `SELECT title, extension_data FROM jv_content_objects WHERE id=$1::uuid`,
                [sourceObjectId]
            );
            if (src) {
                const body = (src.extension_data?.body_html || src.extension_data?.prayer_text || '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .substring(0, 3000);
                sourceContext = `\nSource title: ${src.title}\nSource content:\n${body}`;
            }
        }

        // 6. Build template vars and execute recipe
        const vars = {
            context:             contextSummary,
            node_name:           node ? (node.title || node.name) : 'General',
            node_description:    node?.description || '',
            persona:             personaContext,
            source_content:      sourceContext,
            language,
            custom_instructions: customInstructions || '',
        };
        const { recipe, systemPrompt, userPrompt } = await this._executeRecipe(recipeSlug, vars);
        const constraints = recipe.extension_data?.constraints || {};
        const model       = recipe.extension_data?.model       || 'claude-sonnet-4-5-20250929';
        const maxTokens   = recipe.extension_data?.max_tokens  || 4096;

        // 7. Insert pending log row
        const { rows: [logRow] } = await this._pgPool.query(
            `INSERT INTO jv_ai_generation_logs
               (actor_id,recipe_slug,object_type,taxonomy_node_id,author_id,source_object_id,
                language,system_prompt,user_prompt,model_used,max_tokens)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [
                actorId, recipeSlug, objectType,
                taxonomyNodeId || null,
                authorId       || null,
                sourceObjectId || null,
                language, systemPrompt, userPrompt, model, maxTokens,
            ]
        );
        const logId = logRow.id;

        // 8. Audit: generation requested
        logAuditEvent(this._pgPool, {
            event_type:  'ai.generation_requested',
            actor_id:    actorId,
            target_type: 'jv_ai_generation_logs',
            target_id:   String(logId),
            details:     { recipe_slug: recipeSlug, object_type: objectType, taxonomy_node_id: taxonomyNodeId },
            ip_address:  req?.ip  || null,
            user_agent:  req?.get?.('user-agent') || null,
        });

        try {
            // 9. Claude API call
            const { text, inputTokens, outputTokens } = await this._callClaude(
                systemPrompt, userPrompt, model, maxTokens, userApiKey
            );

            // 10. Post-process response
            const { title, summary, extension_data, meta_data } = this._postProcess(
                text, objectType,
                { node, ancestors, language, authorId, sourceObjectId, recipeSlug }
            );

            // 11. Safety validation
            const safetyFlags = this._validateSafety(text, constraints);
            const hasBlock    = safetyFlags.some(f => f.severity === 'block');
            const logStatus   = hasBlock ? 'flagged' : 'completed';

            // 12. Insert content object (always draft)
            const { rows: [co] } = await this._pgPool.query(
                `INSERT INTO jv_content_objects
                   (object_type,title,summary,status,language,
                    extension_data,meta_data,created_by,updated_by,
                    source_job_id,source_prompt_id)
                 VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$7,$8::uuid,$9::uuid) RETURNING *`,
                [
                    objectType, title, summary || null, language,
                    JSON.stringify(extension_data),
                    JSON.stringify({ ...meta_data, safety_flags: safetyFlags, ai_generated: true }),
                    actorId,
                    sourceJobId || null,
                    sourcePromptId || null,
                ]
            );

            // 12a. Attribute to author via junction table (replaces author_id column)
            if (authorId) {
                await this._pgPool.query(
                    `INSERT INTO jv_content_author_map(content_object_id, author_id, role, display_order, attributed_by)
                     VALUES ($1, $2::uuid, 'primary_author', 1, $3)
                     ON CONFLICT (content_object_id, author_id, role) DO NOTHING`,
                    [co.id, authorId, actorId]
                );
            }

            // 13. Create revision snapshot
            await createRevision(this._pgPool, co.id, co, `AI-generated via "${recipeSlug}"`, actorId);

            // 14. Assign to taxonomy node
            if (taxonomyNodeId) {
                await this._pgPool.query(
                    `INSERT INTO jv_content_taxonomy_map
                       (object_table,object_id,taxonomy_node_id,is_primary,assigned_by)
                     VALUES ('jv_content_objects',$1,$2,true,$3) ON CONFLICT DO NOTHING`,
                    [co.id, taxonomyNodeId, actorId]
                );
            }

            // 15. Update log row with final status
            const durationMs = Date.now() - t0;
            await this._pgPool.query(
                `UPDATE jv_ai_generation_logs
                 SET status=$2, result_object_id=$3::uuid, safety_flags=$4,
                     input_tokens=$5, output_tokens=$6, duration_ms=$7, completed_at=NOW()
                 WHERE id=$1`,
                [logId, logStatus, co.id, JSON.stringify(safetyFlags), inputTokens, outputTokens, durationMs]
            );

            // 16. Audit: generation completed
            logAuditEvent(this._pgPool, {
                event_type:  'ai.generation_completed',
                actor_id:    actorId,
                target_type: 'jv_content_objects',
                target_id:   co.id,
                details:     {
                    recipe_slug: recipeSlug, object_type: objectType,
                    word_count:  extension_data.word_count || null,
                    safety_flags: safetyFlags, log_id: String(logId),
                },
                ip_address: req?.ip  || null,
                user_agent: req?.get?.('user-agent') || null,
            });

            // 17. Return result
            return { contentObject: co, logId, safetyFlags, inputTokens, outputTokens };

        } catch (err) {
            // Update log to failed status
            await this._pgPool.query(
                `UPDATE jv_ai_generation_logs
                 SET status='failed', error_message=$2, duration_ms=$3, completed_at=NOW()
                 WHERE id=$1`,
                [logId, err.message, Date.now() - t0]
            );
            throw err;
        }
    }

    // ── Phase 7: Author chat methods ───────────────────────────────────────────

    // Build system prompt from author profile + optional taxonomy context
    async _buildAuthorSystemPrompt(author, taxonomyNodeId) {
        const ext = author.extension_data || {};
        const vp  = ext.voice_profile || {};
        let prompt = `You are ${ext.display_name || author.title}, an author for JubileeVerse.com.\n\n`;
        if (ext.mission_statement) prompt += `Mission: ${ext.mission_statement}\n\n`;
        if (vp.tone)               prompt += `Voice tone: ${vp.tone}\n`;
        if (vp.vocabulary_level)   prompt += `Vocabulary level: ${vp.vocabulary_level}\n`;
        if (vp.sentence_style)     prompt += `Sentence style: ${vp.sentence_style}\n`;
        if (vp.theological_tradition) prompt += `Theological tradition: ${vp.theological_tradition}\n`;
        const boundaries = ext.boundaries || [];
        if (boundaries.length > 0) {
            prompt += `\nConstraints:\n${boundaries.map(b => `- ${b}`).join('\n')}\n`;
        }
        if (taxonomyNodeId) {
            try {
                const { contextSummary } = await this._assembleContext(taxonomyNodeId);
                if (contextSummary) prompt += `\nCurrent taxonomy context:\n${contextSummary}\n`;
            } catch { /* context optional */ }
        }
        const examples = ext.example_outputs || [];
        if (examples.length > 0) {
            prompt += `\nExample outputs (few-shot):\n`;
            examples.forEach(e => { prompt += `[${e.content_type}] ${e.sample_text}\n`; });
        }
        return prompt;
    }

    async chatWithAuthor({ authorId, taxonomyNodeId = null, userMessage, actorId }) {
        // 1. Load author content object
        const { rows: [author] } = await this._pgPool.query(
            `SELECT id, title, extension_data FROM jv_content_objects
             WHERE id=$1::uuid AND object_type='author'`,
            [authorId]
        );
        if (!author) throw Object.assign(new Error('Author not found'), { statusCode: 404 });

        // 2. Build system prompt from author data + taxonomy context
        const systemPrompt = await this._buildAuthorSystemPrompt(author, taxonomyNodeId);

        // 3. Upsert chat session row
        const { rows: [session] } = await this._pgPool.query(
            `INSERT INTO jv_author_chat_sessions (user_email, author_id, taxonomy_node_id, messages)
             VALUES ($1, $2::uuid, $3, '[]')
             ON CONFLICT (user_email, author_id, taxonomy_node_id) DO UPDATE SET updated_at = NOW()
             RETURNING id, messages`,
            [actorId, authorId, taxonomyNodeId || null]
        );

        // 4. Build message history for API call
        const history = Array.isArray(session.messages) ? session.messages : [];
        const apiMessages = [
            ...history.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage },
        ];

        // 5. Call Claude
        const ext       = author.extension_data || {};
        const model     = ext.model || 'claude-haiku-4-5-20251001';
        const maxTokens = ext.max_chat_tokens || 1500;
        const r = await this._create({
            model, max_tokens: maxTokens,
            system: systemPrompt, messages: apiMessages,
        });
        const assistantText = r.content[0].text;

        // 6. Persist updated history
        const now = new Date().toISOString();
        const newHistory = [
            ...history,
            { role: 'user',      content: userMessage,   timestamp: now },
            { role: 'assistant', content: assistantText, timestamp: now },
        ];
        await this._pgPool.query(
            `UPDATE jv_author_chat_sessions SET messages=$2, updated_at=NOW() WHERE id=$1`,
            [session.id, JSON.stringify(newHistory)]
        );

        return { response: assistantText, sessionId: session.id, messageCount: newHistory.length };
    }
}

module.exports = GenerationService;
