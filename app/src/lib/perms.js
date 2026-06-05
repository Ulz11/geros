// Role → visible sections. Mirrors docs/DATA_MODEL.md permission matrix.
// This is UX only — the real enforcement is the API rules in pb_schema.json.
export const PERMS = {
  admin: ["dashboard", "gers", "calendar", "bookings", "guests", "operators", "finance", "prices", "payroll", "kitchen", "reports", "audit", "settings"],
  manager: ["dashboard", "gers", "calendar", "bookings", "guests", "operators", "finance", "prices", "payroll", "kitchen", "reports", "audit"],
  kitchen: ["dashboard", "kitchen"],
  worker: ["dashboard", "gers", "calendar", "bookings", "guests"],
};

export const NAV = [
  { k: "dashboard", ic: "◧" },
  { k: "gers", ic: "⬡" },
  { k: "calendar", ic: "◫" },
  { k: "bookings", ic: "▤" },
  { k: "guests", ic: "👤" },
  { k: "operators", ic: "◎" },
  { k: "finance", ic: "₮" },
  { k: "prices", ic: "✦" },
  { k: "payroll", ic: "▦" },
  { k: "kitchen", ic: "♨" },
  { k: "reports", ic: "◰" },
  { k: "audit", ic: "≣" },
  { k: "settings", ic: "⚙" },
];

export function canDo(role, section) {
  return (PERMS[role] || []).includes(section);
}

// Which roles may edit what (mirrors collection API rules, for hiding buttons)
export const CAN_EDIT = {
  gers: ["admin", "manager", "worker"],
  bookings: ["admin", "manager", "worker"],
  operators: ["admin", "manager"],
  invoices: ["admin", "manager"],
  kitchen_txns: ["admin", "manager", "kitchen"],
  staff: ["admin", "manager"],
  wage_payments: ["admin", "manager"],
  services: ["admin", "manager"],
  guests: ["admin", "manager", "worker"],
  operator_docs: ["admin", "manager"],
};

// Create is stricter than update for gers (schema: createRule admin/manager only —
// workers can move gers and change status but not add new ones)
export const CAN_CREATE = {
  ...CAN_EDIT,
  gers: ["admin", "manager"],
};

export function canEdit(role, collection) {
  return (CAN_EDIT[collection] || []).includes(role);
}

export function canCreate(role, collection) {
  return (CAN_CREATE[collection] || []).includes(role);
}
