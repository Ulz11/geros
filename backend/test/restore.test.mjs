// v1.6 RESTORE DRILL - a backup that has never been restored is not a backup.
//
// Full round-trip against a real PocketBase, exercising the same mechanics
// deploy/restore.sh uses on the VPS (stop -> file-level restore -> start):
//   1. seed data, stop the server cleanly
//   2. take a backup (copy of pb_data)
//   3. restart, MUTATE the data (delete a ger, add junk), stop
//   4. restore the backup over pb_data
//   5. restart and verify the pre-backup state: deleted ger is back, junk gone

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startInstance, api, authAs, seedGer } from "./harness.mjs";

const PORT = 8103;
let dir = null;
let backupDir = null;

after(async () => {
  for (const d of [dir, backupDir]) {
    if (d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* locked */ } }
  }
});

test("backup -> mutate -> restore round-trip preserves the snapshot state", { timeout: 120000 }, async () => {
  // 1. fresh instance with data worth protecting
  const inst1 = await startInstance(PORT, {}, { keepDir: true });
  dir = inst1.dir;
  const manager = await authAs(inst1, "manager");
  const g1 = await seedGer(inst1, { code: "PRECIOUS", capacity: 2 });
  const bk = await api(inst1, "POST", "/api/collections/bookings/records", {
    token: manager,
    body: { ref: "BK-KEEP", party: 2, channel: "phone", status: "pending", guest_name: "Keep me", guides: 0, nights: 1 },
  });
  assert.ok(bk.ok);
  await inst1.stopProcess();

  // 2. the backup: a cold copy of pb_data (restore.sh restores exactly this shape)
  backupDir = mkdtempSync(join(tmpdir(), "geros-backup-"));
  cpSync(dir, backupDir, { recursive: true });

  // 3. disaster strikes: restart and wreck the data
  const inst2 = await startInstance(PORT, {}, { dir, keepDir: true });
  const manager2 = await authAs(inst2, "manager");
  const admin2 = await authAs(inst2, "admin");
  const del = await api(inst2, "DELETE", `/api/collections/gers/records/${g1.id}`, { token: admin2 });
  assert.ok(del.ok, "precious ger deleted (the disaster)");
  await api(inst2, "POST", "/api/collections/gers/records", {
    token: manager2,
    body: { code: "JUNK", capacity: 1, status: "available", x: 0, y: 0, bed_type: "1bed", name: "junk", features: [] },
  });
  await inst2.stopProcess();

  // 4. restore: wipe pb_data, put the backup back (what restore.sh does)
  rmSync(dir, { recursive: true, force: true });
  cpSync(backupDir, dir, { recursive: true });

  // 5. the moment of truth
  const inst3 = await startInstance(PORT, {}, { dir, keepDir: true });
  try {
    const manager3 = await authAs(inst3, "manager");
    const gers = (await api(inst3, "GET", "/api/collections/gers/records?perPage=50", { token: manager3 })).data;
    const codes = gers.items.map((g) => g.code);
    assert.ok(codes.includes("PRECIOUS"), "the deleted ger must be back: " + codes);
    assert.ok(!codes.includes("JUNK"), "post-backup junk must be gone: " + codes);
    const bks = (await api(inst3, "GET", "/api/collections/bookings/records?perPage=50", { token: manager3 })).data;
    assert.equal(bks.items.length, 1);
    assert.equal(bks.items[0].ref, "BK-KEEP");
  } finally {
    await inst3.stopProcess();
  }
});
