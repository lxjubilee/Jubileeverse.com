#!/usr/bin/env node

/**
 * Test script to verify Leonardo AI fallback in image generation pipeline
 */

require('dotenv').config();
const LeonardoAPI = require('./lib/leonardo-api');

async function testLeonardoFallback() {
    console.log('\n========== LEONARDO AI FALLBACK TEST ==========\n');

    try {
        const apiKey = process.env.LEONARDO_API_KEY_PRIMARY;
        if (!apiKey) {
            throw new Error('LEONARDO_API_KEY_PRIMARY not set in .env');
        }

        console.log('1. Initializing Leonardo API client...');
        const leonardo = new LeonardoAPI(apiKey);
        console.log('   ✓ Client initialized\n');

        console.log('2. Starting test generation...');
        const prompt = 'A beautiful sunset over a peaceful Christian chapel, photorealistic, high quality, cinematic lighting';
        const generationId = await leonardo.startGeneration(prompt, {
            negativePrompt: 'text, watermarks, logos, distorted, low quality',
            width: 1472,
            height: 832,
            guidanceScale: 7.5,
            steps: 30
        });
        console.log(`   ✓ Generation submitted: ${generationId}\n`);

        console.log('3. Polling for completion (with 2-minute timeout)...');
        const imageUrl = await leonardo.pollGeneration(generationId, 120000);
        console.log(`   ✓ Generation complete: ${imageUrl}\n`);

        console.log('4. Downloading image...');
        const fs = require('fs');
        const path = require('path');
        const downloadPath = path.join(__dirname, 'public', 'images', 'generated', 'test-leonardo.jpg');
        fs.mkdirSync(path.dirname(downloadPath), { recursive: true });
        
        await leonardo.downloadImage(imageUrl, downloadPath);
        console.log(`   ✓ Downloaded to: ${downloadPath}\n`);

        console.log('========== TEST PASSED ==========\n');
        console.log('Leonardo AI fallback is working correctly!');
        process.exit(0);

    } catch (err) {
        console.error('\n✗ TEST FAILED\n');
        console.error(`Error: ${err.message}`);
        console.error(err.stack);
        process.exit(1);
    }
}

testLeonardoFallback();
