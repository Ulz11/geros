/// <reference path="../pb_data/types.d.ts" />
/**
 * GerOS - PocketBase hooks
 * Targets PocketBase JSVM v0.23+ (the *.pb.js hooks API).
 * If you run an older build, see https://pocketbase.io/docs/js-overview/
 *
 * NOTE: this file is deliberately ASCII-only.
 *
 * Four things live here:
 *   1. Append-only AUDIT TRAIL - every write to a business collection is logged
 *      with the acting user, so "who did this" is always answerable.
 *   2. SMART ALLOCATION endpoint - GET /api/camp/recommend/{bookingId}
 *      returns the best-fit available ger(s) for a booking.
 *   3. ASSIGN endpoint - POST /api/camp/assign/{bookingId}
 *      applies the recommendation server-side: occupies the gers, confirms the
 *      booking, auto-creates the invoice with a sequential number, writes one
 *      clean audit entry. The frontend makes ONE call instead of four writes.
 *   4. PUBLIC BOOKING endpoint - POST /api/camp/public-booking
 *      the only unauthenticated write in the system: the public website's form.
 *      Validated server-side, lands as a pending website-channel booking in
 *      the same queue the staff already work.
 */

/* ----------------------------------------------------------------
   1. AUDIT TRAIL
   ---------------------------------------------------------------- */
const AUDITED = ["bookings", "gers", "invoices", "kitchen_txns", "tour_operators", "staff", "wage_payments"];

// writeAudit() and recommendFor() live in ./utils.js, NOT here. PocketBase runs
// each hook callback in an isolated pooled runtime that cannot see top-level
// functions of this file, so shared helpers must be require()d *inside* every
// callback (see utils.js header for the full explanation).

// Request-level hooks: e.next() first so the business write succeeds (or throws)
// BEFORE we log it. Programmatic saves (e.g. inside /api/camp/assign) don't fire
// these, which is intentional - that route writes its own single audit entry.
onRecordCreateRequest((e) => { e.next(); require(`${__hooks}/utils.js`).writeAudit(e, "created"); }, ...AUDITED);
onRecordUpdateRequest((e) => { e.next(); require(`${__hooks}/utils.js`).writeAudit(e, "updated"); }, ...AUDITED);
onRecordDeleteRequest((e) => { e.next(); require(`${__hooks}/utils.js`).writeAudit(e, "deleted"); }, ...AUDITED);

/* ----------------------------------------------------------------
   2. SMART ALLOCATION (read-only)
   GET /api/camp/recommend/{bookingId}
   recommendFor() lives in ./utils.js (see note above on JSVM scoping).
   ---------------------------------------------------------------- */
routerAdd("GET", "/api/camp/recommend/{bookingId}", (e) => {
  if (!e.auth) return e.json(401, { error: "auth required" });
  const { recommendFor } = require(`${__hooks}/utils.js`);
  const booking = e.app.findRecordById("bookings", e.request.pathValue("bookingId"));
  return e.json(200, recommendFor(e.app, booking));
});

/* ----------------------------------------------------------------
   3. ASSIGN (write)
   POST /api/camp/assign/{bookingId}
   ---------------------------------------------------------------- */
routerAdd("POST", "/api/camp/assign/{bookingId}", (e) => {
  if (!e.auth) return e.json(401, { error: "auth required" });
  const role = e.auth.get("role");
  if (role !== "admin" && role !== "manager" && role !== "worker") {
    return e.json(403, { error: "not allowed" });
  }

  const { recommendFor } = require(`${__hooks}/utils.js`);
  const booking = e.app.findRecordById("bookings", e.request.pathValue("bookingId"));
  if (booking.get("status") !== "pending") {
    return e.json(400, { error: "booking is not pending" });
  }

  const rec = recommendFor(e.app, booking);
  if (!rec.gers.length) return e.json(400, { error: "no fit", reason: rec.reason });

  const ref = booking.get("ref");

  // v1.3: assign RESERVES. The gers stay physically available until check-in -
  // a September booking confirmed in June must not paint the map red all summer.
  booking.set("status", "confirmed");
  booking.set("assigned_gers", rec.gers.map((g) => g.id));
  e.app.save(booking);

  // auto-create the invoice with a sequential number (count this year's, +1;
  // unique index on number + retry below makes collisions harmless)
  const year = new Date().getFullYear();
  const existing = e.app.findRecordsByFilter("invoices", "number ~ 'INV-" + year + "-%'", "", 500, 0);
  let seq = existing.length + 1;
  let number = "INV-" + year + "-" + String(seq).padStart(3, "0");

  const invCol = e.app.findCollectionByNameOrId("invoices");
  const inv = new Record(invCol);
  let saved = false;
  for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    try {
      inv.set("number", number);
      inv.set("booking_ref", ref);
      inv.set("operator", booking.get("operator") || "");
      inv.set("amount", booking.getFloat("amount"));
      inv.set("total", booking.getFloat("amount"));
      inv.set("status", booking.get("pay_status") || "pending");
      inv.set("issued", new Date().toISOString().slice(0, 10) + " 00:00:00.000Z");
      e.app.save(inv);
      saved = true;
    } catch (err) {
      // unique collision - bump and retry
      seq += 1;
      number = "INV-" + year + "-" + String(seq).padStart(3, "0");
    }
  }

  // one clean, attributable audit entry for the whole action
  try {
    const log = new Record(e.app.findCollectionByNameOrId("audit_log"));
    log.set("user", String(e.auth.get("full_name") || e.auth.get("email")));
    log.set("role", String(role));
    log.set("action", "assigned");
    log.set("entity", ref + " -> " + rec.gers.map((g) => g.code).join("+"));
    log.set("detail", "auto-invoice " + (saved ? number : "FAILED") + " - " + booking.getFloat("amount"));
    e.app.save(log);
  } catch (err) {
    console.log("[audit] assign skipped:", err);
  }

  return e.json(200, {
    ok: true,
    gers: rec.gers.map((g) => g.code),
    waste: rec.waste,
    invoice: saved ? number : null,
  });
});

/* ----------------------------------------------------------------
   3b. CHECK-IN (write)
   POST /api/camp/checkin/{bookingId}
   The guests arrived: physically occupy the reserved gers, one audit row.
   ---------------------------------------------------------------- */
routerAdd("POST", "/api/camp/checkin/{bookingId}", (e) => {
  if (!e.auth) return e.json(401, { error: "auth required" });
  const role = e.auth.get("role");
  if (role !== "admin" && role !== "manager" && role !== "worker") {
    return e.json(403, { error: "not allowed" });
  }

  const booking = e.app.findRecordById("bookings", e.request.pathValue("bookingId"));
  if (booking.get("status") !== "confirmed") {
    return e.json(400, { error: "booking is not confirmed" });
  }
  const ref = booking.get("ref");
  const gerIds = booking.get("assigned_gers") || [];
  if (!gerIds.length) return e.json(400, { error: "no gers assigned" });

  // conflict check BEFORE any write: someone physically in one of our gers?
  const gers = [];
  for (let i = 0; i < gerIds.length; i++) {
    const ger = e.app.findRecordById("gers", gerIds[i]);
    const holder = ger.get("current_booking");
    if (ger.get("status") === "occupied" && holder && holder !== ref) {
      return e.json(409, { error: "ger occupied", ger: ger.get("code"), by: holder });
    }
    gers.push(ger);
  }

  gers.forEach((ger) => {
    ger.set("status", "occupied");
    ger.set("current_booking", ref);
    e.app.save(ger);
  });
  booking.set("status", "checked_in");
  e.app.save(booking);

  try {
    const log = new Record(e.app.findCollectionByNameOrId("audit_log"));
    log.set("user", String(e.auth.get("full_name") || e.auth.get("email")));
    log.set("role", String(role));
    log.set("action", "checked_in");
    log.set("entity", ref + " -> " + gers.map((g) => g.get("code")).join("+"));
    log.set("detail", "guests arrived, " + gers.length + " ger(s) occupied");
    e.app.save(log);
  } catch (err) {
    console.log("[audit] checkin skipped:", err);
  }

  return e.json(200, { ok: true, gers: gers.map((g) => g.get("code")) });
});

/* ----------------------------------------------------------------
   3c. CHECK-OUT (write)
   POST /api/camp/checkout/{bookingId}
   Frees only the gers THIS booking physically holds (-> cleaning); a confirmed
   booking that never checked in just flips status. One audit row.
   ---------------------------------------------------------------- */
routerAdd("POST", "/api/camp/checkout/{bookingId}", (e) => {
  if (!e.auth) return e.json(401, { error: "auth required" });
  const role = e.auth.get("role");
  if (role !== "admin" && role !== "manager" && role !== "worker") {
    return e.json(403, { error: "not allowed" });
  }

  const booking = e.app.findRecordById("bookings", e.request.pathValue("bookingId"));
  const status = booking.get("status");
  if (status !== "checked_in" && status !== "confirmed") {
    return e.json(400, { error: "booking is not checked in or confirmed" });
  }
  const ref = booking.get("ref");

  const freed = [];
  (booking.get("assigned_gers") || []).forEach((gid) => {
    let ger;
    try { ger = e.app.findRecordById("gers", gid); } catch (err) { return; } // ger deleted meanwhile
    if (ger.get("current_booking") === ref) {
      ger.set("status", "cleaning");
      ger.set("current_booking", "");
      e.app.save(ger);
      freed.push(ger.get("code"));
    }
  });
  booking.set("status", "checked_out");
  e.app.save(booking);

  try {
    const log = new Record(e.app.findCollectionByNameOrId("audit_log"));
    log.set("user", String(e.auth.get("full_name") || e.auth.get("email")));
    log.set("role", String(role));
    log.set("action", "checked_out");
    log.set("entity", ref + (freed.length ? " -> " + freed.join("+") : ""));
    log.set("detail", freed.length ? freed.length + " ger(s) to cleaning" : "no gers were held");
    e.app.save(log);
  } catch (err) {
    console.log("[audit] checkout skipped:", err);
  }

  return e.json(200, { ok: true, freed: freed });
});

/* ----------------------------------------------------------------
   4. PUBLIC BOOKING (unauthenticated, from the website form)
   POST /api/camp/public-booking
   Body: { guest_name, email, phone, party, check_in, check_out, note, website }
   "website" is a honeypot field - bots fill it, humans never see it.
   ---------------------------------------------------------------- */
routerAdd("POST", "/api/camp/public-booking", (e) => {
  const { rateLimitOk } = require(`${__hooks}/utils.js`);

  // abuse guard: this is the only unauthenticated write in the system. Cap each
  // client IP to N submissions/minute before doing any work (honeypot included).
  // Defaults to 5/60s; override with GEROS_PUBBOOK_MAX / GEROS_PUBBOOK_WINDOW.
  const rlMax = parseInt($os.getenv("GEROS_PUBBOOK_MAX"), 10) || 5;
  const rlWin = parseInt($os.getenv("GEROS_PUBBOOK_WINDOW"), 10) || 60;
  if (!rateLimitOk(e, "pubbook:" + e.realIP(), rlMax, rlWin)) {
    return e.json(429, { error: "rate_limited" });
  }

  const body = e.requestInfo().body || {};

  // honeypot: silently accept and drop
  if (body.website) return e.json(200, { ok: true });

  const name = String(body.guest_name || "").trim();
  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();
  const note = String(body.note || "").trim().slice(0, 200);
  const party = parseInt(body.party, 10);
  const ci = String(body.check_in || "").slice(0, 10);
  const co = String(body.check_out || "").slice(0, 10);

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (name.length < 2 || name.length > 120) return e.json(400, { error: "name" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && phone.length < 6) {
    return e.json(400, { error: "contact" }); // need at least one way to reach them
  }
  if (!Number.isFinite(party) || party < 1 || party > 60) return e.json(400, { error: "party" });
  if (!dateRe.test(ci) || !dateRe.test(co)) return e.json(400, { error: "dates" });
  const nights = Math.round((new Date(co) - new Date(ci)) / 86400000);
  if (!(nights > 0) || nights > 90) return e.json(400, { error: "dates" });
  if (new Date(ci) < new Date(new Date().toISOString().slice(0, 10))) {
    return e.json(400, { error: "dates" });
  }

  const col = e.app.findCollectionByNameOrId("bookings");
  let ref = "";
  let saved = false;
  for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    ref = "BK-W" + String(Date.now()).slice(-6) + (attempt ? String(attempt) : "");
    try {
      const r = new Record(col);
      r.set("ref", ref);
      r.set("channel", "website");
      r.set("guest_name", name);
      r.set("party", party);
      r.set("guides", 0);
      r.set("check_in", ci + " 00:00:00.000Z");
      r.set("check_out", co + " 00:00:00.000Z");
      r.set("nights", nights);
      r.set("status", "pending");
      r.set("pay_status", "pending");
      r.set("services", [["contact:", email || phone, note].filter(Boolean).join(" ")]);
      e.app.save(r);
      saved = true;
    } catch (err) {
      // ref collision - retry with suffix
    }
  }
  if (!saved) return e.json(500, { error: "retry" });

  try {
    const log = new Record(e.app.findCollectionByNameOrId("audit_log"));
    log.set("user", "website");
    log.set("role", "public");
    log.set("action", "created");
    log.set("entity", "bookings:" + ref);
    log.set("detail", "online booking request - " + party + " guests - " + ci + " to " + co);
    e.app.save(log);
  } catch (err) {
    console.log("[audit] public booking skipped:", err);
  }

  return e.json(200, { ok: true, ref: ref });
});
