// Integration tests for the GerOS PocketBase hooks + API rules.
// Run: node --test   (from backend/)  -- needs the bundled pocketbase.exe present.
//
// These tests exercise the three custom endpoints (recommend / assign /
// public-booking), the audit trail, and the server-side role gating against a
// real, running PocketBase. The audit + recommend/assign tests are the
// regression guard for the JSVM "helpers not in scope" bug.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startInstance, api, authAs, wipe, seedGer, seedBooking, listAudit,
} from "./harness.mjs";

let inst;
before(async () => { inst = await startInstance(); }, { timeout: 60000 });
after(async () => { if (inst) await inst.stop(); });
beforeEach(async () => { await wipe(inst); });

/* ---------------------------------------------------------------- */
describe("smart allocation  GET /api/camp/recommend/{id}", () => {
  test("requires auth", async () => {
    const b = await seedBooking(inst, { ref: "B1", party: 2 });
    const r = await api(inst, "GET", `/api/camp/recommend/${b.id}`);
    assert.equal(r.status, 401);
  });

  test("picks the tightest single ger that fits", async () => {
    await seedGer(inst, { code: "S2", capacity: 2, x: 0, y: 0 });
    await seedGer(inst, { code: "S4", capacity: 4, x: 50, y: 0 });
    const b = await seedBooking(inst, { ref: "B1", party: 2 });
    const token = await authAs(inst, "manager");
    const r = await api(inst, "GET", `/api/camp/recommend/${b.id}`, { token });
    assert.equal(r.status, 200);
    assert.equal(r.data.gers.length, 1);
    assert.equal(r.data.gers[0].code, "S2");
    assert.equal(r.data.waste, 0);
  });

  test("ignores gers that are not available", async () => {
    await seedGer(inst, { code: "BUSY", capacity: 2, status: "occupied" });
    await seedGer(inst, { code: "CLEAN", capacity: 2, status: "cleaning" });
    await seedGer(inst, { code: "OK4", capacity: 4, status: "available" });
    const b = await seedBooking(inst, { ref: "B1", party: 2 });
    const token = await authAs(inst, "manager");
    const r = await api(inst, "GET", `/api/camp/recommend/${b.id}`, { token });
    assert.deepEqual(r.data.gers.map((g) => g.code), ["OK4"]);
  });

  test("combines multiple gers when no single one is big enough", async () => {
    await seedGer(inst, { code: "A4", capacity: 4, x: 0, y: 0 });
    await seedGer(inst, { code: "B4", capacity: 4, x: 10, y: 0 });
    await seedGer(inst, { code: "C2", capacity: 2, x: 999, y: 999 });
    const b = await seedBooking(inst, { ref: "B1", party: 6 });
    const token = await authAs(inst, "manager");
    const r = await api(inst, "GET", `/api/camp/recommend/${b.id}`, { token });
    assert.equal(r.status, 200);
    const total = r.data.gers.length;
    assert.ok(total >= 2, "should pick at least two gers");
    // largest-first then nearest neighbour: A4 + B4 cover 6 and are adjacent
    assert.deepEqual(r.data.gers.map((g) => g.code).sort(), ["A4", "B4"]);
  });

  test("returns no gers when capacity is insufficient", async () => {
    await seedGer(inst, { code: "TINY", capacity: 2 });
    const b = await seedBooking(inst, { ref: "B1", party: 10 });
    const token = await authAs(inst, "manager");
    const r = await api(inst, "GET", `/api/camp/recommend/${b.id}`, { token });
    assert.equal(r.status, 200);
    assert.equal(r.data.gers.length, 0);
  });
});

/* ---------------------------------------------------------------- */
describe("assign  POST /api/camp/assign/{id}", () => {
  test("occupies gers, confirms booking, creates a numbered invoice, audits once", async () => {
    const g = await seedGer(inst, { code: "G1", capacity: 2 });
    const b = await seedBooking(inst, { ref: "BK-1", party: 2 });
    const token = await authAs(inst, "manager");

    const r = await api(inst, "POST", `/api/camp/assign/${b.id}`, { token });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.deepEqual(r.data.gers, ["G1"]);
    assert.match(r.data.invoice, /^INV-\d{4}-001$/);

    // ger now occupied + tagged with the booking ref
    const ger = (await api(inst, "GET", `/api/collections/gers/records/${g.id}`, { token })).data;
    assert.equal(ger.status, "occupied");
    assert.equal(ger.current_booking, "BK-1");
    // booking confirmed + linked
    const bk = (await api(inst, "GET", `/api/collections/bookings/records/${b.id}`, { token })).data;
    assert.equal(bk.status, "confirmed");
    assert.deepEqual(bk.assigned_gers, [g.id]);
    // invoice exists
    const inv = (await api(inst, "GET", `/api/collections/invoices/records?filter=(booking_ref='BK-1')`, { token })).data;
    assert.equal(inv.items.length, 1);
    // exactly one assign audit row, attributed to the acting user + role
    const audit = await listAudit(inst);
    const assigned = audit.filter((a) => a.action === "assigned");
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].role, "manager");
    assert.equal(assigned[0].user, "Test manager");
  });

  test("invoice numbers increase sequentially across assigns", async () => {
    const token = await authAs(inst, "manager");
    await seedGer(inst, { code: "G1", capacity: 2 });
    await seedGer(inst, { code: "G2", capacity: 2 });
    const b1 = await seedBooking(inst, { ref: "BK-1", party: 2 });
    const b2 = await seedBooking(inst, { ref: "BK-2", party: 2 });
    const r1 = await api(inst, "POST", `/api/camp/assign/${b1.id}`, { token });
    const r2 = await api(inst, "POST", `/api/camp/assign/${b2.id}`, { token });
    assert.match(r1.data.invoice, /-001$/);
    assert.match(r2.data.invoice, /-002$/);
  });

  test("rejects a booking that is not pending", async () => {
    await seedGer(inst, { code: "G1", capacity: 2 });
    const b = await seedBooking(inst, { ref: "BK-1", party: 2, status: "confirmed" });
    const token = await authAs(inst, "manager");
    const r = await api(inst, "POST", `/api/camp/assign/${b.id}`, { token });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.data), /not pending/);
  });

  test("returns 400 when nothing fits", async () => {
    await seedGer(inst, { code: "TINY", capacity: 1 });
    const b = await seedBooking(inst, { ref: "BK-1", party: 9 });
    const token = await authAs(inst, "manager");
    const r = await api(inst, "POST", `/api/camp/assign/${b.id}`, { token });
    assert.equal(r.status, 400);
  });

  test("kitchen role is forbidden from assigning", async () => {
    await seedGer(inst, { code: "G1", capacity: 2 });
    const b = await seedBooking(inst, { ref: "BK-1", party: 2 });
    const token = await authAs(inst, "kitchen");
    const r = await api(inst, "POST", `/api/camp/assign/${b.id}`, { token });
    assert.equal(r.status, 403);
    // and nothing happened: booking still pending
    const su = await authAs(inst, "admin");
    const bk = (await api(inst, "GET", `/api/collections/bookings/records/${b.id}`, { token: su })).data;
    assert.equal(bk.status, "pending");
  });
});

/* ---------------------------------------------------------------- */
describe("public booking  POST /api/camp/public-booking", () => {
  const good = () => ({
    guest_name: "Jane Traveller", email: "jane@example.com", party: 2,
    check_in: "2026-09-01", check_out: "2026-09-04", website: "",
  });

  test("creates a pending website-channel booking", async () => {
    const r = await api(inst, "POST", "/api/camp/public-booking", { body: good() });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.match(r.data.ref, /^BK-W/);
    const su = await authAs(inst, "admin");
    const list = (await api(inst, "GET", `/api/collections/bookings/records?filter=(ref='${r.data.ref}')`, { token: su })).data;
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].channel, "website");
    assert.equal(list.items[0].status, "pending");
  });

  test("honeypot field is silently dropped (no booking created)", async () => {
    const r = await api(inst, "POST", "/api/camp/public-booking", { body: { ...good(), website: "http://spam" } });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.equal(r.data.ref, undefined);
    const su = await authAs(inst, "admin");
    const all = (await api(inst, "GET", "/api/collections/bookings/records", { token: su })).data;
    assert.equal(all.items.length, 0);
  });

  test("rejects a too-short name", async () => {
    const r = await api(inst, "POST", "/api/camp/public-booking", { body: { ...good(), guest_name: "x" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "name");
  });

  test("rejects when no usable contact is given", async () => {
    const r = await api(inst, "POST", "/api/camp/public-booking", { body: { ...good(), email: "", phone: "" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "contact");
  });

  test("rejects an out-of-range party size", async () => {
    const r = await api(inst, "POST", "/api/camp/public-booking", { body: { ...good(), party: 99 } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "party");
  });

  test("rejects check_out on/before check_in", async () => {
    const r = await api(inst, "POST", "/api/camp/public-booking", { body: { ...good(), check_in: "2026-09-04", check_out: "2026-09-04" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "dates");
  });

  test("rejects a check_in in the past", async () => {
    const r = await api(inst, "POST", "/api/camp/public-booking", { body: { ...good(), check_in: "2000-01-01", check_out: "2000-01-03" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "dates");
  });
});

/* ---------------------------------------------------------------- */
describe("audit trail (regression guard for the JSVM scoping bug)", () => {
  test("an authed create on an audited collection writes one attributable row", async () => {
    const token = await authAs(inst, "manager");
    const r = await api(inst, "POST", "/api/collections/gers/records", {
      token, body: { code: "AUD1", name: "AUD1", capacity: 2, status: "available", x: 0, y: 0, bed_type: "2bed" },
    });
    assert.ok(r.ok, "create should succeed");
    const audit = await listAudit(inst);
    const row = audit.find((a) => a.entity === "gers:AUD1" && a.action === "created");
    assert.ok(row, "expected an audit row for the create");
    assert.equal(row.role, "manager");
    assert.equal(row.user, "Test manager");
  });

  test("update and delete are audited with the right action", async () => {
    const token = await authAs(inst, "manager");
    const g = await seedGer(inst, { code: "AUD2", capacity: 2 });
    await api(inst, "PATCH", `/api/collections/gers/records/${g.id}`, { token, body: { status: "cleaning" } });
    const admin = await authAs(inst, "admin");
    await api(inst, "DELETE", `/api/collections/gers/records/${g.id}`, { token: admin });
    const audit = await listAudit(inst);
    const actions = audit.filter((a) => a.entity === "gers:AUD2").map((a) => a.action);
    assert.ok(actions.includes("updated"), "update should be audited");
    assert.ok(actions.includes("deleted"), "delete should be audited");
  });
});

/* ---------------------------------------------------------------- */
describe("server-side role gating (API rules)", () => {
  test("worker cannot delete a ger; admin can", async () => {
    const g = await seedGer(inst, { code: "DEL1", capacity: 2 });
    const worker = await authAs(inst, "worker");
    const denied = await api(inst, "DELETE", `/api/collections/gers/records/${g.id}`, { token: worker });
    assert.ok(denied.status >= 400, "worker delete should be rejected");
    const admin = await authAs(inst, "admin");
    const ok = await api(inst, "DELETE", `/api/collections/gers/records/${g.id}`, { token: admin });
    assert.ok(ok.ok, "admin delete should succeed");
  });

  test("kitchen cannot create a booking; worker can", async () => {
    const kitchen = await authAs(inst, "kitchen");
    const denied = await api(inst, "POST", "/api/collections/bookings/records", {
      token: kitchen, body: { ref: "K1", party: 2, channel: "phone", status: "pending" },
    });
    assert.ok(denied.status >= 400, "kitchen create booking should be rejected");
    const worker = await authAs(inst, "worker");
    const ok = await api(inst, "POST", "/api/collections/bookings/records", {
      token: worker, body: { ref: "W1", party: 2, channel: "phone", status: "pending" },
    });
    assert.ok(ok.ok, "worker create booking should succeed");
  });

  test("worker cannot read the audit log; manager can", async () => {
    const token = await authAs(inst, "manager");
    await seedGer(inst, { code: "X", capacity: 2 }); // generate at least one audit row via a manager write
    await api(inst, "POST", "/api/collections/gers/records", {
      token, body: { code: "Y", name: "Y", capacity: 2, status: "available", x: 0, y: 0, bed_type: "2bed" },
    });
    const worker = await authAs(inst, "worker");
    const w = await api(inst, "GET", "/api/collections/audit_log/records", { token: worker });
    // list-rule failure yields an empty/forbidden result, never the rows
    assert.ok(!(w.data?.items?.length), "worker must not see audit rows");
    const mgr = await api(inst, "GET", "/api/collections/audit_log/records", { token });
    assert.ok(mgr.data.items.length >= 1, "manager should see audit rows");
  });
});
