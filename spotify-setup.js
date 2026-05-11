#!/usr/bin/env node

/**
 * Spotify Setup Script for JARVIS
 * Run: node spotify-setup.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CLIENT_ID = '5a1dc5e522c54a87a530937002a35f4b';
const CLIENT_SECRET = '05a8911c4c5348a5960d3fb4fd8393c7';
const REDIRECT_URI = 'http://127.0.0.1:3000/api/spotify/callback';
const PORT = 3000;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function log(message) {
  console.log(`\n[Spotify Setup] ${message}`);
}

function question(prompt) {
  return new Promise(resolve => {
    rl.question(prompt, resolve);
  });
}

// Step 1: Start local server to capture the callback
function startCallbackServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Error: ${error}</h1><p>Authorization failed.</p>`);
        server.close();
        reject(new Error(`Authorization failed: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<h1>✅ Success!</h1><p>Authorization code received. You can close this window.</p><script>window.close()</script>`);
        server.close();
        resolve(code);
      } else {
        res.writeHead(200);
        res.end('<h1>Waiting for authorization...</h1>');
      }
    });

    server.listen(PORT, () => {
      log(`Callback server started on port ${PORT}`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        log('Port 3000 is already in use. Make sure JARVIS is not running.');
        reject(err);
      } else {
        reject(err);
      }
    });
  });
}

// Step 2: Exchange code for tokens
function exchangeCodeForTokens(code) {
  return new Promise((resolve, reject) => {
    const authString = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

    const postData = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI
    }).toString();

    const options = {
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.refresh_token) {
            resolve(response);
          } else {
            reject(new Error(`Token exchange failed: ${JSON.stringify(response)}`));
          }
        } catch (e) {
          reject(new Error(`Invalid response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Step 3: Update .env.local
function updateEnvFile(refreshToken) {
  const envPath = path.join(__dirname, 'jarvis', '.env.local');

  let content = fs.readFileSync(envPath, 'utf8');

  // Update or add Spotify credentials
  const lines = content.split('\n');
  const newLines = [];
  let foundClientId = false;
  let foundClientSecret = false;
  let foundRefreshToken = false;

  for (const line of lines) {
    if (line.startsWith('SPOTIFY_CLIENT_ID=')) {
      newLines.push(`SPOTIFY_CLIENT_ID=${CLIENT_ID}`);
      foundClientId = true;
    } else if (line.startsWith('SPOTIFY_CLIENT_SECRET=')) {
      newLines.push(`SPOTIFY_CLIENT_SECRET=${CLIENT_SECRET}`);
      foundClientSecret = true;
    } else if (line.startsWith('SPOTIFY_REFRESH_TOKEN=')) {
      newLines.push(`SPOTIFY_REFRESH_TOKEN=${refreshToken}`);
      foundRefreshToken = true;
    } else {
      newLines.push(line);
    }
  }

  // Add missing lines
  if (!foundClientId) {
    newLines.push(`SPOTIFY_CLIENT_ID=${CLIENT_ID}`);
  }
  if (!foundClientSecret) {
    newLines.push(`SPOTIFY_CLIENT_SECRET=${CLIENT_SECRET}`);
  }
  if (!foundRefreshToken) {
    newLines.push(`SPOTIFY_REFRESH_TOKEN=${refreshToken}`);
  }

  fs.writeFileSync(envPath, newLines.join('\n'));
  log('.env.local updated successfully!');
}

// Step 4: Test the token
function testToken(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.spotify.com',
      path: '/v1/me/player/devices',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (e) {
          resolve({ devices: [] });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🎵 JARVIS Spotify Setup');
  console.log('='.repeat(60));

  try {
    log('Step 1: Starting callback server...');
    const codePromise = startCallbackServer();

    log('Step 2: Opening Spotify authorization...');
    const scopes = [
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'streaming',
      'playlist-read-private'
    ];

    const authUrl = `https://accounts.spotify.com/authorize?` +
      `client_id=${CLIENT_ID}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${scopes.join('%20')}`;

    console.log(`\n👉 Opening: ${authUrl}`);

    // Try to open browser
    const { exec } = require('child_process');
    const platform = process.platform;
    const command = platform === 'win32' ? `start "" "${authUrl}"` :
                   platform === 'darwin' ? `open "${authUrl}"` :
                   `xdg-open "${authUrl}"`;

    exec(command, (err) => {
      if (err) {
        console.log(`\n⚠️ Could not open browser automatically.`);
        console.log(`Please manually open this URL:\n${authUrl}\n`);
      }
    });

    log('Step 3: Waiting for authorization...');
    console.log('(Login to Spotify in the browser and click "Agree")\n');

    const code = await codePromise;
    log('Authorization code received!');

    log('Step 4: Exchanging code for tokens...');
    const tokens = await exchangeCodeForTokens(code);
    log('✅ Got refresh token!');

    log('Step 5: Updating .env.local...');
    updateEnvFile(tokens.refresh_token);

    log('Step 6: Testing token...');
    const devices = await testToken(tokens.access_token);
    log(`Found ${devices.devices?.length || 0} Spotify devices`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ Spotify setup complete!');
    console.log('='.repeat(60));
    console.log('\nNext steps:');
    console.log('1. Restart JARVIS: npm run dev');
    console.log('2. Say: "play music" or "testspotify"');
    console.log('\n⚠️  IMPORTANT: Open Spotify app before using voice commands!');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.log('\nTroubleshooting:');
    console.log('- Make sure JARVIS is NOT running on port 3000');
    console.log('- Try running: taskkill /F /IM node.exe (Windows)');
    console.log('- Then run this script again');
  } finally {
    rl.close();
    process.exit(0);
  }
}

main();
