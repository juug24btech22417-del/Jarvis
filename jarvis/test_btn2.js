const { chromium } = require('playwright-extra');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://us06web.zoom.us/webinar/register/9017769419156/WN_7_ycl3CHTjiejrBX9-ZOVQ');
  await page.waitForTimeout(2000);
  
  await page.locator('#question_first_name').pressSequentially('JARVIS', { delay: 100 });
  await page.keyboard.press('Tab');
  await page.locator('#question_last_name').pressSequentially('B', { delay: 100 });
  await page.keyboard.press('Tab');
  await page.locator('#question_email').pressSequentially('dhruvbijapur@gmail.com', { delay: 100 });
  await page.keyboard.press('Tab');
  await page.locator('#question_phone').pressSequentially('9606571200', { delay: 100 });
  await page.keyboard.press('Tab');
  
  await page.waitForTimeout(1000);
  
  const button = page.locator('button', { hasText: 'Register' }).first();
  const classes = await button.getAttribute('class');
  console.log("Button classes:", classes);
  
  await browser.close();
})();
