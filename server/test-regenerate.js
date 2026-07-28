const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: 'localhost',
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function main() {
  try {
    // Get an approved image job
    const { rows } = await pool.query(
      `SELECT id, content_object_id, image_status FROM image_generation_jobs
       WHERE image_status='approved' LIMIT 1`
    );

    if (rows.length === 0) {
      console.log('No approved images found in database');
      await pool.end();
      return;
    }

    const jobId = rows[0].id;
    console.log(`Found approved job: ${jobId}`);
    console.log(`Content Object ID: ${rows[0].content_object_id}`);
    console.log(`Status: ${rows[0].image_status}`);

    // Now test the regenerate endpoint
    const csrf = '1db2b5bcc9dfebf3670cb93c8307a7060e5978b239a42c7626331afae4ac342e';
    const session = '3d4bb528ae22c726763f0e6ff5f8f83a1c53b306bbb8e428e9dd36e08d0b2151';

    console.log(`\nTesting regenerate endpoint with jobId: ${jobId}`);

    const http = require('http');
    const options = {
      hostname: 'localhost',
      port: 3107,
      path: `/api/v1/images/${jobId}/regenerate`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `jv-session=${session}; jv-csrf=${csrf}`,
        'X-CSRF-Token': csrf,
        'Content-Length': '2'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`\nResponse status: ${res.statusCode}`);
        console.log(`Response body: ${data}`);
        pool.end();
      });
    });

    req.on('error', (e) => {
      console.error(`Request error: ${e.message}`);
      pool.end();
    });

    req.write('{}');
    req.end();

  } catch (error) {
    console.error('Error:', error.message);
    await pool.end();
  }
}

main();
