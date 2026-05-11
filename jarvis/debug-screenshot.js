const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  await page.goto('https://us06web.zoom.us/webinar/register/9017769419156/WN_7_ycl3CHTjiejrBX9-ZOVQ');
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'zoom_webinar_reg.png' });
  console.log("Screenshot 1 taken.");

  const emailInput = page.locator('input[type="email"], input[name*="email" i], #question_email').first();
  if (await emailInput.isVisible({ timeout: 3000 })) {
    const firstName = page.locator('input[name*="first" i], #question_first_name').first();
    if (await firstName.isVisible()) await firstName.fill('JARVIS');
    
    const lastName = page.locator('input[name*="last" i], #question_last_name').first();
    if (await lastName.isVisible()) await lastName.fill('B');
    
    await emailInput.fill('dhruvbijapur@gmail.com');
    
    try {
      const phoneInput = page.locator('input[type="tel"], input[name*="phone" i], input[name*="mobile" i], input[id*="phone" i]').first();
      if (await phoneInput.isVisible({ timeout: 1000 })) {
        await phoneInput.fill('9606571200');
      }
    } catch {}

    await page.screenshot({ path: 'zoom_webinar_reg_filled.png' });
    console.log("Screenshot 2 (filled) taken.");

    const registerBtn = page.locator('button:has-text("Register"), button:has-text("Join")').first();
    await registerBtn.click();
    
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'zoom_webinar_reg_after_submit.png' });
    console.log("Screenshot 3 (after submit) taken.");
  } else {
    console.log("No email input found.");
  }

  await browser.close();
})();
