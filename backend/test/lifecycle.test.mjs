// v1.3: date-aware allocation + server-side check-in/check-out lifecycle.
//
// New semantics under test:
//   - recommend/assign consider BOOKING DATE OVERLAP, not just physical status:
//     a ger reserved by a confirmed/checked_in booking with overlapping dates is
//     off-limits; a physically occupied ger IS reservable for future dates.
//   - assign RESERVES (assigned_gers + invoice); gers turn occupied only at
//     check-in and free to cleaning at check-out - each one server-side call.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startInstance, api, authAs, wipe, seedGer, listAudit } from "./harness.mjs";

let inst;
before(async () => { inst = await startInstance(8100); }, { timeout: 60000 });
after(async () => { if (inst) await inst.stop(); });
beforeEach(async () => { await wipe(inst); });

const D = (s) => s + " 00:00:00.000Z";
const todayStr = new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function seedDatedBooking(token, { ref, party, ci, co, status = "pending", assigned = [] }) {
  const r = await api(inst, "POST", "/api/collections/bookings/records", {
    token,
    body: { ref, party, channel: "phone", status, guest_name: ref, guides: 0,
      nights: 1, check_in: D(ci), check_out: D(co), assigned_gers: assigned },
  });
  if (!r.ok) throw new Error("seedDatedBooking failed: " + JSON.stringify(r.data));
  return r.data;
}

describe("date-aware allocation", () => {
  test("a ger reserved for overlapping dates is not recommended", async () => {
    const manager = await authAs(inst, "manager");
    const g = await seedGer(inst, { code: "G1", capacity: 2 });
    await seedGer(inst, { code: "G2", capacity: 4 });
    // G1 is reserved Sep 10-13 by a confirmed booking
    await seedDatedBooking(manager, { ref: "HELD", party: 2, ci: "2026-09-10", co: "2026-09-13", status: "confirmed", assigned: [g.id] });
    // a new request overlapping that range must NOT get G1
    const b = await seedDatedBooking(manager, { ref: "ASK", party: 2, ci: "2026-09-11", co: "2026-09-14" });
    const r = await api(inst, "GET", `/api/camp/recommend/${b.id}`, { token: manager });
    assert.equal(r.status, 200);
    assert.ok(r.data.gers.length, "should still find a ger");
    assert.ok(!r.data.gers.some((x) => x.code === "G1"), "G1 is double-booked: " + JSON.stringify(r.data.gers));
  });

  test("the same ger IS recommended for non-overlapping dates", async () => {
    const manager = await authAs(inst, "manager");
    const g = await seedGer(inst, { code: "G1", capacity: 2 });
    await seedDatedBooking(manager, { ref: "HELD", party: 2, ci: "2026-09-10", co: "2026-09-13", status: "confirmed", assigned: [g.id] });
    // back-to-back: starts the day the other ends - no overlap
    const b = await seedDatedBooking(manager, { ref: "ASK", party: 2, ci: "2026-09-13", co: "2026-09-15" });
    const r = await api(inst, "GET", `/api/camp/recommend/${b.id}`, { token: manager });
    assert.deepEqual(r.data.gers.map((x) => x.code), ["G1"]);
  });

  test("a physically occupied ger is reservable for FUTURE dates", async () => {
    const manager = await authAs(inst, "manager");
    await seedGer(inst, { code: "G1", capacity: 2, status: "occupied" }); // someone sleeps in it tonight
    const b = await seedDatedBooking(manager, { ref: "FUT", party: 2, ci: plusDays(30), co: plusDays(33) });
    const r = await api(inst, "GET", `/api/camp/recommend/${b.id}`, { token: manager });
    assert.deepEqual(r.data.gers.map((x) => x.code), ["G1"],
      "future requests must not be blocked by tonight's physical state");
  });

  test("a booking starting today still requires a physically available ger", async () => {
    const manager = await authAs(inst, "manager");
    await seedGer(inst, { code: "DIRTY", capacity: 2, status: "cleaning" });
    await seedGer(inst, { code: "OK", capacity: 2, status: "available" });
    const b = await seedDatedBooking(manager, { ref: "NOW", party: 2, ci: todayStr, co: plusDays(2) });
    const r = await api(inst, "GET", `/api/camp/recommend/${b.id}`, { token: manager });
    assert.deepEqual(r.data.gers.map((x) => x.code), ["OK"]);
  });

  test("assign reserves without flipping the ger to occupied", async () => {
    const manager = await authAs(inst, "manager");
    const g = await seedGer(inst, { code: "G1", capacity: 2 });
    const b = await seedDatedBooking(manager, { ref: "RES", party: 2, ci: plusDays(10), co: plusDays(12) });
    const r = await api(inst, "POST", `/api/camp/assign/${b.id}`, { token: manager });
    assert.equal(r.status, 200);
    assert.match(r.data.invoice, /^INV-/);
    const ger = (await api(inst, "GET", `/api/collections/gers/records/${g.id}`, { token: manager })).data;
    assert.equal(ger.status, "available", "the guest hasn't arrived - the map must stay green");
    assert.equal(ger.current_booking, "");
    const bk = (await api(inst, "GET", `/api/collections/bookings/records/${b.id}`, { token: manager })).data;
    assert.equal(bk.status, "confirmed");
    assert.deepEqual(bk.assigned_gers, [g.id]);
  });

  test("two overlapping requests can never assign the same ger", async () => {
    const manager = await authAs(inst, "manager");
    await seedGer(inst, { code: "ONLY", capacity: 2 });
    const b1 = await seedDatedBooking(manager, { ref: "B1", party: 2, ci: "2026-09-10", co: "2026-09-13" });
    const b2 = await seedDatedBooking(manager, { ref: "B2", party: 2, ci: "2026-09-11", co: "2026-09-14" });
    const r1 = await api(inst, "POST", `/api/camp/assign/${b1.id}`, { token: manager });
    assert.equal(r1.status, 200);
    const r2 = await api(inst, "POST", `/api/camp/assign/${b2.id}`, { token: manager });
    assert.equal(r2.status, 400, "second overlapping assign must find no fit");
  });
});

describe("check-in  POST /api/camp/checkin/{id}", () => {
  async function reserved(manager) {
    const g = await seedGer(inst, { code: "G1", capacity: 2 });
    const b = await seedDatedBooking(manager, { ref: "BK-1", party: 2, ci: todayStr, co: plusDays(2) });
    await api(inst, "POST", `/api/camp/assign/${b.id}`, { token: manager });
    return { g, b };
  }

  test("occupies the assigned gers and marks the booking checked_in, audited once", async () => {
    const manager = await authAs(inst, "manager");
    const { g, b } = await reserved(manager);
    const r = await api(inst, "POST", `/api/camp/checkin/${b.id}`, { token: manager });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.gers, ["G1"]);
    const ger = (await api(inst, "GET", `/api/collections/gers/records/${g.id}`, { token: manager })).data;
    assert.equal(ger.status, "occupied");
    assert.equal(ger.current_booking, "BK-1");
    const bk = (await api(inst, "GET", `/api/collections/bookings/records/${b.id}`, { token: manager })).data;
    assert.equal(bk.status, "checked_in");
    const audit = await listAudit(inst);
    assert.equal(audit.filter((a) => a.action === "checked_in").length, 1);
  });

  test("rejects a booking that is not confirmed", async () => {
    const manager = await authAs(inst, "manager");
    await seedGer(inst, { code: "G1", capacity: 2 });
    const b = await seedDatedBooking(manager, { ref: "PEND", party: 2, ci: todayStr, co: plusDays(1) });
    const r = await api(inst, "POST", `/api/camp/checkin/${b.id}`, { token: manager });
    assert.equal(r.status, 400);
  });

  test("kitchen role is forbidden", async () => {
    const manager = await authAs(inst, "manager");
    const { b } = await reserved(manager);
    const kitchen = await authAs(inst, "kitchen");
    const r = await api(inst, "POST", `/api/camp/checkin/${b.id}`, { token: kitchen });
    assert.equal(r.status, 403);
  });

  test("409 when a ger is physically occupied by someone else", async () => {
    const manager = await authAs(inst, "manager");
    const { g, b } = await reserved(manager);
    // someone else is physically in G1 (e.g. a walk-in placed manually)
    const su = await authAs(inst, "admin");
    await api(inst, "PATCH", `/api/collections/gers/records/${g.id}`, {
      token: su, body: { status: "occupied", current_booking: "WALKIN" },
    });
    const r = await api(inst, "POST", `/api/camp/checkin/${b.id}`, { token: manager });
    assert.equal(r.status, 409, JSON.stringify(r.data));
  });
});

describe("check-out  POST /api/camp/checkout/{id}", () => {
  test("frees the gers to cleaning and marks the booking checked_out, audited", async () => {
    const manager = await authAs(inst, "manager");
    const g = await seedGer(inst, { code: "G1", capacity: 2 });
    const b = await seedDatedBooking(manager, { ref: "BK-1", party: 2, ci: todayStr, co: plusDays(2) });
    await api(inst, "POST", `/api/camp/assign/${b.id}`, { token: manager });
    await api(inst, "POST", `/api/camp/checkin/${b.id}`, { token: manager });
    const r = await api(inst, "POST", `/api/camp/checkout/${b.id}`, { token: manager });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const ger = (await api(inst, "GET", `/api/collections/gers/records/${g.id}`, { token: manager })).data;
    assert.equal(ger.status, "cleaning");
    assert.equal(ger.current_booking, "");
    const bk = (await api(inst, "GET", `/api/collections/bookings/records/${b.id}`, { token: manager })).data;
    assert.equal(bk.status, "checked_out");
    const audit = await listAudit(inst);
    assert.equal(audit.filter((a) => a.action === "checked_out").length, 1);
  });

  test("a confirmed (never checked-in) booking can be checked out without touching gers", async () => {
    const manager = await authAs(inst, "manager");
    const g = await seedGer(inst, { code: "G1", capacity: 2 });
    const b = await seedDatedBooking(manager, { ref: "BK-1", party: 2, ci: plusDays(5), co: plusDays(7) });
    await api(inst, "POST", `/api/camp/assign/${b.id}`, { token: manager });
    const r = await api(inst, "POST", `/api/camp/checkout/${b.id}`, { token: manager });
    assert.equal(r.status, 200);
    const ger = (await api(inst, "GET", `/api/collections/gers/records/${g.id}`, { token: manager })).data;
    assert.equal(ger.status, "available", "ger was never occupied - it must not go to cleaning");
  });

  test("rejects a pending booking", async () => {
    const manager = await authAs(inst, "manager");
    const b = await seedDatedBooking(manager, { ref: "PEND", party: 2, ci: todayStr, co: plusDays(1) });
    const r = await api(inst, "POST", `/api/camp/checkout/${b.id}`, { token: manager });
    assert.equal(r.status, 400);
  });
});
