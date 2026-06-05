import { useEffect, useState, useCallback } from "react";
import { pb } from "../lib/pb";
import { useLang } from "../lib/i18n";
import { canEdit } from "../lib/perms";
import { useToast, Head, Modal, Loading } from "../components/ui";
import { dateOf, downloadCSV } from "../lib/format";

// Guest CRM: every incoming tourist as a record, linked to the booking they
// arrived on (and through it the operator). Reception registers on arrival.
export default function Guests({ role }) {
  const { t } = useLang();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null); // record or "new"
  const editable = canEdit(role, "guests");
  const managerial = role === "admin" || role === "manager";

  const load = useCallback(async () => {
    try {
      const [g, b] = await Promise.all([
        pb.collection("guests").getFullList({ sort: "-created", expand: "booking,operator" }),
        pb.collection("bookings").getFullList({ sort: "-created", expand: "operator" }).catch(() => []),
      ]);
      setRows(g);
      setBookings(b);
    } catch (_) {
      toast(t("connErr"));
      setRows([]);
    }
  }, [t, toast]);

  useEffect(() => { load(); }, [load]);

  if (!rows) return <Loading t={t} />;

  const needle = q.trim().toLowerCase();
  const visible = needle
    ? rows.filter((g) =>
        [g.name, g.country, g.passport_no, g.phone, g.email,
          g.expand?.booking?.ref, g.expand?.operator?.name]
          .filter(Boolean).some((v) => String(v).toLowerCase().includes(needle)))
    : rows;

  function exportCSV() {
    downloadCSV("guests.csv",
      ["name", "country", "passport_no", "phone", "email", "booking", "operator", "registered", "notes"],
      visible.map((g) => [
        g.name, g.country, g.passport_no, g.phone, g.email,
        g.expand?.booking?.ref || "", g.expand?.operator?.name || "", dateOf(g.created), g.notes,
      ]));
    toast("✓ CSV");
  }

  async function remove(g) {
    try {
      await pb.collection("guests").delete(g.id);
      toast("✓");
      load();
    } catch (_) {
      toast(t("connErr"));
    }
  }

  return (
    <>
      <Head title={t("guests")} sub={`${visible.length} / ${rows.length}`} actions={
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")}
            style={{ padding: "6px 10px", fontSize: 13, width: 180 }} />
          <button className="btn ghost sm" onClick={exportCSV}>{t("export")} CSV</button>
          {editable && <button className="btn sm" onClick={() => setEditing("new")}>+ {t("addGuest")}</button>}
        </>
      } />
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>{t("name")}</th><th>{t("country")}</th><th>{t("passportNo")}</th>
              <th>{t("contact")}</th><th>{t("linkedBooking")}</th><th>{t("operator")}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan="7" className="muted" style={{ fontSize: 13 }}>—</td></tr>}
            {visible.map((g) => (
              <tr key={g.id}>
                <td>
                  <b>{g.name}</b>
                  {g.notes && <div className="muted" style={{ fontSize: 11 }}>{g.notes}</div>}
                </td>
                <td>{g.country || "—"}</td>
                <td className="muted">{g.passport_no || "—"}</td>
                <td className="muted" style={{ fontSize: 12 }}>{[g.phone, g.email].filter(Boolean).join(" · ") || "—"}</td>
                <td>{g.expand?.booking?.ref || "—"}</td>
                <td>{g.expand?.operator?.name || "—"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {editable && <button className="btn ghost sm" onClick={() => setEditing(g)}>✎</button>}
                  {managerial && (
                    <button className="btn ghost sm" style={{ marginLeft: 4 }} onClick={() => remove(g)}>✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <GuestModal t={t} toast={toast} guest={editing === "new" ? null : editing} bookings={bookings}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </>
  );
}

function GuestModal({ t, toast, guest, bookings, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: guest?.name || "", country: guest?.country || "", passport_no: guest?.passport_no || "",
    phone: guest?.phone || "", email: guest?.email || "",
    booking: guest?.booking || "", notes: guest?.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.name.trim()) return toast(t("required"));
    setBusy(true);
    try {
      // operator follows the linked booking automatically
      const bk = bookings.find((b) => b.id === form.booking);
      const payload = { ...form, operator: bk?.operator || "" };
      if (guest) await pb.collection("guests").update(guest.id, payload);
      else await pb.collection("guests").create(payload);
      toast("✓");
      onSaved();
    } catch (_) {
      toast(t("connErr"));
      setBusy(false);
    }
  }

  return (
    <Modal title={guest ? t("editGuest") : t("addGuest")} onClose={onClose}>
      <label className="field"><span>{t("name")} *</span>
        <input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus /></label>
      <div style={{ display: "flex", gap: 8 }}>
        <label className="field" style={{ flex: 1 }}><span>{t("country")}</span>
          <input value={form.country} onChange={(e) => set("country", e.target.value)} /></label>
        <label className="field" style={{ flex: 1 }}><span>{t("passportNo")}</span>
          <input value={form.passport_no} onChange={(e) => set("passport_no", e.target.value)} /></label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <label className="field" style={{ flex: 1 }}><span>{t("phone")}</span>
          <input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></label>
        <label className="field" style={{ flex: 1 }}><span>{t("email")}</span>
          <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></label>
      </div>
      <label className="field"><span>{t("linkedBooking")}</span>
        <select value={form.booking} onChange={(e) => set("booking", e.target.value)}>
          <option value="">—</option>
          {bookings.filter((b) => b.status !== "cancelled").map((b) => (
            <option key={b.id} value={b.id}>
              {b.ref} · {b.guest_name}{b.expand?.operator?.name ? ` · ${b.expand.operator.name}` : ""}
            </option>
          ))}
        </select></label>
      <label className="field"><span>{t("notes")}</span>
        <input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></label>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn" onClick={save} disabled={busy}>{t("save")}</button>
      </div>
    </Modal>
  );
}
