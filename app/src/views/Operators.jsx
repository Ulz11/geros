import { useEffect, useState, useCallback } from "react";
import { pb, fileUrl } from "../lib/pb";
import { useLang } from "../lib/i18n";
import { canEdit } from "../lib/perms";
import { useToast, Head, Modal, Loading, UploadButton } from "../components/ui";
import { fmt } from "../lib/format";

export default function Operators({ role }) {
  const { t } = useLang();
  const toast = useToast();
  const [ops, setOps] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [edit, setEdit] = useState(null); // null | {} (new) | operator record
  const editable = canEdit(role, "operators");

  const load = useCallback(async () => {
    try {
      const [o, b] = await Promise.all([
        pb.collection("tour_operators").getFullList({ sort: "name" }),
        pb.collection("bookings").getFullList({ fields: "id,operator,amount,status" }).catch(() => []),
      ]);
      setOps(o);
      setBookings(b);
    } catch (_) {
      toast(t("connErr"));
      setOps([]);
    }
  }, [t, toast]);

  useEffect(() => { load(); }, [load]);

  if (!ops) return <Loading t={t} />;

  const stats = (id) => {
    const mine = bookings.filter((b) => b.operator === id && b.status !== "cancelled");
    return { count: mine.length, revenue: mine.reduce((s, b) => s + (b.amount || 0), 0) };
  };

  const contractChip = (o) =>
    o.contract_status === "signed" ? ["g", t("contractOk")] :
    o.contract_status === "pending" ? ["a", t("contractPending")] : ["r", t("contractNone")];

  return (
    <>
      <Head title={t("operators")} sub="CRM"
        actions={editable ? <button className="btn sm" onClick={() => setEdit({})}>+ {t("addOperator")}</button> : null} />
      {ops.length === 0 && <div className="ph">—</div>}
      <div className="grid3">
        {ops.map((o) => {
          const s = stats(o.id);
          const [cls, label] = contractChip(o);
          return (
            <div key={o.id} className="panel card-pad">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div className="sec-title">{o.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {[o.country, o.contact].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <span className={"chip " + cls}>{label}</span>
              </div>
              <div className="kv" style={{ marginTop: 12 }}><span>{t("bookingsCount")}</span><b>{s.count}</b></div>
              <div className="kv"><span>{t("totalRev")}</span><b>{fmt(s.revenue)}</b></div>
              <div className="kv"><span>{t("email")}</span><span className="muted" style={{ fontSize: 12 }}>{o.email || "—"}</span></div>
              {editable && (
                <button className="btn ghost sm" style={{ marginTop: 12, width: "100%" }} onClick={() => setEdit(o)}>
                  {t("manage")} →
                </button>
              )}
            </div>
          );
        })}
      </div>
      {edit !== null && (
        <OperatorModal t={t} toast={toast} op={edit}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); }} />
      )}
    </>
  );
}

function OperatorModal({ t, toast, op, onClose, onSaved }) {
  const isNew = !op.id;
  const [f, setF] = useState({
    name: op.name || "", name_en: op.name_en || "", country: op.country || "",
    contact: op.contact || "", email: op.email || "", phone: op.phone || "",
    contract_status: op.contract_status || "none", crm_notes: op.crm_notes || "",
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!f.name.trim()) return toast(t("required"));
    setBusy(true);
    try {
      const data = { ...f, name: f.name.trim() };
      if (isNew) await pb.collection("tour_operators").create(data);
      else await pb.collection("tour_operators").update(op.id, data);
      toast("✓");
      onSaved();
    } catch (_) {
      toast(t("connErr"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={isNew ? t("addOperator") : t("editOperator")} onClose={onClose}>
      <div className="grid-form">
        <label className="field wide"><span>{t("name")}</span>
          <input value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />
        </label>
        <label className="field"><span>{t("country")}</span>
          <input value={f.country} onChange={(e) => set("country", e.target.value)} />
        </label>
        <label className="field"><span>{t("contact")}</span>
          <input value={f.contact} onChange={(e) => set("contact", e.target.value)} />
        </label>
        <label className="field"><span>{t("email")}</span>
          <input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
        </label>
        <label className="field"><span>{t("phone")}</span>
          <input value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        </label>
        <label className="field wide"><span>{t("status")}</span>
          <select value={f.contract_status} onChange={(e) => set("contract_status", e.target.value)}>
            <option value="signed">{t("contractOk")}</option>
            <option value="pending">{t("contractPending")}</option>
            <option value="none">{t("contractNone")}</option>
          </select>
        </label>
        <label className="field wide"><span>{t("notes")}</span>
          <textarea rows={3} value={f.crm_notes} onChange={(e) => set("crm_notes", e.target.value)} />
        </label>
        {!isNew && (
          <div className="field wide">
            <span>{t("invoice")} / PDF</span>
            <div className="file-chips" style={{ paddingTop: 4 }}>
              {(op.documents || []).map((d) => (
                <a key={d} href={fileUrl("tour_operators", op, d)} target="_blank" rel="noreferrer">{d}</a>
              ))}
              <UploadButton label="+ 📎" multiple
                accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"
                onFile={async (files) => {
                  try {
                    const fd = new FormData();
                    files.forEach((file) => fd.append("documents+", file));
                    await pb.collection("tour_operators").update(op.id, fd);
                    toast("✓ 📎");
                    onSaved();
                  } catch (_) {
                    toast(t("connErr"));
                  }
                }} />
            </div>
          </div>
        )}
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn" onClick={save} disabled={busy}>{t("save")}</button>
      </div>
    </Modal>
  );
}
