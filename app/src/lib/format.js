export const fmt = (n) => "₮" + Number(n || 0).toLocaleString("en-US");

export const today = () => new Date().toISOString().slice(0, 10);

// PocketBase date fields come back as "2026-06-05 00:00:00.000Z" — keep the date part.
export const dateOf = (v) => (v ? String(v).slice(0, 10) : "");
export const shortDate = (v) => dateOf(v).slice(5); // "06-05"

export function nightsBetween(a, b) {
  const d1 = new Date(dateOf(a)), d2 = new Date(dateOf(b));
  const n = Math.round((d2 - d1) / 86400000);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const monthKey = (v) => dateOf(v).slice(0, 7); // "2026-06"

export function parseJson(v, fallback) {
  if (v == null || v === "") return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

/* ---------- CSV export (client-side, no deps) ---------- */
export function downloadCSV(filename, headers, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const text = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  // BOM so Excel opens UTF-8 (Cyrillic) correctly
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
