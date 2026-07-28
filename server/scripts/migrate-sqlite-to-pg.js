/**
 * migrate-sqlite-to-pg.js
 *
 * One-time migration script: copies user/session/newsletter/role-permission data
 * from SQLite (data/jubileeverse.db) into PostgreSQL (jubileeverse db).
 *
 * Safe to re-run — uses INSERT ... ON CONFLICT DO NOTHING for all tables.
 *
 * Usage:
 *   node scripts/migrate-sqlite-to-pg.js
 *
 * Tables migrated:
 *   SQLite users              → PostgreSQL jv_users
 *   SQLite user_sessions      → PostgreSQL jv_user_sessions
 *   SQLite cms_sessions       → PostgreSQL jv_cms_sessions
 *   SQLite newsletter_subscribers → PostgreSQL jv_newsletter_subscribers
 *   SQLite jv_role_permissions → PostgreSQL jv_role_permissions
 *   SQLite pulse_tasks        → PostgreSQL jv_pulse_tasks
 *   SQLite reviewer_activity  → PostgreSQL jv_reviewer_activity
 *   SQLite radio_favorites    → PostgreSQL jv_radio_favorites
 *   SQLite radio_follows      → PostgreSQL jv_radio_follows
 *
 * Tables NOT migrated (owned by jubileeinspire.com IdP):
 *   oidc_rsa_keys, oidc_clients, oidc_auth_codes, oidc_refresh_tokens,
 *   idp_sessions, oidc_pkce_states
 */

'use strict';

require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

const DB_PATH = path.join(__dirname, '..', 'data', 'jubileeverse.db');
const db = new Database(DB_PATH, { readonly: true });

const pgPool = new Pool({
  host:     process.env.DB_HOST     || '207.244.228.8',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'jubileeverse',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl:      false,
});

async function migrateTable(label, rows, insertFn) {
  let inserted = 0, skipped = 0;
  for (const row of rows) {
    try {
      const result = await insertFn(row);
      if (result.rowCount > 0) inserted++; else skipped++;
    } catch (e) {
      if (e.code === '23505') { skipped++; } // unique violation — already exists
      else console.error(`  [${label}] row error:`, e.message, JSON.stringify(row).substring(0, 100));
    }
  }
  console.log(`  ${label}: ${inserted} inserted, ${skipped} skipped`);
}

async function main() {
  console.log('=== SQLite → PostgreSQL Migration ===');
  console.log(`Source: ${DB_PATH}`);
  console.log(`Target: ${process.env.DB_HOST || '207.244.228.8'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'jubileeverse'}`);
  console.log('');

  // ── 1. jv_users ──────────────────────────────────────────────────────────
  const users = db.prepare('SELECT * FROM users').all();
  await migrateTable('jv_users', users, async (u) =>
    pgPool.query(`
      INSERT INTO jv_users (
        id, email, password_hash, password_salt, name, role, permissions,
        is_active, is_locked, locked_at, locked_by, sessions_revoked_at,
        force_password_reset, last_login_at, updated_by,
        mfa_secret, mfa_enabled, mfa_backup_codes,
        idp_subject_id, entitlements, cms_roles,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      ON CONFLICT (email) DO NOTHING`,
      [
        u.id, u.email, u.password_hash || null, u.password_salt || null,
        u.name || null, u.role || 'user',
        safeJson(u.permissions, '[]'),
        u.is_active ?? 1, u.is_locked ?? 0,
        u.locked_at || null, u.locked_by || null, u.sessions_revoked_at || null,
        u.force_password_reset ?? 0, u.last_login_at || null, u.updated_by || null,
        u.mfa_secret || null, u.mfa_enabled ?? 0,
        safeJson(u.mfa_backup_codes, null),
        u.idp_subject_id || null,
        safeJson(u.entitlements, '["jubileeverse_cms"]'),
        safeJson(u.cms_roles, '[]'),
        u.created_at || new Date().toISOString(),
        u.updated_at || new Date().toISOString(),
      ]
    )
  );

  // ── 2. jv_user_sessions ───────────────────────────────────────────────────
  const userSessions = db.prepare('SELECT * FROM user_sessions').all();
  await migrateTable('jv_user_sessions', userSessions, async (s) =>
    pgPool.query(`
      INSERT INTO jv_user_sessions (
        id, user_email, session_token_hash, login_at, logout_at,
        duration_seconds, ip_address, user_agent, device_parsed,
        auth_method, mfa_satisfied, revoked_at, revoked_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT DO NOTHING`,
      [
        s.id, s.user_email, s.session_token_hash,
        s.login_at || new Date().toISOString(), s.logout_at || null,
        s.duration_seconds || null, s.ip_address || null, s.user_agent || null,
        s.device_parsed || null, s.auth_method || 'oidc', s.mfa_satisfied ?? 0,
        s.revoked_at || null, s.revoked_by || null,
      ]
    )
  );
  // Reset BIGSERIAL sequence
  await pgPool.query(`SELECT setval('jv_user_sessions_id_seq', COALESCE((SELECT MAX(id) FROM jv_user_sessions), 1))`);

  // ── 3. jv_cms_sessions (only non-expired) ─────────────────────────────────
  const cmsSessions = db.prepare(`SELECT cs.*, u.email as user_email
    FROM cms_sessions cs JOIN users u ON u.id = cs.user_id
    WHERE cs.expires_at > datetime('now')`).all();
  await migrateTable('jv_cms_sessions', cmsSessions, async (s) =>
    pgPool.query(`
      INSERT INTO jv_cms_sessions (session_id, user_id, refresh_token, csrf_token, created_at, expires_at, last_active_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (session_id) DO NOTHING`,
      [
        s.session_id, s.user_id, s.refresh_token || null, s.csrf_token,
        s.created_at || new Date().toISOString(),
        s.expires_at,
        s.last_active_at || new Date().toISOString(),
      ]
    )
  );

  // ── 4. jv_newsletter_subscribers ──────────────────────────────────────────
  const newsletters = db.prepare('SELECT * FROM newsletter_subscribers').all();
  await migrateTable('jv_newsletter_subscribers', newsletters, async (n) =>
    pgPool.query(`
      INSERT INTO jv_newsletter_subscribers (id, email, subscribed_at, active)
      VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING`,
      [n.id, n.email, n.subscribed_at || new Date().toISOString(), n.active ?? 1]
    )
  );
  await pgPool.query(`SELECT setval('jv_newsletter_subscribers_id_seq', COALESCE((SELECT MAX(id) FROM jv_newsletter_subscribers), 1))`);

  // ── 5. jv_role_permissions ────────────────────────────────────────────────
  const rolePerms = db.prepare('SELECT * FROM jv_role_permissions').all();
  await migrateTable('jv_role_permissions', rolePerms, async (r) =>
    pgPool.query(`
      INSERT INTO jv_role_permissions (id, role, permission, scope)
      VALUES ($1,$2,$3,$4) ON CONFLICT (role, permission) DO NOTHING`,
      [r.id, r.role, r.permission, r.scope || 'global']
    )
  );

  // ── 6. jv_pulse_tasks ─────────────────────────────────────────────────────
  let pulseTasks = [];
  try { pulseTasks = db.prepare('SELECT * FROM pulse_tasks').all(); } catch { /* table may not exist */ }
  await migrateTable('jv_pulse_tasks', pulseTasks, async (t) =>
    pgPool.query(`
      INSERT INTO jv_pulse_tasks (
        id, title, instructions, category_location, status, "user",
        scheduled, delivery_type, frequency_type, interval_value,
        days_of_week, execution_times, start_date, end_date,
        immediate_execution, started_at, completed_at,
        error_message, output_log, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT DO NOTHING`,
      [
        t.id, t.title || null, t.instructions || null, t.category_location || null,
        t.status || 'pending', t.user || null, t.scheduled || null,
        t.delivery_type || null, t.frequency_type || null, t.interval_value || null,
        t.days_of_week || null, t.execution_times || null, t.start_date || null,
        t.end_date || null, t.immediate_execution || null, t.started_at || null,
        t.completed_at || null, t.error_message || null, t.output_log || null,
        t.created_at || new Date().toISOString(),
        t.updated_at || new Date().toISOString(),
      ]
    )
  );

  // ── 7. jv_reviewer_activity ───────────────────────────────────────────────
  let reviewerActivity = [];
  try { reviewerActivity = db.prepare('SELECT * FROM reviewer_activity').all(); } catch { /* may not exist */ }
  await migrateTable('jv_reviewer_activity', reviewerActivity, async (a) =>
    pgPool.query(`
      INSERT INTO jv_reviewer_activity (
        id, reviewer_email, action, summary, article_id, article_headline,
        before_title, after_title, before_content, after_content, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      [
        a.id, a.reviewer_email || null, a.action || null, a.summary || null,
        a.article_id || null, a.article_headline || null, a.before_title || null,
        a.after_title || null, a.before_content || null, a.after_content || null,
        a.created_at || new Date().toISOString(),
      ]
    )
  );

  // ── 8. jv_radio_favorites ─────────────────────────────────────────────────
  let radioFavorites = [];
  try { radioFavorites = db.prepare('SELECT * FROM radio_favorites').all(); } catch { /* may not exist */ }
  await migrateTable('jv_radio_favorites', radioFavorites, async (r) =>
    pgPool.query(`
      INSERT INTO jv_radio_favorites (id, user_id, station_id, station_name, station_category, station_image, favorited_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id, station_id) DO NOTHING`,
      [r.id, r.user_id, r.station_id, r.station_name || null, r.station_category || null, r.station_image || null, r.favorited_at || new Date().toISOString()]
    )
  );

  // ── 9. jv_radio_follows ───────────────────────────────────────────────────
  let radioFollows = [];
  try { radioFollows = db.prepare('SELECT * FROM radio_follows').all(); } catch { /* may not exist */ }
  await migrateTable('jv_radio_follows', radioFollows, async (r) =>
    pgPool.query(`
      INSERT INTO jv_radio_follows (id, user_id, station_id, station_name, station_category, station_image, followed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id, station_id) DO NOTHING`,
      [r.id, r.user_id, r.station_id, r.station_name || null, r.station_category || null, r.station_image || null, r.followed_at || new Date().toISOString()]
    )
  );

  // Reset jv_users BIGSERIAL after explicit ID inserts
  await pgPool.query(`SELECT setval('jv_users_id_seq', COALESCE((SELECT MAX(id) FROM jv_users), 1))`);

  console.log('');
  console.log('=== Migration complete ===');
  console.log('All existing sessions will be invalidated — users must re-login.');
  await pgPool.end();
  db.close();
}

function safeJson(val, defaultVal) {
  if (val == null) return defaultVal;
  if (typeof val === 'object') return JSON.stringify(val);
  try { JSON.parse(val); return val; } catch { return defaultVal; }
}

main().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
