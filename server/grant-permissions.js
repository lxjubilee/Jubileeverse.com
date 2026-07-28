#!/usr/bin/env node
/**
 * Grant image:generate permission to admin users
 */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function grantPermissions() {
  console.log('Granting image:generate permission to admin users...\n');

  try {
    // Get all admin users
    const { rows: users } = await pool.query(
      `SELECT id, email, permissions FROM jv_users WHERE role='admin'`
    );

    console.log(`Found ${users.length} admin users\n`);

    for (const user of users) {
      let perms = [];
      try {
        perms = JSON.parse(user.permissions || '[]');
      } catch (e) {}

      if (!perms.includes('image:generate')) {
        perms.push('image:generate');
        await pool.query(
          `UPDATE jv_users SET permissions=$1 WHERE id=$2`,
          [JSON.stringify(perms), user.id]
        );
        console.log(`✓ ${user.email}: added image:generate`);
      } else {
        console.log(`✓ ${user.email}: already has image:generate`);
      }
    }

    // Also grant to publisher and editor roles
    const roles = ['publisher', 'editor'];
    for (const role of roles) {
      const { rows: roleUsers } = await pool.query(
        `SELECT id, email, permissions FROM jv_users WHERE role=$1`,
        [role]
      );

      for (const user of roleUsers) {
        let perms = [];
        try {
          perms = JSON.parse(user.permissions || '[]');
        } catch (e) {}

        if (!perms.includes('image:generate')) {
          perms.push('image:generate');
          await pool.query(
            `UPDATE jv_users SET permissions=$1 WHERE id=$2`,
            [JSON.stringify(perms), user.id]
          );
          console.log(`✓ ${user.email} (${role}): added image:generate`);
        }
      }
    }

    console.log('\n✅ Permissions updated');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

grantPermissions();
