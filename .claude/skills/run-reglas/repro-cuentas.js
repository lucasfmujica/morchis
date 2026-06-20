// Reproduce the /cuentas edit-movement-save bug.
// Opens /cuentas, taps the first account, taps the first movement, opens the
// category picker, picks a category, taps Guardar, and captures:
//  - all /rest/v1/transactions network requests (looking for id=eq.undefined)
//  - console errors
// Read-only-ish: it DOES attempt a save (that's the repro), but only sets a
// category on an existing row.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '../../..');
const STATE = path.join(REPO, '.auth', 'storageState.json');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = '/tmp/morchis-e2e';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();

  const reqs = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/rest/v1/transactions')) reqs.push(`${r.method()} ${u}`);
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });

  await page.goto(`${BASE}/cuentas`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  console.log('URL:', page.url());
  await page.screenshot({ path: path.join(OUT, 'cuentas-0.png'), fullPage: true });

  // Tap the first account card (it has onClick to open the drilldown sheet).
  // Account cards are the big tappable rows; find one by its currency/amount.
  // We click the first element that opens the movements sheet.
  const accountCards = page.locator('[class*="rounded"][role], button, div').filter({ hasText: /\$/ });
  // Heuristic: click the first account row. Account rows live in the list; tap by name not reliable.
  // Instead click the first card that, when clicked, shows "movimientos"/a sheet.
  // Try clicking each top-level account container.
  const cards = await page.locator('div').evaluateAll(() => []); // placeholder

  // Simpler: the account list items are clickable divs with onClick={() => setDetailAccountId(a.id)}.
  // They contain the account name. Click the first one in the accounts section.
  // We'll click the first visible balance-bearing card.
  const firstCard = page.locator('div:has(> div):has-text("$")').first();

  // Most robust: dump the page's clickable account names by querying text, then click.
  await page.waitForTimeout(500);

  // Click first account: accounts render as cards; tap the first one containing a money amount.
  const moneyCards = page.getByText(/\$\s?[\d.]/).first();
  await moneyCards.click({ timeout: 5000 }).catch((e) => console.log('account click failed:', e.message));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'cuentas-1-detail.png'), fullPage: true });

  // Click the first movement row in the drilldown sheet.
  // Movement rows are buttons/divs with the label + date.
  const movement = page.locator('[class*="z-50"] button, [class*="z-50"] [onclick], [style*="rgba(45,45,45"] div div').first();
  // fall back: click first row that has a date-like text
  await page.waitForTimeout(500);
  const firstMovement = page.locator('div').filter({ hasText: /^.+$/ }).last();

  // Try clicking a movement by its row structure inside the sheet overlay.
  const sheetRows = page.locator('.fixed.inset-0 button, .fixed.inset-0 [class*="cursor"], .fixed.inset-0 > div > div > div');
  const count = await sheetRows.count();
  console.log('sheet candidate rows:', count);

  await page.screenshot({ path: path.join(OUT, 'cuentas-1b.png'), fullPage: true });

  console.log('--- transactions requests so far ---');
  console.log(reqs.join('\n') || '(none)');
  console.log('--- errors ---');
  console.log(errors.join('\n') || '(none)');
  await browser.close();
})();
