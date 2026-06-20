const path = require('path');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../../..');
const STATE = path.join(REPO, '.auth', 'storageState.json');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const RANGE = process.argv[2]; // e.g. 'Histórico'

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();

  let lastSplitId = null;
  page.on('request', (r) => {
    const m = r.url().match(/transactions\?select=usd_rate_snapshot,splits[^&]*&id=eq\.([^&]+)/);
    if (m) lastSplitId = decodeURIComponent(m[1]);
  });

  await page.goto(`${BASE}/movimientos`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  if (RANGE) { await page.getByRole('button', { name: RANGE }).first().click().catch(()=>{}); await page.waitForTimeout(1500); }

  // Movement buttons: those whose text contains a currency amount and a date-ish.
  const isMovement = (t) => /US\$|\-\$|\+\$|\$\s?\d/.test(t) && !/Filtros|Seleccionar|Comparar|Exportar|Semana|Histórico|presupuesto|Conciliar/.test(t);
  const labels = await page.locator('button').evaluateAll((bs, _) => bs.map((b) => (b.textContent||'').replace(/\s+/g,' ').trim()), null);
  const movIdx = labels.map((t, i) => [i, t]).filter(([, t]) => /US\$|\-\$|\+\$/.test(t) && !/Filtros|Seleccionar|Comparar|Exportar/.test(t));
  console.log(`movement buttons: ${movIdx.length}`);

  for (const [i, label] of movIdx) {
    lastSplitId = '(none)';
    const btn = page.locator('button').nth(i);
    await btn.click().catch(() => {});
    await page.waitForTimeout(800);
    const bad = String(lastSplitId).includes('undefined');
    console.log(`#${i} "${label.slice(0,40)}" -> ${lastSplitId}${bad ? '   <<<<< UNDEFINED' : ''}`);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
    // close any leftover overlay by clicking top-left
    await page.mouse.click(5, 5).catch(() => {});
    await page.waitForTimeout(200);
  }
  await browser.close();
})();
