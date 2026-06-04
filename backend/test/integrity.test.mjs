// Core integrity (v1.4) - findings from the core audit:
//   1. audit_log createRule allowed ANY authed user to POST forged audit rows
//      with arbitrary user/role text -> the trail was spoofable. Locked to
//      hooks-only (rules null); programmatic hook writes bypass rules.
//   2. assign had a read-check-write race: two concurrent assigns could both
//      see a ger as free and double-book it. Now the read + writes run inside
//      one DB transaction, so overlapping assigns serialize.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startInstance, api, authAs, wipe, seedGer, listAudit } from "./harness.mjs";

let inst;
before(async () => { inst = await startInstance(8101); }, { timeout: 60000 });
after(async () => { if (inst) await inst.stop(); });
beforeEach(async () => { await wipe(inst); });

const D = (s) => s + " 00:00:00.000Z";

describe("audit log cannot be forged", () => {
  test("no role can POST audit rows through the API", async () => {
    for (const role of ["worker", "kitchen", "manager", "admin"]) {
      const token = await authAs(inst, role);
      const r = await api(inst, "POST", "/api/collections/audit_log/records", {
        token,
        body: { user: "Администратор", role: "admin", action: "deleted", entity: "invoices:INV-2026-001", detail: "forged" },
      });
      assert.ok(r.status >= 400, `${role} must not be able to forge audit rows (got ${r.status})`);
    }
  });

  test("hook-written audit rows still work after the lockdown", async () => {
    const manager = await authAs(inst, "manager");
    await api(inst, "POST", "/api/collections/gers/records", {
      token: manager,
      body: { code: "AUD", name: "AUD", capacity: 2, status: "available", x: 0, y: 0, bed_type: "2bed" },
    });
    const audit = await listAudit(inst);
    assert.ok(audit.find((a) => a.entity === "gers:AUD" && a.action === "created"),
      "the hook must still write audit rows (it bypasses API rules)");
  });
});

describe("concurrent assigns cannot double-book", () => {
  test("six parallel overlapping assigns on one ger: exactly one wins", async () => {
    const manager = await authAs(inst, "manager");
    await seedGer(inst, { code: "ONLY", capacity: 2 });
    const bookings = [];
    for (let i = 0; i < 6; i++) {
      const r = await api(inst, "POST", "/api/collections/bookings/records", {
        token: manager,
        body: { ref: `RACE-${i}`, party: 2, channel: "phone", status: "pending", guest_name: `r${i}`,
          guides: 0, nights: 3, check_in: D("2026-09-10"), check_out: D("2026-09-13") },
      });
      bookings.push(r.data);
    }
    const results = await Promise.all(
      bookings.map((b) => api(inst, "POST", `/api/camp/assign/${b.id}`, { token: manager }))
    );
    const wins = results.filter((r) => r.status === 200);
    const losses = results.filter((r) => r.status === 400);
    assert.equal(wins.length, 1, `exactly one assign may win, got ${results.map((r) => r.status)}`);
    assert.equal(losses.length, 5);
    // and exactly one invoice was created
    const inv = (await api(inst, "GET", "/api/collections/invoices/records?perPage=50", { token: manager })).data;
    assert.equal(inv.items.length, 1, "one winner -> one invoice");
  });
});

describe("invoice numbering is gap-proof", () => {
  test("deleting an old invoice never causes a number collision", async () => {
    const manager = await authAs(inst, "manager");
    const admin = await authAs(inst, "admin");
    await seedGer(inst, { code: "G1", capacity: 2 });
    await seedGer(inst, { code: "G2", capacity: 2 });
    await seedGer(inst, { code: "G3", capacity: 2 });
    const mk = async (i, ci, co) => (await api(inst, "POST", "/api/collections/bookings/records", {
      token: manager,
      body: { ref: `BK-${i}`, party: 2, channel: "phone", status: "pending", guest_name: `g${i}`,
        guides: 0, nights: 1, check_in: D(ci), check_out: D(co) },
    })).data;
    const b1 = await mk(1, "2026-09-01", "2026-09-02");
    const b2 = await mk(2, "2026-09-03", "2026-09-04");
    const r1 = await api(inst, "POST", `/api/camp/assign/${b1.id}`, { token: manager }); // INV-...-001
    const r2 = await api(inst, "POST", `/api/camp/assign/${b2.id}`, { token: manager }); // INV-...-002
    assert.match(r1.data.invoice, /-001$/);
    assert.match(r2.data.invoice, /-002$/);
    // delete invoice 001 - count-based numbering would now reissue "002" and collide
    const inv1 = (await api(inst, "GET", `/api/collections/invoices/records?filter=(number~'%25001')`, { token: admin })).data.items[0];
    await api(inst, "DELETE", `/api/collections/invoices/records/${inv1.id}`, { token: admin });
    const b3 = await mk(3, "2026-09-05", "2026-09-06");
    const r3 = await api(inst, "POST", `/api/camp/assign/${b3.id}`, { token: manager });
    assert.equal(r3.status, 200, JSON.stringify(r3.data));
    assert.match(r3.data.invoice, /-003$/, "max+1, not count+1: " + r3.data.invoice);
  });
});
