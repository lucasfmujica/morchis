const path = require('path');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../../..');
const STATE = path.join(REPO, '.auth', 'storageState.json');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const LIMIT = Number(process.argv[2] || 200);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();

  let lastSplitId = null;
  page.on('request', (r) => {
    const m = r.url().match(/transactions\?select=usd_rate_snapshot,splits[^&]*&id=eq\.([^&]+)/);
    if (m) lastSplitId = decodeURIComponent(m[1]);
  });
  page.on('console', (m) => { if (m.type() === 'error' && m.text().includes('DEBUG editTx missing id')) console.log('   >>> ' + m.text()); });

  await page.goto(`${BASE}/movimientos`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const idxs = await page.evaluate(() => {
    const res = [];
    document.querySelectorAll('button').forEach((b, i) => {
      const t = (b.textContent || '');
      if (/US\$|[-+]\$\s?\d/.test(t) && !/Filtros|Seleccionar|Comparar|Exportar|Conciliar/.test(t)) res.push(i);
    });
    return res;
  });
  console.log(`movement buttons: ${idxs.length}`);

  for (const i of idxs.slice(0, LIMIT)) {
    lastSplitId = '(none)';
    const btn = page.locator('button').nth(i);
    const label = ((await btn.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 42);
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ timeout: 4000 }).catch((e) => console.log(`  click fail #${i}: ${e.message.split('\n')[0]}`));
    await page.waitForTimeout(1200);
    const bad = String(lastSplitId).includes('undefined');
    console.log(`#${i} "${label}" -> ${lastSplitId}${bad ? '   <<<<< UNDEFINED' : ''}`);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(350);
  }
  await browser.close();
})();
