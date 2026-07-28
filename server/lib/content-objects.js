'use strict';
/**
 * lib/content-objects.js — PubOS Content Object Helpers (Phase 3)
 *
 * Provides reusable helpers for the jv_content_objects + jv_content_revisions
 * tables: revision creation, rollback, field diff, and search text extraction.
 */

// ── 1. createRevision ─────────────────────────────────────────────────────────

/**
 * Snapshot the current state of a content object and insert a revision row.
 *
 * Called automatically on every PUT /api/content/:id before the update is
 * applied, so the revision captures the state *before* the change.
 *
 * @param {import('pg').Pool} pgPool
 * @param {string}            contentObjectId  — UUID
 * @param {object}            snapshotData     — full row from jv_content_objects
 * @param {string|null}       changeSummary    — short human-readable description
 * @param {string|null}       changedBy        — actor_id from JWT payload
 * @returns {Promise<{ id: number, version: number }>}
 */
async function createRevision(pgPool, contentObjectId, snapshotData, changeSummary, changedBy) {
    const { rows } = await pgPool.query(
        `INSERT INTO jv_content_revisions
           (content_object_id, version, snapshot, change_summary, changed_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, version`,
        [
            contentObjectId,
            snapshotData.version ?? 1,
            JSON.stringify(snapshotData),
            changeSummary || null,
            changedBy     || null,
        ]
    );
    return rows[0];
}

// ── 2. applyRollback ──────────────────────────────────────────────────────────

/**
 * Restore a content object to a prior version's snapshot.
 *
 * Steps:
 *   1. Fetch the target revision snapshot.
 *   2. Snapshot the *current* state as a new revision (the rollback itself is
 *      versioned, per Section 3.3).
 *   3. UPDATE jv_content_objects with snapshot_data fields, incrementing version.
 *
 * @param {import('pg').Pool} pgPool
 * @param {string}            contentObjectId — UUID
 * @param {number}            targetVersion   — version to restore
 * @param {string|null}       changedBy       — actor_id
 * @returns {Promise<object>} the updated content object row
 * @throws {Error} if the target version does not exist
 */
async function applyRollback(pgPool, contentObjectId, targetVersion, changedBy) {
    // 1. Find the target revision
    const { rows: revRows } = await pgPool.query(
        `SELECT snapshot FROM jv_content_revisions
          WHERE content_object_id = $1 AND version = $2
          ORDER BY id DESC LIMIT 1`,
        [contentObjectId, targetVersion]
    );
    if (!revRows.length) {
        throw new Error(`Revision version ${targetVersion} not found for object ${contentObjectId}`);
    }
    const snapshot = typeof revRows[0].snapshot === 'string'
        ? JSON.parse(revRows[0].snapshot)
        : revRows[0].snapshot;

    // 2. Read current state and record it as a new revision
    const { rows: current } = await pgPool.query(
        `SELECT * FROM jv_content_objects WHERE id = $1`,
        [contentObjectId]
    );
    if (!current.length) {
        throw new Error(`Content object ${contentObjectId} not found`);
    }
    const newVersion = current[0].version + 1;
    await createRevision(
        pgPool, contentObjectId, current[0],
        `Rollback to version ${targetVersion}`, changedBy
    );

    // 3. Apply snapshot fields to the live row
    const { rows: updated } = await pgPool.query(
        `UPDATE jv_content_objects SET
           title          = $2,
           slug           = $3,
           summary        = $4,
           status         = $5,
           language       = $6,
           extension_data = $7,
           meta_data      = $8,
           version        = $9,
           updated_by     = $10
         WHERE id = $1
         RETURNING *`,
        [
            contentObjectId,
            snapshot.title,
            snapshot.slug,
            snapshot.summary,
            snapshot.status,
            snapshot.language,
            JSON.stringify(snapshot.extension_data || {}),
            JSON.stringify(snapshot.meta_data      || {}),
            newVersion,
            changedBy || null,
        ]
    );
    return updated[0];
}

// ── 3. computeDiff ────────────────────────────────────────────────────────────

/**
 * Compute a field-by-field diff between two content object snapshots.
 *
 * Compares top-level fields plus one level of extension_data fields.
 * Returns only fields that differ.
 *
 * @param {object} snapshotA — older snapshot (JSONB parsed)
 * @param {object} snapshotB — newer snapshot (JSONB parsed)
 * @returns {Record<string, { from: unknown, to: unknown }>}
 */
function computeDiff(snapshotA, snapshotB) {
    const SKIP = new Set(['updated_at', 'search_vector', 'embedding', 'created_at']);
    const diff = {};

    // Top-level fields
    const allKeys = new Set([
        ...Object.keys(snapshotA || {}),
        ...Object.keys(snapshotB || {}),
    ]);
    for (const key of allKeys) {
        if (SKIP.has(key)) continue;
        if (key === 'extension_data') continue; // handled separately
        const aVal = JSON.stringify(snapshotA?.[key] ?? null);
        const bVal = JSON.stringify(snapshotB?.[key] ?? null);
        if (aVal !== bVal) {
            diff[key] = { from: snapshotA?.[key] ?? null, to: snapshotB?.[key] ?? null };
        }
    }

    // extension_data sub-fields
    const extA = snapshotA?.extension_data || {};
    const extB = snapshotB?.extension_data || {};
    const extKeys = new Set([...Object.keys(extA), ...Object.keys(extB)]);
    for (const key of extKeys) {
        const aVal = JSON.stringify(extA[key] ?? null);
        const bVal = JSON.stringify(extB[key] ?? null);
        if (aVal !== bVal) {
            diff[`extension_data.${key}`] = { from: extA[key] ?? null, to: extB[key] ?? null };
        }
    }

    return diff;
}

// ── 4. extractSearchText ──────────────────────────────────────────────────────

/**
 * Extract plain text from a content object row suitable for building a
 * tsvector. The DB trigger handles this automatically on INSERT/UPDATE,
 * but this function is available for offline indexing or testing.
 *
 * @param {object} obj — row from jv_content_objects
 * @returns {string} space-joined plain text
 */
function extractSearchText(obj) {
    const ext = obj.extension_data || {};
    return [
        obj.title          || '',
        obj.summary        || '',
        ext.body_html      || '',
        ext.prayer_text    || '',
        ext.lyrics_text    || '',
        ext.script_text    || '',
        ext.show_notes     || '',
    ].join(' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = {
    createRevision,
    applyRollback,
    computeDiff,
    extractSearchText,
};
