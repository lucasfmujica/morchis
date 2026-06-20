// Capture an authenticated Supabase session into .auth/storageState.json.
//
// Opens a REAL Chromium window so the user can complete the OAuth login, then
// detects the session by watching for a Supabase auth cookie (so we never
// navigate away mid-OAuth) and persists the storage state for drive.js to reuse.
//
// Run from the repo root (so `require('playwright')` resolves to node_modules):
//   node .claude/skills/run-reglas/capture.js
const path = require('path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '../../..');
const STATE = path.join(REPO, '.auth', 'storageState.json');
const BASE = process.env.BASE_URL || 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/reglas`).catch(() => {});
  console.log('>>> Iniciá sesión en la ventana de Chromium. Esperando hasta 5 min...');

  const deadline = Date.now() + 300000;
  let ok = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const cookies = await ctx.cookies();
    if (cookies.some((c) => /auth-token/.test(c.name))) { ok = true; break; }
  }

  if (!ok) {
    console.log('TIMEOUT: no se detectó sesión (no apareció cookie auth-token).');
    await browser.close();
    process.exit(1);
  }

  // Confirm an auth-gated route loads without bouncing to /auth, then persist.
  await page.goto(`${BASE}/reglas`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);
  const fs = require('fs');
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  await ctx.storageState({ path: STATE });
  console.log('SAVED', STATE, '| url:', page.url());
  await browser.close();
})();
