# Image Regeneration Feature — Testing Guide

## Current Status

✅ **Feature Implementation**: COMPLETE
- Backend endpoint `/api/v1/images/:jobId/regenerate` — fully implemented
- Frontend hook `useRegenerateImage()` — uses correct authentication pattern
- UI red refresh button — ready to use
- InspireCortex API credentials — correctly configured
- Cloudflare Access headers — properly constructed

⚠️ **Blocker**: No approved images in database
- All 200 images stuck in `pending` status
- Cannot test regeneration without approved images
- Root cause: Initial image generation failed

---

## Quick Diagnosis (5 minutes)

### Step 1: Run Diagnostic in F12 Console

1. Go to your Cockpit (Images workspace or any page)
2. Press **F12** to open Developer Tools
3. Go to **Console** tab
4. Copy-paste the entire contents of: `F12_IMAGE_REGENERATION_DIAGNOSTIC.js`
5. Press Enter

**What it does:**
- ✅ Verifies API authentication
- ✅ Shows image status distribution (pending/in_review/approved/rejected)
- ✅ Identifies stuck images
- ✅ Shows reason why initial generation failed

### Step 2: Interpret Results

Expected output:
```
pending        : 200 images
generating     : 0 images
in_review      : 0 images
approved       : 0 images  ← ⚠️ PROBLEM: No images to regenerate
rejected       : 0 images
```

**If approved > 0**: Skip to "Testing Regeneration" section below  
**If approved = 0**: Continue with "Workflow Fix" section

---

## Workflow Fix — Move Images to Approved

### Option A: Use Cockpit UI (Recommended)

1. **Go to Images Workspace** → In Review tab
2. **Check Out Images**: Click "Checkout" button
3. **Review & Approve**: 
   - Select images one by one
   - Click green **Approve** button
   - Images move to "Completed / Published" tab
4. **Repeat** until you have at least 1-2 approved images

### Option B: Manual API Calls (Advanced)

1. Find an image in `in_review` status:
```javascript
// In F12 Console:
const res = await fetch('/api/v1/images/queue/in_review', { credentials: 'include' });
const images = await res.json();
const imageId = images[0]?.id;
console.log('Image to approve:', imageId);
```

2. Approve it using the helper:
```javascript
// Copy-paste from F12_MANUAL_WORKFLOW_HELPER.js
// Then run:
await approveImage(imageId);
```

---

## Testing Regeneration

### Prerequisites

- ✅ At least 1 image in `approved` status
- ✅ Logged in to Cockpit
- ✅ Have `image:generate` permission (admin, publisher, editor)

### Test 1: Via UI (Visual Confirmation)

1. **Go to Images workspace** → Completed/Published tab
2. **Find an approved image**
3. **Click the red circular refresh icon** (top-right of image)
4. **Watch for**:
   - Icon changes to spinning indicator
   - Text shows "1 regenerating..."
   - After 30-60 seconds, image updates with new generated version

### Test 2: Via F12 Console (Detailed Diagnostics)

1. Copy-paste `F12_MANUAL_WORKFLOW_HELPER.js` into F12 Console
2. Find an approved image ID:
```javascript
const res = await fetch('/api/v1/images/queue/approved', { credentials: 'include' });
const images = await res.json();
const jobId = images[0]?.id;
console.log('Approved image:', jobId);
```

3. Start regeneration:
```javascript
const result = await regenerateImage(jobId);
// Watch console for poll updates
// When complete: ✅ REGENERATION COMPLETE!
```

---

## Troubleshooting

### Issue: Still "No approved images" after following Workflow Fix

**Possible causes:**
1. Images stuck in `pending` because initial generation failed
2. InspireCortex API not responding
3. Job polling timed out

**Check:**
- Open Browser DevTools → Network tab
- Check server logs for errors:
  - `[callMidjourneyGenerate] IC API error`
  - `[checkICJobStatus] Status check error`
  - `[images:generate] ✗ Download failed`

### Issue: Regenerate clicked but nothing happens

**Step 1**: Check frontend authentication
```javascript
const csrfMatch = document.cookie.match(/(?:^|;\s*)jv-csrf=([^;]*)/);
const authMatch = document.cookie.match(/(?:^|;\s*)jv-session=([^;]*)/);
console.log('CSRF:', csrfMatch ? '✓' : '❌');
console.log('Auth:', authMatch ? '✓' : '❌');
```

**Step 2**: Check Network tab in DevTools
- Look for `POST /api/v1/images/{jobId}/regenerate`
- Check response status: should be 200
- If 403: user lacks `image:generate` permission
- If 422: image not in approved status

**Step 3**: Check server logs
- Look for `[images:regenerate]` messages
- Should see: "Calling MidJourney API..." → "Job polling loop..."

### Issue: Regeneration starts but never completes

**Causes:**
1. InspireCortex API slow or timing out (15-30 seconds)
2. Job polling stuck (network issue)
3. Image generation failed after 5 minutes

**Solution:**
1. Check server logs for API errors
2. Verify network connectivity to api.inspirecortex.com
3. Try smaller/simpler prompts

---

## Detailed Diagnostics

### Admin Diagnostic Endpoint

Get detailed info about a specific image:
```javascript
// In F12 Console, for admin users:
const jobId = 'your-job-id-here';
const res = await fetch(`/api/v1/images/diagnostic/${jobId}`, {
  credentials: 'include'
});
const diagnostic = await res.json();
console.log(diagnostic);
```

Returns:
```javascript
{
  status: { image_status, gpu_job_status },
  timeline: { created_at, age_minutes, updated_at },
  generation: { prompt, image_url, gpu_response },
  workflow: { is_stuck, can_regenerate, can_approve }
}
```

### Check Server Logs

1. **Terminal where server is running**:
   - Look for `[callMidjourneyGenerate]` messages
   - Look for `[checkICJobStatus]` messages
   - Look for `[images:generate]` or `[images:regenerate]`

2. **Errors to watch for**:
   - `IC API error: getaddrinfo ENOTFOUND api.inspirecortex.com`
     → Network/DNS issue
   - `IC API error: 401 Unauthorized`
     → Credentials invalid
   - `IC API error: 302 Found`
     → Cloudflare Access rejected request
   - `Job did not complete within 5 minutes`
     → Timeout waiting for generation

---

## Architecture Summary

### Image Workflow

```
Create Image
    ↓
Status: pending → generating (immediately)
    ↓
[Backend polls IC API every 5 seconds for up to 5 minutes]
    ↓
If completed: Move to in_review
If failed: Stay pending
    ↓
Reviewer approves: in_review → approved
    ↓
User clicks red refresh button
    ↓
[Backend submits to IC API again]
Status: approved → resubmitted (gpu_job_status)
    ↓
[Backend polls for completion]
    ↓
If completed: Update image_url, status stays approved
If failed: Keep approved, mark gpu_job_status=failed
    ↓
Image updates in UI (via React Query polling)
```

### Files Involved

**Backend:**
- `server.js:8649` — `POST /api/v1/images/:jobId/regenerate` endpoint
- `server.js:454` — `callMidjourneyGenerate()` IC API submission
- `server.js:502` — `checkICJobStatus()` polling function

**Frontend:**
- `cockpit/src/hooks/useImages.ts:119` — `useRegenerateImage()` hook
- `cockpit/src/lib/api.ts:~1260` — `regenerateImage()` API function
- `cockpit/src/components/workspace/ImagesWorkspace.tsx:471` — `CompletedGrid` component

---

## Success Criteria

✅ Feature is working when:
1. You have ≥1 approved image in the Completed grid
2. Red refresh icon is visible and clickable
3. Clicking icon shows spinning indicator + "regenerating..." text
4. After 30-60 seconds, image updates with new generated version
5. Server logs show successful IC API polling cycle
6. Audit log records `image.regenerated` event

---

## Next Steps

1. **Right now**: Run diagnostic (`F12_IMAGE_REGENERATION_DIAGNOSTIC.js`)
2. **If approved = 0**: Move images to approved via UI or API
3. **Then**: Click red refresh button to test regeneration
4. **If stuck**: Use diagnostic endpoint to understand why
5. **If working**: Feature is ready for production!

---

## Questions?

Check server logs first — they contain detailed error messages that pinpoint the exact issue.

Most common issues:
- 🔴 **Images stuck pending** → Initial generation failed (check IC API logs)
- 🔴 **Regenerate button not working** → Auth/CSRF issue (check Network tab)
- 🔴 **Regeneration hangs** → InspireCortex API timeout (check connectivity)
