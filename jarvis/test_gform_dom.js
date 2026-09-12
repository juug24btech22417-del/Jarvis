const { chromium } = require('playwright');

async function testGoogleFormSearch() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Searching for a public Google Form...');
  await page.goto('https://duckduckgo.com/?q=site:docs.google.com/forms/d/e/+contact+information', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const links = await page.$$eval('a', as => as.map(a => a.href).filter(h => h.includes('docs.google.com/forms/d/e/')));
  console.log('Discovered Google Form links:', links.slice(0, 3));

  if (links.length > 0) {
    const targetForm = links[0];
    console.log('Testing navigation to:', targetForm);
    await page.goto(targetForm, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // Inspect inputs on Google Forms
    const inputInfo = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea'));
      return els.map(el => {
        // Find question container
        const item = el.closest('[role="listitem"]') || el.closest('.Qr7Oae');
        const heading = item ? item.querySelector('[role="heading"], .M7eMe, .F9NWFb')?.textContent : '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const ariaLabelledBy = el.getAttribute('aria-labelledby') || '';
        let labelledByText = '';
        if (ariaLabelledBy) {
          labelledByText = ariaLabelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
        }
        return {
          tag: el.tagName,
          type: el.type,
          ariaLabel,
          ariaLabelledBy,
          labelledByText,
          heading,
          classes: el.className
        };
      });
    });

    console.log('Google Form Inputs Found (' + inputInfo.length + '):', JSON.stringify(inputInfo, null, 2));
  }

  await browser.close();
}

testGoogleFormSearch().catch(console.error);
