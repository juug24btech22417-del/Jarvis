const { chromium } = require('playwright');

async function findViaGoogle() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  await page.goto('https://www.google.com/search?q=inurl:docs.google.com/forms/d/e/+contact+form', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const links = await page.$$eval('a', as => as.map(a => a.href).filter(h => h.includes('docs.google.com/forms/d/e/')));
  console.log('Google discovered Google Form links:', links.slice(0, 5));

  await browser.close();
}

findViaGoogle().catch(console.error);
