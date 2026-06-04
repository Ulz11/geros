// v1.5: GET /api/camp/availability?from=YYYY-MM-DD&days=N
// One call feeding the calendar view: every ger + its active reservations
// (confirmed / checked_in) that overlap the window. Pending bookings aren't
// allocated yet and cancelled ones are dead - neither may appear.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startInstance, api, authAs, wipe, seedGer } from "./harness.mjs";

let inst;
before(async () => { inst = await startInstance(8102); }, { timeout: 60000 });
after(async () => { if (inst) await inst.stop(); });
beforeEach(async () => { await wipe(inst); });

const D = (s) => s + " 00:00:00.000Z";
const todayStr = new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function seedAssigned(token, { ref, gerIds, ci, co, status }) {
  const r = await api(inst, "POST", "/api/collections/bookings/records", {
    token,
    body: { ref, party: 2, channel: "phone", status, guest_name: "Guest " + ref, guides: 0,
      nights: 1, check_in: D(ci), check_out: D(co), assigned_gers: gerIds },
  });
  if (!r.ok) throw new Error("seedAssigned failed: " + JSON.stringify(r.data));
  return r.data;
}

describe("availability endpoint", () => {
  test("requires auth", async () => {
    const r = await api(inst, "GET", "/api/camp/availability?from=2026-09-01&days=14");
    assert.equal(r.status, 401);
  });

  test("returns every ger with its overlapping active reservations", async () => {
    const manager = await authAs(inst, "manager");
    const g1 = await seedGer(inst, { code: "G1", capacity: 2 });
    const g2 = await seedGer(inst, { code: "G2", capacity: 4 });
    await seedAssigned(manager, { ref: "RES", gerIds: [g1.id], ci: "2026-09-10", co: "2026-09-13", status: "confirmed" });

    const r = await api(inst, "GET", "/api/camp/availability?from=2026-09-08&days=14", { token: manager });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.from, "2026-09-08");
    assert.equal(r.data.days, 14);
    assert.equal(r.data.gers.length, 2);
    const a = r.data.gers.find((g) => g.code === "G1");
    const b = r.data.gers.find((g) => g.code === "G2");
    assert.equal(a.bookings.length, 1);
    assert.equal(a.bookings[0].ref, "RES");
    assert.equal(a.bookings[0].status, "confirmed");
    assert.equal(a.bookings[0].check_in, "2026-09-10");
    assert.equal(a.bookings[0].check_out, "2026-09-13");
    assert.equal(b.bookings.length, 0);
    void g2;
  });

  test("checked_in bookings appear with their status; the window is live", async () => {
    const manager = await authAs(inst, "manager");
    const g1 = await seedGer(inst, { code: "G1", capacity: 2, status: "occupied" });
    await seedAssigned(manager, { ref: "NOW", gerIds: [g1.id], ci: todayStr, co: plusDays(2), status: "checked_in" });
    const r = await api(inst, "GET", `/api/camp/availability?from=${todayStr}&days=7`, { token: manager });
    const a = r.data.gers.find((g) => g.code === "G1");
    assert.equal(a.status, "occupied", "physical status rides along for the map dot");
    assert.equal(a.bookings.length, 1);
    assert.equal(a.bookings[0].status, "checked_in");
  });

  test("pending and cancelled bookings never appear", async () => {
    const manager = await authAs(inst, "manager");
    const g1 = await seedGer(inst, { code: "G1", capacity: 2 });
    await seedAssigned(manager, { ref: "PEND", gerIds: [g1.id], ci: "2026-09-10", co: "2026-09-12", status: "pending" });
    await seedAssigned(manager, { ref: "DEAD", gerIds: [g1.id], ci: "2026-09-10", co: "2026-09-12", status: "cancelled" });
    const r = await api(inst, "GET", "/api/camp/availability?from=2026-09-08&days=14", { token: manager });
    assert.equal(r.data.gers.find((g) => g.code === "G1").bookings.length, 0);
  });

  test("a reservation straddling the window start is still returned", async () => {
    const manager = await authAs(inst, "manager");
    const g1 = await seedGer(inst, { code: "G1", capacity: 2 });
    await seedAssigned(manager, { ref: "STRADDLE", gerIds: [g1.id], ci: "2026-09-05", co: "2026-09-10", status: "confirmed" });
    const r = await api(inst, "GET", "/api/camp/availability?from=2026-09-08&days=7", { token: manager });
    const a = r.data.gers.find((g) => g.code === "G1");
    assert.equal(a.bookings.length, 1);
    assert.equal(a.bookings[0].ref, "STRADDLE");
  });

  test("validates from and clamps days", async () => {
    const manager = await authAs(inst, "manager");
    const bad = await api(inst, "GET", "/api/camp/availability?from=garbage", { token: manager });
    assert.equal(bad.status, 400);
    const huge = await api(inst, "GET", "/api/camp/availability?from=2026-09-01&days=9999", { token: manager });
    assert.equal(huge.status, 200);
    assert.ok(huge.data.days <= 120, "days must be clamped, got " + huge.data.days);
    const dflt = await api(inst, "GET", "/api/camp/availability?from=2026-09-01", { token: manager });
    assert.equal(dflt.data.days, 28);
  });
});
