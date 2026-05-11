const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  await page.goto('https://us06web.zoom.us/webinar/register/9017769419156/WN_7_ycl3CHTjiejrBX9-ZOVQ');
  await page.waitForTimeout(5000);

  const html = await page.content();
  const fs = require('fs');
  fs.writeFileSync('zoom_form.html', html);
  console.log("HTML saved.");

  await browser.close();
})();
