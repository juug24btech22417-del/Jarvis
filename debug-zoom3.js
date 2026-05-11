const { chromium } = require('playwright');
const fs = require('fs');

async function debugZoom() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const url = 'https://us06web.zoom.us/w/89470861004?tk=Dyv9liDBnH4xCQMNGLes3Rxxy7RVpwpt9wLkrrbWI74.DQkAAAAU1OD-zBZVZXR6QjVVNlRoV1JKYWRpVHVPVzB3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&uuid=WN_7_ycl3CHTjiejrBX9-ZOVQ';
  
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  const sel = 'button:has-text("Join from browser"), a:has-text("Join from browser")';
  try {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 1000 })) {
      await el.click();
    }
  } catch (e) {}
  
  await page.waitForTimeout(5000);
  console.log('URL after click:', page.url());

  const elements = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input')).map(el => ({
      id: el.id,
      name: el.name,
      type: el.type,
      placeholder: el.placeholder
    })).filter(i => i.type === 'text' || i.type === 'email');
    const buttons = Array.from(document.querySelectorAll('button')).map(el => ({
      id: el.id,
      text: el.innerText.trim()
    }));
    return { inputs, buttons };
  });
  
  console.log(JSON.stringify(elements, null, 2));
  
  await browser.close();
}

debugZoom().catch(console.error);
