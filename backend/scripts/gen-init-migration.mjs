// Generates backend/pb_migrations/1717200000_init_geros.js from pb_schema.json,
// so pb_schema.json stays the single source of truth for the data model while
// PocketBase provisions itself automatically on first `serve` (no manual import).
//
// Run after changing the schema:  node scripts/gen-init-migration.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BACKEND = join(import.meta.dirname, "..");
const schema = JSON.parse(readFileSync(join(BACKEND, "pb_schema.json"), "utf8"));
const names = schema.map((c) => c.name);

const body = `/// <reference path="../pb_data/types.d.ts" />
//
// AUTO-GENERATED from backend/pb_schema.json by scripts/gen-init-migration.mjs.
// Do NOT edit by hand - re-run the generator instead.
//
// Self-provisioning: on first \`serve\` this creates every business collection and
// patches the \`users\` collection (full_name + role + admin-only listing) so a
// fresh box needs no manual "Import collections" step. Idempotent + reversible.

migrate((app) => {
  const collections = ${JSON.stringify(schema, null, 2)};

  // create/update the business collections (deleteMissing=false leaves the
  // built-in system collections untouched)
  app.importCollections(collections, false);

  // users: the app-specific identity fields + lock listing to admins
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("full_name")) {
    users.fields.add(new TextField({ name: "full_name", max: 120 }));
  }
  if (!users.fields.getByName("role")) {
    users.fields.add(new SelectField({
      name: "role", required: true, maxSelect: 1,
      values: ["admin", "manager", "kitchen", "worker"],
    }));
  }
  users.listRule = "@request.auth.role = 'admin'";
  app.save(users);
}, (app) => {
  // down: drop the business collections (reverse dependency order)
  const drop = ${JSON.stringify([...names].reverse())};
  for (const name of drop) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (e) { /* already gone */ }
  }
  try {
    const users = app.findCollectionByNameOrId("users");
    users.listRule = "id = @request.auth.id";
    app.save(users);
  } catch (e) { /* ignore */ }
});
`;

const outDir = join(BACKEND, "pb_migrations");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "1717200000_init_geros.js");
writeFileSync(outFile, body);
console.log("wrote", outFile, `(${schema.length} collections: ${names.join(", ")})`);
