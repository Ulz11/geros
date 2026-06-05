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

// Folder-organized documents inside one operator profile (operator_docs).
// Default folders match how camps actually file paperwork; typing a new name
// creates a folder on the fly. Legacy flat `documents` show under General.
const DEFAULT_FOLDERS = ["Гэрээ / Contracts", "Нэхэмжлэх / Invoices", "Захидал / Correspondence"];

function DocFolders({ t, toast, op }) {
  const [docs, setDocs] = useState(null);
  const [folder, setFolder] = useState(DEFAULT_FOLDERS[0]);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    try {
      setDocs(await pb.collection("operator_docs").getFullList({
        filter: `operator='${op.id}'`, sort: "folder,-created",
      }));
    } catch (_) {
      setDocs([]);
    }
  }, [op.id]);

  useEffect(() => { load(); }, [load]);

  if (!docs) return null;

  const folders = [...new Set([...DEFAULT_FOLDERS, ...docs.map((d) => d.folder)])];
  const grouped = folders.map((f) => [f, docs.filter((d) => d.folder === f)]);
  const targetFolder = folder === "__new__" ? newName.trim() : folder;

  async function upload(files) {
    if (!targetFolder) return toast(t("required"));
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("operator", op.id);
        fd.append("folder", targetFolder);
        fd.append("title", file.name);
        fd.append("file", file);
        await pb.collection("operator_docs").create(fd);
      }
      toast("✓ 📎");
      if (folder === "__new__") { setFolder(targetFolder); setNewName(""); }
      load();
    } catch (_) {
      toast(t("connErr"));
    }
  }

  return (
    <div className="field wide">
      <span>{t("documents")}</span>
      {grouped.map(([f, list]) => (list.length > 0 || f === folder) && (
        <div key={f} style={{ marginTop: 6 }}>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".4px" }}>📁 {f}</div>
          <div className="file-chips" style={{ paddingTop: 3 }}>
            {list.length === 0 && <span className="muted" style={{ fontSize: 11 }}>—</span>}
            {list.flatMap((d) => (d.file || []).map((fn) => (
              <a key={d.id + fn} href={fileUrl("operator_docs", d, fn)} target="_blank" rel="noreferrer"
                title={d.title || fn}>{fn}</a>
            )))}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10 }}>
        <select value={folder} onChange={(e) => setFolder(e.target.value)} style={{ fontSize: 12, padding: "5px 8px" }}>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
          <option value="__new__">+ {t("newFolder")}</option>
        </select>
        {folder === "__new__" && (
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("folder")}
            style={{ fontSize: 12, padding: "5px 8px", width: 140 }} />
        )}
        <UploadButton label="+ 📎" multiple
          accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"
          onFile={upload} />
      </div>
      {(op.documents || []).length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700 }}>📁 General (legacy)</div>
          <div className="file-chips" style={{ paddingTop: 3 }}>
            {op.documents.map((d) => (
              <a key={d} href={fileUrl("tour_operators", op, d)} target="_blank" rel="noreferrer">{d}</a>
            ))}
          </div>
        </div>
      )}
    </div>
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
        {!isNew && <DocFolders t={t} toast={toast} op={op} />}
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn" onClick={save} disabled={busy}>{t("save")}</button>
      </div>
    </Modal>
  );
}
