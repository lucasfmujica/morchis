const path = require('path');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '../../..');
const STATE = path.join(REPO, '.auth', 'storageState.json');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ACCOUNTS = ['ARQ','Brubank','Deel','Efectivo','Efectivo USD','Mercado Pago','Mercado Pago USD','Personal Pay','Santander','Santander USD','Wallbit','Tarjeta Brubank','Tarjeta Comafi','Tarjeta Hipotecario','Tarjeta ICBC','Tarjeta Mercado Pago'];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  let lastSplitId = null;
  page.on('request', (r) => { const m = r.url().match(/transactions\?select=usd_rate_snapshot,splits[^&]*&id=eq\.([^&]+)/); if (m) lastSplitId = decodeURIComponent(m[1]); });
  page.on('console', (m) => { if (m.type() === 'error' && m.text().includes('DEBUG editTx missing id')) console.log('   >>> ' + m.text()); });

  await page.goto(`${BASE}/cuentas`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const openAccount = async (name) => {
    const card = page.locator('div').filter({ hasText: new RegExp('^[🏦💳💵]?' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).filter({ hasText: /saldo actual|gastado/ }).first();
    await card.click({ timeout: 4000 });
  };

  for (const name of ACCOUNTS) {
    try { await openAccount(name); } catch (e) { console.log(`[${name}] open fail: ${e.message.split('\n')[0]}`); continue; }
    await page.waitForTimeout(900);
    let n = await page.locator('.fixed.inset-0 button').count();
    if (n === 0) { console.log(`[${name}] 0 movements`); await page.keyboard.press('Escape').catch(()=>{}); await page.waitForTimeout(300); continue; }
    for (let i = 0; i < n; i++) {
      lastSplitId = '(none)';
      const row = page.locator('.fixed.inset-0 button').nth(i);
      const label = ((await row.textContent().catch(()=>'')) || '').replace(/\s+/g,' ').trim().slice(0,36);
      await row.click().catch(()=>{});
      await page.waitForTimeout(1100);
      const bad = String(lastSplitId).includes('undefined');
      console.log(`[${name}] row${i} "${label}" -> ${lastSplitId}${bad ? '   <<<<< UNDEFINED' : ''}`);
      await page.keyboard.press('Escape').catch(()=>{});
      await page.waitForTimeout(400);
      if (i < n - 1) { try { await openAccount(name); } catch {} await page.waitForTimeout(800); }
    }
    await page.keyboard.press('Escape').catch(()=>{});
    await page.waitForTimeout(300);
  }
  await browser.close();
})();
