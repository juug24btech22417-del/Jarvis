/**
 * JARVIS Meeting Bot - Google Account Setup
 *
 * Run this ONCE to sign in to Google in the JARVIS meeting browser profile.
 * After signing in, ALL future Google Meet sessions are authenticated automatically.
 *
 * Usage: node setup-google-login.js
 */

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const JARVIS_PROFILE_DIR = path.join(os.homedir(), '.jarvis-meet-profile');

async function main() {
  console.log('🚀 JARVIS: Launching Chrome for Google Sign-In setup...');
  console.log(`📁 Profile: ${JARVIS_PROFILE_DIR}`);
  console.log('');
  console.log('👉 Instructions:');
  console.log('   1. Chrome will open to accounts.google.com');
  console.log('   2. Sign in with: dhruvbijapur67@gmail.com');
  console.log('   3. Complete any 2FA prompts');
  console.log('   4. This terminal will auto-detect when you\'re signed in');
  console.log('   5. After verification, you can close Chrome');
  console.log('');

  const context = await chromium.launchPersistentContext(JARVIS_PROFILE_DIR, {
    executablePath: CHROME_PATH,
    headless: false,
    args: [
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,800',
      '--window-position=100,50',   // Force on screen top-left area
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: 1280, height: 800 },
  });

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  console.log('🌐 Opening Google Sign-In page...');
  await page.goto('https://accounts.google.com/signin/v2/identifier?hl=en', {
    waitUntil: 'domcontentloaded',
  });

  console.log('');
  console.log('⏳ Waiting for you to sign in...');
  console.log('   (Chrome window should be visible on your screen)');
  console.log('');

  let signedIn = false;
  let attempts = 0;

  while (!signedIn && attempts < 180) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    attempts++;

    try {
      const url = page.url();
      const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      const lower = bodyText.toLowerCase();

      if (
        url.includes('myaccount.google.com') ||
        url.includes('mail.google.com') ||
        url.includes('accounts.google.com/b/') ||
        lower.includes('sign out') ||
        lower.includes('manage your google account') ||
        lower.includes('google account')
      ) {
        signedIn = true;
      }
    } catch {}

    if (attempts % 10 === 0) {
      console.log(`⏳ Still waiting... (${attempts * 2}s) — please sign in to dhruvbijapur67@gmail.com`);
    }
  }

  if (signedIn) {
    console.log('');
    console.log('✅ Sign-in detected! Verifying Google Meet...');
    await page.goto('https://meet.google.com', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 4000));

    const meetText = (await page.evaluate(() => document.body?.innerText || '').catch(() => '')).toLowerCase();

    if (meetText.includes('new meeting') || meetText.includes('start a meeting') || meetText.includes('join a meeting')) {
      console.log('✅ Google Meet CONFIRMED — you are now authenticated!');
      console.log('');
      console.log('🎉 JARVIS Meeting Bot is ready. Close Chrome and test from the Automation Panel.');
    } else {
      console.log('⚠️  Signed in but Meet verification inconclusive. Session is likely saved anyway.');
    }
  } else {
    console.log('⚠️  Timed out, but if you signed in, the session IS saved. Close Chrome and test.');
  }

  console.log('');
  console.log('📌 Session saved permanently to:', JARVIS_PROFILE_DIR);

  await new Promise(resolve => {
    process.on('SIGINT', async () => {
      await context.close().catch(() => {});
      resolve(null);
    });
    context.on('close', () => resolve(null));
  });

  console.log('✅ Done! Meeting Bot profile is ready.');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
