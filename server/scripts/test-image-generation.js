#!/usr/bin/env node
/**
 * Test script to verify image generation pipeline works end-to-end
 * Tests: API call → job submission → job polling → image download → database update
 */

require('dotenv').config();
const { Pool } = require('pg');
const http = require('http');
const https = require('https');

const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3107';
const JWT_TOKEN = process.env.TEST_JWT || '';

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    database: process.env.DB_NAME || 'jubileeverse',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'jubilee2026',
});

async function test() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     IMAGE GENERATION PIPELINE TEST                         ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    try {
        // Step 1: Get a sample article
        console.log('[1] Fetching a sample article...');
        const { rows: articles } = await pool.query(
            'SELECT id, title FROM jv_content_objects WHERE object_type = $1 LIMIT 1',
            ['article']
        );

        if (!articles.length) {
            console.error('❌ No articles found in database');
            process.exit(1);
        }

        const articleId = articles[0].id;
        console.log(`    ✓ Found article: ${articles[0].title} (${articleId})`);

        // Step 2: Call the image generation API
        console.log('\n[2] Calling /api/v1/images/generate...');
        const genResponse = await makeRequest('POST', '/api/v1/images/generate', {
            content_object_ids: [articleId],
            aspect_ratio: '16:9'
        });

        console.log(`    Response status: ${genResponse.statusCode}`);
        console.log(`    Response body:`, JSON.stringify(genResponse.body).slice(0, 500));

        if (genResponse.statusCode !== 200) {
            console.error(`❌ API call failed with status ${genResponse.statusCode}`);
            process.exit(1);
        }

        if (!genResponse.body.created || genResponse.body.created.length === 0) {
            console.error('❌ No jobs were created');
            process.exit(1);
        }

        const jobId = genResponse.body.created[0].id;
        console.log(`    ✓ Job created: ${jobId}`);

        // Step 3: Poll the job status
        console.log('\n[3] Polling job status (max 60 attempts, 5s interval)...');
        let completed = false;
        let attempts = 0;
        let jobStatus = null;

        while (attempts < 60 && !completed) {
            attempts++;
            await sleep(5000);

            const statusResponse = await pool.query(
                'SELECT gpu_job_status, image_status, image_url FROM image_generation_jobs WHERE id = $1',
                [jobId]
            );

            if (statusResponse.rows.length === 0) {
                console.log(`    [${attempts}] Job not found in database`);
                continue;
            }

            jobStatus = statusResponse.rows[0];
            console.log(`    [${attempts}] gpu_job_status: ${jobStatus.gpu_job_status}, image_status: ${jobStatus.image_status}, image_url: ${jobStatus.image_url ? '✓' : '✗'}`);

            if (jobStatus.gpu_job_status === 'completed' && jobStatus.image_url) {
                completed = true;
                console.log(`    ✓ Job completed with image_url: ${jobStatus.image_url}`);
            } else if (jobStatus.gpu_job_status === 'failed') {
                console.error(`❌ Job failed`);
                process.exit(1);
            }
        }

        if (!completed) {
            console.error(`❌ Job did not complete within 5 minutes (${attempts} attempts)`);
            process.exit(1);
        }

        // Step 4: Verify image URL is accessible
        console.log('\n[4] Verifying image URL is accessible...');
        const imageResponse = await makeRequest('GET', jobStatus.image_url, null, true);

        if (imageResponse.statusCode === 200) {
            console.log(`    ✓ Image is accessible (${imageResponse.body.length} bytes)`);
        } else {
            console.error(`❌ Image not accessible (status ${imageResponse.statusCode})`);
            process.exit(1);
        }

        // Step 5: Verify UI can fetch the job
        console.log('\n[5] Verifying /api/v1/images/queue/:status endpoint...');
        const queueResponse = await makeRequest('GET', '/api/v1/images/queue/completed', null, false);

        if (queueResponse.statusCode === 200 && Array.isArray(queueResponse.body)) {
            const foundJob = queueResponse.body.find(j => j.id === jobId);
            if (foundJob && foundJob.image_url) {
                console.log(`    ✓ Job visible in queue with image_url`);
            } else {
                console.error(`❌ Job not found in queue or missing image_url`);
                process.exit(1);
            }
        } else {
            console.error(`❌ Queue endpoint failed (status ${queueResponse.statusCode})`);
            process.exit(1);
        }

        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║ ✅ ALL TESTS PASSED - Image pipeline works!                ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');
        process.exit(0);

    } catch (err) {
        console.error('\n❌ Test failed:', err.message);
        console.error(err.stack?.split('\n').slice(0, 5).join('\n'));
        process.exit(1);
    } finally {
        await pool.end();
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function makeRequest(method, path, body, isImage) {
    return new Promise((resolve, reject) => {
        const url = new URL(path.startsWith('http') ? path : BASE_URL + path);
        const transport = url.protocol === 'https:' ? https : http;

        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        if (JWT_TOKEN) {
            options.headers['Authorization'] = `Bearer ${JWT_TOKEN}`;
        }

        const req = transport.request(options, (res) => {
            let data = Buffer.alloc(0);

            res.on('data', (chunk) => {
                data = Buffer.concat([data, chunk]);
            });

            res.on('end', () => {
                try {
                    const body = isImage ? data : JSON.parse(data.toString());
                    resolve({ statusCode: res.statusCode, body });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, body: data });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (body) {
            req.write(JSON.stringify(body));
        }

        req.end();
    });
}

test();
