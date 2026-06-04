# GerOS — Camp Management, simplified

A compact booking, ger-management and finance system for Mongolian tourist camps.
One install, 5 users, runs on one cheap box. Sold once, not babysat after.

This is **Day 3 of 3 — feature-complete v1**. One PocketBase process serves three things:

- **`/`** — the public bilingual (MN/EN) marketing + booking site. Static file, no build.
  Content and gallery images managed from the admin dashboard (`site_content`). The
  booking form posts to a validated server endpoint and lands in the staff queue as a
  `website`-channel booking. Honeypot field keeps the bots out.
- **`/admin/`** — the management app (React, built into `pb_public/admin/`): login for
  the 5 role-gated users, live draggable ger map, booking queue with smart allocation
  and one-click assign + auto-invoice, bookings lifecycle, finance with invoice
  creation (line items, 10% VAT, bilingual printable invoice -> browser print = PDF,
  attach PDFs), operator CRM with document uploads, kitchen, reports, audit log,
  website content editor, CSV export everywhere.
- **`/_/`** — PocketBase's own admin UI for superuser jobs (schema import, user accounts).

---

## Open these right now (no install)

Double-click either file. Pure HTML, no build, works offline.

- **`prototype/camp-os-demo.html`** — the working core. Pick a role to sign in
  (Admin / Manager / Kitchen / Worker), then:
  - **Ger Map** — drag gers to rearrange, click one to see features + change status,
    green/red/yellow = available/occupied/cleaning. Click a booking in the queue and the
    system pulses the **recommended gers**; hit assign and it occupies them, auto-creates
    the invoice, and logs the action.
  - **Finance / Kitchen / Reports / Activity log** — live numbers in ₮, role-gated.
  - **EN / MN toggle** top-right. The whole UI flips to Mongolian.
- **`prototype/invoice-generator.html`** — the **PDF → invoice** feature, built around
  your real Актив Адвенчер Турс request. It shows the 20 parsed trips (3 cancelled ones
  auto-excluded), an editable camp price list, and a live bilingual invoice. Edit a price
  and the invoice recomputes. "Save / Print PDF" gives you a sendable document.

The prototype's data objects use the **exact field names** in `backend/pb_schema.json`,
so wiring it to the live backend is a mapping job, not a rewrite.

---

## How it's built (and why it stays cheap)

```
                one small box (~$5/mo)  or  the camp's own PC
        ┌─────────────────────────────────────────────────────┐
        │  PocketBase  (single Go binary)                      │
        │  ├─ SQLite (one file: pb_data/)  ← all camp data     │
        │  ├─ Auth + 5 users + roles (built in)                │
        │  ├─ REST API + admin UI (built in)                   │
        │  ├─ pb_hooks/  ← audit trail + smart allocation      │
        │  └─ pb_public/ ← serves the React app AND the        │
        │                   bilingual public booking site      │
        └─────────────────────────────────────────────────────┘
```

One process. One data file. No database server, no Redis, no cloud bill. PocketBase is
free and open source. That is what makes "pay for the domain and it just works" almost
true. The honest asterisk: a **public** booking site needs to be reachable from the
internet, so it lives on a ~$5/mo VPS, or on the camp's PC behind a free Cloudflare
Tunnel. Either way there is no per-seat or per-booking cost.

### Cost per camp
| item | cost |
|---|---|
| VPS (Hetzner CX22 / equivalent) | ~$5/mo (~$60/yr) |
| Domain | ~$12/yr |
| PocketBase, the app, updates | $0 |
| **Total** | **~$72/yr**, or **~$12/yr** if self-hosted on-prem |

You sell the software once. The camp runs it on their own $5 box (or you bundle year one).
Nothing phones home, nothing to maintain per customer.

---

## What's in this folder

```
Camp/
├─ README.md                  ← you are here
├─ app/                       ← the management app (React + Vite)
│   ├─ package.json           ← react, react-dom, pocketbase SDK; vite
│   ├─ vite.config.js         ← base /admin/, builds into backend/pb_public/admin
│   └─ src/                   ← views: map, queue, finance, kitchen, reports, audit…
├─ prototype/
│   ├─ camp-os-demo.html      ← Day-1 interactive demo (still works standalone)
│   └─ invoice-generator.html ← PDF → invoice exploration (standalone)
├─ backend/
│   ├─ pb_schema.json         ← import into PocketBase to create all collections
│   ├─ pb_hooks/main.pb.js    ← audit trail + recommend/assign/public-booking endpoints
│   └─ pb_public/
│       ├─ index.html         ← the public MN/EN site (static, reads site_content)
│       └─ admin/             ← created by `npm run build`
├─ deploy/
│   ├─ install.sh             ← one-shot VPS setup: PocketBase + Caddy TLS + systemd + cron
│   ├─ geros.service          ← systemd unit
│   ├─ Caddyfile              ← HTTPS reverse proxy (SSE-safe for realtime)
│   └─ backup.sh              ← nightly consistent SQLite snapshot + uploads, 14-day rotation
└─ docs/
    ├─ DATA_MODEL.md          ← authoritative schema + role/permission matrix
    └─ PLAN.md                ← the 3-day build plan
```

## Stand up the whole system (≈10 min)

The database **provisions itself.** `backend/pb_migrations/` creates every collection,
patches the `users` collection (adds `full_name` + `role`, locks listing to admins), and
applies hardened settings (rate limiting + trusted-proxy) on the first `serve` — no manual
"Import collections" step. `pb_schema.json` stays the source of truth; re-run
`node backend/scripts/gen-init-migration.mjs` after editing it.

Backend:
1. Download the PocketBase binary for your OS, put it in `backend/` (next to `pb_hooks/`,
   `pb_migrations/`, `pb_public/`).
2. `cd backend && ./pocketbase serve` — migrations run automatically; the schema is ready.
3. Create the first superuser (the admin UI prints a link, or
   `./pocketbase superuser upsert you@camp.mn <password>`).
4. In `/_/` create your 5 staff accounts — the `role` field already exists. That's it.

Frontend (`app/`, needs Node 18+ once, on the dev machine only):
```sh
cd app
npm install
npm run dev      # dev server; expects PocketBase on 127.0.0.1:8090
npm run build    # writes the production app into backend/pb_public/admin
```
After `npm run build`, PocketBase serves everything itself — the camp's box runs ONE
process and needs Node never again. Public site at `/`, staff app at `/admin/`. Sign in
with any of the 5 users; the role decides what they see. Add gers via "+ Add ger" on the
map (admin/manager), then drag them to match your camp's layout — positions persist.

Or skip all of the above on a fresh VPS: `cd deploy && bash install.sh yourdomain.mn`
(downloads PocketBase, copies hooks + migrations, configures Caddy TLS + security headers,
systemd, nightly backups; the DB self-provisions on first boot — you only create the
superuser and the 5 staff accounts afterward. Set `SUPERUSER_EMAIL` to have it generate
and print a superuser password too).

### Tests

```sh
cd backend && node --test        # 54 integration tests, zero deps
```
Each test spins up an isolated PocketBase on a temp DB, provisioned by the **same
migrations production uses**, and exercises the real hooks + API rules: smart allocation,
assign + auto-invoice, the audit trail, public-booking validation + rate limiting, and the
role matrix. CI (`.github/workflows/ci.yml`) runs this plus the production frontend build on
every push.

Six endpoints the hooks add (all single-call, server-side, audited):
- `GET  /api/camp/availability?from=YYYY-MM-DD&days=N` — every ger + its active
  reservations overlapping the window; feeds the calendar view.
- `GET  /api/camp/recommend/{bookingId}` — ranked best-fit gers, **date-aware**: a ger
  reserved by a confirmed booking with overlapping dates is excluded; a ger someone
  sleeps in tonight is still offered for September.
- `POST /api/camp/assign/{bookingId}` — **reserves** the gers (assigned_gers), confirms
  the booking, creates the numbered invoice. The map stays green until the guests arrive.
- `POST /api/camp/checkin/{bookingId}` — guests arrived: occupies the reserved gers
  (409 if someone else is physically in one), booking → checked_in.
- `POST /api/camp/checkout/{bookingId}` — frees exactly the gers this booking holds to
  cleaning, booking → checked_out.
- `POST /api/camp/public-booking` — the website form's target. Server-side validation,
  honeypot, per-IP rate limit, lands as a pending booking with channel `website`.

---

## The 3-day plan (short version — full version in docs/PLAN.md)

**Day 1 — done.** Interactive core proven (map, queue, smart allocation, finance, audit,
EN/MN), real PDF→invoice generator built on your actual operator file, full database schema
+ audit hook + allocation endpoint, this architecture.

**Day 2 — done, build verified.** The React app in `app/` talks to live collections:
real login for the 5 users, role-gated router, draggable ger map persisting positions
(one PATCH on drop, not per pixel), booking queue, server-side recommend + assign +
auto-invoice endpoint, bookings with check-in/out lifecycle that frees gers to cleaning,
finance with live monthly revenue/expense, kitchen quick-add, operators CRM-lite,
reports with CSV export everywhere it matters.

**Day 3 — done, build verified.** Public MN/EN site at the root with online booking
(validated endpoint + honeypot), website content editor in the admin dashboard, in-app
invoice creation with line items + VAT + bilingual print sheet (browser print = the PDF),
file attachments (operator documents, booking source PDFs, invoice PDFs), VPS deploy
script with Caddy TLS + systemd + nightly consistent SQLite backups.

### Honest status
- **Verified:** `vite build` passes; the schema, API rules and permission matrix are
  enforced server-side. CSV exports use a UTF-8 BOM so Excel renders Cyrillic correctly.
- **Verified end-to-end (running PocketBase):** the full stack was stood up and driven
  against PocketBase 0.39.1 — login, the live ger map, smart allocation, assign +
  auto-invoice, the audit trail, and the public booking form all work. An automated
  integration suite (`backend/test/`, run `cd backend && node --test`) covers the three
  custom endpoints, the audit trail, and the role gating. This run also fixed a real
  bug: the hook helpers (`recommendFor`, `writeAudit`) were declared at the top level of
  `main.pb.js` but called inside `routerAdd`/`onRecord*Request` callbacks, which run in
  isolated JSVM runtimes that can't see them — silently breaking smart allocation,
  assign, and the audit trail. They now live in `pb_hooks/utils.js` and are `require()`d
  inside each handler (see that file's header).
- **Production hardening (done):** self-provisioning via `pb_migrations` (no manual
  schema import); per-IP rate limiting on the public booking endpoint (the only unauthed
  write) plus PocketBase's built-in brute-force limiter on the auth endpoints;
  trusted-proxy config so the real client IP is seen behind Caddy; security headers
  (HSTS, nosniff, frame-deny, referrer/permissions policy) in the Caddyfile; CI that runs
  the test suite + frontend build; `.gitignore` for runtime artifacts; the live online
  SQLite backup technique verified to produce a complete, consistent snapshot.
- **Known deviations:** styling is the prototype's hand-rolled design system, not
  Tailwind (zero visual difference, one less build dep; swap later if you care). The dev
  toolchain (vite 5 / esbuild) carries a moderate advisory that affects only the Vite
  **dev server**, never the static bundle PocketBase ships — not a production exposure;
  the fix is a major vite bump, deferred.
- **v1.1 (done, verified end-to-end):** one-click end-of-season report — Reports now has
  a season (year) selector and a 🖨 print button that opens a bilingual MN/EN print-styled
  report (browser print = the PDF): financial summary, monthly revenue/kitchen/expense
  breakdown, booking stats by channel and status, top operators by invoice revenue, and
  invoice status totals. Reuses the invoice paper styles; verified in a real browser
  against a seeded 4-month season, including print-media rendering.
- **v1.2 (done, tested + verified end-to-end):** payroll — staff registry + monthly pay
  runs (admin/manager only; wages never visible to kitchen/worker, enforced by API
  rules). One Pay click per staff per month, prefilled from their wage, with bonus and
  deduction; a unique (staff, period) index makes double-paying a month impossible.
  Wage payments flow into Finance's monthly expenses and the season report (own summary
  row + monthly column); kitchen net stays kitchen-only. Both collections audited.
  6 new integration tests (31 total). Ships as its own migration —
  `1717200200_payroll.js` — existing camps just restart PocketBase.
- **v1.3 (done, tested + verified end-to-end):** date-aware allocation + server-side
  lifecycle. Allocation now considers booking date overlap, not just the map's physical
  colors — confirming a September booking in June no longer paints gers red all summer,
  two overlapping bookings can never hold the same ger, and tonight's occupied ger is
  still sellable for next month. Assign reserves; gers turn occupied at **check-in**
  (`/api/camp/checkin`, 409 on physical conflict) and free to cleaning at **check-out**
  (`/api/camp/checkout`) — each one transactional server call replacing the old
  client-side multi-writes that could be half-applied on a dropped connection.
  13 new integration tests (44 total); the whole arc verified in a real browser.
- **v1.4 (done — core audit + hardening):** the core was audited and upgraded.
  Found + fixed: (1) the audit log was **forgeable** — any authed user could POST
  fake rows with arbitrary user/role text; the API surface is now locked
  (`1717200300_lock_audit.js`), only the hooks write the trail. (2) assign /
  check-in / check-out ran as sequential writes — now each runs inside **one DB
  transaction**: concurrent overlapping assigns serialize (a 6-way parallel race
  test proves exactly one winner), and a dropped connection can't half-apply a
  group check-in. (3) invoice numbering moved from count+retry to **max+1** —
  gap-proof by construction, no retry needed inside a transaction. 4 new tests
  (48 total). Verified clean: unique indexes on ref/number/code/key were already
  in place.
- **v1.5 (done, tested + verified end-to-end):** availability calendar — a gers × days
  grid (3-week window, shift by week) showing every reservation: teal = reserved,
  red = guests in the ger, physical-status dot per ger, booking ref + tooltip on each
  span, today highlighted. Backed by `GET /api/camp/availability` (6 new tests, 54
  total). Staff can finally answer "can we take 6 people Aug 14-17?" at a glance.
- **Not yet done:** Generic
  operator-PDF auto-parsing (the standalone generator handles the known format).
  Deliberately out of scope: online card payments,
  multi-camp tenancy.
