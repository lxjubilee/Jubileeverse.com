# Image Generation Fallback Implementation — Apr 11, 2026

## Problem Fixed

The image generation pipeline was blocked because InspireCortex API at `localhost:4000` (via wslrelay.exe) and the Docker API Gateway were rejecting JWT authentication attempts with "Invalid or expired token" errors, even though the JWT was properly formatted and not expired.

Root cause: Complex Docker API Gateway configuration with Cloudflare Access service token validation that wasn't properly configured for the authentication request.

## Solution Implemented

Added **Leonardo AI fallback mechanism** to `server.js` at the image generation endpoint (`POST /api/v1/images/generate`).

### How It Works

1. **Primary Path** (InspireCortex):
   - Attempt to call `callMidjourneyGenerate()` with InspireCortex API
   - Wait for job completion (up to 5 minutes)
   - Download generated image

2. **Fallback Path** (Leonardo AI):
   - If InspireCortex fails for ANY reason, automatically fallback to Leonardo AI
   - Use Leonardo API's `startGeneration()` to submit the same prompt
   - Poll for completion using Leonardo's `pollGeneration()` (up to 5 minutes)
   - Download generated image from Leonardo
   - Update database with `model: 'leonardo-ai-fallback'` in audit trail

3. **Error Handling**:
   - If both InspireCortex AND Leonardo fail, mark job as failed in database
   - Log both error messages in audit trail for debugging

### Code Changes

**File**: `server.js` (lines ~8191-8280)

**Changed**: Error handler in image generation async function

**Old behavior**: On InspireCortex failure → mark job as failed, stop

**New behavior**: On InspireCortex failure → try Leonardo AI → if Leonardo succeeds → mark as completed, if both fail → mark as failed

### Configuration

Leonardo API credentials already configured in `.env`:
```
LEONARDO_API_KEY_PRIMARY=c571627f-d40f-45ff-bf09-6dfde5b7184a
LEONARDO_API_KEY_BACKUP=eb30d69c-a743-43cc-87f7-fdc5146dc1a7
```

No additional configuration needed.

### Testing

Run the fallback test:
```bash
node test-leonardo-fallback.js
```

This will:
1. Initialize Leonardo API client
2. Submit a test generation request
3. Poll for completion
4. Download the image
5. Report success/failure

### Image Generation Pipeline Now Unblocked

The bulk article generation workers can now proceed without being blocked by InspireCortex API issues. Images will be generated via Leonardo AI if InspireCortex is unavailable.

### Future Work

- Consider exploring InspireCortex JWT authentication to get it working properly
- Add metrics tracking which model (InspireCortex vs Leonardo) generated each image
- Consider regional preference (InspireCortex for Qwen LLM-based generation, Leonardo for pure image generation)

## Audit Trail Updates

Image generation jobs now include model information in audit trail:
- `model: 'jubilee-midjourney'` — InspireCortex successful
- `model: 'leonardo-ai-fallback'` — Leonardo AI used (InspireCortex failed)
- Job status: `failed` — Both systems failed
