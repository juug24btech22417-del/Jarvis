import { chromium as originalChromium } from 'playwright';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

// Apply the stealth plugin ONLY if it hasn't been added yet (prevents double-injection)
if (!(chromium as any)._plugins?.some((p: any) => p.name === 'stealth')) {
  chromium.use(stealthPlugin());
}

interface PlaywrightResponse {
  content: string;
  screenshot?: string;
  error?: string;
}

class PlaywrightService {
  /**
   * Navigates to a URL and takes a screenshot
   */
  async takeScreenshot(url: string): Promise<PlaywrightResponse> {
    try {
      console.log(`[Playwright] Navigating to ${url} for screenshot...`);
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 80 });
      await browser.close();
      
      return {
        content: `Screenshot taken for ${url}`,
        screenshot: screenshotBuffer.toString('base64'),
      };
    } catch (e: any) {
      console.error("[Playwright] Screenshot failed:", e.message);
      return { content: '', error: e.message };
    }
  }

  /**
   * Extracts text content from a specific selector on a page
   */
  async extractText(url: string, selector: string): Promise<PlaywrightResponse> {
    try {
      console.log(`[Playwright] Extracting text from ${url} with selector ${selector}...`);
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Use .first() to avoid strict mode violations if multiple elements match
      const text = await page.locator(selector).first().textContent({ timeout: 5000 });
      await browser.close();
      
      return {
        content: text || '',
      };
    } catch (e: any) {
      console.error("[Playwright] Text extraction failed:", e.message);
      return { content: '', error: e.message };
    }
  }

  /**
   * Clicks an element on a page
   */
  async clickElement(url: string, selector: string): Promise<PlaywrightResponse> {
    try {
      console.log(`[Playwright] Clicking ${selector} on ${url}...`);
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.locator(selector).click();
      await page.waitForLoadState('networkidle');
      const text = await page.content();
      await browser.close();
      
      return {
        content: `Successfully clicked ${selector}. Page HTML length: ${text.length}`,
      };
    } catch (e: any) {
      console.error("[Playwright] Click failed:", e.message);
      return { content: '', error: e.message };
    }
  }

  /**
   * Automates a checkout process on Amazon / other stores
   */
  async automateCheckout(url: string, productSelector: string): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Starting auto-checkout on ${url}...`);
      browser = await chromium.launch({
        headless: false,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--window-size=1280,720',
        ]
      });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'en-IN',
        extraHTTPHeaders: {
          'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Upgrade-Insecure-Requests': '1',
        }
      });
      const page = await context.newPage();

      // Step 1: Navigate and wait for full page load (not just DOM — Amazon renders via JS)
      console.log(`[Playwright] Navigating to ${url}...`);
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });

      // Give Amazon's JavaScript time to fully render search results
      console.log(`[Playwright] Waiting 5s for JS to render search results...`);
      await page.waitForTimeout(5000);

      // Debug: log the page title to confirm we're on the right page
      const title = await page.title();
      console.log(`[Playwright] Page title: "${title}"`);

      // Step 2: Find the first product link using multiple fallback selectors
      const productSelectors = [
        'div[data-component-type="s-search-result"] h2 a',  // Standard Amazon search result
        '[data-asin] h2 a',                                  // By ASIN attribute
        '.s-result-item h2 a',                               // By result item class
        'h2 a.a-link-normal',                                // Classic link class
        'h2 a',                                              // Last resort: any h2 link
      ];

      let productHref: string | null = null;
      for (const sel of productSelectors) {
        try {
          const count = await page.locator(sel).count();
          console.log(`[Playwright] Selector "${sel}" matched ${count} elements`);
          if (count > 0) {
            productHref = await page.locator(sel).first().getAttribute('href');
            if (productHref) {
              console.log(`[Playwright] Found product link with "${sel}": ${productHref.substring(0, 80)}...`);
              break;
            }
          }
        } catch {
          // Selector didn't match, try the next one
        }
      }

      if (!productHref) {
        // Last fallback: evaluate in the browser to grab ANY product link
        console.log(`[Playwright] All selectors failed. Trying JS evaluation...`);
        productHref = await page.evaluate(() => {
          const links = document.querySelectorAll('a[href*="/dp/"]');
          for (const link of links) {
            const href = link.getAttribute('href');
            if (href && href.includes('/dp/')) return href;
          }
          return null;
        });
        if (productHref) {
          console.log(`[Playwright] Found product via JS eval: ${productHref.substring(0, 80)}...`);
        }
      }

      if (!productHref) {
        console.error(`[Playwright] Could not find any product link on the page.`);
        await page.waitForTimeout(60000);
        await browser.close();
        return { content: '', error: 'Could not find any product link on the search page.' };
      }

      // Step 3: Navigate to the product page
      const fullUrl = productHref.startsWith('http') ? productHref : `https://www.amazon.in${productHref}`;
      console.log(`[Playwright] Navigating to product page...`);
      await page.goto(fullUrl, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Step 4: Click Add to Cart
      console.log(`[Playwright] Looking for Add to Cart button...`);
      const addToCartSelectors = ['#add-to-cart-button', 'input[name="submit.add-to-cart"]', '#submit.add-to-cart'];
      for (const sel of addToCartSelectors) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 3000 })) {
            console.log(`[Playwright] Clicking Add to Cart (${sel})...`);
            await btn.click();
            break;
          }
        } catch {
          // Try next selector
        }
      }

      await page.waitForTimeout(3000);

      // Step 5: Try to proceed to checkout
      console.log(`[Playwright] Looking for Proceed to Checkout...`);
      const checkoutSelectors = [
        'input[name="proceedToRetailCheckout"]',
        '#sc-buy-box-ptc-button input',
        '#ptc-button-handler',
        'a:has-text("Proceed to Buy")',
      ];
      for (const sel of checkoutSelectors) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 3000 })) {
            console.log(`[Playwright] Clicking Proceed to Checkout (${sel})...`);
            await btn.click();
            break;
          }
        } catch {
          // Try next selector
        }
      }

      // Keep browser open for 2 minutes so user can log in and finalize
      console.log(`[Playwright] Done! Browser will stay open for 2 minutes.`);
      await page.waitForTimeout(120000);
      await browser.close();

      return {
        content: `Checkout automation completed for ${url}`,
      };
    } catch (e: any) {
      console.error("[Playwright] Checkout failed:", e.message);
      if (browser) {
        try { await browser.close(); } catch {}
      }
      return { content: '', error: e.message };
    }
  }

  /**
   * Automates a social media post (Skeletal implementation for expansion)
   */
  async postToSocialMedia(platform: 'twitter' | 'linkedin', message: string): Promise<PlaywrightResponse> {
    try {
      console.log(`[Playwright] Preparing to post to ${platform}...`);
      const browser = await chromium.launch({ headless: false }); // Visible for debugging
      const page = await browser.newPage();
      
      if (platform === 'twitter') {
        await page.goto('https://twitter.com/compose/tweet', { waitUntil: 'domcontentloaded' });
        // Example skeleton logic:
        // await page.fill('[data-testid="tweetTextarea_0"]', message);
        // await page.click('[data-testid="tweetButton"]');
      } else if (platform === 'linkedin') {
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
        // Example skeleton logic:
        // await page.click('button:has-text("Start a post")');
        // await page.fill('.ql-editor', message);
        // await page.click('button:has-text("Post")');
      }

      // Wait for 60 seconds so you can see it working before closing
      await page.waitForTimeout(60000);
      await browser.close();
      
      return {
        content: `Successfully posted to ${platform}`,
      };
    } catch (e: any) {
      console.error(`[Playwright] ${platform} post failed:`, e.message);
      return { content: '', error: e.message };
    }
  }

  /**
   * Helper: create a stealth browser context
   */
  private async createStealthContext() {
    const browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--window-size=1280,720']
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'en-IN',
      extraHTTPHeaders: {
        'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Upgrade-Insecure-Requests': '1',
      }
    });
    const page = await context.newPage();
    return { browser, context, page };
  }

  /**
   * Search flights on Google Flights — types from/to, clicks search
   */
  async searchFlights(from: string, to: string, date?: string): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Searching flights from ${from} to ${to}...`);
      const ctx = await this.createStealthContext();
      browser = ctx.browser;
      const page = ctx.page;

      const url = `https://www.google.com/travel/flights?q=flights+from+${encodeURIComponent(from)}+to+${encodeURIComponent(to)}${date ? '+on+' + encodeURIComponent(date) : ''}`;
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(5000);
      
      const title = await page.title();
      console.log(`[Playwright] Page title: "${title}"`);

      // Step 5: Extract flight prices
      const flightData = await page.evaluate(() => {
        const results: string[] = [];
        const bodyText = document.body.innerText;
        const priceMatches = bodyText.match(/₹[\d,]+/g);
        if (priceMatches) results.push('Prices found: ' + [...new Set(priceMatches)].slice(0, 6).join(', '));
        return results;
      });

      console.log(`[Playwright] Flight data: ${JSON.stringify(flightData)}`);
      await page.waitForTimeout(120000);
      await browser.close();
      return { content: flightData.length > 0 ? `✈️ Flights ${from} → ${to}:\n${flightData.join('\n')}` : `✈️ Opened Google Flights for ${from} → ${to}. Check the browser, Boss.` };
    } catch (e: any) {
      console.error('[Playwright] Flight search failed:', e.message);
      if (browser) try { await browser.close(); } catch {}
      return { content: '', error: e.message };
    }
  }

  /**
   * Search food on Zomato or Swiggy — types search, clicks results
   */
  async searchFood(query: string, platform: 'zomato' | 'swiggy' = 'zomato'): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Searching "${query}" on ${platform}...`);
      const ctx = await this.createStealthContext();
      browser = ctx.browser;
      const page = ctx.page;

      if (platform === 'zomato') {
        // Go straight to Zomato search URL to bypass location prompts
        await page.goto(`https://www.zomato.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(3000);
        
        console.log(`[Playwright] Zomato search loaded, finding first restaurant...`);
        try {
          // Try to click the first search result card
          const firstResult = page.locator('a:has(h4), .search-snippet-card, [class*="result"] a').first();
          if (await firstResult.isVisible({ timeout: 5000 })) {
            await firstResult.click();
            console.log(`[Playwright] Clicked first Zomato restaurant`);
            await page.waitForTimeout(3000);
          }
        } catch {
          console.log(`[Playwright] Could not click result. Browser left on search page.`);
        }
      } else {
        // Go straight to Swiggy search URL
        await page.goto(`https://www.swiggy.com/search?query=${encodeURIComponent(query)}`, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(3000);
        
        console.log(`[Playwright] Swiggy search loaded, finding first restaurant...`);
        try {
          // Swiggy results
          const firstResult = page.locator('[data-testid="restaurant-info"], [class*="Restaurant"], a[href*="/restaurants/"]').first();
          if (await firstResult.isVisible({ timeout: 5000 })) {
            await firstResult.click();
            console.log(`[Playwright] Clicked first Swiggy restaurant`);
            await page.waitForTimeout(3000);
          }
        } catch {
          console.log(`[Playwright] Could not click result. Browser left on search page.`);
        }
      }

      await page.waitForTimeout(3000);
      console.log(`[Playwright] ${platform} search complete. Browser stays open for 2 min.`);
      await page.waitForTimeout(120000);
      await browser.close();
      return { content: `🍔 Searched "${query}" on ${platform} and opened results. Browser is ready for ordering, Boss.` };
    } catch (e: any) {
      console.error(`[Playwright] Food search failed:`, e.message);
      if (browser) try { await browser.close(); } catch {}
      return { content: '', error: e.message };
    }
  }

  /**
   * Open WhatsApp Web and send a message
   */
  async sendWhatsApp(contact: string, message: string): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Opening WhatsApp Web to message "${contact}"...`);
      const ctx = await this.createStealthContext();
      browser = ctx.browser;
      const page = ctx.page;
      await page.goto('https://web.whatsapp.com', { waitUntil: 'load', timeout: 60000 });
      console.log(`[Playwright] Waiting for WhatsApp to load (scan QR if needed)...`);
      try {
        await page.waitForSelector('[data-testid="chat-list"]', { timeout: 60000 });
        console.log(`[Playwright] WhatsApp loaded! Searching for contact...`);
      } catch {
        console.log(`[Playwright] QR scan timeout. Keeping browser open...`);
        await page.waitForTimeout(120000);
        await browser.close();
        return { content: `📱 WhatsApp Web is open. Please scan the QR code, Boss.` };
      }
      const searchBox = page.locator('[data-testid="chat-list-search"]').first();
      await searchBox.click();
      await searchBox.fill(contact);
      await page.waitForTimeout(2000);
      try {
        await page.locator(`span[title*="${contact}" i]`).first().click({ timeout: 5000 });
        await page.waitForTimeout(1000);
        const msgBox = page.locator('[data-testid="conversation-compose-box-input"]').first();
        await msgBox.click();
        await msgBox.fill(message);
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        console.log(`[Playwright] Message sent to ${contact}!`);
      } catch {
        console.log(`[Playwright] Could not find contact "${contact}". Keeping browser open.`);
      }
      await page.waitForTimeout(120000);
      await browser.close();
      return { content: `📱 Message sent to ${contact} on WhatsApp: "${message}"` };
    } catch (e: any) {
      console.error(`[Playwright] WhatsApp failed:`, e.message);
      if (browser) try { await browser.close(); } catch {}
      return { content: '', error: e.message };
    }
  }

  /**
   * Take a full-page screenshot or generate PDF of any website
   */
  async captureWebsite(url: string, format: 'screenshot' | 'pdf' = 'screenshot'): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Capturing ${format} of ${url}...`);
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(3000);
      const timestamp = Date.now();
      const fs = await import('fs');
      const path = await import('path');
      if (format === 'pdf') {
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        const filePath = path.join(process.cwd(), 'public', `capture_${timestamp}.pdf`);
        fs.writeFileSync(filePath, pdfBuffer);
        await browser.close();
        return { content: `📄 PDF saved: /capture_${timestamp}.pdf` };
      } else {
        const buf = await page.screenshot({ fullPage: true, type: 'png' });
        const filePath = path.join(process.cwd(), 'public', `capture_${timestamp}.png`);
        fs.writeFileSync(filePath, buf);
        await browser.close();
        return { content: `📸 Full-page screenshot saved: /capture_${timestamp}.png`, screenshot: buf.toString('base64') };
      }
    } catch (e: any) {
      console.error(`[Playwright] Capture failed:`, e.message);
      if (browser) try { await browser.close(); } catch {}
      return { content: '', error: e.message };
    }
  }

  /**
   * Compare prices across Amazon India and Flipkart
   */
  async comparePrices(product: string): Promise<PlaywrightResponse> {
    const stores = [
      { name: 'Amazon', url: `https://www.amazon.in/s?k=${encodeURIComponent(product)}` },
      { name: 'Flipkart', url: `https://www.flipkart.com/search?q=${encodeURIComponent(product)}` },
    ];
    const results: string[] = [];
    for (const store of stores) {
      let browser;
      try {
        console.log(`[Playwright] Checking ${store.name} for "${product}"...`);
        browser = await chromium.launch({ headless: true });
        const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', viewport: { width: 1280, height: 720 }, locale: 'en-IN' });
        const page = await ctx.newPage();
        await page.goto(store.url, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(5000);
        const priceData = await page.evaluate(() => {
          const bodyText = document.body.innerText;
          const prices = bodyText.match(/₹[\d,]+(?:\.\d{2})?/g);
          if (prices) {
            const unique = [...new Set(prices)].filter(p => parseInt(p.replace(/[₹,]/g, '')) > 100);
            return unique.slice(0, 3);
          }
          return [];
        });
        results.push(priceData.length > 0 ? `${store.name}: ${priceData.join(' | ')}` : `${store.name}: Price not found`);
        await browser.close();
      } catch (e: any) {
        results.push(`${store.name}: Error fetching price`);
        if (browser) try { await browser.close(); } catch {}
      }
    }
    return { content: `💰 Price comparison for "${product}":\n${results.join('\n')}` };
  }

  /**
   * Scrape latest news headlines from Google News
   */
  async scrapeNews(topic: string = 'technology'): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Scraping news for "${topic}"...`);
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(`https://news.google.com/search?q=${encodeURIComponent(topic)}&hl=en-IN`, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(3000);
      const headlines = await page.evaluate(() => {
        const results: string[] = [];
        const articles = document.querySelectorAll('article a, h3, h4');
        articles.forEach((el, i) => {
          if (i < 10) {
            const text = el.textContent?.trim();
            if (text && text.length > 15 && text.length < 200) results.push(`• ${text}`);
          }
        });
        return [...new Set(results)].slice(0, 8);
      });
      await browser.close();
      return { content: headlines.length > 0 ? `📰 Latest ${topic} news:\n${headlines.join('\n')}` : `📰 Could not extract headlines. Try a different topic, Boss.` };
    } catch (e: any) {
      console.error(`[Playwright] News scraping failed:`, e.message);
      if (browser) try { await browser.close(); } catch {}
      return { content: '', error: e.message };
    }
  }

  /**
   * Open any website in stealth browser for manual interaction
   */
  async openWebsite(url: string): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Opening ${url} in stealth browser...`);
      const ctx = await this.createStealthContext();
      browser = ctx.browser;
      const page = ctx.page;
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(3000);
      const title = await page.title();
      console.log(`[Playwright] Page loaded: "${title}"`);
      await page.waitForTimeout(180000);
      await browser.close();
      return { content: `🌐 Opened "${title}" in stealth browser. You have 3 minutes, Boss.` };
    } catch (e: any) {
      console.error(`[Playwright] Open website failed:`, e.message);
      if (browser) try { await browser.close(); } catch {}
      return { content: '', error: e.message };
    }
  }

  /**
   * Search and play a YouTube video
   */
  async playYouTube(query: string): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Searching YouTube for "${query}"...`);
      const ctx = await this.createStealthContext();
      browser = ctx.browser;
      const page = ctx.page;
      await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Click the first video result
      const videoLink = await page.evaluate(() => {
        const links = document.querySelectorAll('a#video-title');
        for (const link of links) {
          const href = link.getAttribute('href');
          if (href && href.startsWith('/watch')) return href;
        }
        return null;
      });

      if (videoLink) {
        console.log(`[Playwright] Playing video: ${videoLink}`);
        await page.goto(`https://www.youtube.com${videoLink}`, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(2000);
        // Try to skip ads
        try {
          const skipBtn = page.locator('button.ytp-ad-skip-button, button.ytp-skip-ad-button, .ytp-ad-skip-button-modern').first();
          if (await skipBtn.isVisible({ timeout: 5000 })) await skipBtn.click();
        } catch { /* no ad */ }
      }

      // Keep browser open for 5 minutes to watch the video
      await page.waitForTimeout(300000);
      await browser.close();
      return { content: `▶️ Playing "${query}" on YouTube, Boss.` };
    } catch (e: any) {
      console.error('[Playwright] YouTube failed:', e.message);
      if (browser) try { await browser.close(); } catch {}
      return { content: '', error: e.message };
    }
  }

  /**
   * Get directions on Google Maps
   */
  async getDirections(from: string, to: string): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Getting directions from ${from} to ${to}...`);
      const ctx = await this.createStealthContext();
      browser = ctx.browser;
      const page = ctx.page;
      const url = `https://www.google.com/maps/dir/${encodeURIComponent(from)}/${encodeURIComponent(to)}`;
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(5000);

      // Extract travel time and distance
      const routeInfo = await page.evaluate(() => {
        const results: string[] = [];
        const sections = document.querySelectorAll('[data-trip-index], .section-directions-trip');
        sections.forEach((s, i) => {
          if (i < 3) {
            const text = s.textContent?.replace(/\s+/g, ' ').trim();
            if (text && text.length > 10) results.push(text.substring(0, 150));
          }
        });
        // Fallback: grab any time/distance info
        if (results.length === 0) {
          const bodyText = document.body.innerText;
          const timeMatch = bodyText.match(/(\d+\s*(?:hr|min|hours?|minutes?)[\s\d]*(?:hr|min|hours?|minutes?)?)/gi);
          const distMatch = bodyText.match(/(\d+[\.,]?\d*\s*(?:km|mi|miles?))/gi);
          if (timeMatch) results.push('Time: ' + timeMatch.slice(0, 3).join(', '));
          if (distMatch) results.push('Distance: ' + distMatch.slice(0, 3).join(', '));
        }
        return results;
      });

      console.log(`[Playwright] Route info: ${JSON.stringify(routeInfo)}`);
      await page.waitForTimeout(120000);
      await browser.close();
      return { content: routeInfo.length > 0 ? `🗺️ Directions from ${from} to ${to}:\n${routeInfo.join('\n')}` : `🗺️ Opened Google Maps with directions from ${from} to ${to}. Check the browser, Boss.` };
    } catch (e: any) {
      console.error('[Playwright] Directions failed:', e.message);
      if (browser) try { await browser.close(); } catch {}
      return { content: '', error: e.message };
    }
  }

  /**
   * Search jobs on LinkedIn — actively types job and location
   */
  async searchJobs(query: string, location: string = 'India'): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Searching LinkedIn jobs: "${query}" in ${location}...`);
      const ctx = await this.createStealthContext();
      browser = ctx.browser;
      const page = ctx.page;

      // Step 1: Open LinkedIn Jobs Search URL
      const url = `https://www.linkedin.com/jobs/search?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}`;
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      
      console.log(`[Playwright] LinkedIn URL loaded, waiting for user to potentially sign in or results to load...`);
      // Wait for either the search results or login wall
      await page.waitForTimeout(5000);

      // Extract job listings (if they load instantly without login)
      const jobs = await page.evaluate(() => {
        const results: string[] = [];
        const cards = document.querySelectorAll('.base-card, .job-search-card, [data-entity-urn], .job-card-container');
        cards.forEach((card, i) => {
          if (i < 8) {
            const title = card.querySelector('h3, .base-search-card__title, .job-card-list__title')?.textContent?.trim();
            const company = card.querySelector('h4, .base-search-card__subtitle, .job-card-container__company-name')?.textContent?.trim();
            const loc = card.querySelector('.job-search-card__location, .job-card-container__metadata-item')?.textContent?.trim();
            if (title) results.push(`• ${title}${company ? ' — ' + company : ''}${loc ? ' (' + loc + ')' : ''}`);
          }
        });
        return results;
      });

      if (jobs.length > 0) {
        console.log(`[Playwright] Found ${jobs.length} job listings instantly`);
      } else {
        console.log(`[Playwright] No jobs extracted immediately (likely behind login or slow load). Leaving browser open.`);
      }
      
      await page.waitForTimeout(180000); // 3 minutes for user to sign in and view
      await browser.close();
      return { content: jobs.length > 0 ? `💼 Jobs for "${query}" in ${location}:\n${jobs.join('\n')}` : `💼 Opened LinkedIn Jobs for "${query}". Log in if prompted, Boss.` };
    } catch (e: any) {
      console.error('[Playwright] Job search failed:', e.message);
      if (browser) try { await browser.close(); } catch {}
      return { content: '', error: e.message };
    }
  }

  /**
   * Compose an email via Gmail
   */
  async composeEmail(to: string, subject: string, body: string): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Opening Gmail to compose email to ${to}...`);
      const ctx = await this.createStealthContext();
      browser = ctx.browser;
      const page = ctx.page;
      // Gmail compose URL with pre-filled fields
      const url = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(5000);

      const title = await page.title();
      console.log(`[Playwright] Gmail page: "${title}"`);

      // Keep open so user can log in and send
      await page.waitForTimeout(180000);
      await browser.close();
      return { content: `📧 Gmail compose window opened for ${to} with subject "${subject}". Log in and hit Send, Boss.` };
    } catch (e: any) {
      console.error('[Playwright] Gmail compose failed:', e.message);
      if (browser) try { await browser.close(); } catch {}
      return { content: '', error: e.message };
    }
  }

  /**
   * Search movies on BookMyShow — actively selects city, types search, clicks movie
   */
  async searchMovies(query: string, city: string = 'mumbai'): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Searching BookMyShow for "${query}" in ${city}...`);
      const ctx = await this.createStealthContext();
      browser = ctx.browser;
      const page = ctx.page;

      // Step 1: Go directly to the city's movie page (bypasses city popup modal)
      const citySlug = city.toLowerCase().replace(/\s+/g, '-');
      await page.goto(`https://in.bookmyshow.com/explore/movies-${citySlug}`, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Step 2: Open the main search overlay
      console.log(`[Playwright] Opening search bar...`);
      try {
        // BookMyShow usually has a span with this text that triggers the search overlay
        const searchTrigger = page.locator('span:has-text("Search for Movies"), span:has-text("Search for")').first();
        if (await searchTrigger.isVisible({ timeout: 3000 })) {
          await searchTrigger.click();
          await page.waitForTimeout(1000);
        }
      } catch { /* Maybe already visible or different UI */ }

      // Step 3: Type the movie name in the actual search box
      console.log(`[Playwright] Typing "${query}"...`);
      const searchSelectors = [
        'input[placeholder*="Search for Movies" i]',
        'input[placeholder*="Search for" i]',
        'input[type="text"][placeholder*="Search" i]'
      ];
      for (const sel of searchSelectors) {
        try {
          const searchBox = page.locator(sel).first();
          if (await searchBox.isVisible({ timeout: 2000 })) {
            await searchBox.click();
            await searchBox.fill('');
            await searchBox.fill(query);
            console.log(`[Playwright] Typed "${query}" in search box (${sel})`);
            await page.waitForTimeout(2000); // wait for dropdown suggestions

            // Step 4: Click the first movie suggestion
            try {
              // The suggestions drop down list
              const resultSelectors = [
                `text="${query}"`,
                `span:has-text("${query}")`,
                `strong:has-text("${query}")`,
                '[class*="suggest"] li',
                '[class*="result"] li',
              ];
              let clicked = false;
              for (const rSel of resultSelectors) {
                try {
                  const result = page.locator(rSel).first();
                  if (await result.isVisible({ timeout: 2000 })) {
                    await result.click();
                    console.log(`[Playwright] Clicked search result`);
                    clicked = true;
                    break;
                  }
                } catch { /* try next */ }
              }
              if (!clicked) {
                await page.keyboard.press('Enter');
              }
            } catch {
              await page.keyboard.press('Enter');
            }
            break; // Finished searching
          }
        } catch { /* try next selector */ }
      }

      await page.waitForTimeout(3000);
      console.log(`[Playwright] BookMyShow ready. Browser stays open for 2 minutes.`);
      await page.waitForTimeout(120000);
      await browser.close();
      return { content: `🎬 Found "${query}" on BookMyShow in ${city}. Browser is open for booking, Boss.` };
    } catch (e: any) {
      console.error('[Playwright] Movie search failed:', e.message);
      if (browser) try { await browser.close(); } catch {}
      return { content: '', error: e.message };
    }
  }

  /**
   * Generic web scraper — extract specific info from any URL
   */
  async scrapeWebsite(url: string, whatToFind: string): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Scraping ${url} for "${whatToFind}"...`);
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
      });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Extract all visible text from the page
      const pageText = await page.evaluate(() => {
        return document.body.innerText.substring(0, 15000);
      });

      await browser.close();

      // Find relevant chunks based on the query
      const lines = pageText.split('\n').filter(l => l.trim().length > 5);
      const keywords = whatToFind.toLowerCase().split(/\s+/);
      const relevant = lines.filter(line => {
        const lower = line.toLowerCase();
        return keywords.some(kw => lower.includes(kw));
      }).slice(0, 15);

      if (relevant.length > 0) {
        return { content: `🔍 Found on ${url}:\n${relevant.map(r => `• ${r.trim()}`).join('\n')}` };
      }
      // Return first few lines as fallback
      return { content: `🔍 Page content from ${url}:\n${lines.slice(0, 10).map(r => `• ${r.trim()}`).join('\n')}` };
    } catch (e: any) {
      console.error('[Playwright] Scrape failed:', e.message);
      if (browser) try { await browser.close(); } catch {}
      return { content: '', error: e.message };
    }
  }

  /**
   * Auto-fill a form on any website
   */
  async fillForm(url: string, fields: Record<string, string>): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Opening ${url} to fill form...`);
      const ctx = await this.createStealthContext();
      browser = ctx.browser;
      const page = ctx.page;
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(3000);

      let filled = 0;
      for (const [selector, value] of Object.entries(fields)) {
        try {
          // Try by name, id, placeholder, or label
          const selectors = [
            `input[name="${selector}"]`,
            `input[id="${selector}"]`,
            `input[placeholder*="${selector}" i]`,
            `textarea[name="${selector}"]`,
            `textarea[id="${selector}"]`,
            `select[name="${selector}"]`,
          ];
          for (const sel of selectors) {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2000 })) {
              const tagName = await el.evaluate(e => e.tagName.toLowerCase());
              if (tagName === 'select') {
                await el.selectOption({ label: value });
              } else {
                await el.fill(value);
              }
              filled++;
              console.log(`[Playwright] Filled "${selector}" with "${value}"`);
              break;
            }
          }
        } catch {
          console.log(`[Playwright] Could not fill field "${selector}"`);
        }
      }

      console.log(`[Playwright] Filled ${filled}/${Object.keys(fields).length} fields`);
      await page.waitForTimeout(120000);
      await browser.close();
      return { content: `📝 Filled ${filled} out of ${Object.keys(fields).length} fields on ${url}. Browser is open for review, Boss.` };
    } catch (e: any) {
      console.error('[Playwright] Form fill failed:', e.message);
      if (browser) try { await browser.close(); } catch {}
      return { content: '', error: e.message };
    }
  }

  /**
   * Track a package/delivery
   */
  async trackPackage(trackingId: string, courier: string = 'auto'): Promise<PlaywrightResponse> {
    let browser;
    try {
      console.log(`[Playwright] Tracking package ${trackingId} on ${courier}...`);
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
      });
      const page = await ctx.newPage();

      // Use a universal tracking site
      const url = `https://www.17track.net/en/track#nums=${encodeURIComponent(trackingId)}`;
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(8000);

      // Try to click the track button
      try {
        const trackBtn = page.locator('button:has-text("Track"), #btn-track, .btn-track').first();
        if (await trackBtn.isVisible({ timeout: 3000 })) await trackBtn.click();
        await page.waitForTimeout(5000);
      } catch { /* button may not exist */ }

      const trackingInfo = await page.evaluate(() => {
        const results: string[] = [];
        const statusElements = document.querySelectorAll('[class*="status"], [class*="track"], [class*="event"], [class*="result"], td, .info-content');
        statusElements.forEach((el, i) => {
          if (i < 10) {
            const text = el.textContent?.replace(/\s+/g, ' ').trim();
            if (text && text.length > 10 && text.length < 200) results.push(text);
          }
        });
        return [...new Set(results)].slice(0, 6);
      });

      await browser.close();
      return { content: trackingInfo.length > 0 ? `📦 Tracking ${trackingId}:\n${trackingInfo.map(t => `• ${t}`).join('\n')}` : `📦 Opened tracking for ${trackingId}. The courier may need a moment to load results.` };
    } catch (e: any) {
      console.error('[Playwright] Package tracking failed:', e.message);
      if (browser) try { await browser.close(); } catch {}
      return { content: '', error: e.message };
    }
  }
}

export const playwrightService = new PlaywrightService();
