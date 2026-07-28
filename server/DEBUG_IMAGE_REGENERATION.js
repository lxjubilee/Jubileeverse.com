/**
 * Image Regeneration Debug Script
 *
 * Paste this entire script into the F12 console and run it to diagnose
 * exactly where image regeneration is failing.
 */

console.log('=== IMAGE REGENERATION DEBUG SCRIPT ===\n');

(async () => {
  // Step 1: Test API connectivity
  console.log('Step 1: Testing API endpoint...');
  try {
    const healthResponse = await fetch('/health');
    const health = await healthResponse.json();
    console.log('✅ Server is responding:', health.status);
  } catch (e) {
    console.error('❌ Server not responding:', e.message);
    return;
  }

  // Step 2: Get CSRF token
  console.log('\nStep 2: Checking CSRF token...');
  const csrfMatch = document.cookie.match(/(?:^|;\s*)jv-csrf=([^;]*)/);
  const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;
  if (csrfToken) {
    console.log('✅ CSRF token found:', csrfToken.slice(0, 20) + '...');
  } else {
    console.error('❌ CSRF token NOT found in cookies');
    console.log('Cookies:', document.cookie);
  }

  // Step 3: Get auth token
  console.log('\nStep 3: Checking authentication...');
  const authMatch = document.cookie.match(/(?:^|;\s*)jv-session=([^;]*)/);
  const authToken = authMatch ? decodeURIComponent(authMatch[1]) : null;
  if (authToken) {
    console.log('✅ Auth session found:', authToken.slice(0, 20) + '...');
  } else {
    console.warn('⚠️  Auth session not found (may be using header auth)');
  }

  // Step 4: Find an image job ID
  console.log('\nStep 4: Finding approved image to regenerate...');
  let testJobId = null;

  // Try to find from the API
  try {
    const imageResponse = await fetch('/api/v1/images/queue/approved', {
      credentials: 'include'
    });
    if (imageResponse.ok) {
      const images = await imageResponse.json();
      if (Array.isArray(images) && images.length > 0) {
        testJobId = images[0].id;
        console.log('✅ Found approved image job:', testJobId);
        console.log('   Status:', images[0].gpu_job_status);
        console.log('   Image URL:', images[0].image_url?.slice(0, 50) + '...');
      } else {
        console.warn('⚠️  No approved images found');
      }
    } else {
      console.error('❌ Failed to fetch images:', imageResponse.status);
    }
  } catch (e) {
    console.error('❌ Error fetching images:', e.message);
  }

  if (!testJobId) {
    console.log('\n⚠️  Cannot test regeneration without an approved image.');
    console.log('Go to Images workspace > Completed tab and note a job ID');
    console.log('Then run: testRegenerateImage(\'job-id-here\')');
    return;
  }

  // Step 5: Test the regenerate endpoint
  console.log('\nStep 5: Testing regenerate endpoint...');
  try {
    const regenResponse = await fetch(`/api/v1/images/${testJobId}/regenerate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || ''
      },
      credentials: 'include',
      body: JSON.stringify({})
    });

    console.log('Response status:', regenResponse.status);
    const regenData = await regenResponse.json();
    console.log('Response data:', regenData);

    if (regenResponse.ok) {
      console.log('✅ Regenerate endpoint returned 200');
      console.log('   Job ID:', regenData.id);
      console.log('   GPU Status:', regenData.gpu_job_status);
      console.log('   Image Status:', regenData.image_status);
    } else {
      console.error('❌ Regenerate endpoint returned', regenResponse.status);
      console.error('   Error:', regenData.error || regenData.message);
    }

    // Step 6: Poll for completion
    console.log('\nStep 6: Polling for regeneration (10 polls at 2-second intervals)...');
    let completed = false;
    for (let i = 1; i <= 10; i++) {
      await new Promise(r => setTimeout(r, 2000));

      try {
        const pollResponse = await fetch(`/api/v1/images/queue/approved`, {
          credentials: 'include'
        });
        const pollData = await pollResponse.json();
        const currentJob = pollData.find(j => j.id === testJobId);

        if (currentJob) {
          console.log(`Poll ${i}: gpu_job_status = ${currentJob.gpu_job_status}`);
          if (currentJob.gpu_job_status === 'completed') {
            console.log('✅ REGENERATION COMPLETE!');
            console.log('   New image URL:', currentJob.image_url);
            completed = true;
            break;
          }
        } else {
          console.warn(`Poll ${i}: Job not found in results`);
        }
      } catch (e) {
        console.error(`Poll ${i} failed:`, e.message);
      }
    }

    if (!completed) {
      console.warn('\n⚠️  Regeneration did not complete in 20 seconds');
      console.log('Check server logs for backend errors');
    }

  } catch (e) {
    console.error('❌ Regenerate endpoint error:', e.message);
    console.error('Stack:', e.stack);
  }

  console.log('\n=== DEBUG COMPLETE ===');
})();

// Helper function to test a specific job ID
window.testRegenerateImage = async (jobId) => {
  console.log(`Testing regeneration for job: ${jobId}`);
  const csrfMatch = document.cookie.match(/(?:^|;\s*)jv-csrf=([^;]*)/);
  const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;

  const response = await fetch(`/api/v1/images/${jobId}/regenerate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken || ''
    },
    credentials: 'include',
    body: JSON.stringify({})
  });

  console.log('Status:', response.status);
  const data = await response.json();
  console.log('Response:', data);
  return data;
};

console.log('\nYou can also manually test with: testRegenerateImage(\'job-id\')');
