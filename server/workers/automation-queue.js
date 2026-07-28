/**
 * workers/automation-queue.js — Background automation job processor
 *
 * Polls `jv_automation_jobs` for queued work and executes each job by:
 *   1. Claiming the job (FOR UPDATE SKIP LOCKED — safe for multiple worker instances)
 *   2. Resolving identity (system or user — Section 11: OAuth/API-key token lookup)
 *   3. Loading the prompt recipe from jv_content_objects
 *   4. Calling GenerationService.generateContent() `quantity` times
 *   5. Marking the job completed with token_usage and output_object_ids
 *   6. On failure: exponential backoff retry up to max_retries, then mark failed
 *
 * Run: node workers/automation-queue.js
 * Stop: SIGINT or SIGTERM — completes in-flight jobs then exits cleanly.
 */

'use strict'

const { Pool } = require('pg')
const GenerationService = require('../lib/generation-service')
const { logAuditEvent } = require('../lib/audit')
const { decrypt: decryptToken } = require('../lib/oauth-encryption')

// ── DB connection (mirrors server.js pgPool config) ───────────────────────────
const pgPool = new Pool({
    host:     process.env.DB_HOST     || '207.244.228.8',
    port:     Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME     || 'jubileeverse',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl:      false,
    max:      5,
})

const generationService = new GenerationService(pgPool)

// ── Config ────────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 5_000
const MAX_CONCURRENT   = 3

let isShuttingDown = false
let activeJobs     = 0

// ── Logging helpers ───────────────────────────────────────────────────────────
function log(level, ...args) {
    const ts = new Date().toISOString()
    console[level === 'error' ? 'error' : 'log'](`[automation-queue] ${ts}`, ...args)
}

function makeLogEntry(message, level = 'info') {
    return { ts: new Date().toISOString(), level, message }
}

// ── Poll + claim ──────────────────────────────────────────────────────────────
async function pollOnce() {
    if (isShuttingDown || activeJobs >= MAX_CONCURRENT) return

    const client = await pgPool.connect()
    let job = null
    try {
        await client.query('BEGIN')
        const { rows } = await client.query(
            `SELECT * FROM jv_automation_jobs
             WHERE status = 'queued'
               AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
             ORDER BY priority ASC, created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`
        )
        if (!rows.length) { await client.query('ROLLBACK'); return }

        job = rows[0]
        await client.query(
            `UPDATE jv_automation_jobs
             SET status = 'running',
                 started_at = COALESCE(started_at, NOW()),
                 updated_at = NOW()
             WHERE id = $1`,
            [job.id]
        )
        await client.query('COMMIT')
    } catch (err) {
        await client.query('ROLLBACK')
        log('error', 'Poll/claim failed:', err.message)
        return
    } finally {
        client.release()
    }

    if (job) {
        activeJobs++
        processJob(job).finally(() => activeJobs--)
    }
}

// ── Main job processor ────────────────────────────────────────────────────────
async function processJob(job) {
    log('log', `Starting job ${job.id}: "${job.name}" (qty=${job.quantity ?? 1})`)

    const logEntries = [makeLogEntry(`Job started: ${job.name}`)]
    const outputObjectIds = Array.isArray(job.output_object_ids) ? [...job.output_object_ids] : []
    let totalInputTokens  = 0
    let totalOutputTokens = 0
    const t0 = Date.now()

    try {
        // Step 3 — Identity resolution (Section 11)
        const actorId = job.requested_by
        let userApiKey = null   // set when identity_type === 'user' and an active token exists

        if (job.identity_type === 'user' && job.identity_id) {
            // Look up caller's active API key / OAuth token
            const { rows: [oauthToken] } = await pgPool.query(
                `SELECT id, access_token, token_type, expires_at
                 FROM user_oauth_tokens
                 WHERE user_email = $1 AND is_active = true
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [job.identity_id]
            )
            if (oauthToken) {
                // Auto-refresh check: if OAuth token expires in < 5 minutes, skip for now
                // (api_key tokens never expire — skip refresh logic)
                const nearExpiry = oauthToken.expires_at
                    ? new Date(oauthToken.expires_at).getTime() - Date.now() < 5 * 60_000
                    : false

                if (!nearExpiry || oauthToken.token_type === 'api_key') {
                    try {
                        userApiKey = decryptToken(oauthToken.access_token)
                        // Update last_used_at
                        await pgPool.query(
                            `UPDATE user_oauth_tokens SET last_used_at = NOW(), updated_at = NOW()
                             WHERE id = $1`,
                            [oauthToken.id]
                        )
                        logAuditEvent(pgPool, {
                            event_type:  'oauth.token_used',
                            actor_id:    job.identity_id,
                            target_type: 'user_oauth_tokens',
                            target_id:   oauthToken.id,
                            details:     { job_id: job.id },
                        })
                        logEntries.push(makeLogEntry(
                            `Identity resolved: ${job.identity_id} (user — own API key)`
                        ))
                    } catch (decryptErr) {
                        log('error', `Failed to decrypt token for ${job.identity_id}:`, decryptErr.message)
                        logEntries.push(makeLogEntry(
                            `Token decryption failed — falling back to system key`, 'warn'
                        ))
                    }
                } else {
                    logEntries.push(makeLogEntry(
                        `User token near expiry — falling back to system key`, 'warn'
                    ))
                }
            } else {
                logEntries.push(makeLogEntry(
                    `No active token found for ${job.identity_id} — using system key`, 'warn'
                ))
            }
        }

        if (!userApiKey) {
            logEntries.push(makeLogEntry(`Identity resolved: ${actorId} (${job.identity_type} — system key)`))
        }

        // Step 4 — Load prompt recipe
        if (!job.prompt_recipe_id) throw new Error('No prompt_recipe_id on job')
        const { rows: [recipe] } = await pgPool.query(
            `SELECT id, slug, title FROM jv_content_objects
             WHERE id = $1 AND object_type = 'prompt_recipe'`,
            [job.prompt_recipe_id]
        )
        if (!recipe) throw new Error(`Prompt recipe ${job.prompt_recipe_id} not found`)
        logEntries.push(makeLogEntry(`Prompt recipe: "${recipe.title}" (slug: ${recipe.slug})`))

        const quantity = Math.max(1, Math.min(100, job.quantity ?? 1))

        // Step 5 — Generate loop
        for (let i = 0; i < quantity; i++) {
            logEntries.push(makeLogEntry(`Generating item ${i + 1} of ${quantity}…`))

            // Build custom_instructions from parameters if provided
            const params = job.parameters || {}
            const customInstructions = params.custom_instructions || null

            const result = await generationService.generateContent({
                recipeSlug:          recipe.slug,
                objectType:          job.target_content_type || 'article',
                taxonomyNodeId:      job.target_taxonomy_node_id || null,
                language:            params.language || 'en-US',
                actorId,
                customInstructions,
                confirmed:           true,   // worker bypasses the sensitive-node interactive check
                sourceJobId:         job.id,
                sourcePromptId:      recipe.id,
                userApiKey,                  // null unless identity_type === 'user' with active token
            })

            outputObjectIds.push(result.contentObject.id)
            totalInputTokens  += result.inputTokens  ?? 0
            totalOutputTokens += result.outputTokens ?? 0

            logEntries.push(makeLogEntry(
                `Created: "${result.contentObject.title}" (${result.contentObject.id})`
            ))

            // Persist partial progress after each generation
            await pgPool.query(
                `UPDATE jv_automation_jobs
                 SET output_object_ids = $2, execution_log_entries = $3, updated_at = NOW()
                 WHERE id = $1`,
                [job.id, outputObjectIds, JSON.stringify(logEntries)]
            )
        }

        // Step 6 — Mark completed
        logEntries.push(makeLogEntry(`Job completed: ${outputObjectIds.length} object(s) created`))
        const durationMs = Date.now() - t0
        const tokenUsage = {
            input_tokens:  totalInputTokens,
            output_tokens: totalOutputTokens,
            total_tokens:  totalInputTokens + totalOutputTokens,
        }

        await pgPool.query(
            `UPDATE jv_automation_jobs
             SET status               = 'completed',
                 completed_at         = NOW(),
                 updated_at           = NOW(),
                 output_object_ids    = $2,
                 execution_log_entries = $3,
                 token_usage          = $4,
                 duration_ms          = $5,
                 input_tokens         = $6,
                 output_tokens        = $7
             WHERE id = $1`,
            [
                job.id, outputObjectIds, JSON.stringify(logEntries),
                JSON.stringify(tokenUsage), durationMs,
                totalInputTokens, totalOutputTokens,
            ]
        )

        logAuditEvent(pgPool, {
            event_type:  'automation_job.completed',
            actor_id:    actorId,
            target_type: 'jv_automation_jobs',
            target_id:   job.id,
            details:     {
                quantity,
                output_count:  outputObjectIds.length,
                duration_ms:   durationMs,
                total_tokens:  tokenUsage.total_tokens,
            },
        })

        log('log', `Job ${job.id} completed (${outputObjectIds.length} objects, ${durationMs}ms)`)

    } catch (err) {
        logEntries.push(makeLogEntry(`Error: ${err.message}`, 'error'))
        log('error', `Job ${job.id} failed:`, err.message)

        const newRetryCount = (job.retry_count || 0) + 1
        const maxRetries    = job.max_retries || 3

        if (newRetryCount < maxRetries) {
            // Exponential backoff: 30s × 2^(retry-1)
            const backoffMs     = 30_000 * Math.pow(2, newRetryCount - 1)
            const nextAttemptAt = new Date(Date.now() + backoffMs)
            logEntries.push(
                makeLogEntry(
                    `Retry ${newRetryCount}/${maxRetries} scheduled in ${backoffMs / 1000}s`,
                    'warn'
                )
            )

            await pgPool.query(
                `UPDATE jv_automation_jobs
                 SET status                = 'queued',
                     retry_count           = $2,
                     next_attempt_at       = $3,
                     execution_log_entries = $4,
                     error_message         = $5,
                     error_details         = $6,
                     output_object_ids     = $7,
                     updated_at            = NOW()
                 WHERE id = $1`,
                [
                    job.id, newRetryCount, nextAttemptAt,
                    JSON.stringify(logEntries),
                    err.message,
                    JSON.stringify({ stack: err.stack }),
                    outputObjectIds,
                ]
            )
        } else {
            await pgPool.query(
                `UPDATE jv_automation_jobs
                 SET status                = 'failed',
                     completed_at          = NOW(),
                     updated_at            = NOW(),
                     retry_count           = $2,
                     output_object_ids     = $3,
                     execution_log_entries = $4,
                     error_message         = $5,
                     error_details         = $6
                 WHERE id = $1`,
                [
                    job.id, newRetryCount, outputObjectIds,
                    JSON.stringify(logEntries),
                    err.message,
                    JSON.stringify({ stack: err.stack }),
                ]
            )

            logAuditEvent(pgPool, {
                event_type:  'automation_job.failed',
                actor_id:    job.requested_by,
                target_type: 'jv_automation_jobs',
                target_id:   job.id,
                details:     { error: err.message, retry_count: newRetryCount },
            })
        }
    }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
async function runPollLoop() {
    log('log', `Worker started — polling every ${POLL_INTERVAL_MS}ms, max ${MAX_CONCURRENT} concurrent`)
    while (!isShuttingDown) {
        try { await pollOnce() } catch (e) { log('error', 'Unexpected poll error:', e.message) }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    }

    // Drain: wait for all in-flight jobs before exiting
    log('log', 'Shutting down — waiting for in-flight jobs…')
    while (activeJobs > 0) {
        await new Promise(r => setTimeout(r, 500))
    }
    await pgPool.end()
    log('log', 'Worker stopped cleanly.')
    process.exit(0)
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGINT',  () => { log('log', 'SIGINT received'); isShuttingDown = true })
process.on('SIGTERM', () => { log('log', 'SIGTERM received'); isShuttingDown = true })

runPollLoop().catch(err => { log('error', 'Fatal worker error:', err.message); process.exit(1) })
