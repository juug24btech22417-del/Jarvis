const FirecrawlApp = require('@mendable/firecrawl-js');
const dotenv = require('dotenv');
dotenv.config({ path: './jarvis/.env.local' });

async function test() {
  const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
  try {
    const res = await app.scrapeUrl('https://example.com', {
      formats: ['markdown'],
      onlyMainContent: true,
      waitFor: 1000,
      excludeTags: ['nav'],
      removeSelectors: ['.header']
    });
    console.log('Success:', Object.keys(res));
  } catch (e) {
    console.error('Error:', e.message);
  }
}

test();
