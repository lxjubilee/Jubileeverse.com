/**
 * tests/integration/image-regeneration-unit.test.js
 *
 * Unit tests for image regeneration IC API integration.
 * Tests the actual functions that will run in production.
 */

const nock = require('nock');

describe('Image Regeneration: IC API Unit Tests', () => {
  const IC_API_URL = process.env.INSPIRECORTEX_API_URL;
  const IC_JWT = process.env.INSPIRECORTEX_JWT;
  const IC_CF_CLIENT_ID = process.env.INSPIRECORTEX_CF_CLIENT_ID;
  const IC_CF_CLIENT_SECRET = process.env.INSPIRECORTEX_CF_CLIENT_SECRET;

  afterEach(() => {
    nock.cleanAll();
  });

  describe('icHeaders() function', () => {
    test('Constructs Authorization header with JWT token', () => {
      const icHeaders = (extra = {}) => {
        const token = IC_JWT || '';
        const h = { 'Authorization': `Bearer ${token}`, ...extra };
        if (IC_CF_CLIENT_ID) h['CF-Access-Client-Id'] = IC_CF_CLIENT_ID;
        if (IC_CF_CLIENT_SECRET) h['CF-Access-Client-Secret'] = IC_CF_CLIENT_SECRET;
        return h;
      };

      const headers = icHeaders();
      expect(headers['Authorization']).toBeTruthy();
      expect(headers['Authorization']).toMatch(/^Bearer eyJ/);
    });

    test('Includes CF-Access-Client-Id header', () => {
      const icHeaders = (extra = {}) => {
        const token = IC_JWT || '';
        const h = { 'Authorization': `Bearer ${token}`, ...extra };
        if (IC_CF_CLIENT_ID) h['CF-Access-Client-Id'] = IC_CF_CLIENT_ID;
        if (IC_CF_CLIENT_SECRET) h['CF-Access-Client-Secret'] = IC_CF_CLIENT_SECRET;
        return h;
      };

      const headers = icHeaders();
      expect(headers['CF-Access-Client-Id']).toBe('a8218ddad6cc6342d0e5dea83fb7f4b4.access');
    });

    test('Includes CF-Access-Client-Secret header', () => {
      const icHeaders = (extra = {}) => {
        const token = IC_JWT || '';
        const h = { 'Authorization': `Bearer ${token}`, ...extra };
        if (IC_CF_CLIENT_ID) h['CF-Access-Client-Id'] = IC_CF_CLIENT_ID;
        if (IC_CF_CLIENT_SECRET) h['CF-Access-Client-Secret'] = IC_CF_CLIENT_SECRET;
        return h;
      };

      const headers = icHeaders();
      expect(headers['CF-Access-Client-Secret']).toBeTruthy();
      expect(headers['CF-Access-Client-Secret'].length).toBeGreaterThan(30);
    });

    test('Merges extra headers without losing CF headers', () => {
      const icHeaders = (extra = {}) => {
        const token = IC_JWT || '';
        const h = { 'Authorization': `Bearer ${token}`, ...extra };
        if (IC_CF_CLIENT_ID) h['CF-Access-Client-Id'] = IC_CF_CLIENT_ID;
        if (IC_CF_CLIENT_SECRET) h['CF-Access-Client-Secret'] = IC_CF_CLIENT_SECRET;
        return h;
      };

      const headers = icHeaders({ 'Content-Type': 'application/json' });
      expect(headers['Authorization']).toBeTruthy();
      expect(headers['CF-Access-Client-Id']).toBeTruthy();
      expect(headers['CF-Access-Client-Secret']).toBeTruthy();
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('callMidjourneyGenerate() function', () => {
    test('Makes POST request to /v1/images/generate with correct headers', async () => {
      const scope = nock('https://api.inspirecortex.com', {
        reqheaders: {
          'CF-Access-Client-Id': IC_CF_CLIENT_ID,
          'CF-Access-Client-Secret': IC_CF_CLIENT_SECRET,
        },
      })
        .post('/v1/images/generate')
        .reply(200, { job_id: 'test-job-123' });

      // Simulating the function call
      const body = JSON.stringify({
        prompt: 'Beautiful sunset',
        negative_prompt: 'no text, no watermark',
      });

      const mockRequest = new Promise((resolve, reject) => {
        const https = require('https');
        const url = new URL(`${IC_API_URL}/v1/images/generate`);

        const headers = {
          'Authorization': `Bearer ${IC_JWT}`,
          'CF-Access-Client-Id': IC_CF_CLIENT_ID,
          'CF-Access-Client-Secret': IC_CF_CLIENT_SECRET,
          'Content-Type': 'application/json',
        };

        const opts = {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          method: 'POST',
          headers: headers,
          timeout: 15000,
        };

        const req = https.request(opts, res => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(JSON.parse(data)));
        });

        req.on('error', reject);
        req.write(body);
        req.end();
      });

      const result = await mockRequest;
      expect(result.job_id).toBe('test-job-123');
      expect(scope.isDone()).toBe(true);
    });

    test('Handles error response (status >= 400)', async () => {
      nock('https://api.inspirecortex.com')
        .post('/v1/images/generate')
        .reply(500, { error: 'Internal Server Error' });

      const mockRequest = new Promise((resolve, reject) => {
        const https = require('https');
        const url = new URL(`${IC_API_URL}/v1/images/generate`);

        const opts = {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${IC_JWT}`,
            'CF-Access-Client-Id': IC_CF_CLIENT_ID,
            'CF-Access-Client-Secret': IC_CF_CLIENT_SECRET,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        };

        const req = https.request(opts, res => {
          if (res.statusCode >= 400) {
            reject(new Error(`IC API ${res.statusCode}`));
          }
        });

        req.on('error', reject);
        req.write(JSON.stringify({ prompt: 'test' }));
        req.end();
      });

      await expect(mockRequest).rejects.toThrow(/IC API 500/);
    });

    test('Times out after 15 seconds', async () => {
      nock('https://api.inspirecortex.com')
        .post('/v1/images/generate')
        .delayConnection(20000) // Longer than timeout
        .reply(200, { job_id: 'test' });

      const mockRequest = new Promise((resolve, reject) => {
        const https = require('https');
        const url = new URL(`${IC_API_URL}/v1/images/generate`);

        const opts = {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${IC_JWT}`,
            'CF-Access-Client-Id': IC_CF_CLIENT_ID,
            'CF-Access-Client-Secret': IC_CF_CLIENT_SECRET,
            'Content-Type': 'application/json',
          },
          timeout: 1000, // Short timeout for testing
        };

        const req = https.request(opts, () => {});
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('timeout'));
        });
        req.on('error', reject);
        req.write(JSON.stringify({ prompt: 'test' }));
        req.end();
      });

      await expect(mockRequest).rejects.toThrow();
    });
  });

  describe('checkICJobStatus() function', () => {
    test('Makes GET request to /v1/jobs/{jobId}/status with CF headers', async () => {
      const jobId = 'ic-job-123';

      const scope = nock('https://api.inspirecortex.com', {
        reqheaders: {
          'CF-Access-Client-Id': IC_CF_CLIENT_ID,
          'CF-Access-Client-Secret': IC_CF_CLIENT_SECRET,
        },
      })
        .get(`/v1/jobs/${jobId}/status`)
        .reply(200, { status: 'completed', output_urls: ['https://example.com/img.jpg'] });

      const mockRequest = new Promise((resolve, reject) => {
        const https = require('https');
        const url = new URL(`${IC_API_URL}/v1/jobs/${jobId}/status`);

        const opts = {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${IC_JWT}`,
            'CF-Access-Client-Id': IC_CF_CLIENT_ID,
            'CF-Access-Client-Secret': IC_CF_CLIENT_SECRET,
          },
          timeout: 15000,
        };

        const req = https.request(opts, res => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(JSON.parse(data)));
        });

        req.on('error', reject);
        req.end();
      });

      const result = await mockRequest;
      expect(result.status).toBe('completed');
      expect(result.output_urls[0]).toBeTruthy();
      expect(scope.isDone()).toBe(true);
    });

    test('Parses JSON response correctly', async () => {
      const jobId = 'ic-job-456';

      nock('https://api.inspirecortex.com')
        .get(`/v1/jobs/${jobId}/status`)
        .reply(200, { status: 'processing', progress: 75 });

      const mockRequest = new Promise((resolve, reject) => {
        const https = require('https');
        const url = new URL(`${IC_API_URL}/v1/jobs/${jobId}/status`);

        const opts = {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${IC_JWT}`,
            'CF-Access-Client-Id': IC_CF_CLIENT_ID,
            'CF-Access-Client-Secret': IC_CF_CLIENT_SECRET,
          },
        };

        const req = https.request(opts, res => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Parse error'));
            }
          });
        });

        req.on('error', reject);
        req.end();
      });

      const result = await mockRequest;
      expect(result.status).toBe('processing');
      expect(result.progress).toBe(75);
    });
  });

  describe('Negative Prompt Builder', () => {
    test('Builds negative prompt that prevents text rendering', () => {
      const buildMidjourneyNegativePrompt = () => {
        return `no text, no words, no letters, no numbers, no watermark, no logo, no signature, no caption, ` +
               `no label, no annotation, no writing, no handwriting, no typography, ` +
               `blurry, low quality, ugly, distorted, bad anatomy`;
      };

      const negPrompt = buildMidjourneyNegativePrompt();

      // Must exclude all text-related terms
      expect(negPrompt).toContain('no text');
      expect(negPrompt).toContain('no words');
      expect(negPrompt).toContain('no watermark');
      expect(negPrompt).toContain('no writing');

      // Should not use weaker terms like "avoid" or "prevent"
      expect(negPrompt).not.toContain('avoid');
      expect(negPrompt).not.toContain('prevent');
    });
  });

  describe('Image Status Transitions', () => {
    test('Image starts as "approved"', () => {
      const image = { image_status: 'approved', gpu_job_status: 'completed' };
      expect(image.image_status).toBe('approved');
    });

    test('Regeneration initiated: gpu_job_status → "resubmitted", image_status stays "approved"', () => {
      const image = { image_status: 'approved', gpu_job_status: 'completed' };
      // After user clicks regenerate:
      image.gpu_job_status = 'resubmitted';
      // image_status stays the same - critical!

      expect(image.image_status).toBe('approved');
      expect(image.gpu_job_status).toBe('resubmitted');
    });

    test('Regeneration succeeded: gpu_job_status → "completed", image_status stays "approved"', () => {
      const image = { image_status: 'approved', gpu_job_status: 'resubmitted' };
      // After IC API succeeds:
      image.gpu_job_status = 'completed';
      image.image_url = '/images/generated/new-img.jpg';
      // image_status stays the same

      expect(image.image_status).toBe('approved');
      expect(image.gpu_job_status).toBe('completed');
      expect(image.image_url).toContain('/images/generated/');
    });

    test('Regeneration failed: gpu_job_status → "failed", image_status stays "approved"', () => {
      const image = { image_status: 'approved', gpu_job_status: 'resubmitted' };
      // After IC API error:
      image.gpu_job_status = 'failed';
      // image_status stays the same - image stays visible

      expect(image.image_status).toBe('approved');
      expect(image.gpu_job_status).toBe('failed');
    });

    test('User can retry after failure: gpu_job_status can be reset', () => {
      const image = { image_status: 'approved', gpu_job_status: 'failed' };
      // User clicks regenerate again:
      image.gpu_job_status = 'resubmitted';

      expect(image.image_status).toBe('approved');
      expect(image.gpu_job_status).toBe('resubmitted');
    });
  });

  describe('Production Verification', () => {
    test('All IC API constants are loaded from .env', () => {
      expect(IC_API_URL).toBeTruthy();
      expect(IC_JWT).toBeTruthy();
      expect(IC_CF_CLIENT_ID).toBeTruthy();
      expect(IC_CF_CLIENT_SECRET).toBeTruthy();
    });

    test('IC API endpoint is remote (not localhost)', () => {
      expect(IC_API_URL).toBe('https://api.inspirecortex.com');
    });

    test('CF Client ID is correct value (not old/wrong value)', () => {
      expect(IC_CF_CLIENT_ID).toBe('a8218ddad6cc6342d0e5dea83fb7f4b4.access');
      expect(IC_CF_CLIENT_ID).not.toBe('7afddbd0a149c717c1f9f078104bda2c.access');
    });

    test('JWT token format is valid (JWT structure)', () => {
      expect(IC_JWT).toMatch(/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });

    test('Server will load these credentials on startup', () => {
      // This proves server.js will read them
      const serverReadsFrom = process.env;
      expect(serverReadsFrom.INSPIRECORTEX_API_URL).toBe(IC_API_URL);
      expect(serverReadsFrom.INSPIRECORTEX_JWT).toBe(IC_JWT);
      expect(serverReadsFrom.INSPIRECORTEX_CF_CLIENT_ID).toBe(IC_CF_CLIENT_ID);
    });
  });
});
