/**
 * Grok (xAI) Image Generation API Wrapper
 *
 * Generates photorealistic cinematic hero images via grok-2-image-1212.
 * Synchronous API — no polling required.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const XAI_API_BASE = 'https://api.x.ai/v1';
const GROK_IMAGE_MODEL = 'grok-2-image-1212';

class GrokAPI {
    constructor(apiKey) {
        this.apiKey = apiKey || process.env.GROK_API_KEY_PRIMARY;
        if (!this.apiKey) {
            throw new Error('Grok API key required');
        }
    }

    /**
     * Generate an image and return the URL
     */
    async generateImage(prompt, options = {}) {
        const body = {
            model: GROK_IMAGE_MODEL,
            prompt,
            n: 1,
            aspect_ratio: options.aspectRatio || '16:9',
        };

        return new Promise((resolve, reject) => {
            const postData = JSON.stringify(body);
            const reqOptions = {
                hostname: 'api.x.ai',
                path: '/v1/images/generations',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                },
            };

            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject(new Error(`Grok API ${res.statusCode}: ${JSON.stringify(parsed)}`));
                        } else {
                            const imageUrl = parsed?.data?.[0]?.url;
                            if (!imageUrl) reject(new Error(`No image URL in response: ${data}`));
                            else resolve(imageUrl);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse Grok response: ${data}`));
                    }
                });
            });

            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }

    /**
     * Download image from URL to disk
     */
    async downloadImage(imageUrl, outputPath) {
        return new Promise((resolve, reject) => {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            const file = fs.createWriteStream(outputPath);
            const protocol = imageUrl.startsWith('https') ? https : http;

            protocol.get(imageUrl, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    file.close();
                    fs.unlink(outputPath, () => {});
                    return this.downloadImage(response.headers.location, outputPath)
                        .then(resolve).catch(reject);
                }
                if (response.statusCode !== 200) {
                    file.close();
                    fs.unlink(outputPath, () => {});
                    return reject(new Error(`Image download failed: HTTP ${response.statusCode}`));
                }
                response.pipe(file);
                file.on('finish', () => { file.close(); resolve(outputPath); });
            }).on('error', (err) => {
                file.close();
                fs.unlink(outputPath, () => {});
                reject(err);
            });
        });
    }

    /**
     * Full pipeline: generate + download, with retries
     */
    async generateAndDownload(prompt, outputPath, options = {}) {
        const maxRetries = options.maxRetries || 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`    [Grok] Starting generation (attempt ${attempt})...`);
                const imageUrl = await this.generateImage(prompt, options);
                console.log(`    [Grok] Image URL obtained, downloading...`);
                await this.downloadImage(imageUrl, outputPath);
                console.log(`    [Grok] Saved to: ${outputPath}`);
                return { success: true, imageUrl, outputPath, model: GROK_IMAGE_MODEL };
            } catch (error) {
                lastError = error;
                console.error(`    [Grok] Attempt ${attempt} failed: ${error.message}`);
                if (attempt < maxRetries) {
                    const backoffMs = Math.pow(2, attempt) * 2000;
                    console.log(`    [Grok] Retrying in ${backoffMs / 1000}s...`);
                    await this.sleep(backoffMs);
                }
            }
        }
        throw lastError;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = GrokAPI;
