const path = require('path');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../../..');
const STATE = path.join(REPO, '.auth', 'storageState.json');
const BASE = process.env.BASE_URL || 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();

  let lastSplitId = null;
  page.on('request', (r) => {
    const u = r.url();
    const m = u.match(/transactions\?select=usd_rate_snapshot,splits[^&]*&id=eq\.([^&]+)/);
    if (m) lastSplitId = decodeURIComponent(m[1]);
  });

  await page.goto(`${BASE}/cuentas`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Account card divs: those containing "saldo" or "gastado".
  const accountNames = await page.evaluate(() => {
    const names = [];
    document.querySelectorAll('div').forEach((d) => {
      const t = (d.textContent || '');
      if ((/saldo actual|gastado/.test(t)) && d.querySelector('span,p')) {
        // grab the account name (first strong-ish text)
      }
    });
    return names;
  });

  // Simpler: iterate the known account label list via the card locator.
  const cards = page.locator('div').filter({ hasText: /saldo actual|gastado/ });
  // Build a stable list of account display names by reading the page once.
  const labels = await page.evaluate(() => {
    const res = [];
    document.querySelectorAll('div').forEach((d) => {
      const t = (d.textContent || '').replace(/\s+/g, ' ').trim();
      const m = t.match(/^[🏦💳💵]\s*([^·]+?)(Caja|Cuenta|Efectivo|Tarjeta)/);
      if (m && t.length < 120 && (/saldo actual|gastado/.test(t))) res.push(m[1].trim());
    });
    return [...new Set(res)];
  });
  console.log('accounts:', labels.join(' | '));

  for (const name of labels) {
    const card = page.locator('div').filter({ hasText: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).filter({ hasText: /saldo actual|gastado/ }).first();
    await card.click().catch(() => {});
    await page.waitForTimeout(900);
    const rows = page.locator('.fixed.inset-0 button');
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      lastSplitId = '(no split-load fired)';
      const label = (await rows.nth(i).textContent() || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      await rows.nth(i).click().catch(() => {});
      await page.waitForTimeout(900);
      const flag = lastSplitId === undefined || String(lastSplitId).includes('undefined') ? '  <<< UNDEFINED ID' : '';
      console.log(`[${name}] row${i} "${label}" -> splitLoadId=${lastSplitId}${flag}`);
      // close edit sheet (Escape) and reopen drilldown
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
      // reopen the account drilldown for the next row
      if (i < n - 1) {
        await page.locator('div').filter({ hasText: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).filter({ hasText: /saldo actual|gastado/ }).first().click().catch(() => {});
        await page.waitForTimeout(900);
      }
    }
    // ensure drilldown closed
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
  }
  await browser.close();
})();
