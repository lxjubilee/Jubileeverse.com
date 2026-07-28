/**
 * Leonardo AI Image Generation API Wrapper
 *
 * Generates photorealistic cinematic hero images for articles.
 * Handles rate limiting, retries with exponential backoff, and image download.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const LEONARDO_API_BASE = 'https://cloud.leonardo.ai/api/rest/v1';

// Leonardo model IDs
const MODELS = {
    PHOENIX: '6b645e3a-d64f-4341-a6d8-7a3690fbf042',           // Leonardo Phoenix — high quality
    DIFFUSION_XL: 'b24e16ff-06e3-43eb-8d33-4416c2d75876',      // Leonardo Diffusion XL
    LIGHTNING_XL: 'aa77f04e-3eec-4034-9c07-d0f619684628',       // Lightning XL (faster)
    KINO_XL: 'aa77f04e-3eec-4034-9c07-d0f619684628',            // Kino XL (cinematic)
};

const DEFAULT_MODEL = MODELS.PHOENIX;

class LeonardoAPI {
    constructor(apiKey) {
        this.apiKey = apiKey || process.env.LEONARDO_API_KEY_PRIMARY;
        if (!this.apiKey) {
            throw new Error('Leonardo API key required');
        }
    }

    /**
     * HTTP request wrapper for Leonardo API
     */
    async request(method, endpoint, body = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(`${LEONARDO_API_BASE}${endpoint}`);
            const options = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method,
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject(new Error(`Leonardo API ${res.statusCode}: ${JSON.stringify(parsed)}`));
                        } else {
                            resolve(parsed);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse Leonardo response: ${data}`));
                    }
                });
            });

            req.on('error', reject);

            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }

    /**
     * Start a generation job
     */
    async startGeneration(prompt, options = {}) {
        const body = {
            prompt,
            modelId: options.modelId || DEFAULT_MODEL,
            negative_prompt: options.negativePrompt || 'distorted anatomy, extra limbs, malformed fingers, extra fingers, fused digits, warped hands, duplicate limbs, mutated anatomy, visual artifacts, oversharpening, low-resolution textures, lens distortion, unrealistic lighting, blown-out highlights, flat lighting, text, watermarks, logos, writing',
            width: options.width || 1472,
            height: options.height || 832,
            num_images: 1,
            num_inference_steps: options.steps || 10,
            alchemy: true,
            contrastRatio: 0.5,
            guidance_scale: options.guidanceScale || 7,
            ...options.extra
        };

        const result = await this.request('POST', '/generations', body);
        return result.sdGenerationJob?.generationId || result.generationId;
    }

    /**
     * Poll generation until complete
     */
    async pollGeneration(generationId, maxWaitMs = 120000) {
        const startTime = Date.now();
        const pollInterval = 3000;

        while (Date.now() - startTime < maxWaitMs) {
            await this.sleep(pollInterval);

            const result = await this.request('GET', `/generations/${generationId}`);
            const gen = result.generations_by_pk || result;

            if (gen.status === 'COMPLETE') {
                const images = gen.generated_images || [];
                if (images.length === 0) {
                    throw new Error('Generation complete but no images returned');
                }
                return images[0].url;
            }

            if (gen.status === 'FAILED') {
                throw new Error(`Leonardo generation failed: ${JSON.stringify(gen)}`);
            }

            // Still pending/in-progress — keep polling
            console.log(`    [Leonardo] Generation ${generationId}: ${gen.status}...`);
        }

        throw new Error(`Leonardo generation timed out after ${maxWaitMs / 1000}s`);
    }

    /**
     * Download an image from URL and save to disk
     */
    async downloadImage(imageUrl, outputPath) {
        return new Promise((resolve, reject) => {
            // Ensure directory exists
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });

            const file = fs.createWriteStream(outputPath);
            const protocol = imageUrl.startsWith('https') ? https : http;

            protocol.get(imageUrl, (response) => {
                // Handle redirects
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
                file.on('finish', () => {
                    file.close();
                    resolve(outputPath);
                });
            }).on('error', (err) => {
                file.close();
                fs.unlink(outputPath, () => {});
                reject(err);
            });
        });
    }

    /**
     * Full pipeline: generate + poll + download
     * Retries with exponential backoff on failure
     */
    async generateAndDownload(prompt, outputPath, options = {}) {
        const maxRetries = options.maxRetries || 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`    [Leonardo] Starting generation (attempt ${attempt})...`);
                const generationId = await this.startGeneration(prompt, options);
                console.log(`    [Leonardo] Job ID: ${generationId}`);

                const imageUrl = await this.pollGeneration(generationId);
                console.log(`    [Leonardo] Image URL obtained, downloading...`);

                await this.downloadImage(imageUrl, outputPath);
                console.log(`    [Leonardo] Saved to: ${outputPath}`);

                return {
                    success: true,
                    generationId,
                    imageUrl,
                    outputPath,
                    model: options.modelId || DEFAULT_MODEL,
                };
            } catch (error) {
                lastError = error;
                console.error(`    [Leonardo] Attempt ${attempt} failed: ${error.message}`);

                if (attempt < maxRetries) {
                    const backoffMs = Math.pow(2, attempt) * 2000; // 4s, 8s, 16s
                    console.log(`    [Leonardo] Retrying in ${backoffMs / 1000}s...`);
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

module.exports = LeonardoAPI;
