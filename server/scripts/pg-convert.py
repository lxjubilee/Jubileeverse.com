"""
pg-convert.py — Convert remaining db.prepare() calls to pgPool.query() in server.js
"""

import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# ─── Helper ──────────────────────────────────────────────────────────────────

def s(old, new, text=None):
    """Simple string replacement; operates on content if text is None."""
    global content
    if text is None:
        content = content.replace(old, new)
    else:
        return text.replace(old, new)

# ─── 1. Reviewer activity ────────────────────────────────────────────────────

s(
    """        const rows = db.prepare(`
            SELECT id, reviewer_email, action, summary, article_id, article_headline,
                   before_title, after_title, before_content, after_content, created_at
            FROM reviewer_activity
            ORDER BY created_at DESC
            LIMIT 500
        `).all();
        res.json({ success: true, activities: rows });""",
    """        const { rows } = await pgPool.query(`
            SELECT id, reviewer_email, action, summary, article_id, article_headline,
                   before_title, after_title, before_content, after_content, created_at
            FROM jv_reviewer_activity
            ORDER BY created_at DESC
            LIMIT 500
        `);
        res.json({ success: true, activities: rows });"""
)

# ─── 2. Newsletter subscribe ─────────────────────────────────────────────────

s(
    """        const existing = db.prepare('SELECT id, active FROM newsletter_subscribers WHERE email = ?').get(trimmed);

        if (existing) {
            if (existing.active) {
                return res.json({ success: true, message: 'You are already subscribed!' });
            }
            // Re-activate
            db.prepare('UPDATE newsletter_subscribers SET active = 1, subscribed_at = datetime(\\'now\\') WHERE id = ?').run(existing.id);
            return res.json({ success: true, message: 'Welcome back! Your subscription has been reactivated.' });
        }

        db.prepare('INSERT INTO newsletter_subscribers (email) VALUES (?)').run(trimmed);""",
    """        const { rows: [existing] } = await pgPool.query('SELECT id, active FROM jv_newsletter_subscribers WHERE email = $1', [trimmed]);

        if (existing) {
            if (existing.active) {
                return res.json({ success: true, message: 'You are already subscribed!' });
            }
            // Re-activate
            await pgPool.query('UPDATE jv_newsletter_subscribers SET active = 1, subscribed_at = NOW() WHERE id = $1', [existing.id]);
            return res.json({ success: true, message: 'Welcome back! Your subscription has been reactivated.' });
        }

        await pgPool.query('INSERT INTO jv_newsletter_subscribers (email) VALUES ($1)', [trimmed]);"""
)

# Newsletter get all subscribers
s(
    """        const subscribers = db.prepare('SELECT id, email, subscribed_at, active FROM newsletter_subscribers ORDER BY subscribed_at DESC').all();
        res.json({ success: true, count: subscribers.length, subscribers });""",
    """        const { rows: subscribers } = await pgPool.query('SELECT id, email, subscribed_at, active FROM jv_newsletter_subscribers ORDER BY subscribed_at DESC');
        res.json({ success: true, count: subscribers.length, subscribers });"""
)

# Newsletter export
s(
    """        const subscribers = db.prepare('SELECT id, email, subscribed_at, active FROM newsletter_subscribers ORDER BY subscribed_at DESC').all();

        const workbook""",
    """        const { rows: subscribers } = await pgPool.query('SELECT id, email, subscribed_at, active FROM jv_newsletter_subscribers ORDER BY subscribed_at DESC');

        const workbook"""
)

# Newsletter unsubscribe
s(
    """        const result = db.prepare('UPDATE newsletter_subscribers SET active = 0 WHERE email = ? AND active = 1').run(email.trim().toLowerCase());
        if (result.changes > 0) {""",
    """        const result = await pgPool.query('UPDATE jv_newsletter_subscribers SET active = 0 WHERE email = $1 AND active = 1', [email.trim().toLowerCase()]);
        if (result.rowCount > 0) {"""
)

# ─── 3. Radio favorites ───────────────────────────────────────────────────────

s(
    """        const favorites = db.prepare(`
            SELECT id, station_id, station_name, station_category, station_image, favorited_at
            FROM radio_favorites
            WHERE user_id = ?
            ORDER BY favorited_at DESC
        `).all(userId);""",
    """        const { rows: favorites } = await pgPool.query(`
            SELECT id, station_id, station_name, station_category, station_image, favorited_at
            FROM jv_radio_favorites
            WHERE user_id = $1
            ORDER BY favorited_at DESC
        `, [userId]);"""
)

s(
    """        const stmt = db.prepare(`
            INSERT INTO radio_favorites (user_id, station_id, station_name, station_category, station_image)
            VALUES (?, ?, ?, ?, ?)
        `);

        stmt.run(userId, station_id, station_name, station_category || '', station_image || '');

        console.log(`[Radio Favorites] User ${userId} favorited ${station_name}`);

        res.json({
            success: true,
            message: 'Station added to favorites'
        });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {""",
    """        await pgPool.query(`
            INSERT INTO jv_radio_favorites (user_id, station_id, station_name, station_category, station_image)
            VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, station_id) DO NOTHING
        `, [userId, station_id, station_name, station_category || '', station_image || '']);

        console.log(`[Radio Favorites] User ${userId} favorited ${station_name}`);

        res.json({
            success: true,
            message: 'Station added to favorites'
        });
    } catch (err) {
        if (err.code === '23505') {"""
)

s(
    """        const result = db.prepare(`
            DELETE FROM radio_favorites
            WHERE user_id = ? AND station_id = ?
        `).run(userId, stationId);

        if (result.changes > 0) {
            console.log(`[Radio Favorites] User ${userId} unfavorited ${stationId}`);""",
    """        const result = await pgPool.query(`
            DELETE FROM jv_radio_favorites
            WHERE user_id = $1 AND station_id = $2
        `, [userId, stationId]);

        if (result.rowCount > 0) {
            console.log(`[Radio Favorites] User ${userId} unfavorited ${stationId}`);"""
)

s(
    """        const favorite = db.prepare(`
            SELECT id FROM radio_favorites
            WHERE user_id = ? AND station_id = ?
        `).get(userId, req.params.stationId);""",
    """        const { rows: [favorite] } = await pgPool.query(`
            SELECT id FROM jv_radio_favorites
            WHERE user_id = $1 AND station_id = $2
        `, [userId, req.params.stationId]);"""
)

# ─── 4. Radio follows ────────────────────────────────────────────────────────

s(
    """        const follows = db.prepare(`
            SELECT id, station_id, station_name, station_category, station_image, followed_at
            FROM radio_follows
            WHERE user_id = ?
            ORDER BY followed_at DESC
        `).all(userId);""",
    """        const { rows: follows } = await pgPool.query(`
            SELECT id, station_id, station_name, station_category, station_image, followed_at
            FROM jv_radio_follows
            WHERE user_id = $1
            ORDER BY followed_at DESC
        `, [userId]);"""
)

s(
    """        const stmt = db.prepare(`
            INSERT INTO radio_follows (user_id, station_id, station_name, station_category, station_image)
            VALUES (?, ?, ?, ?, ?)
        `);

        stmt.run(userId, station_id, station_name, station_category || '', station_image || '');

        console.log(`[Radio Follows] User ${userId} followed ${station_name}`);

        res.json({
            success: true,
            message: 'Station followed'
        });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {""",
    """        await pgPool.query(`
            INSERT INTO jv_radio_follows (user_id, station_id, station_name, station_category, station_image)
            VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, station_id) DO NOTHING
        `, [userId, station_id, station_name, station_category || '', station_image || '']);

        console.log(`[Radio Follows] User ${userId} followed ${station_name}`);

        res.json({
            success: true,
            message: 'Station followed'
        });
    } catch (err) {
        if (err.code === '23505') {"""
)

s(
    """        const result = db.prepare(`
            DELETE FROM radio_follows
            WHERE user_id = ? AND station_id = ?
        `).run(userId, stationId);

        if (result.changes > 0) {
            console.log(`[Radio Follows] User ${userId} unfollowed ${stationId}`);""",
    """        const result = await pgPool.query(`
            DELETE FROM jv_radio_follows
            WHERE user_id = $1 AND station_id = $2
        `, [userId, stationId]);

        if (result.rowCount > 0) {
            console.log(`[Radio Follows] User ${userId} unfollowed ${stationId}`);"""
)

# ─── 5. Auth register ────────────────────────────────────────────────────────

s(
    """        const stmt = db.prepare(`INSERT INTO users (email, password_hash, password_salt, name) VALUES (?, ?, ?, ?)`);
        const result = stmt.run(email.toLowerCase().trim(), hash, salt, name || '');
        const user = { id: result.lastInsertRowid, email: email.toLowerCase().trim(), name: name || '', role: 'user', permissions: [] };""",
    """        const { rows: [insertedUser] } = await pgPool.query(
            `INSERT INTO jv_users (email, password_hash, password_salt, name) VALUES ($1, $2, $3, $4) RETURNING id`,
            [email.toLowerCase().trim(), hash, salt, name || '']
        );
        const user = { id: insertedUser.id, email: email.toLowerCase().trim(), name: name || '', role: 'user', permissions: [] };"""
)

s(
    "        if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered' });",
    "        if (e.code === '23505') return res.status(409).json({ error: 'Email already registered' });"
)

# ─── 6. Auth login (password-based) ─────────────────────────────────────────

s(
    "    const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase().trim());",
    "    const { rows: [user] } = await pgPool.query(`SELECT * FROM jv_users WHERE email = $1`, [email.toLowerCase().trim()]);"
)

s(
    """                db.prepare(`UPDATE users SET mfa_backup_codes=? WHERE id=?`).run(JSON.stringify(codes), user.id);""",
    """                await pgPool.query(`UPDATE jv_users SET mfa_backup_codes=$1 WHERE id=$2`, [JSON.stringify(codes), user.id]);"""
)

s(
    """        db.prepare(`INSERT INTO user_sessions (user_email, session_token_hash, ip_address, user_agent, device_parsed, auth_method, mfa_satisfied)
                    VALUES (?, ?, ?, ?, ?, 'password', ?)`)
          .run(user.email, tokenHash, req.ip || null, req.get('user-agent') || null,
               JSON.stringify(deviceParsed), mfaSatisfied);
        db.prepare(`UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?`).run(user.id);""",
    """        await pgPool.query(
            `INSERT INTO jv_user_sessions (user_email, session_token_hash, ip_address, user_agent, device_parsed, auth_method, mfa_satisfied)
             VALUES ($1, $2, $3, $4, $5, 'password', $6)`,
            [user.email, tokenHash, req.ip || null, req.get('user-agent') || null, JSON.stringify(deviceParsed), mfaSatisfied]
        );
        await pgPool.query(`UPDATE jv_users SET last_login_at=NOW() WHERE id=$1`, [user.id]);"""
)

# ─── 7. Auth me ──────────────────────────────────────────────────────────────

s(
    """        const user = db.prepare(
            `SELECT id, email, name, role, permissions, entitlements, cms_roles, idp_subject_id FROM users WHERE id=?`
        ).get(sessionPayload.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        return res.json({ success: true, user: _buildUserResponse(user) });
    }
    // Bearer token fallback
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = authVerifyJWT(token);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const user = db.prepare(
        `SELECT id, email, name, role, permissions, entitlements, cms_roles, idp_subject_id FROM users WHERE id = ?`
    ).get(payload.userId);""",
    """        const { rows: [user] } = await pgPool.query(
            `SELECT id, email, name, role, permissions, entitlements, cms_roles, idp_subject_id FROM jv_users WHERE id=$1`,
            [sessionPayload.userId]
        );
        if (!user) return res.status(404).json({ error: 'User not found' });
        return res.json({ success: true, user: _buildUserResponse(user) });
    }
    // Bearer token fallback
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = authVerifyJWT(token);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const { rows: [user] } = await pgPool.query(
        `SELECT id, email, name, role, permissions, entitlements, cms_roles, idp_subject_id FROM jv_users WHERE id = $1`,
        [payload.userId]
    );"""
)

# ─── 8. Auth logout (JWT/bearer path) ────────────────────────────────────────

s(
    """                const tokenHash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 64);
                const sess = db.prepare(`SELECT id, login_at FROM user_sessions WHERE session_token_hash=? AND logout_at IS NULL`).get(tokenHash);
                if (sess) {
                    const dur = Math.floor((Date.now() - new Date(sess.login_at).getTime()) / 1000);
                    db.prepare(`UPDATE user_sessions SET logout_at=CURRENT_TIMESTAMP, duration_seconds=? WHERE id=?`).run(dur, sess.id);
                }""",
    """                const tokenHash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 64);
                const { rows: [sess] } = await pgPool.query(`SELECT id, login_at FROM jv_user_sessions WHERE session_token_hash=$1 AND logout_at IS NULL`, [tokenHash]);
                if (sess) {
                    const dur = Math.floor((Date.now() - new Date(sess.login_at).getTime()) / 1000);
                    await pgPool.query(`UPDATE jv_user_sessions SET logout_at=NOW(), duration_seconds=$1 WHERE id=$2`, [dur, sess.id]);
                }"""
)

# ─── 9. MFA setup/verify/disable ────────────────────────────────────────────

s(
    "    db.prepare(`UPDATE users SET mfa_secret=? WHERE id=?`).run(secret, payload.userId);",
    "    await pgPool.query(`UPDATE jv_users SET mfa_secret=$1 WHERE id=$2`, [secret, payload.userId]);"
)

s(
    "    const user = db.prepare(`SELECT mfa_secret FROM users WHERE id=?`).get(payload.userId);",
    "    const { rows: [user] } = await pgPool.query(`SELECT mfa_secret FROM jv_users WHERE id=$1`, [payload.userId]);"
)

s(
    """    db.prepare(`UPDATE users SET mfa_enabled=1, mfa_backup_codes=? WHERE id=?`)
        .run(JSON.stringify(backupCodes), payload.userId);""",
    """    await pgPool.query(`UPDATE jv_users SET mfa_enabled=1, mfa_backup_codes=$1 WHERE id=$2`, [JSON.stringify(backupCodes), payload.userId]);"""
)

s(
    "    const user = db.prepare(`SELECT mfa_secret, mfa_enabled FROM users WHERE id=?`).get(payload.userId);",
    "    const { rows: [user] } = await pgPool.query(`SELECT mfa_secret, mfa_enabled FROM jv_users WHERE id=$1`, [payload.userId]);"
)

s(
    """    db.prepare(`UPDATE users SET mfa_enabled=0, mfa_secret=NULL, mfa_backup_codes=NULL WHERE id=?`)
        .run(payload.userId);""",
    """    await pgPool.query(`UPDATE jv_users SET mfa_enabled=0, mfa_secret=NULL, mfa_backup_codes=NULL WHERE id=$1`, [payload.userId]);"""
)

# ─── 10. Pulse tasks ─────────────────────────────────────────────────────────

# GET /api/pulse-tasks
s(
    """        const tasks = db.prepare(`
            SELECT id, title, user, delivery_type, frequency_type, start_date,
                   status, completed_at as done_date
            FROM pulse_tasks
            ORDER BY created_at DESC
        `).all();""",
    """        const { rows: tasks } = await pgPool.query(`
            SELECT id, title, "user", delivery_type, frequency_type, start_date,
                   status, completed_at as done_date
            FROM jv_pulse_tasks
            ORDER BY created_at DESC
        `);"""
)

# POST /api/pulse-tasks
s(
    """        const result = db.prepare(`
            INSERT INTO pulse_tasks (
                title, instructions, category_location, status, user,
                delivery_type, frequency_type, interval_value, days_of_week,
                execution_times, start_date, end_date, immediate_execution
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            title,
            instructions,
            category_location,
            status || 'pending',
            user,
            delivery_type || 'one-time',
            frequency_type,
            interval_value || 1,
            days_of_week ? JSON.stringify(days_of_week) : null,
            execution_times ? JSON.stringify(execution_times) : null,
            start_date,
            end_date,
            immediate_execution !== undefined ? immediate_execution : 1
        );

        res.json({
            success: true,
            task_id: result.lastInsertRowid,""",
    """        const { rows: [newTask] } = await pgPool.query(`
            INSERT INTO jv_pulse_tasks (
                title, instructions, category_location, status, "user",
                delivery_type, frequency_type, interval_value, days_of_week,
                execution_times, start_date, end_date, immediate_execution
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id
        `, [
            title,
            instructions,
            category_location,
            status || 'pending',
            user,
            delivery_type || 'one-time',
            frequency_type,
            interval_value || 1,
            days_of_week ? JSON.stringify(days_of_week) : null,
            execution_times ? JSON.stringify(execution_times) : null,
            start_date,
            end_date,
            immediate_execution !== undefined ? immediate_execution : 1
        ]);

        res.json({
            success: true,
            task_id: newTask.id,"""
)

# POST /api/pulse-tasks/start-heartbeat
s(
    """        db.prepare(`
            UPDATE pulse_tasks
            SET status = 'in-progress',
                started_at = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?
        `).run(task_id);""",
    """        await pgPool.query(`
            UPDATE jv_pulse_tasks
            SET status = 'in-progress',
                started_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
        `, [task_id]);"""
)

# Chat message - recent tasks query
s(
    """        const recentTasks = db.prepare(`
            SELECT id, title, status, created_at, started_at, completed_at
            FROM pulse_tasks
            ORDER BY created_at DESC
            LIMIT 10
        `).all();""",
    """        const { rows: recentTasks } = await pgPool.query(`
            SELECT id, title, status, created_at, started_at, completed_at
            FROM jv_pulse_tasks
            ORDER BY created_at DESC
            LIMIT 10
        `);"""
)

# Chat message - create_task tool call
s(
    """                const result = db.prepare(`
                    INSERT INTO pulse_tasks (
                        title, instructions, category_location, status, user,
                        delivery_type, immediate_execution
                    )
                    VALUES (?, ?, ?, 'pending', 'Jubilee AI', 'one-time', 1)
                `).run(title, instructions, category_location || 'Jubilee AI Tasks');

                createdTaskId = result.lastInsertRowid;""",
    """                const { rows: [createdTask] } = await pgPool.query(`
                    INSERT INTO jv_pulse_tasks (
                        title, instructions, category_location, status, "user",
                        delivery_type, immediate_execution
                    )
                    VALUES ($1, $2, $3, 'pending', 'Jubilee AI', 'one-time', 1)
                    RETURNING id
                `, [title, instructions, category_location || 'Jubilee AI Tasks']);

                createdTaskId = createdTask.id;"""
)

# ─── 11. User management Block G ────────────────────────────────────────────

# GET /api/admin/directory/search
s(
    """        const rows = db.prepare(
            `SELECT id, email, name, role, entitlements, idp_subject_id
             FROM users WHERE (email LIKE ? OR name LIKE ?) ORDER BY name LIMIT 20`
        ).all(like, like);
        const users = rows.map(u => ({ ...u, entitlements: JSON.parse(u.entitlements || '[]') }));""",
    """        const { rows } = await pgPool.query(
            `SELECT id, email, name, role, entitlements, idp_subject_id
             FROM jv_users WHERE (email ILIKE $1 OR name ILIKE $1) ORDER BY name LIMIT 20`,
            [like]
        );
        const users = rows.map(u => ({ ...u, entitlements: Array.isArray(u.entitlements) ? u.entitlements : JSON.parse(u.entitlements || '[]') }));"""
)

# POST /api/admin/directory/grant-access
s(
    """        // Upsert user
        db.prepare(
            `INSERT OR IGNORE INTO users (email, idp_subject_id, role, entitlements, is_active)
             VALUES (?,?,?,?,1)`
        ).run(email, idp_subject_id || null, initial_role, '["jubileeverse_cms"]');
        // Fetch existing (INSERT OR IGNORE may not have inserted if user exists)
        const existing = db.prepare(`SELECT * FROM users WHERE email=?`).get(email);
        if (!existing) return res.status(500).json({ error: 'Could not upsert user' });
        // Ensure entitlement is present
        const entitlements = JSON.parse(existing.entitlements || '[]');
        if (!entitlements.includes('jubileeverse_cms')) entitlements.push('jubileeverse_cms');
        db.prepare(
            `UPDATE users SET role=?, entitlements=?, idp_subject_id=COALESCE(?,idp_subject_id) WHERE id=?`
        ).run(initial_role, JSON.stringify(entitlements), idp_subject_id || null, existing.id);
        const user = db.prepare(
            `SELECT id, email, name, role, entitlements, cms_roles, idp_subject_id, is_active, is_locked
             FROM users WHERE id=?`
        ).get(existing.id);""",
    """        // Upsert user
        await pgPool.query(
            `INSERT INTO jv_users (email, idp_subject_id, role, entitlements, is_active)
             VALUES ($1,$2,$3,$4,1) ON CONFLICT (email) DO NOTHING`,
            [email, idp_subject_id || null, initial_role, JSON.stringify(['jubileeverse_cms'])]
        );
        // Fetch existing
        const { rows: [existing] } = await pgPool.query(`SELECT * FROM jv_users WHERE email=$1`, [email]);
        if (!existing) return res.status(500).json({ error: 'Could not upsert user' });
        // Ensure entitlement is present
        const entitlements = Array.isArray(existing.entitlements) ? existing.entitlements : JSON.parse(existing.entitlements || '[]');
        if (!entitlements.includes('jubileeverse_cms')) entitlements.push('jubileeverse_cms');
        await pgPool.query(
            `UPDATE jv_users SET role=$1, entitlements=$2, idp_subject_id=COALESCE($3,idp_subject_id) WHERE id=$4`,
            [initial_role, JSON.stringify(entitlements), idp_subject_id || null, existing.id]
        );
        const { rows: [user] } = await pgPool.query(
            `SELECT id, email, name, role, entitlements, cms_roles, idp_subject_id, is_active, is_locked
             FROM jv_users WHERE id=$1`,
            [existing.id]
        );"""
)
s(
    "        res.json({ success: true, user: { ...user, entitlements: JSON.parse(user.entitlements || '[]'), cms_roles: JSON.parse(user.cms_roles || '[]') } });",
    "        res.json({ success: true, user: { ...user, entitlements: Array.isArray(user.entitlements) ? user.entitlements : JSON.parse(user.entitlements || '[]'), cms_roles: Array.isArray(user.cms_roles) ? user.cms_roles : JSON.parse(user.cms_roles || '[]') } });"
)

# DELETE /api/admin/users/:id/revoke-entitlement
s(
    """        const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const entitlements = JSON.parse(user.entitlements || '[]').filter(e => e !== 'jubileeverse_cms');
        db.prepare(`UPDATE users SET entitlements=? WHERE id=?`).run(JSON.stringify(entitlements), user.id);""",
    """        const { rows: [user] } = await pgPool.query(`SELECT * FROM jv_users WHERE id=$1`, [req.params.id]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const entitlements = (Array.isArray(user.entitlements) ? user.entitlements : JSON.parse(user.entitlements || '[]')).filter(e => e !== 'jubileeverse_cms');
        await pgPool.query(`UPDATE jv_users SET entitlements=$1 WHERE id=$2`, [JSON.stringify(entitlements), user.id]);"""
)

# GET /api/admin/users/:id/cms-roles
s(
    """        const user = db.prepare(`SELECT cms_roles FROM users WHERE id=?`).get(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ cms_roles: JSON.parse(user.cms_roles || '[]') });""",
    """        const { rows: [user] } = await pgPool.query(`SELECT cms_roles FROM jv_users WHERE id=$1`, [req.params.id]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ cms_roles: Array.isArray(user.cms_roles) ? user.cms_roles : JSON.parse(user.cms_roles || '[]') });"""
)

# PUT /api/admin/users/:id/cms-roles
s(
    """        const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const oldRoles = JSON.parse(user.cms_roles || '[]');
        db.prepare(`UPDATE users SET cms_roles=? WHERE id=?`).run(JSON.stringify(cms_roles), user.id);""",
    """        const { rows: [user] } = await pgPool.query(`SELECT * FROM jv_users WHERE id=$1`, [req.params.id]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const oldRoles = Array.isArray(user.cms_roles) ? user.cms_roles : JSON.parse(user.cms_roles || '[]');
        await pgPool.query(`UPDATE jv_users SET cms_roles=$1 WHERE id=$2`, [JSON.stringify(cms_roles), user.id]);"""
)

# GET /api/admin/users (list)
s(
    """        const rows = db.prepare(
            `SELECT id, email, name, role, entitlements, cms_roles, idp_subject_id,
                    is_active, is_locked, mfa_enabled, force_password_reset,
                    last_login_at, created_at, updated_at, updated_by
             FROM users
             WHERE (json_extract(entitlements, '$') LIKE '%jubileeverse_cms%')
                OR role IN ('admin','site_owner','publisher','reviewer','editor','persona_operator')
             ORDER BY created_at DESC`
        ).all();
        const users = rows.map(u => ({
            ...u,
            entitlements: JSON.parse(u.entitlements || '[]'),
            cms_roles:    JSON.parse(u.cms_roles    || '[]'),
        }));""",
    """        const { rows } = await pgPool.query(
            `SELECT id, email, name, role, entitlements, cms_roles, idp_subject_id,
                    is_active, is_locked, mfa_enabled, force_password_reset,
                    last_login_at, created_at, updated_at, updated_by
             FROM jv_users
             WHERE entitlements::text LIKE '%jubileeverse_cms%'
                OR role IN ('admin','site_owner','publisher','reviewer','editor','persona_operator')
             ORDER BY created_at DESC`
        );
        const users = rows.map(u => ({
            ...u,
            entitlements: Array.isArray(u.entitlements) ? u.entitlements : JSON.parse(u.entitlements || '[]'),
            cms_roles:    Array.isArray(u.cms_roles)    ? u.cms_roles    : JSON.parse(u.cms_roles    || '[]'),
        }));"""
)

# GET /api/admin/users/:id/permissions — "user.email" lookup
# (already uses pgPool for the actual permission query, just needs user email lookup)
# First occurrence (permissions GET):
s(
    """        const user = db.prepare(`SELECT email FROM users WHERE id=?`).get(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const { rows } = await pgPool.query(
            `SELECT * FROM jv_user_taxonomy_permissions WHERE user_email=$1 ORDER BY granted_at DESC`,""",
    """        const { rows: [user] } = await pgPool.query(`SELECT email FROM jv_users WHERE id=$1`, [req.params.id]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const { rows } = await pgPool.query(
            `SELECT * FROM jv_user_taxonomy_permissions WHERE user_email=$1 ORDER BY granted_at DESC`,"""
)

# POST /api/admin/users/:id/permissions — user email lookup
s(
    """        const user = db.prepare(`SELECT email FROM users WHERE id=?`).get(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const { rows } = await pgPool.query(
            `INSERT INTO jv_user_taxonomy_permissions""",
    """        const { rows: [user] } = await pgPool.query(`SELECT email FROM jv_users WHERE id=$1`, [req.params.id]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const { rows } = await pgPool.query(
            `INSERT INTO jv_user_taxonomy_permissions"""
)

# GET /api/admin/users/:id — single user detail
s(
    """        const user = db.prepare(
            `SELECT id, email, name, role, is_active, is_locked, mfa_enabled, force_password_reset,
                    last_login_at, locked_at, locked_by, sessions_revoked_at, created_at, updated_at, updated_by
             FROM users WHERE id=?`
        ).get(req.params.id);""",
    """        const { rows: [user] } = await pgPool.query(
            `SELECT id, email, name, role, is_active, is_locked, mfa_enabled, force_password_reset,
                    last_login_at, locked_at, locked_by, sessions_revoked_at, created_at, updated_at, updated_by
             FROM jv_users WHERE id=$1`,
            [req.params.id]
        );"""
)

# PUT /api/admin/users/:id — update
s(
    """        const user = db.prepare(`SELECT id, email, name, role FROM users WHERE id=?`).get(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const newName = name !== undefined ? name : user.name;
        const newRole = role !== undefined ? role : user.role;
        db.prepare(`UPDATE users SET name=?, role=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(newName, newRole, actor.email || actor.sub, req.params.id);""",
    """        const { rows: [user] } = await pgPool.query(`SELECT id, email, name, role FROM jv_users WHERE id=$1`, [req.params.id]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const newName = name !== undefined ? name : user.name;
        const newRole = role !== undefined ? role : user.role;
        await pgPool.query(`UPDATE jv_users SET name=$1, role=$2, updated_by=$3, updated_at=NOW() WHERE id=$4`,
          [newName, newRole, actor.email || actor.sub, req.params.id]);"""
)
s(
    """        const updated = db.prepare(`SELECT id, email, name, role, is_active, is_locked, mfa_enabled, force_password_reset, last_login_at, created_at, updated_at, updated_by FROM users WHERE id=?`).get(req.params.id);""",
    """        const { rows: [updated] } = await pgPool.query(`SELECT id, email, name, role, is_active, is_locked, mfa_enabled, force_password_reset, last_login_at, created_at, updated_at, updated_by FROM jv_users WHERE id=$1`, [req.params.id]);"""
)

# For enable/disable/lock/unlock/force-password-reset/reset-mfa/revoke-sessions —
# all follow pattern: db.prepare(`SELECT id, email, name FROM users WHERE id=?`).get(req.params.id)
# followed by db.prepare(`UPDATE users SET ... WHERE id=?`)

# There are many occurrences. Let me handle the SELECT pattern first, then the UPDATEs.
# SELECT id, email, name FROM users WHERE id=?
content = re.sub(
    r"db\.prepare\(`SELECT id, email, name FROM users WHERE id=\?`\)\.get\(req\.params\.id\)",
    r"(await pgPool.query(`SELECT id, email, name FROM jv_users WHERE id=$1`, [req.params.id])).rows[0]",
    content
)

# Common UPDATE patterns for admin user actions
content = re.sub(
    r"db\.prepare\(`UPDATE users SET is_active=1, updated_by=\?, updated_at=CURRENT_TIMESTAMP WHERE id=\?`\)\s*\.run\(actor\.email \|\| actor\.sub, req\.params\.id\)",
    r"await pgPool.query(`UPDATE jv_users SET is_active=1, updated_by=$1, updated_at=NOW() WHERE id=$2`, [actor.email || actor.sub, req.params.id])",
    content
)
content = re.sub(
    r"db\.prepare\(`UPDATE users SET is_active=0, sessions_revoked_at=CURRENT_TIMESTAMP, updated_by=\?, updated_at=CURRENT_TIMESTAMP WHERE id=\?`\)\s*\.run\(actor\.email \|\| actor\.sub, req\.params\.id\)",
    r"await pgPool.query(`UPDATE jv_users SET is_active=0, sessions_revoked_at=NOW(), updated_by=$1, updated_at=NOW() WHERE id=$2`, [actor.email || actor.sub, req.params.id])",
    content
)
content = re.sub(
    r"db\.prepare\(`UPDATE users SET is_locked=1, locked_at=CURRENT_TIMESTAMP, locked_by=\?, updated_by=\?, updated_at=CURRENT_TIMESTAMP WHERE id=\?`\)\s*\.run\(actor\.email \|\| actor\.sub, actor\.email \|\| actor\.sub, req\.params\.id\)",
    r"await pgPool.query(`UPDATE jv_users SET is_locked=1, locked_at=NOW(), locked_by=$1, updated_by=$1, updated_at=NOW() WHERE id=$2`, [actor.email || actor.sub, req.params.id])",
    content
)
content = re.sub(
    r"db\.prepare\(`UPDATE users SET is_locked=0, locked_at=NULL, locked_by=NULL, updated_by=\?, updated_at=CURRENT_TIMESTAMP WHERE id=\?`\)\s*\.run\(actor\.email \|\| actor\.sub, req\.params\.id\)",
    r"await pgPool.query(`UPDATE jv_users SET is_locked=0, locked_at=NULL, locked_by=NULL, updated_by=$1, updated_at=NOW() WHERE id=$2`, [actor.email || actor.sub, req.params.id])",
    content
)
content = re.sub(
    r"db\.prepare\(`UPDATE users SET force_password_reset=1, updated_by=\?, updated_at=CURRENT_TIMESTAMP WHERE id=\?`\)\s*\.run\(actor\.email \|\| actor\.sub, req\.params\.id\)",
    r"await pgPool.query(`UPDATE jv_users SET force_password_reset=1, updated_by=$1, updated_at=NOW() WHERE id=$2`, [actor.email || actor.sub, req.params.id])",
    content
)
content = re.sub(
    r"db\.prepare\(`UPDATE users SET mfa_enabled=0, mfa_secret=NULL, mfa_backup_codes=NULL, updated_by=\?, updated_at=CURRENT_TIMESTAMP WHERE id=\?`\)\s*\.run\(actor\.email \|\| actor\.sub, req\.params\.id\)",
    r"await pgPool.query(`UPDATE jv_users SET mfa_enabled=0, mfa_secret=NULL, mfa_backup_codes=NULL, updated_by=$1, updated_at=NOW() WHERE id=$2`, [actor.email || actor.sub, req.params.id])",
    content
)
content = re.sub(
    r"db\.prepare\(`UPDATE users SET sessions_revoked_at=CURRENT_TIMESTAMP, updated_by=\?, updated_at=CURRENT_TIMESTAMP WHERE id=\?`\)\s*\.run\(actor\.email \|\| actor\.sub, req\.params\.id\)",
    r"await pgPool.query(`UPDATE jv_users SET sessions_revoked_at=NOW(), updated_by=$1, updated_at=NOW() WHERE id=$2`, [actor.email || actor.sub, req.params.id])",
    content
)
content = re.sub(
    r"db\.prepare\(`UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP, revoked_by=\? WHERE user_email=\? AND logout_at IS NULL AND revoked_at IS NULL`\)\s*\.run\(actor\.email \|\| actor\.sub, user\.email\)",
    r"await pgPool.query(`UPDATE jv_user_sessions SET revoked_at=NOW(), revoked_by=$1 WHERE user_email=$2 AND logout_at IS NULL AND revoked_at IS NULL`, [actor.email || actor.sub, user.email])",
    content
)

# GET /api/admin/users/:id/sessions
s(
    """        const user = db.prepare(`SELECT email FROM users WHERE id=?`).get(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const limit  = Math.min(parseInt(req.query.limit  || '50', 10), 200);
        const offset = parseInt(req.query.offset || '0', 10);
        const sessions = db.prepare(
            `SELECT * FROM user_sessions WHERE user_email=? ORDER BY login_at DESC LIMIT ? OFFSET ?`
        ).all(user.email, limit, offset);
        const { total } = db.prepare(`SELECT COUNT(*) as total FROM user_sessions WHERE user_email=?`).get(user.email);""",
    """        const { rows: [user] } = await pgPool.query(`SELECT email FROM jv_users WHERE id=$1`, [req.params.id]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const limit  = Math.min(parseInt(req.query.limit  || '50', 10), 200);
        const offset = parseInt(req.query.offset || '0', 10);
        const { rows: sessions } = await pgPool.query(
            `SELECT * FROM jv_user_sessions WHERE user_email=$1 ORDER BY login_at DESC LIMIT $2 OFFSET $3`,
            [user.email, limit, offset]
        );
        const { rows: [{ total }] } = await pgPool.query(`SELECT COUNT(*) as total FROM jv_user_sessions WHERE user_email=$1`, [user.email]);"""
)

# DELETE /api/admin/users/:id/sessions/:sessionId
s(
    """        db.prepare(`UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP, revoked_by=? WHERE id=?`)
          .run(actor.email || actor.sub, req.params.sessionId);""",
    """        await pgPool.query(`UPDATE jv_user_sessions SET revoked_at=NOW(), revoked_by=$1 WHERE id=$2`, [actor.email || actor.sub, req.params.sessionId]);"""
)

# GET /api/admin/users/:id/activity — user email lookup (remaining ones)
# There are three remaining db.prepare(`SELECT email FROM users WHERE id=?`) calls
# at lines 16066, 16095, 16124, 16155
# All follow same pattern - replace remaining occurrences
content = re.sub(
    r"const user = db\.prepare\(`SELECT email FROM users WHERE id=\?`\)\.get\(req\.params\.id\);",
    r"const { rows: [user] } = await pgPool.query(`SELECT email FROM jv_users WHERE id=$1`, [req.params.id]);",
    content
)

# ─── Write output ────────────────────────────────────────────────────────────

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

# Verify remaining db.prepare in route handlers (skip init block)
lines = content.split('\n')
remaining = []
for i, line in enumerate(lines, 1):
    if 'db.prepare' in line and not line.strip().startswith('//'):
        remaining.append(f"  {i}: {line.strip()[:100]}")

print(f"Done. Remaining db.prepare occurrences: {len(remaining)}")
for r in remaining:
    print(r)
