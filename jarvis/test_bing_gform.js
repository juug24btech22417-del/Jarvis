const { chromium } = require('playwright');

async function findViaBing() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://www.bing.com/search?q=site%3Adocs.google.com%2Fforms%2Fd%2Fe%2F+contact+information', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const links = await page.$$eval('a', as => as.map(a => a.href).filter(h => h.includes('docs.google.com/forms/d/e/')));
  console.log('Bing discovered Google Form links:', links.slice(0, 5));

  if (links.length > 0) {
    const target = links[0];
    console.log('FOUND REAL GOOGLE FORM:', target);
  }

  await browser.close();
}

findViaBing().catch(console.error);
