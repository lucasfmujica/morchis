const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../../..');
const STATE = path.join(REPO, '.auth', 'storageState.json');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ROUTE = process.argv[2] || '/cuentas';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  console.log('URL:', page.url());
  // Print a compact outline of clickable elements with text
  const outline = await page.evaluate(() => {
    const out = [];
    const els = document.querySelectorAll('button, [onclick], a, [class*="cursor"]');
    els.forEach((el, i) => {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      out.push(`${i} <${el.tagName.toLowerCase()}> "${t}"`);
    });
    return out;
  });
  console.log(outline.join('\n'));
  await browser.close();
})();
