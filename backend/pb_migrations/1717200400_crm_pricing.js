/// <reference path="../pb_data/types.d.ts" />
//
// v1.7 - CRM + PRICING. Three collections:
//   services      - the camp's price list feeding the invoice generator
//   guests        - incoming-tourist registry (CRM), linked to bookings/operators
//   operator_docs - operator documents organized in named folders
// Ships as its own delta (init migration stays frozen at the v1 snapshot).

migrate((app) => {
  const collections = [
  {
    "id": "services0000001",
    "name": "services",
    "type": "base",
    "listRule": "@request.auth.id != ''",
    "viewRule": "@request.auth.id != ''",
    "createRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager'",
    "updateRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager'",
    "deleteRule": "@request.auth.role = 'admin'",
    "fields": [
      {
        "name": "name",
        "type": "text",
        "required": true,
        "max": 160
      },
      {
        "name": "category",
        "type": "select",
        "required": true,
        "maxSelect": 1,
        "values": [
          "meal",
          "accommodation",
          "guide",
          "activity",
          "transport",
          "other"
        ]
      },
      {
        "name": "price",
        "type": "number",
        "required": true,
        "min": 0
      },
      {
        "name": "unit",
        "type": "select",
        "required": true,
        "maxSelect": 1,
        "values": [
          "per_person",
          "per_night",
          "per_person_night",
          "fixed"
        ]
      },
      {
        "name": "active",
        "type": "bool"
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
    "indexes": []
  },
  {
    "id": "guests000000001",
    "name": "guests",
    "type": "base",
    "listRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager' || @request.auth.role = 'worker'",
    "viewRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager' || @request.auth.role = 'worker'",
    "createRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager' || @request.auth.role = 'worker'",
    "updateRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager' || @request.auth.role = 'worker'",
    "deleteRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager'",
    "fields": [
      {
        "name": "name",
        "type": "text",
        "required": true,
        "max": 160
      },
      {
        "name": "country",
        "type": "text",
        "max": 80
      },
      {
        "name": "passport_no",
        "type": "text",
        "max": 40
      },
      {
        "name": "phone",
        "type": "text",
        "max": 40
      },
      {
        "name": "email",
        "type": "email"
      },
      {
        "name": "booking",
        "type": "relation",
        "collectionId": "bookings0000001",
        "maxSelect": 1,
        "cascadeDelete": false
      },
      {
        "name": "operator",
        "type": "relation",
        "collectionId": "tourops00000001",
        "maxSelect": 1,
        "cascadeDelete": false
      },
      {
        "name": "notes",
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
    "indexes": [
      "CREATE INDEX `idx_guest_booking` ON `guests` (`booking`)"
    ]
  },
  {
    "id": "opdocs000000001",
    "name": "operator_docs",
    "type": "base",
    "listRule": "@request.auth.id != ''",
    "viewRule": "@request.auth.id != ''",
    "createRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager'",
    "updateRule": "@request.auth.role = 'admin' || @request.auth.role = 'manager'",
    "deleteRule": "@request.auth.role = 'admin'",
    "fields": [
      {
        "name": "operator",
        "type": "relation",
        "required": true,
        "collectionId": "tourops00000001",
        "maxSelect": 1,
        "cascadeDelete": true
      },
      {
        "name": "folder",
        "type": "text",
        "required": true,
        "max": 80
      },
      {
        "name": "title",
        "type": "text",
        "max": 160
      },
      {
        "name": "file",
        "type": "file",
        "maxSelect": 5,
        "maxSize": 15728640
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
      "CREATE INDEX `idx_opdoc_operator` ON `operator_docs` (`operator`, `folder`)"
    ]
  }
];
  app.importCollections(collections, false);
}, (app) => {
  for (const name of ["operator_docs", "guests", "services"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (e) { /* already gone */ }
  }
});
