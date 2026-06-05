import { useEffect, useState, useCallback } from "react";
import { pb } from "../lib/pb";
import { useLang } from "../lib/i18n";
import { canEdit } from "../lib/perms";
import { useToast, Head, Modal, Loading } from "../components/ui";
import { fmt, downloadCSV } from "../lib/format";

// The camp's price list: what we sell and for how much. Feeds the invoice
// generator in Finance ("Add from price list").
const CATEGORIES = ["meal", "accommodation", "guide", "activity", "transport", "other"];
const UNITS = ["per_person", "per_night", "per_person_night", "fixed"];
const catKey = (c) => (c === "other" ? "other_cat" : c);

export default function Prices({ role }) {
  const { t } = useLang();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null); // record or "new"
  const editable = canEdit(role, "services");

  const load = useCallback(async () => {
    try {
      setRows(await pb.collection("services").getFullList({ sort: "category,name" }));
    } catch (_) {
      toast(t("connErr"));
      setRows([]);
    }
  }, [t, toast]);

  useEffect(() => { load(); }, [load]);

  if (!rows) return <Loading t={t} />;

  function exportCSV() {
    downloadCSV("price-list.csv",
      ["service", "category", "price", "unit", "active"],
      rows.map((s) => [s.name, s.category, s.price, s.unit, s.active ? 1 : 0]));
    toast("✓ CSV");
  }

  async function remove(s) {
    try {
      await pb.collection("services").delete(s.id);
      toast("✓");
      load();
    } catch (_) {
      toast(t("connErr"));
    }
  }

  // group rows by category for scannability
  const byCat = CATEGORIES.map((c) => [c, rows.filter((r) => r.category === c)]).filter(([, v]) => v.length);

  return (
    <>
      <Head title={t("priceList")} sub={t("services")} actions={
        <>
          <button className="btn ghost sm" onClick={exportCSV}>{t("export")} CSV</button>
          {editable && <button className="btn sm" onClick={() => setEditing("new")}>+ {t("addService")}</button>}
        </>
      } />
      <div className="panel">
        <table>
          <thead>
            <tr><th>{t("priceService")}</th><th>{t("amount")}</th><th>{t("priceUnit")}</th><th></th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="4" className="muted" style={{ fontSize: 13 }}>—</td></tr>}
            {byCat.map(([cat, list]) => (
              [
                <tr key={cat + "-h"}>
                  <td colSpan="4" style={{ paddingTop: 14 }}>
                    <span className="sec-title">{t(catKey(cat))}</span>
                  </td>
                </tr>,
                ...list.map((s) => (
                  <tr key={s.id} style={s.active ? undefined : { opacity: 0.45 }}>
                    <td>
                      <b>{s.name}</b>
                      {!s.active && <span className="muted"> · {t("inactive_s")}</span>}
                      {s.note && <div className="muted" style={{ fontSize: 11 }}>{s.note}</div>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}><b>{fmt(s.price)}</b></td>
                    <td className="muted">{t(s.unit)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {editable && <button className="btn ghost sm" onClick={() => setEditing(s)}>✎</button>}
                      {role === "admin" && (
                        <button className="btn ghost sm" style={{ marginLeft: 4 }} onClick={() => remove(s)}>✕</button>
                      )}
                    </td>
                  </tr>
                )),
              ]
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <ServiceModal t={t} toast={toast} service={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </>
  );
}

function ServiceModal({ t, toast, service, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: service?.name || "",
    category: service?.category || "meal",
    price: service?.price ?? 0,
    unit: service?.unit || "per_person",
    active: service ? !!service.active : true,
    note: service?.note || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.name.trim()) return toast(t("required"));
    setBusy(true);
    try {
      const payload = { ...form, price: Number(form.price) || 0 };
      if (service) await pb.collection("services").update(service.id, payload);
      else await pb.collection("services").create(payload);
      toast("✓");
      onSaved();
    } catch (_) {
      toast(t("connErr"));
      setBusy(false);
    }
  }

  return (
    <Modal title={service ? t("editService") : t("addService")} onClose={onClose}>
      <label className="field"><span>{t("priceService")} * (МН / EN)</span>
        <input value={form.name} placeholder="Үдийн хоол / Lunch" onChange={(e) => set("name", e.target.value)} autoFocus /></label>
      <label className="field"><span>{t("category")}</span>
        <select value={form.category} onChange={(e) => set("category", e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{t(catKey(c))}</option>)}
        </select></label>
      <label className="field"><span>{t("amount")} (₮) *</span>
        <input type="number" min="0" value={form.price} onChange={(e) => set("price", e.target.value)} /></label>
      <label className="field"><span>{t("priceUnit")}</span>
        <select value={form.unit} onChange={(e) => set("unit", e.target.value)}>
          {UNITS.map((u) => <option key={u} value={u}>{t(u)}</option>)}
        </select></label>
      <label className="field"><span>{t("note")}</span>
        <input value={form.note} onChange={(e) => set("note", e.target.value)} /></label>
      <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 13, marginTop: 8 }}>
        <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
        {t("active")}
      </label>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn" onClick={save} disabled={busy}>{t("save")}</button>
      </div>
    </Modal>
  );
}
