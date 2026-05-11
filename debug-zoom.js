const { chromium } = require('playwright');
const fs = require('fs');

async function debugZoom() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const url = 'https://us06web.zoom.us/w/89470861004?tk=Dyv9liDBnH4xCQMNGLes3Rxxy7RVpwpt9wLkrrbWI74.DQkAAAAU1OD-zBZVZXR6QjVVNlRoV1JKYWRpVHVPVzB3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&uuid=WN_7_ycl3CHTjiejrBX9-ZOVQ';
  
  console.log('Navigating to Zoom URL...');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  
  console.log('URL after 5s:', page.url());
  
  // Try to click "Join from Browser" if available
  const joinSelectors = [
    'a:has-text("Join from browser")',
    'a:has-text("Join from Browser")',
    'a:has-text("Join from Your Browser")',
    'a:has-text("Launch Meeting")',
    'a:has-text("Join")',
    'a >> text=browser'
  ];
  
  let clicked = false;
  for (const sel of joinSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 })) {
        console.log('Clicking selector:', sel);
        await el.click();
        clicked = true;
        break;
      }
    } catch (e) {}
  }
  
  if (clicked) {
    console.log('Waiting for next page...');
    await page.waitForTimeout(5000);
    console.log('URL after click:', page.url());
  }

  console.log('Dumping DOM inputs and buttons...');
  const elements = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input')).map(el => ({
      tag: 'input',
      id: el.id,
      name: el.name,
      type: el.type,
      placeholder: el.placeholder
    }));
    const buttons = Array.from(document.querySelectorAll('button')).map(el => ({
      tag: 'button',
      id: el.id,
      text: el.innerText.trim()
    }));
    return { inputs, buttons };
  });
  
  console.log(JSON.stringify(elements, null, 2));
  
  await browser.close();
}

debugZoom().catch(console.error);
