# Image Regeneration Diagnostic Guide

## Quick Test Steps

### 1. Verify Server is Running
```bash
curl http://localhost:3107/
```
Should return HTML (Cockpit homepage)

### 2. Check If You're Logged In
Open DevTools (F12) → Console. Run:
```javascript
document.cookie
```
Look for `jv-session=` or similar auth cookie

### 3. Test the Regenerate Endpoint Directly
In browser console, get an article ID, then:
```javascript
fetch('/api/jv-articles/{ARTICLE_ID}/regenerate-image', {
  method: 'POST',
  credentials: 'include',
  headers: {'Content-Type': 'application/json'}
}).then(r => r.json()).then(d => console.log(d))
```

Expected responses:
- ✅ `{success: true, jobId: "...", queued: true}` — WORKING
- ❌ `{error: "Authorization token required"}` — NOT LOGGED IN
- ❌ `{error: "Forbidden"}` — MISSING PERMISSION
- ❌ `{error: "..."}` — CODE ERROR

### 4. Check Database After Regeneration
Run this after clicking refresh (replace ARTICLE_ID):
```sql
SELECT id, extension_data->>'hero_image_path' as image_path, updated_at 
FROM jv_content_objects 
WHERE id = 'ARTICLE_ID';
```

The `hero_image_path` should be a new `/images/generated/...` path

### 5. Check Image Jobs Created
```sql
SELECT id, gpu_job_status, image_status, image_url 
FROM image_generation_jobs 
WHERE content_object_id = 'ARTICLE_ID' 
ORDER BY created_at DESC LIMIT 3;
```

Should see `gpu_job_status='completed'` for recent jobs

### 6. Check Server Logs for Errors
Look at the terminal/console where npm start is running. Search for:
- `[JVRegen:...]` — regeneration was called
- `Error:` — any exceptions
- `500 Internal Server Error` — endpoint crashed

## The Complete Flow Should Be:

1. User clicks red refresh button on image
2. Browser calls: `POST /api/jv-articles/{id}/regenerate-image`
3. Server:
   - Authenticates user (must be logged in)
   - Checks permission (must have `image:generate`)
   - Fetches article content
   - Analyzes with LLM (or uses mock)
   - Creates `image_generation_jobs` record
   - Updates `jv_content_objects.extension_data.hero_image_path` ← THIS IS KEY
   - Returns `{success: true, jobId: ...}`
4. Frontend:
   - Receives jobId
   - Starts polling images endpoint every 2 seconds
   - React Query detects `hero_image_path` changed
   - Component re-renders with new image

## If It's Not Working:

**Response is 401 (Not logged in):**
- Solution: Log in to Cockpit first
- Try: Email + password in login form

**Response is 403 (Permission denied):**
- Solution: User account needs `image:generate` permission
- Check: User role should be admin/publisher/editor

**Response is 500 (Server error):**
- Diagnostic: Check server logs for `[JVRegen:...]` errors
- Check if article exists in database
- Check if LLM analysis is failing

**Response is 200 but image doesn't change:**
- Problem: Database is being updated but frontend isn't detecting it
- Diagnostic: Check if `hero_image_path` is actually changing (use SQL query above)
- Check: Is polling running? (Console should show network requests every 2s)

## Key Settings

These must be set in `.env`:
```
IMAGE_REGEN_MOCK=true      # Enable mock image generation (2-second delay)
LOCAL_AUTH_ENABLED=true    # Allow local auth bypass
```

If mock mode is OFF, it will try calling IC API which requires working internet + valid credentials.

## Tell Me The Answer To These:

After testing, check:

1. When you click refresh, does browser console show any JS errors?
2. What is the response from the direct fetch test?
3. Does the database `hero_image_path` change after refresh?
4. What does the server log say when you click refresh?

Once I know the answer to even ONE of these, I can fix the actual problem.
