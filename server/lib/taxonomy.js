'use strict';
/**
 * lib/taxonomy.js — PubOS Taxonomy Helper Functions (Phase 2)
 *
 * Provides reusable helpers for materialized path management, subtree queries,
 * and config validation for the jv_taxonomy table.
 */

// ── Valid values for config JSONB validation ──────────────────────────────────

const VALID_CONTENT_OBJECT_TYPES = [
    'article', 'prayer', 'music', 'radio_episode', 'podcast',
    'image', 'video', 'taxonomy_node', 'persona', 'site',
    'page_template', 'asset', 'prompt_recipe',
];

const VALID_HERO_SECTION_TYPES = ['featured_article', 'featured_video', 'image_banner', 'none'];
const VALID_LAYOUT_TYPES       = ['full_width', 'split', 'overlay'];
const VALID_DISPLAY_TYPES      = ['grid', 'list', 'carousel'];
const VALID_SORT_ORDERS        = ['newest', 'popular', 'editorial_rank'];
const VALID_SIDEBAR_WIDGETS    = [
    'related_prayers', 'recent_music', 'popular_articles',
    'persona_spotlight', 'taxonomy_children_nav',
];
const VALID_DYNAMIC_COMPONENTS = [
    'newsletter_signup', 'prayer_request_form', 'donation_cta', 'social_share_bar',
];

// ── 1. buildMaterializedPath ──────────────────────────────────────────────────

/**
 * Walk up the jv_taxonomy parent chain to build a slash-prefixed ancestor path.
 *
 * Example: for a node with slug 'warfare-prayer' whose parent chain is
 * intercessory-prayer → prayer → faith-and-life, returns:
 *   '/faith-and-life/prayer/intercessory-prayer/warfare-prayer'
 *
 * @param {import('pg').Pool} pgPool
 * @param {number|null} parentId  — ID of the parent node (null for root)
 * @param {string} slug           — slug of the node being inserted/updated
 * @returns {Promise<string>} materialized path string
 */
async function buildMaterializedPath(pgPool, parentId, slug) {
    if (!parentId) {
        return `/${slug}`;
    }

    // Walk up the ancestor chain using the existing materialized_path on the parent
    const { rows } = await pgPool.query(
        `SELECT materialized_path, slug FROM jv_taxonomy WHERE id = $1`,
        [parentId]
    );

    if (!rows.length) {
        return `/${slug}`;
    }

    const parent = rows[0];
    const parentPath = parent.materialized_path || `/${parent.slug}`;
    return `${parentPath}/${slug}`;
}

// ── 2. getDescendantIds ───────────────────────────────────────────────────────

/**
 * Return an array of all descendant node IDs for a given taxonomy node,
 * including the node itself. Uses WITH RECURSIVE for arbitrary depth traversal.
 *
 * Mirrors the portal query pattern used at server.js lines 4535, 4581.
 *
 * @param {import('pg').Pool} pgPool
 * @param {number} nodeId — root of the subtree
 * @returns {Promise<number[]>} array of node IDs (includes nodeId itself)
 */
async function getDescendantIds(pgPool, nodeId) {
    const { rows } = await pgPool.query(
        `WITH RECURSIVE subtree AS (
            SELECT id FROM jv_taxonomy WHERE id = $1
            UNION ALL
            SELECT t.id FROM jv_taxonomy t
            INNER JOIN subtree s ON t.parent_id = s.id
        )
        SELECT id FROM subtree`,
        [nodeId]
    );
    return rows.map(r => r.id);
}

// ── 3. validateNodeConfig ─────────────────────────────────────────────────────

/**
 * Validate a taxonomy node config JSONB object against the Phase 2 schema.
 *
 * Returns { valid: true } on success, or
 *         { valid: false, errors: string[] } listing all violations.
 *
 * @param {Record<string, unknown>} config
 * @returns {{ valid: boolean, errors?: string[] }}
 */
function validateNodeConfig(config) {
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        return { valid: false, errors: ['config must be a JSON object'] };
    }

    const errors = [];

    // allowed_content_types
    if (config.allowed_content_types !== undefined) {
        if (!Array.isArray(config.allowed_content_types)) {
            errors.push('allowed_content_types must be an array');
        } else {
            const invalid = config.allowed_content_types.filter(
                t => !VALID_CONTENT_OBJECT_TYPES.includes(t)
            );
            if (invalid.length) {
                errors.push(`allowed_content_types contains invalid values: ${invalid.join(', ')}`);
            }
        }
    }

    // required_metadata
    if (config.required_metadata !== undefined) {
        if (typeof config.required_metadata !== 'object' || Array.isArray(config.required_metadata)) {
            errors.push('required_metadata must be an object');
        } else {
            const nonBool = Object.entries(config.required_metadata)
                .filter(([, v]) => typeof v !== 'boolean');
            if (nonBool.length) {
                errors.push(`required_metadata values must be booleans: ${nonBool.map(([k]) => k).join(', ')}`);
            }
        }
    }

    // generation_recipes, publishing_destinations, preferred_personas (integer arrays)
    for (const field of ['generation_recipes', 'publishing_destinations', 'preferred_personas']) {
        if (config[field] !== undefined) {
            if (!Array.isArray(config[field])) {
                errors.push(`${field} must be an array`);
            } else if (config[field].some(v => !Number.isInteger(v))) {
                errors.push(`${field} must contain only integers`);
            }
        }
    }

    // navigation_contract
    if (config.navigation_contract !== undefined) {
        const nc = config.navigation_contract;
        if (typeof nc !== 'object' || Array.isArray(nc)) {
            errors.push('navigation_contract must be an object');
        } else {
            // hero_section
            if (nc.hero_section !== undefined) {
                const hs = nc.hero_section;
                if (hs.type !== undefined && !VALID_HERO_SECTION_TYPES.includes(hs.type)) {
                    errors.push(`navigation_contract.hero_section.type must be one of: ${VALID_HERO_SECTION_TYPES.join(', ')}`);
                }
                if (hs.layout !== undefined && !VALID_LAYOUT_TYPES.includes(hs.layout)) {
                    errors.push(`navigation_contract.hero_section.layout must be one of: ${VALID_LAYOUT_TYPES.join(', ')}`);
                }
            }
            // content_feed
            if (nc.content_feed !== undefined) {
                const cf = nc.content_feed;
                if (cf.display_type !== undefined && !VALID_DISPLAY_TYPES.includes(cf.display_type)) {
                    errors.push(`navigation_contract.content_feed.display_type must be one of: ${VALID_DISPLAY_TYPES.join(', ')}`);
                }
                if (cf.sort_order !== undefined && !VALID_SORT_ORDERS.includes(cf.sort_order)) {
                    errors.push(`navigation_contract.content_feed.sort_order must be one of: ${VALID_SORT_ORDERS.join(', ')}`);
                }
                if (cf.items_per_page !== undefined && !Number.isInteger(cf.items_per_page)) {
                    errors.push('navigation_contract.content_feed.items_per_page must be an integer');
                }
            }
            // sidebar_widgets
            if (nc.sidebar_widgets !== undefined) {
                if (!Array.isArray(nc.sidebar_widgets)) {
                    errors.push('navigation_contract.sidebar_widgets must be an array');
                } else {
                    const invalid = nc.sidebar_widgets.filter(w => !VALID_SIDEBAR_WIDGETS.includes(w));
                    if (invalid.length) {
                        errors.push(`navigation_contract.sidebar_widgets contains invalid values: ${invalid.join(', ')}`);
                    }
                }
            }
            // dynamic_components
            if (nc.dynamic_components !== undefined) {
                if (!Array.isArray(nc.dynamic_components)) {
                    errors.push('navigation_contract.dynamic_components must be an array');
                } else {
                    const invalid = nc.dynamic_components.filter(c => !VALID_DYNAMIC_COMPONENTS.includes(c));
                    if (invalid.length) {
                        errors.push(`navigation_contract.dynamic_components contains invalid values: ${invalid.join(', ')}`);
                    }
                }
            }
        }
    }

    return errors.length ? { valid: false, errors } : { valid: true };
}

// ── 4. cascadePathUpdate ──────────────────────────────────────────────────────

/**
 * After a node is moved to a new parent, recompute materialized_path for the
 * node itself and all its descendants.
 *
 * The cascade is applied level-by-level using repeated WITH RECURSIVE traversal
 * so each node's path is built from its already-updated parent.
 *
 * @param {import('pg').Pool} pgPool
 * @param {number} nodeId — root of the moved subtree
 * @returns {Promise<number>} count of updated rows
 */
async function cascadePathUpdate(pgPool, nodeId) {
    // Fetch the moved node first
    const { rows: [node] } = await pgPool.query(
        `SELECT id, parent_id, slug FROM jv_taxonomy WHERE id = $1`,
        [nodeId]
    );
    if (!node) return 0;

    // Recompute path for the root of the moved subtree
    const newPath = await buildMaterializedPath(pgPool, node.parent_id, node.slug);
    await pgPool.query(
        `UPDATE jv_taxonomy SET materialized_path = $1, updated_at = NOW() WHERE id = $2`,
        [newPath, nodeId]
    );

    // Get all direct children and recurse
    const { rows: children } = await pgPool.query(
        `SELECT id FROM jv_taxonomy WHERE parent_id = $1`,
        [nodeId]
    );

    let updated = 1;
    for (const child of children) {
        updated += await cascadePathUpdate(pgPool, child.id);
    }
    return updated;
}

module.exports = {
    buildMaterializedPath,
    getDescendantIds,
    validateNodeConfig,
    cascadePathUpdate,
    // Expose valid value lists for use in API validation
    VALID_CONTENT_OBJECT_TYPES,
    VALID_HERO_SECTION_TYPES,
    VALID_LAYOUT_TYPES,
    VALID_DISPLAY_TYPES,
    VALID_SORT_ORDERS,
    VALID_SIDEBAR_WIDGETS,
    VALID_DYNAMIC_COMPONENTS,
};
