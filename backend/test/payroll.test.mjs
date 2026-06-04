// Payroll (v1.2): staff registry + monthly wage payments.
// Wages are sensitive - only admin/manager may even read them. The unique
// (staff, period) index is the double-pay guard. Both collections are audited.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startInstance, api, authAs, wipe, listAudit } from "./harness.mjs";

let inst;
before(async () => { inst = await startInstance(8099); }, { timeout: 60000 });
after(async () => { if (inst) await inst.stop(); });
beforeEach(async () => { await wipe(inst); });

async function createStaff(token, over = {}) {
  return api(inst, "POST", "/api/collections/staff/records", {
    token,
    body: { name: "Бат Дорж", title: "Cook", phone: "+976 9900 0000",
      monthly_wage: 1500000, active: true, ...over },
  });
}

describe("payroll: provisioning", () => {
  test("staff and wage_payments collections exist with the expected fields", async () => {
    const su = await authAs(inst, "admin"); // any authed role can't read collections meta; use records probe via manager
    const manager = await authAs(inst, "manager");
    const s = await api(inst, "GET", "/api/collections/staff/records", { token: manager });
    assert.equal(s.status, 200, "staff collection should exist and be listable by manager");
    const w = await api(inst, "GET", "/api/collections/wage_payments/records", { token: manager });
    assert.equal(w.status, 200, "wage_payments collection should exist and be listable by manager");
    void su;
  });
});

describe("payroll: role gating (wages are sensitive)", () => {
  test("manager can create staff and a wage payment", async () => {
    const manager = await authAs(inst, "manager");
    const st = await createStaff(manager);
    assert.ok(st.ok, "manager should create staff: " + JSON.stringify(st.data));
    const pay = await api(inst, "POST", "/api/collections/wage_payments/records", {
      token: manager,
      body: { staff: st.data.id, period: "2026-06", amount: 1500000, bonus: 100000, deduction: 0, paid_on: "2026-06-30 00:00:00.000Z" },
    });
    assert.ok(pay.ok, "manager should create wage payment: " + JSON.stringify(pay.data));
  });

  test("kitchen and worker can neither read nor write staff or wages", async () => {
    const manager = await authAs(inst, "manager");
    const st = await createStaff(manager);
    await api(inst, "POST", "/api/collections/wage_payments/records", {
      token: manager, body: { staff: st.data.id, period: "2026-06", amount: 1500000 },
    });
    for (const role of ["kitchen", "worker"]) {
      const tok = await authAs(inst, role);
      const list = await api(inst, "GET", "/api/collections/staff/records", { token: tok });
      assert.ok(!(list.data?.items?.length), `${role} must not see staff rows`);
      const wlist = await api(inst, "GET", "/api/collections/wage_payments/records", { token: tok });
      assert.ok(!(wlist.data?.items?.length), `${role} must not see wage rows`);
      const denied = await createStaff(tok, { name: "X" });
      assert.ok(denied.status >= 400, `${role} must not create staff`);
      const wdenied = await api(inst, "POST", "/api/collections/wage_payments/records", {
        token: tok, body: { staff: st.data.id, period: "2026-07", amount: 1 },
      });
      assert.ok(wdenied.status >= 400, `${role} must not create wage payments`);
    }
  });

  test("only admin can delete staff", async () => {
    const manager = await authAs(inst, "manager");
    const st = await createStaff(manager);
    const denied = await api(inst, "DELETE", `/api/collections/staff/records/${st.data.id}`, { token: manager });
    assert.ok(denied.status >= 400, "manager delete should be rejected");
    const admin = await authAs(inst, "admin");
    const ok = await api(inst, "DELETE", `/api/collections/staff/records/${st.data.id}`, { token: admin });
    assert.ok(ok.ok, "admin delete should succeed");
  });
});

describe("payroll: double-pay guard", () => {
  test("a second payment for the same staff + period is rejected", async () => {
    const manager = await authAs(inst, "manager");
    const st = await createStaff(manager);
    const p1 = await api(inst, "POST", "/api/collections/wage_payments/records", {
      token: manager, body: { staff: st.data.id, period: "2026-06", amount: 1500000 },
    });
    assert.ok(p1.ok, "first payment should succeed");
    const p2 = await api(inst, "POST", "/api/collections/wage_payments/records", {
      token: manager, body: { staff: st.data.id, period: "2026-06", amount: 1500000 },
    });
    assert.ok(p2.status >= 400, "duplicate (staff, period) must be rejected");
    // a different month is fine
    const p3 = await api(inst, "POST", "/api/collections/wage_payments/records", {
      token: manager, body: { staff: st.data.id, period: "2026-07", amount: 1500000 },
    });
    assert.ok(p3.ok, "next month's payment should succeed");
  });
});

describe("payroll: audit trail", () => {
  test("creating staff and a wage payment writes attributable audit rows", async () => {
    const manager = await authAs(inst, "manager");
    const st = await createStaff(manager);
    await api(inst, "POST", "/api/collections/wage_payments/records", {
      token: manager, body: { staff: st.data.id, period: "2026-06", amount: 1500000 },
    });
    const audit = await listAudit(inst);
    const staffRow = audit.find((a) => a.entity.startsWith("staff:") && a.action === "created");
    const wageRow = audit.find((a) => a.entity.startsWith("wage_payments:") && a.action === "created");
    assert.ok(staffRow, "staff create should be audited");
    assert.ok(wageRow, "wage payment create should be audited");
    assert.equal(wageRow.user, "Test manager");
    assert.equal(wageRow.role, "manager");
  });
});
