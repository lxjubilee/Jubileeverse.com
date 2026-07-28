/**
 * Manual Workflow Helper — Move images through approval for testing
 *
 * Use this to manually move a pending image to approved status
 * so you can test the regeneration feature
 */

console.log('🛠️  MANUAL WORKFLOW HELPER - Image Approval Testing\n');

// Get CSRF token
const getCsrfToken = () => {
  const match = document.cookie.match(/(?:^|;\s*)jv-csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
};

// Move image to in_review (simulates completed generation)
window.forceImageToReview = async (jobId) => {
  console.log(`⚙️  Moving image ${jobId} to in_review status (admin only)...\n`);

  try {
    // This requires admin privileges - attempts to update via API
    // Note: Standard endpoints don't allow direct status updates
    // Would need admin helper endpoint
    console.warn('⚠️  Standard API does not have endpoint to move images directly');
    console.log('\nINSTEAD, use the Image Review Workspace:');
    console.log('  1. Go to Images workspace');
    console.log('  2. Check if image is in "In Review" queue');
    console.log('  3. Click "Approve" to move to "Completed / Published"');
    console.log('  4. Then test regenerate');
  } catch (e) {
    console.error('Error:', e.message);
  }
};

// Try to approve an in_review image
window.approveImage = async (jobId) => {
  console.log(`✅ Attempting to approve image ${jobId}...\n`);

  try {
    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      console.error('❌ CSRF token not found');
      return;
    }

    const res = await fetch(`/api/v1/images/${jobId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      credentials: 'include',
      body: JSON.stringify({})
    });

    console.log(`Response: ${res.status} ${res.statusText}`);
    const data = await res.json();

    if (res.ok) {
      console.log('✅ Image approved!');
      console.log('   Status:', data.image_status);
      console.log('   Can now regenerate');
      return data;
    } else {
      console.error('❌ Error:', data.error || 'Unknown error');
      console.log('\nPossible reasons:');
      console.log('  - Image not in "in_review" status');
      console.log('  - Image is checked out by another reviewer');
      console.log('  - User does not have image:review permission');
      return null;
    }
  } catch (e) {
    console.error('❌ Network error:', e.message);
    return null;
  }
};

// Regenerate an approved image
window.regenerateImage = async (jobId) => {
  console.log(`🔄 Regenerating image ${jobId}...\n`);

  try {
    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      console.error('❌ CSRF token not found');
      return;
    }

    const res = await fetch(`/api/v1/images/${jobId}/regenerate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      credentials: 'include',
      body: JSON.stringify({})
    });

    console.log(`\nResponse: ${res.status} ${res.statusText}`);
    const data = await res.json();

    if (res.ok) {
      console.log('✅ Regeneration submitted!');
      console.log('   Job ID:', data.id);
      console.log('   GPU Status:', data.gpu_job_status);
      console.log('\n⏳ Polling for completion (checking every 3 seconds)...');

      // Poll for 5 minutes
      for (let i = 0; i < 100; i++) {
        await new Promise(r => setTimeout(r, 3000));

        try {
          const pollRes = await fetch(`/api/v1/images/queue/approved`, { credentials: 'include' });
          const images = await pollRes.json();
          const job = images.find(j => j.id === jobId);

          if (job) {
            const indicators = {
              submitted: '⏳',
              processing: '⏳',
              completed: '✅',
              resubmitted: '🔄',
              timeout: '⏱️',
              failed: '❌'
            };

            const icon = indicators[job.gpu_job_status] || '❓';
            console.log(`  Poll ${i + 1}: ${icon} gpu_job_status=${job.gpu_job_status}`);

            if (job.gpu_job_status === 'completed' && job.image_url) {
              console.log('\n✅ REGENERATION COMPLETE!');
              console.log('   New Image URL:', job.image_url);
              return job;
            }
          } else {
            console.warn(`  Poll ${i + 1}: ⚠️  Image not found in approved queue`);
          }
        } catch (e) {
          console.warn(`  Poll ${i + 1}: Error - ${e.message}`);
        }
      }

      console.warn('\n⚠️  Regeneration timed out after 5 minutes');
      console.log('Check server logs for detailed error information');

    } else {
      console.error('❌ Error:', data.error || 'Unknown error');
      console.log('\nPossible reasons:');
      console.log('  - Image not in "approved" status');
      console.log('  - InspireCortex API call failed');
      console.log('  - User does not have image:generate permission');
      return null;
    }
  } catch (e) {
    console.error('❌ Network error:', e.message);
    return null;
  }
};

console.log('✅ Workflow helper loaded. Available functions:\n');
console.log('  approveImage(jobId)     - Approve an in_review image');
console.log('  regenerateImage(jobId)  - Regenerate an approved image\n');
console.log('Example workflow:');
console.log('  1. Get a pending image ID from the Images workspace');
console.log('  2. Use Images UI to move it to "In Review"');
console.log('  3. Run: await approveImage("job-id-here")');
console.log('  4. Run: await regenerateImage("job-id-here")');
console.log('  5. Watch console for polling updates\n');
