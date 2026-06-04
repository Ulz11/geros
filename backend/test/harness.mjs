// Integration test harness for GerOS.
//
// Spins up an ISOLATED PocketBase instance (its own temp pb_data, its own port)
// running the REAL backend/pb_hooks, imports the real pb_schema.json, patches the
// users collection exactly like the README requires, and creates one user per
// role. No external deps - just the bundled pocketbase.exe + Node's fetch.
//
// Exposed: startInstance(), and per-instance helpers (api, authAs, wipe, seedGer...).

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BACKEND = join(import.meta.dirname, "..");
const PB = join(BACKEND, process.platform === "win32" ? "pocketbase.exe" : "pocketbase");
const HOOKS = join(BACKEND, "pb_hooks");
const MIGRATIONS = join(BACKEND, "pb_migrations");

export const SU = { email: "su@test.local", pass: "test-superuser-9000" };
export const USER_PASS = "test-user-pass-9000";
export const ROLES = ["admin", "manager", "kitchen", "worker"];

// business collections audited by the hooks, wiped between tests; audit_log is
// wiped LAST because deleting these (even as superuser) fires the audit hook.
// wage_payments before staff (relation).
const BIZ = ["bookings", "invoices", "kitchen_txns", "tour_operators", "wage_payments", "staff", "gers"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(baseUrl, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error("PocketBase did not become healthy in time");
}

export async function startInstance(port = 8097, env = {}) {
  if (!existsSync(PB)) throw new Error(`pocketbase binary not found at ${PB}`);
  const dir = mkdtempSync(join(tmpdir(), "geros-test-"));
  const baseUrl = `http://127.0.0.1:${port}`;

  // superuser must exist before serve so we can authenticate for the schema import
  execFileSync(PB, ["superuser", "upsert", SU.email, SU.pass, "--dir", dir], { stdio: "ignore" });

  // --migrationsDir provisions the DB on first boot exactly like production:
  // the suite therefore verifies the real self-provisioning path, not a
  // test-only schema import. Default the public-booking rate limit very high so
  // functional tests never trip it; the dedicated limiter test overrides it.
  const proc = spawn(
    PB,
    ["serve", `--http=127.0.0.1:${port}`, "--dir", dir, "--migrationsDir", MIGRATIONS, "--hooksDir", HOOKS],
    { stdio: "ignore", env: { ...process.env, GEROS_PUBBOOK_MAX: "100000", ...env } },
  );

  const inst = {
    baseUrl,
    proc,
    dir,
    tokens: {}, // role -> token cache
    async stop() {
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
        } else {
          proc.kill("SIGKILL");
        }
      } catch { /* already gone */ }
      await sleep(200);
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* locked, leave it */ }
    },
  };

  await waitForHealth(baseUrl);
  await bootstrap(inst);
  return inst;
}

// raw API call. token may be a JWT string or null.
export async function api(inst, method, path, { token = null, body = null } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = token;
  const res = await fetch(`${inst.baseUrl}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, ok: res.ok, data };
}

async function superuserToken(inst) {
  if (inst.tokens.__su) return inst.tokens.__su;
  const r = await api(inst, "POST", "/api/collections/_superusers/auth-with-password", {
    body: { identity: SU.email, password: SU.pass },
  });
  if (!r.data?.token) throw new Error("superuser auth failed: " + JSON.stringify(r.data));
  return (inst.tokens.__su = r.data.token);
}

export async function authAs(inst, role) {
  const r = await api(inst, "POST", "/api/collections/users/auth-with-password", {
    body: { identity: `${role}@test.local`, password: USER_PASS },
  });
  if (!r.data?.token) throw new Error(`auth as ${role} failed: ` + JSON.stringify(r.data));
  return r.data.token;
}

async function bootstrap(inst) {
  // The schema + users patch are applied by pb_migrations on boot (production
  // path). Sanity-check that provisioning actually happened, then seed test users.
  const su = await superuserToken(inst);
  const users = (await api(inst, "GET", "/api/collections/users", { token: su })).data;
  const hasRole = users?.fields?.some((f) => f.name === "role");
  if (!hasRole) throw new Error("migration did not provision the users.role field - bad bootstrap");

  // one user per role (test fixtures only - production creates these via the UI)
  for (const role of ROLES) {
    const r = await api(inst, "POST", "/api/collections/users/records", {
      token: su,
      body: {
        email: `${role}@test.local`, password: USER_PASS, passwordConfirm: USER_PASS,
        role, full_name: `Test ${role}`, emailVisibility: true, verified: true,
      },
    });
    if (!r.ok) throw new Error(`create ${role} user failed: ` + JSON.stringify(r.data));
  }
}

// delete every record in the business + audit collections (superuser bypasses rules)
export async function wipe(inst) {
  const su = await superuserToken(inst);
  for (const col of [...BIZ, "audit_log"]) {
    // page through and delete; small data in tests so one pass is plenty
    const list = await api(inst, "GET", `/api/collections/${col}/records?perPage=500`, { token: su });
    for (const rec of list.data?.items || []) {
      await api(inst, "DELETE", `/api/collections/${col}/records/${rec.id}`, { token: su });
    }
  }
  // the deletes above re-created audit rows (delete fires the audit hook); clear them
  const leftover = await api(inst, "GET", `/api/collections/audit_log/records?perPage=500`, { token: su });
  for (const rec of leftover.data?.items || []) {
    await api(inst, "DELETE", `/api/collections/audit_log/records/${rec.id}`, { token: su });
  }
}

// create a ger as superuser (no audit noise from a role user); returns the record
export async function seedGer(inst, { code, capacity, status = "available", x = 0, y = 0, bed_type = "2bed" }) {
  const su = await superuserToken(inst);
  const r = await api(inst, "POST", "/api/collections/gers/records", {
    token: su, body: { code, name: code, capacity, status, x, y, bed_type, features: [] },
  });
  if (!r.ok) throw new Error("seedGer failed: " + JSON.stringify(r.data));
  return r.data;
}

// create a pending booking as superuser; returns the record
export async function seedBooking(inst, { ref, party, channel = "phone", status = "pending", guest_name = "Test guest" }) {
  const su = await superuserToken(inst);
  const r = await api(inst, "POST", "/api/collections/bookings/records", {
    token: su, body: { ref, party, channel, status, guest_name, guides: 0, nights: 1 },
  });
  if (!r.ok) throw new Error("seedBooking failed: " + JSON.stringify(r.data));
  return r.data;
}

export async function listAudit(inst) {
  const su = await superuserToken(inst);
  const r = await api(inst, "GET", "/api/collections/audit_log/records?perPage=200&sort=-ts", { token: su });
  return r.data?.items || [];
}
