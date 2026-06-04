/// <reference path="../pb_data/types.d.ts" />
//
// Production hardening applied automatically on first boot. Kept SEPARATE from
// the schema migration so that, even if a future PocketBase tweaks the settings
// shape, provisioning of the data model itself can never be blocked.
//
//   - trustedProxy: behind Caddy the TCP peer is always 127.0.0.1, so without
//     this every client looks identical. Trusting Caddy's X-Forwarded-For makes
//     realIP() (and therefore the public-booking rate limiter + audit) see the
//     true client. Caddy is a single trusted hop that REPLACES inbound XFF, so
//     the right-most value is authoritative (useLeftmostIP = false).
//   - rateLimits: built-in brute-force protection for the auth endpoints. Loopback
//     is excluded so local admin access (and the test suite) is never throttled;
//     real internet clients arrive via Caddy with a non-loopback realIP.

migrate((app) => {
  const s = app.settings();

  s.trustedProxy.headers = ["X-Forwarded-For"];
  s.trustedProxy.useLeftmostIP = false;

  s.rateLimits.enabled = true;
  s.rateLimits.excludedIPs = ["127.0.0.1", "::1"];
  s.rateLimits.rules = [
    // slow down password guessing on staff + superuser login
    { label: "POST /api/collections/users/auth-with-password", audience: "@guest", duration: 60, maxRequests: 10 },
    { label: "POST /api/collections/_superusers/auth-with-password", audience: "@guest", duration: 60, maxRequests: 10 },
    // generous catch-all flood guard for unauthenticated traffic
    { label: "/api/", audience: "@guest", duration: 60, maxRequests: 300 },
  ];

  app.save(s);
}, (app) => {
  const s = app.settings();
  s.rateLimits.enabled = false;
  s.rateLimits.rules = [];
  s.trustedProxy.headers = [];
  app.save(s);
});
