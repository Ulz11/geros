// Rate-limiter test. Runs in its own PocketBase instance (separate child process
// + port) with a deliberately low public-booking limit so we can observe the
// throttle without interfering with the functional public-booking tests, which
// share a single app store across the whole process.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startInstance, api } from "./harness.mjs";

let inst;
before(async () => {
  inst = await startInstance(8098, { GEROS_PUBBOOK_MAX: "3", GEROS_PUBBOOK_WINDOW: "60" });
}, { timeout: 60000 });
after(async () => { if (inst) await inst.stop(); });

const good = () => ({
  guest_name: "Rate Tester", email: "rate@example.com", party: 2,
  check_in: "2026-12-01", check_out: "2026-12-03", website: "",
});

test("public-booking throttles a client IP after the limit", async () => {
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const r = await api(inst, "POST", "/api/camp/public-booking", { body: good() });
    statuses.push(r.status);
  }
  // first 3 are processed (200), the 4th and 5th are throttled (429)
  assert.deepEqual(statuses.slice(0, 3), [200, 200, 200], `first three should pass, got ${statuses}`);
  assert.equal(statuses[3], 429, `4th should be rate-limited, got ${statuses}`);
  assert.equal(statuses[4], 429, `5th should be rate-limited, got ${statuses}`);
});

test("a rate-limited request creates no booking", async () => {
  // count bookings via superuser
  const auth = await api(inst, "POST", "/api/collections/_superusers/auth-with-password", {
    body: { identity: "su@test.local", password: "test-superuser-9000" },
  });
  const token = auth.data.token;
  const before = (await api(inst, "GET", "/api/collections/bookings/records?perPage=1", { token })).data.totalItems;
  // we are already over the limit from the previous test (same IP, same window)
  const r = await api(inst, "POST", "/api/camp/public-booking", { body: good() });
  assert.equal(r.status, 429);
  const after = (await api(inst, "GET", "/api/collections/bookings/records?perPage=1", { token })).data.totalItems;
  assert.equal(after, before, "throttled request must not create a booking");
});
