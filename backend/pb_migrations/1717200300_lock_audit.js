/// <reference path="../pb_data/types.d.ts" />
//
// v1.4 core audit fix: audit_log.createRule was "@request.auth.id != ''", which
// let ANY authenticated user POST forged audit rows with arbitrary user/role
// text. The trail is written exclusively by the hooks (programmatic saves
// bypass API rules), so the API surface is locked to superusers only.

migrate((app) => {
  const c = app.findCollectionByNameOrId("audit_log");
  c.createRule = null;
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("audit_log");
  c.createRule = "@request.auth.id != ''";
  app.save(c);
});
