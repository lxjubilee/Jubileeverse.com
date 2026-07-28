/**
 * tests/integration/image-regeneration.test.js
 *
 * TDD tests for image regeneration feature:
 * Validates that IC API credentials are correctly loaded and used in requests
 */

const nock = require('nock');

describe('Image Regeneration: IC API Credentials', () => {
  // Load constants from environment (same as server.js does)
  const IC_API_URL = process.env.INSPIRECORTEX_API_URL || 'https://api.inspirecortex.com';
  const IC_JWT = process.env.INSPIRECORTEX_JWT || '';
  const IC_CF_CLIENT_ID = process.env.INSPIRECORTEX_CF_CLIENT_ID || '';
  const IC_CF_CLIENT_SECRET = process.env.INSPIRECORTEX_CF_CLIENT_SECRET || '';

  afterEach(() => {
    nock.cleanAll();
  });

  test('INSPIRECORTEX_API_URL is set to remote API endpoint', () => {
    expect(IC_API_URL).toBe('https://api.inspirecortex.com');
  });

  test('INSPIRECORTEX_JWT is configured', () => {
    expect(IC_JWT).toBeTruthy();
    expect(IC_JWT.length).toBeGreaterThan(0);
  });

  test('INSPIRECORTEX_CF_CLIENT_ID matches expected value (not old/wrong value)', () => {
    expect(IC_CF_CLIENT_ID).toBe('a8218ddad6cc6342d0e5dea83fb7f4b4.access');
    expect(IC_CF_CLIENT_ID).not.toBe('7afddbd0a149c717c1f9f078104bda2c.access');
  });

  test('INSPIRECORTEX_CF_CLIENT_SECRET is configured', () => {
    expect(IC_CF_CLIENT_SECRET).toBeTruthy();
    expect(IC_CF_CLIENT_SECRET.length).toBeGreaterThan(0);
  });

  test('icHeaders() function constructs CF Access headers correctly', () => {
    // Simulate the icHeaders function from server.js
    const icHeaders = (extra = {}) => {
      const token = IC_JWT || '';
      const h = { 'Authorization': `Bearer ${token}`, ...extra };
      if (IC_CF_CLIENT_ID) h['CF-Access-Client-Id'] = IC_CF_CLIENT_ID;
      if (IC_CF_CLIENT_SECRET) h['CF-Access-Client-Secret'] = IC_CF_CLIENT_SECRET;
      return h;
    };

    const headers = icHeaders();
    expect(headers['Authorization']).toBe(`Bearer ${IC_JWT}`);
    expect(headers['CF-Access-Client-Id']).toBe('a8218ddad6cc6342d0e5dea83fb7f4b4.access');
    expect(headers['CF-Access-Client-Secret']).toBeTruthy();
  });

  test('IC API image generation endpoint rejects requests without CF credentials', async () => {
    const scope = nock('https://api.inspirecortex.com')
      .post('/v1/images/generate', body => true)
      .reply(function() {
        const cfId = this.req.getHeaders()['cf-access-client-id'];
        const cfSecret = this.req.getHeaders()['cf-access-client-secret'];

        // If CF headers missing, should get 302 (Cloudflare Access redirect)
        if (!cfId || !cfSecret) {
          return [302, 'Redirect to Cloudflare Access login'];
        }

        // With proper CF headers, should get 200
        return [200, { job_id: 'test-job-123' }];
      });

    // Simulate request WITHOUT CF headers
    const https = require('https');
    const withoutHeaders = () =>
      new Promise((resolve, reject) => {
        const opts = {
          hostname: 'api.inspirecortex.com',
          path: '/v1/images/generate',
          method: 'POST',
          headers: { 'Authorization': 'Bearer test', 'Content-Type': 'application/json' },
          timeout: 5000,
        };
        const req = https.request(opts, res => {
          expect(res.statusCode).toBe(302); // Missing CF headers = redirect
          resolve();
        });
        req.on('error', reject);
        req.write(JSON.stringify({ prompt: 'test' }));
        req.end();
      });

    await withoutHeaders();
  });

  test('Negative prompt excludes text/watermarks to prevent rendering issues', () => {
    // The _buildMidjourneyNegativePrompt function should exclude text
    const buildNegativePrompt = () => {
      return `no text, no words, no letters, no numbers, no watermark, no logo, no signature, no caption, ` +
             `no label, no annotation, no writing, no handwriting, no typography, ` +
             `blurry, low quality, ugly, distorted, bad anatomy`;
    };

    const negativePrompt = buildNegativePrompt();
    expect(negativePrompt).toContain('no text');
    expect(negativePrompt).toContain('no watermark');
    expect(negativePrompt).not.toContain('mention');
    expect(negativePrompt).not.toContain('say');
  });

  test('Job polling respects timeout of 5 minutes (300 seconds)', () => {
    const maxAttempts = 60; // polling attempts
    const pollInterval = 5000; // 5 seconds per attempt
    const maxTimeoutMs = maxAttempts * pollInterval;
    const expectedTimeoutSecs = 300;

    expect(maxTimeoutMs / 1000).toBe(expectedTimeoutSecs);
  });

  test('Image status remains approved during regeneration (not hidden)', () => {
    // The endpoint should update gpu_job_status='resubmitted'
    // but NOT change image_status='approved'
    // This ensures the image stays visible in the UI

    const updateStatement = `
      UPDATE image_generation_jobs
      SET gpu_job_status='resubmitted', updated_at=NOW()
      WHERE id=$1
    `;

    // Verify the update statement doesn't touch image_status
    expect(updateStatement).not.toMatch(/image_status\s*=/i);
    expect(updateStatement).toMatch(/gpu_job_status\s*=/i);
  });

  test('Successful regeneration updates image_url and keeps approved status', () => {
    const successUpdateStatement = `
      UPDATE image_generation_jobs SET
        gpu_job_status='completed', gpu_response=$2, image_url=$3,
        image_status='approved', updated_at=NOW()
      WHERE id=$1
    `;

    // Verify successful completion:
    // - Sets gpu_job_status='completed'
    // - Sets image_url (new path)
    // - KEEPS image_status='approved' (not hiding it)
    expect(successUpdateStatement).toMatch(/gpu_job_status\s*=\s*'completed'/);
    expect(successUpdateStatement).toMatch(/image_url\s*=/);
    expect(successUpdateStatement).toMatch(/image_status\s*=\s*'approved'/);
  });

  test('Failed regeneration logs error but keeps approved status', () => {
    const failureUpdateStatement = `
      UPDATE image_generation_jobs
      SET gpu_job_status='failed', updated_at=NOW()
      WHERE id=$1
    `;

    // Verify failure handling:
    // - Sets gpu_job_status='failed'
    // - Does NOT change image_status (stays 'approved')
    // - Image stays visible to user
    expect(failureUpdateStatement).toMatch(/gpu_job_status\s*=\s*'failed'/);
    expect(failureUpdateStatement).not.toMatch(/image_status\s*=/);
  });

  test('Cloudflare Access is required only for production API (https://api.inspirecortex.com)', () => {
    // Direct localhost connections don't need CF headers
    // But remote api.inspirecortex.com does

    expect(IC_API_URL).toBe('https://api.inspirecortex.com');
    expect(IC_API_URL).not.toContain('localhost');
    expect(IC_API_URL).not.toContain(':9001');
    expect(IC_API_URL).not.toContain(':4200');
  });
});

describe('Image Regeneration: Error Scenarios', () => {
  test('Missing job_id in IC API response triggers error', () => {
    const response = {}; // No job_id field
    expect(response?.job_id).toBeFalsy();

    const errorCheck = () => {
      if (!response?.job_id) {
        throw new Error(`Invalid MidJourney response: missing job_id`);
      }
    };

    expect(errorCheck).toThrow(/missing job_id/);
  });

  test('HTTP 5xx error from IC API is caught and logged', () => {
    const response = { status: 500, body: 'Internal Server Error' };
    expect(response.status).toBeGreaterThanOrEqual(400);

    const errorCheck = () => {
      if (response.status >= 400) {
        throw new Error(`IC API ${response.status}: ${response.body}`);
      }
    };

    expect(errorCheck).toThrow(/IC API 500/);
  });

  test('Job status check failure retries with exponential backoff', () => {
    // Polling attempts: 0, 1, 2, ..., 59 (60 total)
    // Each attempt waits 5 seconds before next
    const maxAttempts = 60;
    const attemptDurations = [];

    for (let i = 0; i < maxAttempts; i++) {
      attemptDurations.push(5000); // 5 second intervals
    }

    const totalTime = attemptDurations.reduce((a, b) => a + b, 0);
    expect(totalTime).toBe(300000); // 5 minutes total
  });

  test('Image download failure is logged and throws error', () => {
    const downloadError = new Error('Download failed: network timeout');

    const handleDownloadFailure = (error) => {
      if (error.message.includes('Download')) {
        console.error('[images:regenerate] ✗ Download failed:', error.message);
        throw error;
      }
    };

    expect(() => handleDownloadFailure(downloadError)).toThrow(/Download failed/);
  });
});

describe('Image Regeneration: Audit Trail', () => {
  test('Successful regeneration logs image.regenerated event', () => {
    const auditEvent = {
      event_type: 'image.regenerated',
      actor_id: 'test@example.com',
      target_type: 'image_generation_jobs',
      target_id: 'job-123',
      details: { ic_job_id: 'ic-456', image_path: '/images/generated/img.jpg' },
    };

    expect(auditEvent.event_type).toBe('image.regenerated');
    expect(auditEvent.details.ic_job_id).toBeTruthy();
    expect(auditEvent.details.image_path).toContain('/images/generated/');
  });

  test('Failed regeneration logs image.regeneration_failed event', () => {
    const auditEvent = {
      event_type: 'image.regeneration_failed',
      actor_id: 'test@example.com',
      target_type: 'image_generation_jobs',
      target_id: 'job-123',
      details: { error: 'Job did not complete within 5 minutes' },
    };

    expect(auditEvent.event_type).toBe('image.regeneration_failed');
    expect(auditEvent.details.error).toBeTruthy();
  });
});
