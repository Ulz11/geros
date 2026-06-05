// v1.7: CRM + pricing.
//   services      - the camp's price list (breakfast/lunch/dinner/guide/...)
//                   feeding the invoice generator
//   guests        - registry of incoming tourists (CRM), linked to bookings
//   operator_docs - documents inside an operator profile, organized in FOLDERS

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startInstance, api, authAs, wipe, listAudit } from "./harness.mjs";

let inst;
before(async () => { inst = await startInstance(8104); }, { timeout: 60000 });
after(async () => { if (inst) await inst.stop(); });
beforeEach(async () => { await wipe(inst); });

async function seedOperator(token) {
  const r = await api(inst, "POST", "/api/collections/tour_operators/records", {
    token, body: { name: "Тест Оператор", country: "Mongolia", contract_status: "signed" },
  });
  if (!r.ok) throw new Error("seedOperator: " + JSON.stringify(r.data));
  return r.data;
}

/* ---------------------------------------------------------------- */
describe("services price list", () => {
  test("manager can create a priced service; any authed role can read it", async () => {
    const manager = await authAs(inst, "manager");
    const r = await api(inst, "POST", "/api/collections/services/records", {
      token: manager,
      body: { name: "Өглөөний цай / Breakfast", category: "meal", price: 25000, unit: "per_person", active: true },
    });
    assert.ok(r.ok, JSON.stringify(r.data));
    assert.equal(r.data.price, 25000);
    // worker (creates invoiced bookings) and kitchen can read prices
    for (const role of ["worker", "kitchen"]) {
      const tok = await authAs(inst, role);
      const list = await api(inst, "GET", "/api/collections/services/records", { token: tok });
      assert.equal(list.data.items.length, 1, role + " should see the price list");
    }
  });

  test("kitchen and worker cannot create or change prices", async () => {
    const manager = await authAs(inst, "manager");
    const s = await api(inst, "POST", "/api/collections/services/records", {
      token: manager, body: { name: "Үдийн хоол / Lunch", category: "meal", price: 35000, unit: "per_person", active: true },
    });
    for (const role of ["kitchen", "worker"]) {
      const tok = await authAs(inst, role);
      const denied = await api(inst, "POST", "/api/collections/services/records", {
        token: tok, body: { name: "X", category: "other", price: 1, unit: "fixed", active: true },
      });
      assert.ok(denied.status >= 400, role + " must not create services");
      const patched = await api(inst, "PATCH", `/api/collections/services/records/${s.data.id}`, {
        token: tok, body: { price: 1 },
      });
      assert.ok(patched.status >= 400, role + " must not change prices");
    }
  });

  test("price changes are audited", async () => {
    const manager = await authAs(inst, "manager");
    const s = await api(inst, "POST", "/api/collections/services/records", {
      token: manager, body: { name: "Морин аялал / Horse trek", category: "activity", price: 90000, unit: "per_person", active: true },
    });
    await api(inst, "PATCH", `/api/collections/services/records/${s.data.id}`, { token: manager, body: { price: 95000 } });
    const audit = await listAudit(inst);
    const rows = audit.filter((a) => a.entity.startsWith("services:"));
    assert.ok(rows.some((a) => a.action === "created"), "service create audited");
    assert.ok(rows.some((a) => a.action === "updated"), "price change audited");
  });
});

/* ---------------------------------------------------------------- */
describe("guests CRM", () => {
  test("worker registers an incoming tourist linked to a booking", async () => {
    const manager = await authAs(inst, "manager");
    const op = await seedOperator(manager);
    const bk = await api(inst, "POST", "/api/collections/bookings/records", {
      token: manager,
      body: { ref: "BK-1", party: 2, channel: "operator", operator: op.id, status: "confirmed", guest_name: "Group", guides: 0, nights: 2 },
    });
    const worker = await authAs(inst, "worker");
    const g = await api(inst, "POST", "/api/collections/guests/records", {
      token: worker,
      body: { name: "Anna Fischer", country: "Germany", passport_no: "C01X00T47",
        booking: bk.data.id, operator: op.id, phone: "+49 170 000", notes: "vegetarian" },
    });
    assert.ok(g.ok, JSON.stringify(g.data));
    // expand resolves the relations
    const got = await api(inst, "GET", `/api/collections/guests/records/${g.data.id}?expand=booking,operator`, { token: worker });
    assert.equal(got.data.expand.booking.ref, "BK-1");
    assert.equal(got.data.expand.operator.name, "Тест Оператор");
  });

  test("kitchen can neither read nor write guest data", async () => {
    const manager = await authAs(inst, "manager");
    await api(inst, "POST", "/api/collections/guests/records", {
      token: manager, body: { name: "Private Person", country: "France" },
    });
    const kitchen = await authAs(inst, "kitchen");
    const list = await api(inst, "GET", "/api/collections/guests/records", { token: kitchen });
    assert.ok(!(list.data?.items?.length), "kitchen must not see guests");
    const denied = await api(inst, "POST", "/api/collections/guests/records", {
      token: kitchen, body: { name: "X" },
    });
    assert.ok(denied.status >= 400, "kitchen must not register guests");
  });

  test("guest registration is audited", async () => {
    const worker = await authAs(inst, "worker");
    await api(inst, "POST", "/api/collections/guests/records", {
      token: worker, body: { name: "Audited Guest", country: "Japan" },
    });
    const audit = await listAudit(inst);
    const row = audit.find((a) => a.entity.startsWith("guests:") && a.action === "created");
    assert.ok(row, "guest create must be audited");
    assert.equal(row.user, "Test worker");
  });
});

/* ---------------------------------------------------------------- */
describe("operator document folders", () => {
  test("manager files a document into a folder on an operator profile", async () => {
    const manager = await authAs(inst, "manager");
    const op = await seedOperator(manager);

    // multipart with a real file (Node fetch FormData)
    const fd = new FormData();
    fd.append("operator", op.id);
    fd.append("folder", "Гэрээ / Contracts");
    fd.append("title", "2026 season contract");
    fd.append("file", new Blob([Buffer.from("%PDF-1.4 fake contract")], { type: "application/pdf" }), "contract-2026.pdf");
    const res = await fetch(`${inst.baseUrl}/api/collections/operator_docs/records`, {
      method: "POST", headers: { Authorization: manager }, body: fd,
    });
    const doc = await res.json();
    assert.equal(res.status, 200, JSON.stringify(doc));
    assert.equal(doc.folder, "Гэрээ / Contracts");
    assert.equal(doc.file.length, 1, "multi-file field stores an array");
    assert.match(doc.file[0], /contract/i);

    // folder filtering works (the UI groups by this)
    const inFolder = await api(inst, "GET",
      `/api/collections/operator_docs/records?filter=${encodeURIComponent(`operator='${op.id}' && folder='Гэрээ / Contracts'`)}`,
      { token: manager });
    assert.equal(inFolder.data.items.length, 1);
  });

  test("worker cannot file or delete operator documents; admin can delete", async () => {
    const manager = await authAs(inst, "manager");
    const op = await seedOperator(manager);
    const doc = await api(inst, "POST", "/api/collections/operator_docs/records", {
      token: manager, body: { operator: op.id, folder: "Invoices", title: "note only" },
    });
    assert.ok(doc.ok, JSON.stringify(doc.data));
    const worker = await authAs(inst, "worker");
    const denied = await api(inst, "POST", "/api/collections/operator_docs/records", {
      token: worker, body: { operator: op.id, folder: "X", title: "nope" },
    });
    assert.ok(denied.status >= 400, "worker must not file operator docs");
    const delDenied = await api(inst, "DELETE", `/api/collections/operator_docs/records/${doc.data.id}`, { token: manager });
    assert.ok(delDenied.status >= 400, "manager must not delete (admin only)");
    const admin = await authAs(inst, "admin");
    const ok = await api(inst, "DELETE", `/api/collections/operator_docs/records/${doc.data.id}`, { token: admin });
    assert.ok(ok.ok, "admin delete should succeed");
  });
});
