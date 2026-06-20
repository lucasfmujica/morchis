---
name: run-reglas
description: Launch and drive Morchis' authenticated screens (/reglas, /presupuestos, /movimientos, etc.) in a real browser via Playwright, reusing a saved OAuth login session. Use when asked to run, screenshot, or verify an auth-gated page of this app in the browser — not just typecheck it.
---

# Run & drive Morchis (auth-gated)

Morchis pages are auth-gated: the server component `redirect('/auth')`s any
request without a Supabase session, and login is **OAuth** (can't be scripted
from scratch). So driving the real UI needs a captured browser session. This
skill: (1) reuses a saved session, (2) drives the route headless, screenshots
it, and reports render errors.

## 0. Prereqs (one-time per machine)

Dev server running and Playwright + Chromium available:

```bash
lsof -ti :3000 >/dev/null || npm run dev   # start it if not already up
npm install --no-save playwright           # NOT saved to package.json
npx playwright install chromium            # full chromium (headed) + headless shell
```

`--no-save` keeps `package.json` clean. The scripts live inside the repo, so
`require('playwright')` resolves to `node_modules/` with no `NODE_PATH` needed —
**run them from the repo root.**

## 1. Capture a session (interactive, only when missing/expired)

Skip if `.auth/storageState.json` already exists and still works (step 2 will
say `redirected to auth? true` when it's expired). To (re)capture:

```bash
node .claude/skills/run-reglas/capture.js
```

A Chromium window opens. **Ask the user to log in** (complete the OAuth flow).
The script polls for the Supabase `auth-token` cookie — no need to navigate to
any particular page — then saves `.auth/storageState.json` and prints `SAVED`.
This runs headed, so launch it in the **background** and wait for completion
(the user must interact with the window).

`.auth/` is gitignored — **the session contains real tokens; never commit it.**

## 2. Drive a route + screenshot (headless, repeatable)

```bash
node .claude/skills/run-reglas/drive.js /reglas
# other routes / custom out dir:
node .claude/skills/run-reglas/drive.js /presupuestos /tmp/shots
```

Then **Read the PNG** it printed (`/tmp/morchis-e2e/<route>.png`) — a blank or
`/auth` page is a failure. Check the `PAGE ERRORS:` line (`none` = clean) and
`redirected to auth?` (`true` = session expired → redo step 1).

For richer interaction (open a form, select a category, assert a switch/badge
appears), extend `drive.js` with Playwright `click`/`selectOption`/`getByText`
and add more `screenshot()` calls — see git history for the `/reglas` form walk
(category select → "Reservar en presupuesto" switch).

## Notes

- Viewport is mobile (430×932) — Morchis is a mobile-first PWA.
- `BASE_URL` env var overrides `http://localhost:3000` if the dev server moved.
- Don't create/edit real records to "test" unless asked — it mutates the user's
  live Supabase data. Prefer read-only navigation + screenshots.
