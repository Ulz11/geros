# GerOS — 3-Day Build Plan

Scope locked Day 1: go deep on the critical core (ger map + booking allocation + finance/
reporting) as real software with the 5-role login and audit trail. Public website, full
operator CRM, and payroll are Phase 2 (Day 3 + later). Stack: PocketBase + React, one box.

---

## Day 1 — Core proven + foundation laid  ✅ DONE

- Interactive core prototype (`prototype/camp-os-demo.html`): bento dashboard, draggable
  ger map with 3-color status, booking queue, smart allocation with one-click assign +
  auto-invoice, finance, kitchen, reports, append-only activity log, EN/MN toggle, role
  gating for all 4 roles.
- PDF → invoice generator (`prototype/invoice-generator.html`) built on the real
  Актив Адвенчер Турс file: 20 trips parsed, 3 cancelled auto-excluded, editable price
  list, live bilingual invoice, print/save to PDF.
- Database: `backend/pb_schema.json` (7 collections, 72 fields, unique indexes, role-based
  API rules) + `docs/DATA_MODEL.md` (authoritative spec + permission matrix).
- `backend/pb_hooks/main.pb.js`: automatic audit trail on every write + the
  `/api/camp/recommend/{bookingId}` allocation endpoint.
- Verified: allocation algorithm and invoice math unit-checked in Node; both prototype
  files pass JS syntax + tag-balance checks.

## Day 2 — Turn it into the live app  ✅ BUILT (verification pending)

Done
- `app/` Vite + React project; PocketBase JS SDK; real login bound to the `users`
  collection; role-based view router reusing the permission matrix verbatim.
- Every prototype view ported to live collections: draggable ger map (single `x`/`y`
  PATCH on pointer-up — the debounce risk handled), queue from `bookings` with
  `expand=operator`, recommend via `GET /api/camp/recommend`, one-click assign via the
  new `POST /api/camp/assign` endpoint (server-side: occupies gers, confirms booking,
  sequential invoice number with unique-collision retry, one audit row).
- Bookings lifecycle: create (auto BK-ref), pay status, check-in, check-out/cancel frees
  assigned gers to `cleaning`. Finance: live tiles + monthly revenue-vs-expense from real
  invoices/kitchen data + inline invoice status edit. Kitchen quick-add with
  `created_by` snapshot. Operators CRM-lite add/edit. Reports aggregates + CSV. Audit view.
- EN/MN i18n everywhere; lang choice persisted. CSV exports with UTF-8 BOM for Excel.
- Realtime subscriptions on gers/bookings in the map view (second user's changes appear
  without refresh); graceful no-op if the PB version lacks realtime.

Deviations
- Kept the prototype's design-system CSS instead of Tailwind: identical look, one fewer
  build dependency. Revisit only if a future dev demands utility classes.

Still open from Day 2 scope (rolls into Day 3)
- `npm install && npm run build` not yet executed — code is review-clean but unbuilt.
- Invoice generator not yet wired in-app (PDF persist onto bookings/operators).

## Day 3 — Make it sellable  ✅ BUILT (build verified; live click-through pending)

Done
- URL layout finalized: public site owns `/`, staff app moved to `/admin/` (vite base),
  PocketBase admin at `/_/`. One process serves all three.
- Public site: static MN/EN landing + booking page at `pb_public/index.html`, reads
  published `site_content` rows (text + gallery images) with sane defaults when empty;
  form posts to the new validated `POST /api/camp/public-booking` endpoint (honeypot,
  date/party/contact checks, BK-W ref series, audit row as user "website").
- Content manager: Settings now edits `site_content` keys (EN/MN, publish toggle) so the
  admin runs the website from the same dashboard. `invoice_footer` key feeds invoices.
- Invoices: in-app creation with editable line items, optional 10% VAT, sequential
  INV-YYYY-NNN with collision retry; bilingual printable invoice sheet (browser print =
  PDF); PDF attach on invoices; source-PDF attach on bookings (append, max 3); document
  uploads + download chips on operators.
- Ops: `deploy/install.sh` (PocketBase latest, Caddy TLS, systemd hardened unit, cron),
  `backup.sh` using sqlite3 .backup for consistent snapshots + storage dir, 14-day
  rotation; restore = stop, copy back, start.

Still open for v1.1
- End-of-season one-click PDF (CSV export exists today; a print-styled report page is
  the cheap path). Excel-native import. Generic operator-PDF parser. Restore drill on a
  real VPS.

## Explicitly out of scope (be honest with buyers)
- Payment processing / online card capture (camps invoice operators directly).
- Generic PDF parsing for *every* operator's template. Structured/known requests are
  automated; novel layouts get a 30-second manual confirm step until the parser is trained.
- Payroll beyond basic staff-wage expense lines.
- Multi-camp / multi-tenant. This is deliberately one-camp-per-install. That is the
  business model, not a limitation.

## Definition of done (sellable v1)
A camp installs one binary, imports the schema, adds 5 users, points a domain at the box,
and runs their whole season: take bookings from 4 channels, allocate gers on the map,
turn operator PDFs into invoices, track kitchen income/expense, and pull a clean
end-of-season report. Every action is attributable. Annual cost: a domain plus ~$5/mo.
