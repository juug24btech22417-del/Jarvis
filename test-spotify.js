const https = require('https');

const CLIENT_ID = '5a1dc5e522c54a87a530937002a35f4b';
const CLIENT_SECRET = '05a8911c4c5348a5960d3fb4fd8393c7';
const REFRESH_TOKEN = 'AQCI_Hwr2IcWLEG-glVOkMEGJ_n6gioGkjlhw9ydfOX2h8J-G7lxv4L0_0PkZz53yROjbUhNJ6dsWHLC0wxjPObUKzN2Mh06HvGbv84ZwY05CXuEdKV9dUiwhqRkqwPOLTU';

function testTokenRefresh() {
  return new Promise((resolve, reject) => {
    const authString = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

    const postData = `grant_type=refresh_token&refresh_token=${encodeURIComponent(REFRESH_TOKEN)}`;

    console.log('Testing token refresh...');
    console.log('Auth string:', authString.slice(0, 20) + '...');
    console.log('Refresh token length:', REFRESH_TOKEN.length);

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

      console.log('Status:', res.statusCode);

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('Response:', data);
        try {
          const response = JSON.parse(data);
          if (response.access_token) {
            console.log('\n✅ SUCCESS! Got access token:', response.access_token.slice(0, 20) + '...');
            console.log('Expires in:', response.expires_in, 'seconds');
            resolve(response);
          } else {
            console.log('\n❌ FAILED:', response.error);
            console.log('Description:', response.error_description);
            reject(new Error(response.error_description || response.error));
          }
        } catch (e) {
          console.log('Invalid JSON response');
          reject(e);
        }
      });
    });

    req.on('error', (err) => {
      console.error('Request error:', err);
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

testTokenRefresh()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
