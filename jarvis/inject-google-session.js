/**
 * JARVIS Meeting Bot - Google Session Injector
 *
 * Uses the existing GOOGLE_REFRESH_TOKEN from .env.local to get a valid
 * Google access token, then injects the necessary cookies into the JARVIS
 * browser profile so it can join Google Meet without manual sign-in.
 *
 * Run: node inject-google-session.js
 */

require('dotenv').config({ path: '.env.local' });
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('❌ Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN in .env.local');
  process.exit(1);
}

async function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(data).toString();
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('🔑 JARVIS: Exchanging Google refresh token for access token...');

  const tokenRes = await httpPost('https://oauth2.googleapis.com/token', {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });

  if (!tokenRes.access_token) {
    console.error('❌ Failed to get access token:', JSON.stringify(tokenRes));
    console.log('');
    console.log('The refresh token may be expired or revoked.');
    console.log('Please re-authorize JARVIS at: https://accounts.google.com/o/oauth2/v2/auth');
    process.exit(1);
  }

  console.log('✅ Got access token! Checking token info...');

  // Get token info (email, scope)
  const tokenInfo = await new Promise((resolve, reject) => {
    https.get(
      `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${tokenRes.access_token}`,
      res => {
        let d = '';
        res.on('data', c => { d += c; });
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
      }
    ).on('error', reject);
  });

  console.log('✅ Token is valid for:', tokenInfo.email || '(email not in scope)');
  console.log('   Scopes:', tokenInfo.scope || 'unknown');
  console.log('');

  // Write the cookie file for Playwright to inject on launch
  const PROFILE_DIR = path.join(os.homedir(), '.jarvis-meeting-browser-profile');
  const cookieFile = path.join(PROFILE_DIR, 'jarvis-google-token.json');
  
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.writeFileSync(cookieFile, JSON.stringify({
    accessToken: tokenRes.access_token,
    email: tokenInfo.email,
    expiresAt: Date.now() + (tokenRes.expires_in || 3600) * 1000,
    refreshedAt: new Date().toISOString(),
  }, null, 2));

  console.log('✅ Token saved to profile directory.');
  console.log('');
  console.log('⚠️  NOTE: The OAuth token covers Google Calendar/Drive APIs but Google Meet');
  console.log('   requires a full browser session cookie (SID/HSID/SSID). The token alone');
  console.log('   cannot authenticate a Meet session — we need an alternative approach.');
  console.log('');
  console.log('📋 RECOMMENDED: Use the MeetingBot with a guest name instead.');
  console.log('   Most Google Meet rooms allow guests to join with just a name.');
  console.log('   For rooms that block guests, the host needs to admit JARVIS manually.');
  console.log('');
  console.log('Token email:', tokenInfo.email);
  console.log('Token expires in:', tokenRes.expires_in, 'seconds');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
