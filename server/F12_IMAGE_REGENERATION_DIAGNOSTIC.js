/**
 * F12 Image Regeneration Diagnostic
 *
 * Run this in the browser F12 console to diagnose the image regeneration workflow
 */

console.log('🔧 IMAGE REGENERATION WORKFLOW DIAGNOSTIC\n');

(async () => {
  // ==============================================================================
  // PART 1: Test Authentication & API Access
  // ==============================================================================
  console.log('=' .repeat(80));
  console.log('PART 1: Authentication & API Access');
  console.log('='.repeat(80));

  // Check CSRF token
  const csrfMatch = document.cookie.match(/(?:^|;\s*)jv-csrf=([^;]*)/);
  const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;
  console.log('✅ CSRF Token:', csrfToken ? '✓ found' : '❌ NOT FOUND');

  // Check auth session
  const authMatch = document.cookie.match(/(?:^|;\s*)jv-session=([^;]*)/);
  const authToken = authMatch ? decodeURIComponent(authMatch[1]) : null;
  console.log('✅ Auth Session:', authToken ? '✓ found' : '❌ NOT FOUND');

  // Test server connectivity
  try {
    const healthRes = await fetch('/health');
    const healthData = await healthRes.json();
    console.log(`✅ Server Health: ${healthRes.status === 200 ? '✓ OK' : '❌ ERROR'}`);
  } catch (e) {
    console.error('❌ Server unreachable:', e.message);
    return;
  }

  // ==============================================================================
  // PART 2: Check Image Status Distribution
  // ==============================================================================
  console.log('\n' + '='.repeat(80));
  console.log('PART 2: Database Image Status Distribution');
  console.log('='.repeat(80));

  const statuses = ['pending', 'generating', 'in_review', 'approved', 'rejected'];
  const statusCounts = {};

  for (const status of statuses) {
    try {
      const res = await fetch(`/api/v1/images/queue/${status}`, { credentials: 'include' });
      const images = await res.json();
      const count = Array.isArray(images) ? images.length : 0;
      statusCounts[status] = count;

      const icon = count > 0 ? '✓' : '⚠️ ';
      console.log(`  ${icon} ${status.padEnd(12)} : ${count} images`);
    } catch (e) {
      console.error(`  ❌ ${status}: ${e.message}`);
    }
  }

  const totalImages = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  console.log(`\n  📊 TOTAL: ${totalImages} images in database`);

  // ==============================================================================
  // PART 3: React Component State
  // ==============================================================================
  console.log('\n' + '='.repeat(80));
  console.log('PART 3: UI Component State (CompletedGrid)');
  console.log('='.repeat(80));

  // Find the React component
  const appContainer = document.querySelector('#root');
  if (!appContainer) {
    console.warn('⚠️ React root not found, skipping component state check');
  } else {
    // Try to access React DevTools if available
    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
      console.log('ℹ️  React DevTools detected - use DevTools to inspect component state');
    }

    // Check if Zustand store is accessible (via browser extensions or global)
    if (window.useCockpitStore) {
      try {
        const state = window.useCockpitStore.getState();
        console.log('✓ Zustand store accessible');
        console.log('  Selected section:', state.selectedSection || '(none)');
      } catch (e) {
        console.warn('ℹ️  Zustand store check:', e.message);
      }
    }
  }

  // ==============================================================================
  // PART 4: Test Workflow Transitions
  // ==============================================================================
  console.log('\n' + '='.repeat(80));
  console.log('PART 4: Workflow Transition Test');
  console.log('='.repeat(80));

  const pendingImages = statusCounts.pending;

  if (pendingImages === 0) {
    console.warn('⚠️  No pending images to test with');
    console.log('\n📝 SOLUTION:');
    console.log('  1. You need to generate images first');
    console.log('  2. Go to Content workspace and create articles');
    console.log('  3. Use "Generate" button to create images');
    console.log('  4. Wait for them to move from pending → in_review → approved');
  } else {
    console.log(`✓ Found ${pendingImages} pending images - testing workflow...`);

    try {
      // Get first pending image
      const pendingRes = await fetch('/api/v1/images/queue/pending', { credentials: 'include' });
      const pendingList = await pendingRes.json();
      const testImage = pendingList[0];

      if (!testImage) {
        console.error('❌ Could not retrieve pending image');
        return;
      }

      console.log(`\nℹ️  Test Image ID: ${testImage.id}`);
      console.log(`   Status: ${testImage.image_status}`);
      console.log(`   GPU Status: ${testImage.gpu_job_status}`);
      console.log(`   Content: ${testImage.content_object_id ? '✓ linked' : '⚠️  not linked'}`);
      console.log(`   Image URL: ${testImage.image_url ? '✓ has URL' : '⚠️  no URL'}`);

      // Check if image is stuck (no URL after long time)
      if (testImage.gpu_job_status === 'pending' && !testImage.image_url) {
        const createdAt = new Date(testImage.created_at);
        const ageMinutes = (Date.now() - createdAt) / 60000;
        console.log(`\n⚠️  IMAGE STUCK: Created ${Math.round(ageMinutes)} minutes ago`);
        console.log('   Likely causes:');
        console.log('   - Initial generation to InspireCortex API failed');
        console.log('   - Job polling timed out');
        console.log('   - Server restarted mid-generation');
        console.log('\n🔍 Check server logs for errors like:');
        console.log('   [images:generate] MidJourney API error');
        console.log('   [callMidjourneyGenerate] IC API error');
        console.log('   [checkICJobStatus] Status check error');
      }

      // Try to find at least one in_review image
      if (statusCounts.in_review > 0) {
        console.log('\n✓ Found images in in_review - can test approval workflow');
        const inReviewRes = await fetch('/api/v1/images/queue/in_review', { credentials: 'include' });
        const inReviewList = await inReviewRes.json();
        const reviewImage = inReviewList[0];
        console.log(`  Image: ${reviewImage.id}`);
        console.log(`  Ready to approve → approved`);
      }

      if (statusCounts.approved > 0) {
        console.log('\n✓ Found approved images - regenerate should work!');
        const approvedRes = await fetch('/api/v1/images/queue/approved', { credentials: 'include' });
        const approvedList = await approvedRes.json();
        const approvedImage = approvedList[0];
        console.log(`\nℹ️  Test Regeneration: approvedImage.id = '${approvedImage.id}'`);
        console.log('   Window helper set: window.testRegenerateJob');
        window.testRegenerateJob = approvedImage.id;
      } else {
        console.warn('\n⚠️  NO APPROVED IMAGES - Cannot test regeneration yet');
        console.log('\n📝 NEXT STEPS:');
        console.log('  1. Manually approve a pending/in-review image:');
        console.log('     POST /api/v1/images/{jobId}/approve');
        console.log('  2. Or generate new images with the fixed generation pipeline');
      }

    } catch (e) {
      console.error('❌ Workflow test error:', e.message);
    }
  }

  // ==============================================================================
  // PART 5: Test Regenerate Endpoint
  // ==============================================================================
  console.log('\n' + '='.repeat(80));
  console.log('PART 5: Regenerate Endpoint Test');
  console.log('='.repeat(80));

  if (statusCounts.approved > 0) {
    console.log(`\n✓ Ready to test regenerate (${statusCounts.approved} approved images available)`);
    console.log('\nTo test regeneration, run in console:');
    console.log('  await testRegenerate(window.testRegenerateJob)');

    // Define the test function
    window.testRegenerate = async (jobId) => {
      console.log(`\n🔄 Testing regeneration for job: ${jobId}`);

      try {
        const csrfMatch = document.cookie.match(/(?:^|;\s*)jv-csrf=([^;]*)/);
        const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;

        const res = await fetch(`/api/v1/images/${jobId}/regenerate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken || ''
          },
          credentials: 'include',
          body: JSON.stringify({})
        });

        console.log(`Response Status: ${res.status}`);
        const data = await res.json();
        console.log('Response Data:', data);

        if (res.ok) {
          console.log('✅ Regeneration submitted! Polling for completion...');

          // Poll for 2 minutes
          for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 2000));

            const pollRes = await fetch(`/api/v1/images/queue/approved`, { credentials: 'include' });
            const images = await pollRes.json();
            const job = images.find(j => j.id === jobId);

            if (job) {
              console.log(`Poll ${i + 1}: gpu_job_status=${job.gpu_job_status}, image_url=${job.image_url ? '✓' : '⚠️ '}`);

              if (job.gpu_job_status === 'completed' && job.image_url) {
                console.log('✅ REGENERATION COMPLETE!');
                return job;
              }
            }
          }

          console.warn('⚠️  Regeneration did not complete in 2 minutes');
        } else {
          console.error(`❌ Error: ${data.error || 'Unknown error'}`);
        }
      } catch (e) {
        console.error('❌ Test error:', e.message);
      }
    };
  } else {
    console.warn('⚠️  No approved images to test with');
    console.log('\nTo create a test approved image:');
    console.log('  1. Use pending image and move it through workflow');
    console.log('  2. Or manually approve one via API');
  }

  // ==============================================================================
  // SUMMARY
  // ==============================================================================
  console.log('\n' + '='.repeat(80));
  console.log('DIAGNOSTIC COMPLETE');
  console.log('='.repeat(80));

  console.log('\n📊 SUMMARY:');
  console.log(`  Total images: ${totalImages}`);
  console.log(`  Pending: ${statusCounts.pending}`);
  console.log(`  In Review: ${statusCounts.in_review}`);
  console.log(`  Approved (can regenerate): ${statusCounts.approved}`);
  console.log(`  Rejected: ${statusCounts.rejected}`);

  if (statusCounts.approved > 0) {
    console.log('\n✅ READY: Run testRegenerate() to test the feature');
  } else {
    console.log('\n⚠️  BLOCKED: Generate or approve images first to test regeneration');
  }

})();
