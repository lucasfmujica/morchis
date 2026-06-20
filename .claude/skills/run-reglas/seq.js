const path = require('path');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../../..');
const STATE = path.join(REPO, '.auth', 'storageState.json');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PICKS = ['Timba', 'Coto', 'Chicama', 'Verdulería', 'Santander', 'Devlane'];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  let lastSplitId = null;
  page.on('request', (r) => { const u = decodeURIComponent(r.url()); const m = u.match(/transactions\?select=usd_rate_snapshot,splits[^&]*&id=eq\.([^&]+)/); if (m) lastSplitId = m[1]; });
  page.on('console', (m) => { if (m.type()==='error' && m.text().includes('DEBUG editTx missing id')) console.log('   >>> '+m.text()); });

  await page.goto(`${BASE}/movimientos`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  for (const pick of PICKS) {
    lastSplitId = '(none)';
    const btn = page.getByRole('button', { name: new RegExp(pick) }).first();
    if (!(await btn.count())) { console.log(`${pick}: not found`); continue; }
    await btn.click().catch((e)=>console.log(`${pick} click fail`, e.message.split('\n')[0]));
    await page.waitForTimeout(1500);
    const bad = String(lastSplitId).includes('undefined');
    console.log(`${pick} -> ${lastSplitId}${bad?'   <<<<< UNDEFINED':''}`);
    // Close via Escape (Radix Sheet)
    await page.keyboard.press('Escape').catch(()=>{});
    await page.waitForTimeout(700);
  }
  await browser.close();
})();
