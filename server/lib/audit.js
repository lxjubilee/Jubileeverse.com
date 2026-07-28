'use strict';
/**
 * lib/audit.js — PubOS System-Wide Audit Log (Phase 3)
 *
 * Provides a fire-and-forget logAuditEvent() helper that inserts into
 * jv_audit_log. Errors are caught and logged but never thrown, so callers
 * are never blocked by audit failures.
 *
 * Event type catalogue:
 *   content.created, content.updated, content.status_changed,
 *   content.published, content.archived, content.deleted,
 *   content.rolled_back, taxonomy.node_created, taxonomy.node_moved,
 *   user.login, user.permission_changed, site.config_changed,
 *   ai.generation_requested, ai.generation_completed
 */

/**
 * Insert a row into jv_audit_log. Fire-and-forget — never throws.
 *
 * @param {import('pg').Pool} pgPool
 * @param {{
 *   event_type:  string,
 *   actor_id?:   string | null,
 *   target_type?: string | null,
 *   target_id?:  string | null,
 *   details?:    Record<string, unknown>,
 *   ip_address?: string | null,
 *   user_agent?: string | null,
 * }} event
 */
async function logAuditEvent(pgPool, {
    event_type,
    actor_id    = null,
    target_type = null,
    target_id   = null,
    details     = {},
    ip_address  = null,
    user_agent  = null,
} = {}) {
    try {
        await pgPool.query(
            `INSERT INTO jv_audit_log
               (event_type, actor_id, target_type, target_id, details, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6::inet, $7)`,
            [
                event_type,
                actor_id,
                target_type,
                target_id   !== null ? String(target_id) : null,
                JSON.stringify(details),
                ip_address,
                user_agent,
            ]
        );
    } catch (err) {
        // Audit failures must never interrupt the main request flow
        console.error('[audit] Failed to log event:', event_type, err.message);
    }
}

module.exports = { logAuditEvent };
