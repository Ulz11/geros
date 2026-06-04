/// <reference path="../pb_data/types.d.ts" />
/**
 * GerOS - shared hook helpers.
 *
 * IMPORTANT (PocketBase JSVM): handler callbacks registered with routerAdd /
 * onRecord*Request run in ISOLATED pooled runtimes. They CANNOT see functions
 * or constants declared at the top level of main.pb.js. Anything a callback
 * needs at call time must therefore live in a required module like this one and
 * be pulled in *inside* the callback:  require(`${__hooks}/utils.js`).
 *
 * Deliberately ASCII-only, like main.pb.js.
 */

// Append-only audit entry for a request-level record event.
function writeAudit(e, action) {
  try {
    // e.auth exists on REQUEST-level events (onRecord*Request) - that's why the
    // hooks register those and not the model-level *Success hooks, which have no
    // request context and would log every action as "system".
    const auth = e.auth;
    const user = auth ? (auth.get("full_name") || auth.get("email")) : "system";
    const role = auth ? auth.get("role") : "system";
    const col = e.record.collection().name;
    const log = new Record(e.app.findCollectionByNameOrId("audit_log"));
    log.set("user", String(user));
    log.set("role", String(role || ""));
    log.set("action", action);
    log.set("entity", col + ":" + (e.record.get("ref") || e.record.get("code") || e.record.get("number") || e.record.id));
    log.set("detail", action + " on " + col);
    e.app.save(log);
  } catch (err) {
    // never let auditing break the primary write
    console.log("[audit] skipped:", err);
  }
}

// Best-fit allocation for a booking record.
// Strategy: tightest single ger first; else largest-first + nearest neighbours
// so a group stays clustered on the map.
function recommendFor(app, booking) {
  const party = booking.getInt("party");

  const gers = app.findRecordsByFilter("gers", "status = 'available'", "", 200, 0);
  const avail = gers.map((g) => ({
    id: g.id, code: g.get("code"), capacity: g.getInt("capacity"),
    x: g.getFloat("x"), y: g.getFloat("y"),
  }));

  // 1) single ger, smallest capacity that still fits
  const singles = avail.filter((g) => g.capacity >= party).sort((a, b) => a.capacity - b.capacity);
  if (singles.length) {
    const g = singles[0];
    return { gers: [g], waste: g.capacity - party, reason: "single ger, tightest fit" };
  }

  // 2) multi-ger: largest first, then nearest neighbours until covered
  const pool = avail.slice().sort((a, b) => b.capacity - a.capacity);
  if (!pool.length) return { gers: [], waste: 0, reason: "no availability" };
  const chosen = [pool[0]];
  let cap = pool[0].capacity;
  const rest = pool.slice(1);
  while (cap < party && rest.length) {
    const cx = chosen.reduce((s, g) => s + g.x, 0) / chosen.length;
    const cy = chosen.reduce((s, g) => s + g.y, 0) / chosen.length;
    rest.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const n = rest.shift();
    chosen.push(n);
    cap += n.capacity;
  }
  if (cap < party) return { gers: [], waste: 0, reason: "not enough capacity" };
  return { gers: chosen, waste: Math.max(0, cap - party), reason: chosen.length + " adjacent gers" };
}

// Fixed-window per-key rate limiter backed by the shared app runtime store.
// Returns true if the request is ALLOWED, false if it exceeded `max` within the
// last `windowSec`. Only primitive strings are stored, never JS objects - the
// store is shared across PocketBase's pooled hook runtimes and a goja object
// created in one runtime is not safe to read from another.
function rateLimitOk(e, key, max, windowSec) {
  try {
    const store = e.app.store();
    const now = Date.now();
    const k = "rl:" + key;
    let start = now, count = 0;
    const raw = store.get(k);
    if (raw) {
      const p = String(raw).split("|");
      start = parseInt(p[0], 10) || now;
      count = parseInt(p[1], 10) || 0;
      if (now - start > windowSec * 1000) { start = now; count = 0; }
    }
    count += 1;
    store.set(k, start + "|" + count);
    return count <= max;
  } catch (err) {
    // a limiter failure must never take down the endpoint - fail open
    console.log("[ratelimit] skipped:", err);
    return true;
  }
}

module.exports = { writeAudit, recommendFor, rateLimitOk };
