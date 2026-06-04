# GerOS — Data Model (authoritative)

This is the version-proof source of truth for the database. `backend/pb_schema.json`
is a direct import of this into PocketBase (Admin UI → Settings → Import collections).
If any field attribute differs on your PocketBase version, this doc is what you trust:
recreate the field by hand from the table below.

The prototype in `/prototype` uses these exact field names in its JS state objects, so
wiring the frontend to PocketBase on Day 2 is a 1:1 mapping, not a rewrite.

---

## Collections

### `users` (PocketBase built-in auth collection — extend it)
Add two fields to the default `users` collection:

| field | type | notes |
|---|---|---|
| `full_name` | text | shown in UI + audit log |
| `role` | select (single) | `admin` · `manager` · `kitchen` · `worker` — **required** |

Auth, password reset, and sessions are handled by PocketBase. Cap at 5 records for the
product tier. The `role` value drives every API rule below and the frontend navigation.

### `gers`
| field | type | notes |
|---|---|---|
| `code` | text, unique, required | e.g. `G-01` |
| `name` | text | optional friendly name |
| `capacity` | number (int), required | beds |
| `bed_type` | select | `1bed` · `2bed` · `family` |
| `status` | select, required | `available` · `occupied` · `cleaning` (the 3 map colors) |
| `x`, `y` | number | position on the interactive map (pixels) |
| `features` | json | `{stove,ensuite,view,heating}` booleans |
| `current_booking` | text | booking ref snapshot when occupied |

### `tour_operators` (CRM)
| field | type | notes |
|---|---|---|
| `name` / `name_en` | text | bilingual |
| `country`, `contact`, `email`, `phone` | text/email | |
| `contract_status` | select | `signed` · `pending` · `none` |
| `crm_notes` | editor | rich text |
| `documents` | file (multi) | contracts, booking PDFs |

### `bookings`
| field | type | notes |
|---|---|---|
| `ref` | text, unique, required | e.g. `BK-1042` |
| `channel` | select, required | `operator` · `phone` · `walkin` · `website` (channel tracking) |
| `operator` | relation → tour_operators | nullable |
| `guest_name` | text | |
| `party`, `guides` | number (int) | headcounts |
| `check_in`, `check_out` | date | |
| `nights` | number (int) | |
| `status` | select, required | `pending` · `confirmed` · `checked_in` · `checked_out` · `cancelled` |
| `assigned_gers` | relation → gers (multi) | the allocation result |
| `services` | json | `["Full board","Horse trek"]` |
| `amount` | number | |
| `pay_status` | select | `pending` · `advance` · `paid` |
| `source_pdf` | file (pdf) | the operator's original request |

### `invoices`
| field | type | notes |
|---|---|---|
| `number` | text, unique, required | `INV-2026-102` |
| `booking_ref` | text | |
| `operator` | relation → tour_operators | |
| `line_items` | json | parsed/priced lines (see invoice generator) |
| `amount`, `vat`, `total` | number | |
| `status` | select | `paid` · `advance` · `pending` |
| `issued` | date | |
| `pdf` | file | generated invoice |

### `kitchen_txns`
| field | type | notes |
|---|---|---|
| `date` | date, required | |
| `type` | select, required | `income` · `expense` |
| `category` | select | `restaurant` · `groceries` · `wages` · `utilities` · `other` |
| `note` | text | |
| `amount` | number, required | |
| `created_by` | text | user snapshot |

### `audit_log` (append-only)
| field | type | notes |
|---|---|---|
| `user`, `role` | text | who (snapshot, survives user deletion) |
| `action` | text, required | `created` · `updated` · `deleted` · `assigned` · `statusChanged` |
| `entity` | text | `bookings:BK-1042` |
| `detail` | text | |
| `ts` | autodate | when |

No update/delete rules → the trail cannot be edited. The hook in `pb_hooks/main.pb.js`
writes to it automatically on every business write.

### `site_content` (the public MN/EN website — Phase 2)
| field | type | notes |
|---|---|---|
| `key` | text, unique | `hero_title`, `promo_1`, ... |
| `value_en` / `value_mn` | editor | bilingual content |
| `images` | file (multi) | gallery / promos |
| `sort`, `published` | number / bool | |

`listRule`/`viewRule` are **public** (empty string) so the marketing site can read it
without auth; writes are admin-only. The public site is just a static frontend reading
this collection from the same PocketBase.

---

## `staff` + `wage_payments` (v1.2 — payroll)

| field | type | notes |
|---|---|---|
| `staff.name` | text, required | |
| `staff.title`, `phone`, `note` | text | |
| `staff.monthly_wage` | number | default amount for a pay run |
| `staff.active` | bool | inactive staff get no Pay button |
| `wage_payments.staff` | relation → staff, required | |
| `wage_payments.period` | text `YYYY-MM`, required | **unique with `staff`** — the double-pay guard |
| `wage_payments.amount` / `bonus` / `deduction` | number | net paid = amount + bonus − deduction |
| `wage_payments.paid_on` | date | |

Wages are sensitive: **all** rules (list/view/create/update) are admin/manager only,
delete admin only. Both collections are audited. Wage payments count as expenses in
Finance and the season report (kitchen net stays kitchen-only). Added by the
`1717200200_payroll.js` migration — post-release schema changes ship as their own
migration files; the init migration stays frozen at the v1 snapshot.

---

## Role → permission matrix

| Section | admin | manager | kitchen | worker |
|---|:--:|:--:|:--:|:--:|
| Dashboard | ✓ | ✓ | ✓ | ✓ |
| Ger map (move + status) | ✓ | ✓ | — | ✓ |
| Bookings | ✓ | ✓ | — | view |
| Operators / CRM | ✓ | ✓ | — | — |
| Finance / Invoices | ✓ | ✓ | — | — |
| Payroll (staff + wages) | ✓ | ✓ | — | — |
| Kitchen | ✓ | ✓ | ✓ | — |
| Reports | ✓ | ✓ | — | — |
| Activity log | ✓ | ✓ | — | — |
| Website + users | ✓ | — | — | — |

### Lifecycle semantics (v1.3)

`assigned_gers` is the **reservation** (date-scoped); `gers.status` is the **physical
now**. Allocation excludes gers whose reservations overlap the requested dates and only
checks physical status for bookings starting today. Assign reserves; check-in occupies;
check-out frees to cleaning. The three transitions are single server calls
(`/api/camp/assign|checkin|checkout`) and each runs inside **one DB transaction**
(v1.4): concurrent overlapping assigns serialize — the availability check cannot go
stale mid-flight — and a failure rolls the whole action back. Invoice numbers are
max+1 within the year (gap-proof). The audit log is written exclusively by the hooks;
its API createRule is locked (`1717200300_lock_audit.js`) so rows cannot be forged.

Enforced in **two places**: API rules on each collection (server-side, the real
boundary) and the frontend nav (UX). Never trust the frontend alone — the rules in
`pb_schema.json` are what actually stop a worker from reading finance.
