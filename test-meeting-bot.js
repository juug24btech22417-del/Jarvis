/**
 * Test script for Jarvis Meeting Bot caption engine
 * 
 * This script:
 * 1. Dispatches the bot to a Zoom webinar
 * 2. Polls the status endpoint every 5 seconds for 2 minutes
 * 3. Reports whether caption count is increasing (the bug was it getting stuck)
 */

const PORT = process.argv[2] || 3000;
const BASE = `http://localhost:${PORT}`;

// The webinar URL to test with
const WEBINAR_URL = 'https://us06web.zoom.us/w/89470861004?tk=Dyv9liDBnH4xCQMNGLes3Rxxy7RVpwpt9wLkrrbWI74.DQkAAAAU1OD-zBZVZXR6QjVVNlRoV1JKYWRpVHVPVzB3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&uuid=WN_7_ycl3CHTjiejrBX9-ZOVQ';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`\n=== JARVIS MEETING BOT TEST ===`);
  console.log(`Server: ${BASE}`);
  console.log(`Webinar: ${WEBINAR_URL.substring(0, 60)}...`);
  console.log('');

  // Step 1: Dispatch the bot
  console.log('1️⃣  Dispatching bot to Zoom webinar...');
  try {
    const joinRes = await fetch(`${BASE}/api/meeting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'join', url: WEBINAR_URL })
    });
    const joinData = await joinRes.json();
    console.log('   Join result:', joinData.success ? '✅ SUCCESS' : '❌ FAILED');
    console.log('   Message:', joinData.message || joinData.error);
    
    if (!joinData.success) {
      console.log('\n❌ Bot failed to join. Aborting test.');
      process.exit(1);
    }
  } catch (e) {
    console.error('   ❌ Network error:', e.message);
    process.exit(1);
  }

  // Step 2: Wait for captions to start (bot auto-enables after 8s)
  console.log('\n2️⃣  Waiting 35s for bot to click Join from browser + enable captions...');
  await sleep(35000);

  // Step 3: Poll status every 5 seconds for 2 minutes
  console.log('\n3️⃣  Polling caption count (every 5s for 2 minutes)...');
  console.log('   Time     | Captions | Recording | Status');
  console.log('   ---------|----------|-----------|-------');

  const history = [];
  let stuckCount = 0;
  
  for (let i = 0; i < 24; i++) {  // 24 * 5s = 2 minutes
    try {
      const statusRes = await fetch(`${BASE}/api/meeting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' })
      });
      const status = await statusRes.json();
      
      const captions = status.captionsCollected || 0;
      const recording = status.isRecording ? 'YES' : 'NO';
      const active = status.isActive ? 'ACTIVE' : 'DEAD';
      const time = new Date().toLocaleTimeString();
      
      // Check if stuck
      const lastCaption = history.length > 0 ? history[history.length - 1] : -1;
      const delta = captions - lastCaption;
      const indicator = lastCaption === -1 ? '🆕' : delta > 0 ? `⬆️ +${delta}` : '⏸️  same';
      
      console.log(`   ${time} | ${String(captions).padStart(8)} | ${recording.padStart(9)} | ${active} ${indicator}`);
      
      history.push(captions);
      
      if (delta === 0 && lastCaption >= 0) {
        stuckCount++;
      } else {
        stuckCount = 0;
      }
      
      // If stuck for 6 consecutive polls (30s), that's the bug
      if (stuckCount >= 6) {
        console.log(`\n   ⚠️  Caption count stuck at ${captions} for 30+ seconds!`);
        
        // Get debug info
        console.log('\n4️⃣  Getting debug info...');
        const debugRes = await fetch(`${BASE}/api/meeting`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'debug' })
        });
        const debug = await debugRes.json();
        console.log('   Elements in bottom half:', debug.elementsInBottomHalf);
        console.log('   Viewport:', debug.viewport);
        console.log('   URL:', debug.url);
        if (debug.elements) {
          console.log('   Sample elements:');
          debug.elements.slice(0, 5).forEach(el => {
            console.log(`     [${el.tag}] "${el.text}" @ ${el.position}`);
          });
        }
        break;
      }
      
    } catch (e) {
      console.log(`   ${new Date().toLocaleTimeString()} | ERROR: ${e.message}`);
    }
    
    await sleep(5000);
  }

  // Final summary
  console.log('\n=== TEST SUMMARY ===');
  if (history.length > 0) {
    const first = history[0];
    const last = history[history.length - 1];
    const growing = last > first;
    console.log(`Caption count: ${first} → ${last} (${growing ? '✅ GROWING' : '❌ STUCK'})`);
    console.log(`Total polls: ${history.length}`);
    console.log(`Stuck streaks (max allowed 5): ${stuckCount}`);
    
    if (growing) {
      console.log('\n✅ PASS: Caption engine is working correctly!');
    } else {
      console.log('\n❌ FAIL: Caption engine got stuck. Bug still present.');
    }
  }

  // Leave meeting
  console.log('\n5️⃣  Leaving meeting...');
  try {
    await fetch(`${BASE}/api/meeting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'leave' })
    });
    console.log('   Done.');
  } catch (e) {
    console.log('   Warning:', e.message);
  }
}

main().catch(console.error);
