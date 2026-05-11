const port = process.argv[2] || process.env.PORT || 3000;

async function testPlaywright() {
  try {
    console.log(`Testing Playwright API on port ${port}...`);
    const response = await fetch(`http://localhost:${port}/api/playwright`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'screenshot',
        url: 'https://www.google.com'
      })
    });
    const data = await response.json();
    console.log('Response:', data);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testPlaywright();
