// Drive an authenticated route headless using the saved session and capture
// screenshots + a render report (text markers + page errors).
//
// Run from the repo root:
//   node .claude/skills/run-reglas/drive.js [route] [outDir]
// Examples:
//   node .claude/skills/run-reglas/drive.js /reglas
//   node .claude/skills/run-reglas/drive.js /presupuestos /tmp/shots
//
// If the page bounces to /auth, the session expired — re-run capture.js.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '../../..');
const STATE = path.join(REPO, '.auth', 'storageState.json');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ROUTE = process.argv[2] || '/reglas';
const OUT = process.argv[3] || '/tmp/morchis-e2e';

(async () => {
  if (!fs.existsSync(STATE)) {
    console.log('NO SESSION:', STATE, '— run capture.js first.');
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

  await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500); // let react-query settle
  const url = page.url();
  console.log('URL:', url, '| redirected to auth?', url.includes('/auth'));

  const slug = ROUTE.replace(/\W+/g, '_').replace(/^_|_$/g, '') || 'root';
  const shot = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  console.log('shot', shot);

  console.log('PAGE ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
  await browser.close();
})();
