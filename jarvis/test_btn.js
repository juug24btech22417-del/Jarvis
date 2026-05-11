const { chromium } = require('playwright-extra');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://us06web.zoom.us/webinar/register/9017769419156/WN_7_ycl3CHTjiejrBX9-ZOVQ');
  await page.waitForTimeout(2000);
  
  await page.type('#question_first_name', 'JARVIS');
  await page.type('#question_last_name', 'B');
  await page.type('#question_email', 'dhruvbijapur@gmail.com');
  await page.type('#question_phone', '9606571200');
  
  await page.waitForTimeout(1000);
  
  const disabled = await page.evaluate(() => {
    return document.querySelector('button:has-text("Register")').getAttribute('aria-disabled');
  });
  console.log("Is disabled?", disabled);
  
  await browser.close();
})();
