const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../../..');
const STATE = path.join(REPO, '.auth', 'storageState.json');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = '/tmp/morchis-e2e';
const ACCOUNT = process.argv[2] || 'Mercado Pago';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();

  const txReqs = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/rest/v1/transactions') || u.includes('/rest/v1/splits')) txReqs.push(`${r.method()} ${decodeURIComponent(u).replace(BASE,'')}`);
  });
  page.on('response', async (r) => {
    const u = r.url();
    if ((u.includes('/rest/v1/transactions') || u.includes('/rest/v1/splits')) && r.status() >= 400) {
      txReqs.push(`  !! ${r.status()} ${decodeURIComponent(u).replace(/^https:\/\/[^/]+/,'')}`);
    }
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

  await page.goto(`${BASE}/cuentas`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Click the account card whose name matches ACCOUNT (the tappable div).
  const card = page.locator('div').filter({ hasText: new RegExp(ACCOUNT) }).filter({ hasText: /saldo|gastado/ }).first();
  await card.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'repro-1-drilldown.png'), fullPage: true });

  // Dump the movement rows inside the overlay sheet.
  const rows = page.locator('.fixed.inset-0 button');
  const n = await rows.count();
  console.log(`drilldown movement buttons: ${n}`);
  for (let i = 0; i < Math.min(n, 6); i++) {
    console.log(`  row ${i}: "${(await rows.nth(i).textContent() || '').trim().replace(/\s+/g,' ').slice(0,50)}"`);
  }
  if (n === 0) { console.log('NO movements; reqs:', txReqs.join('\n')); await browser.close(); return; }

  // Tap the first movement -> opens edit sheet.
  await rows.first().click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, 'repro-2-editsheet.png'), fullPage: true });

  // Find and tap "Guardar".
  const guardar = page.getByRole('button', { name: /Guardar/i }).first();
  const hasGuardar = await guardar.count();
  console.log('Guardar button present:', hasGuardar > 0);
  if (hasGuardar) {
    await guardar.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, 'repro-3-aftersave.png'), fullPage: true });
  }

  console.log('\n=== transactions/splits requests ===');
  console.log(txReqs.join('\n') || '(none)');
  console.log('\n=== console errors ===');
  console.log(errors.join('\n') || '(none)');
  await browser.close();
})();
