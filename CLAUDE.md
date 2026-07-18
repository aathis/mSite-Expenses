# M-Site Expense Tracker — Project Context

## What this is
A personal web app for tracking house-construction expenses for "M-Site" (a self-built house in Karnataka, India). Built with the owner in a Claude chat; development continues here in Claude Code. The user prefers simple English and precise answers.

## Background / history
- The user's original data lives in an Excel file ("M-Site Expenses and planning"). The construction section has around 190 expense entries (see `data/msite-expenses.csv`, gitignored, for the real figures — never write actual totals/amounts into this file since it's committed to a public repo).
- That data was exported to `data/msite-expenses.csv` (kept locally, NEVER committed — see privacy rules).
- Earlier versions (a Claude artifact and a Replit app) were discarded. This standalone static app is the one true version.

## Tech stack
- React 18 + Recharts (monthly chart). No backend, no database. No CSV import/export in v1 (deliberately removed — see below).
- esbuild bundles everything into ONE self-contained file: `dist/index.html` (inline JS, no external assets except Google Fonts and the Google Identity Services script used for Drive sign-in).
- Persistence: browser `localStorage`, key `msite-construction-expenses-v1`, value = JSON array of expense objects.
- Expense object shape: `{ id, date: "YYYY-MM-DD", paidTo, amount: number, category, notes }`.
- `jsx: "automatic"` must stay set in `scripts/build.mjs` — without it esbuild compiles JSX to `React.createElement` calls that reference an undefined `React` global (app.jsx never imports React as a default import), and the whole app fails to mount.

## Google Drive auto-backup (v1 decision)
- The user explicitly chose this over CSV import/export: no manual export/import step, no daily reminders — instead, every add/edit/delete automatically backs up to the user's own Google Drive.
- `src/config.js` holds `GOOGLE_CLIENT_ID` (a public OAuth Client ID, safe to commit — not a secret) plus the `drive.appdata` scope (least-privilege: this only grants access to the hidden per-app data folder, nothing else in Drive — `drive.file` does NOT cover appDataFolder, a common mix-up) and the fixed backup filename.
- `src/drive.js` handles sign-in (Google Identity Services token client) and backup (Drive REST API v3, `appDataFolder` — a hidden per-app folder, invisible in the user's normal Drive UI). One file is created once, then updated in place on every change (never a new file per backup).
- Backups are best-effort and non-blocking: if offline or the token needs re-consent, `persist()` still saves to localStorage; the UI just shows a small inline message rather than failing the save.
- **Auto-sync on open**: when connected, the app pulls the Drive backup on every load and reconciles — empty local adopts Drive, empty Drive gets the local copy pushed up, and when both sides have data the newer one (Drive `savedAt` vs the `msite-local-modified` localStorage timestamp) wins. This is what makes the same data appear on any device after sign-in. Neither side can silently wipe the other; "Back up now" also refuses to run from an empty device.
- **Hidden one-time import**: adding `?seed` to the URL shows a pick-a-JSON-file import card (generic code only — no personal data in the build). Used once with the seed file from `scripts/seed-local-data.mjs`; kept for emergencies.
- Google Cloud project: "mSite Expenses" (project ID `msite-expenses`), OAuth consent screen in Testing mode with the owner as the only test user. The Client ID's authorized JavaScript origins need updating whenever the deployment URL changes (currently only `http://localhost:8000` is registered — add the real GitHub Pages URL once deployed).

## Build & run
- `npm install` then `npm run build` → produces `dist/index.html`.
- Test by serving `dist/` over `http://localhost:8000` (Google sign-in requires a registered origin — plain `file://` won't work for the Drive features, though the rest of the app still works offline).

## Features (already implemented in src/app.jsx)
1. **Dashboard**: total spend (Indian format, e.g. ₹1,23,456), entry count, spend-by-category horizontal bars (largest bar in safety yellow), spend-by-month bar chart, a Google Drive backup card (connect/disconnect + last-backup time), and a Data card (Clear all with confirm).
2. **Add expense**: date (default today), amount, paid-to, category chips (with "+ New category"), notes. Toast on save, then jumps to Expenses tab.
3. **Expenses list**: newest first, text search (paid-to/notes/category), category filter chips, filtered count + total, per-row delete with confirm step.
4. **Google Drive auto-backup**: see above — this replaces CSV import/export as the backup mechanism.
5. Empty state on first run prompting the user to add their first expense.

## One-time personal data seed (not a general app feature)
- `scripts/seed-local-data.mjs` converts `data/msite-expenses.csv` (the user's real 191-row export, gitignored) into a browser console script the user pastes once into DevTools on their own device, against the real deployed origin, to seed their existing records into localStorage.
- Output must go outside the repo (or to a `*.local.js` path, gitignored) — never commit it, never deploy it. This is a personal one-off, not an in-app import feature.

## Fixed starting categories
Mestri, Electrical & Plumbing, JCB & Tractor, Paya & Digging, Iron bars, Cement, Hollow blocks, Water tanker, Wood work, Sand & Jelly, Misc & Tips. Custom categories are allowed and appear automatically once used.

## Design system (keep consistent)
- Construction-site aesthetic. Palette: concrete `#EAE8E3` page background, white cards, ink `#1D1B16`, safety-yellow accent `#F5B700`, grey `#8B8578`, danger `#B3261E`.
- Signature element: hazard-stripe bar (yellow/ink diagonal stripes) at the very top of the header.
- Fonts: Space Grotesk (UI), IBM Plex Mono (amounts, labels, eyebrows). Amounts always in mono.
- Active chips: ink background with yellow text. Sticky header with 3 tabs underlined in yellow.
- Responsive: single column, max-width 860px centered; form uses a 2-column grid that collapses under 480px. Must work well on phones and desktop.

## PRIVACY RULES (critical — do not break)
1. The built `index.html` must NEVER contain the user's personal expense data. The app ships empty; data only enters via the Add Expense form (or the one-time personal seed, run locally). Data stays in localStorage, mirrored only to the user's own Drive appDataFolder.
2. Never commit `data/` (the CSV with real expenses) — it is gitignored. Keep it that way. Same for any `*.local.js` seed output.
3. The repo itself is now **public**, on top of the deployed site being public — so nothing checked into git can contain real figures. Never write actual totals, amounts, dates, or vendor names into CLAUDE.md, commit messages, code comments, or anywhere else that gets committed. Use placeholder figures in examples.
4. Keep the Drive scope to `drive.appdata` only — never widen it to full Drive access.

## Deployment
GitHub Pages, deployed via `.github/workflows/deploy.yml` (GitHub Actions builds `dist/` fresh on every push to `main` and publishes it — `dist/` is gitignored, never committed). Site is at `https://aathis.github.io/mSite-Expenses/`. The repo itself is **private** — GitHub Pages works fine from a private repo, the published site is just publicly reachable regardless, which is why rules 1–2 above matter.

## PWA (implemented)
`assets/` holds `manifest.webmanifest`, `sw.js` (network-first navigation with cache fallback for offline opens), and hazard-stripe icons (192/512). `scripts/build.mjs` copies them into `dist/` and injects the manifest link, apple-touch-icon, theme-color, and service-worker registration into the built HTML. The user installs it from Chrome's "Add to Home screen" for an app-icon experience on the phone.

## Roadmap ideas the user has not confirmed yet (ask before building)
- Edit existing expense entries (currently only add/delete).
- Simple passcode screen on app open.
- Track pending/owed payments (e.g. amounts pending to contractors).

## Working style for this user
- Simple English, precise, no jargon. Explain trade-offs honestly (cost, privacy).
- Confirm understanding of what a feature means for their data privacy before adding anything that sends data anywhere.
