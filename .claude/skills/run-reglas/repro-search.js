const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../../..');
const STATE = path.join(REPO, '.auth', 'storageState.json');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = '/tmp/morchis-e2e';
const TERM = process.argv[2] || 'Colectivo vuelta';
const DO_SAVE = process.argv[3] === 'save';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  const txReqs = [];
  page.on('request', (r) => { const u = r.url(); if (u.includes('/rest/v1/transactions') || u.includes('/rest/v1/splits')) txReqs.push(`${r.method()} ${decodeURIComponent(u).replace(/^https:\/\/[^/]+/, '')}`); });
  page.on('response', (r) => { const u = r.url(); if ((u.includes('/rest/v1/transactions')||u.includes('/rest/v1/splits')) && r.status()>=400) txReqs.push(`  !! HTTP ${r.status()} ${decodeURIComponent(u).replace(/^https:\/\/[^/]+/, '')}`); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

  await page.goto(`${BASE}/movimientos`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Type into the search box.
  const search = page.getByPlaceholder(/Buscar/i).first();
  if (await search.count()) { await search.fill(TERM); await page.waitForTimeout(1500); }
  else {
    // open filters maybe; fallback: click Histórico then scroll
    await page.getByRole('button', { name: /Histórico/ }).first().click().catch(()=>{});
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: path.join(OUT, 'search-list.png'), fullPage: true });

  const mov = page.getByRole('button', { name: new RegExp(TERM.split(' ')[0]) }).first();
  console.log('movement found:', await mov.count());
  await mov.click().catch((e) => console.log('click fail', e.message));
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, 'search-edit.png'), fullPage: true });

  if (DO_SAVE) {
    const chip = page.getByRole('button', { name: /Transporte/ }).first();
    await chip.click().catch(() => {});
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /^Guardar/i }).first().click().catch((e)=>console.log('guardar fail',e.message));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, 'search-aftersave.png'), fullPage: true });
  }

  console.log('=== tx reqs ===\n' + (txReqs.join('\n') || '(none)'));
  console.log('=== errors ===\n' + (errors.join('\n') || '(none)'));
  await browser.close();
})();
