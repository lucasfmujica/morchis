const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../../..');
const STATE = path.join(REPO, '.auth', 'storageState.json');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = '/tmp/morchis-e2e';
const PICK = process.argv[2] || 'Timba';
const DO_SAVE = process.argv[3] === 'save';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();

  const txReqs = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/rest/v1/transactions') || u.includes('/rest/v1/splits')) {
      txReqs.push(`${r.method()} ${decodeURIComponent(u).replace(/^https:\/\/[^/]+/, '')}`);
    }
  });
  page.on('response', (r) => {
    const u = r.url();
    if ((u.includes('/rest/v1/transactions') || u.includes('/rest/v1/splits')) && r.status() >= 400)
      txReqs.push(`  !! HTTP ${r.status()}`);
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

  await page.goto(`${BASE}/movimientos`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Open the movement whose label contains PICK.
  const mov = page.getByRole('button', { name: new RegExp(PICK) }).first();
  await mov.click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, 'mov-edit.png'), fullPage: true });

  // Tap a category chip to (re)assign a category, then Guardar.
  // Category chips show emoji+name; pick one that's clearly a category.
  if (DO_SAVE) {
    const chip = page.getByRole('button', { name: /Salidas y ocio|Comer afuera|Super/ }).first();
    await chip.click().catch(() => {});
    await page.waitForTimeout(400);
    const guardar = page.getByRole('button', { name: /^Guardar/i }).first();
    await guardar.click().catch((e) => console.log('guardar click fail', e.message));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, 'mov-aftersave.png'), fullPage: true });
  }

  console.log('=== tx/splits requests ===');
  console.log(txReqs.join('\n') || '(none)');
  console.log('\n=== errors ===');
  console.log(errors.join('\n') || '(none)');
  await browser.close();
})();
