const { chromium } = require('playwright');
const fs = require('fs');

async function testCaptionEngine() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Create a mock Zoom meeting page
  const html = `
    <html>
      <head>
        <style>
          body { margin: 0; padding: 0; font-family: Arial; }
          .video { width: 100vw; height: 100vh; background: black; color: white; position: relative; }
          .captions { position: absolute; bottom: 10%; width: 100%; text-align: center; }
          .caption-text { background: rgba(0,0,0,0.8); padding: 10px; display: inline-block; font-size: 24px; }
        </style>
      </head>
      <body>
        <div class="video">
          <div class="captions" id="caps"></div>
        </div>
      </body>
    </html>
  `;
  
  await page.setContent(html);

  let captionsLog = [];
  let previousSnapshot = '';
  let captionSeenSet = new Set();
  
  console.log("Starting engine loop mock...");

  // Mocking the engine loop
  for (let i = 0; i < 5; i++) {
    // Add some captions to the page
    await page.evaluate((step) => {
      const caps = document.getElementById('caps');
      if (step === 0) {
        caps.innerHTML = '<span class="caption-text">Speaker 1: Hello</span>';
      } else if (step === 1) {
        caps.innerHTML = '<span class="caption-text">Speaker 1: Hello everyone</span>';
      } else if (step === 2) {
        caps.innerHTML = '<span class="caption-text">Speaker 1: Hello everyone this is</span>';
      } else if (step === 3) {
        caps.innerHTML = '<span class="caption-text">Speaker 1: Hello everyone this is</span><br><span class="caption-text">Speaker 2: Hi!</span>';
      } else if (step === 4) {
        caps.innerHTML = '<span class="caption-text">Speaker 2: Hi! How are you?</span>';
      }
    }, i);

    console.log(`\n--- Step ${i} ---`);

    const rawTexts = await page.evaluate(() => {
      const vh = window.innerHeight;
      const threshold = vh * 0.55;
      const vw = window.innerWidth;
      const texts = [];

      document.querySelectorAll('span, p, div').forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

        const rect = el.getBoundingClientRect();
        if (rect.top < threshold) return;
        if (rect.width < 10 || rect.height < 10) return;

        let text = '';
        if (el.children.length === 0) {
          text = (el.textContent || '').trim();
        } else {
          el.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
              text += node.textContent || '';
            }
          });
          text = text.trim();
        }

        if (!text || text.length <= 2) return;
        texts.push(text);
      });
      return texts;
    });

    const snapshot = rawTexts.join(' | ');

    if (snapshot && snapshot !== previousSnapshot) {
      for (const text of rawTexts) {
        const normalized = text.replace(/\\s+/g, ' ').trim();
        if (normalized.length <= 2) continue;

        let dominated = false;
        for (const seen of captionSeenSet) {
          if (seen === normalized || seen.includes(normalized)) {
            dominated = true;
            break;
          }
        }
        if (dominated) continue;

        const toRemove = [];
        for (const seen of captionSeenSet) {
          if (normalized.includes(seen)) {
            toRemove.push(seen);
          }
        }
        toRemove.forEach(s => captionSeenSet.delete(s));

        captionSeenSet.add(normalized);

        let speaker = 'Speaker';
        let captionText = normalized;
        const colonIdx = normalized.indexOf(':');
        if (colonIdx > 0 && colonIdx < 30) {
          const possibleName = normalized.substring(0, colonIdx).trim();
          if (possibleName.length > 1) {
            speaker = possibleName;
            captionText = normalized.substring(colonIdx + 1).trim();
          }
        }

        captionsLog.push({ speaker, text: captionText });
        console.log(`LOGGED: [${speaker}]: ${captionText}`);
      }
      previousSnapshot = snapshot;
    }
  }

  console.log("\nFinal Caption Log:");
  console.log(captionsLog);
  await browser.close();
}

testCaptionEngine().catch(console.error);
