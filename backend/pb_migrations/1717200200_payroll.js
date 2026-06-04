/// <reference path="../pb_data/types.d.ts" />
//
// v1.2 - PAYROLL. Adds the staff registry + monthly wage payments.
// Post-release schema changes get their OWN migration (the init migration is
// frozen at the v1 snapshot; already-deployed camps only run this delta).
// pb_schema.json remains the full source-of-truth document and includes these
// collections too - importCollections is an upsert, so fresh installs that get
// them via a regenerated init would simply no-op here.

migrate((app) => {
  const collections = [
  {
    "id": "staff0000000001",
    "name": "staff",
    "type": "base",
    "listRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager'",
    "viewRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager'",
    "createRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager'",
    "updateRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager'",
    "deleteRule": "@request.auth.role = 'admin'",
    "fields": [
      {
        "name": "name",
        "type": "text",
        "required": true,
        "max": 120
      },
      {
        "name": "title",
        "type": "text",
        "max": 80
      },
      {
        "name": "phone",
        "type": "text",
        "max": 40
      },
      {
        "name": "monthly_wage",
        "type": "number",
        "min": 0
      },
      {
        "name": "active",
        "type": "bool"
      },
      {
        "name": "note",
        "type": "text",
        "max": 400
      },
      {
        "name": "created",
        "type": "autodate",
        "onCreate": true
      },
      {
        "name": "updated",
        "type": "autodate",
        "onCreate": true,
        "onUpdate": true
      }
    ],
    "indexes": []
  },
  {
    "id": "wagepay00000001",
    "name": "wage_payments",
    "type": "base",
    "listRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager'",
    "viewRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager'",
    "createRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager'",
    "updateRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager'",
    "deleteRule": "@request.auth.role = 'admin'",
    "fields": [
      {
        "name": "staff",
        "type": "relation",
        "required": true,
        "collectionId": "staff0000000001",
        "maxSelect": 1,
        "cascadeDelete": false
      },
      {
        "name": "period",
        "type": "text",
        "required": true,
        "max": 7,
        "pattern": "^\\d{4}-\\d{2}$"
      },
      {
        "name": "amount",
        "type": "number",
        "required": true,
        "min": 0
      },
      {
        "name": "bonus",
        "type": "number",
        "min": 0
      },
      {
        "name": "deduction",
        "type": "number",
        "min": 0
      },
      {
        "name": "paid_on",
        "type": "date"
      },
      {
        "name": "note",
        "type": "text",
        "max": 200
      },
      {
        "name": "created",
        "type": "autodate",
        "onCreate": true
      },
      {
        "name": "updated",
        "type": "autodate",
        "onCreate": true,
        "onUpdate": true
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX `idx_wage_staff_period` ON `wage_payments` (`staff`, `period`)"
    ]
  }
];
  app.importCollections(collections, false);
}, (app) => {
  for (const name of ["wage_payments", "staff"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (e) { /* already gone */ }
  }
});
