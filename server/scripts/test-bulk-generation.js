#!/usr/bin/env node

/**
 * Quick test to verify bulk generation setup
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const PROMPTS_DIR = path.join(__dirname, '../prompts');

console.log('\n========== BULK GENERATION SANITY CHECK ==========\n');

// 1. Check environment variables
console.log('1. Environment Variables:');
const requiredEnvs = ['ANTHROPIC_API_KEY_PRIMARY', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
for (const env of requiredEnvs) {
  const value = process.env[env];
  if (env === 'ANTHROPIC_API_KEY_PRIMARY') {
    console.log(`   ${env}: ${value ? '✓ SET' : '✗ MISSING'} (${value ? value.substring(0, 20) + '...' : ''})`);
  } else {
    console.log(`   ${env}: ${value ? '✓ ' + value : '✗ MISSING'}`);
  }
}

// 2. Check subcategory files exist
console.log('\n2. Subcategory Files:');
const files = [
  'Celebration-and-Mishpakhah-Top-100-Subcategories.md',
  'Torah-and-Hebraic-Insights-Top-100-Subcategories.md',
  'Shalom-and-Salvation-Top-100-Subcategories.md',
  'Covenant-and-Identity-Top-100-Subcategories.md',
  'Teshuvah-and-Restoration-Top-100-Subcategories.md'
];

for (const file of files) {
  const filePath = path.join(PROMPTS_DIR, file);
  const exists = fs.existsSync(filePath);
  const size = exists ? fs.statSync(filePath).size : 0;
  console.log(`   ${file}: ${exists ? `✓ (${(size / 1024).toFixed(1)} KB)` : '✗ MISSING'}`);
}

// 3. Test database connection
console.log('\n3. Database Connection:');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  database: process.env.DB_NAME || 'jubileeverse',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: false
});

pool.query('SELECT version()')
  .then(result => {
    console.log(`   ✓ Connected to PostgreSQL`);
    console.log(`   ${result.rows[0].version}`);
    return pool.query(`SELECT COUNT(*) FROM jv_taxonomy WHERE level = 1`);
  })
  .then(result => {
    const count = parseInt(result.rows[0].count);
    console.log(`   ✓ jv_taxonomy has ${count} L1 categories`);
    return pool.query(`SELECT COUNT(*) FROM jv_content_objects WHERE object_type = 'article'`);
  })
  .then(result => {
    const count = parseInt(result.rows[0].count);
    console.log(`   ✓ Database has ${count} articles`);
    return pool.query(`SELECT name, id FROM jv_taxonomy WHERE name LIKE '%Torah%' OR name LIKE '%Celebration%' LIMIT 5`);
  })
  .then(result => {
    console.log(`   ✓ Sample categories found:`, result.rows.length);
    result.rows.forEach(row => {
      console.log(`     - [${row.id}] ${row.name}`);
    });
  })
  .catch(err => {
    console.log(`   ✗ Database error: ${err.message}`);
  })
  .finally(() => {
    pool.end();
    console.log('\n========== CHECK COMPLETE ==========\n');
  });
