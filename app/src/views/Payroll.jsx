import { useEffect, useState, useCallback } from "react";
import { pb } from "../lib/pb";
import { useLang } from "../lib/i18n";
import { canEdit } from "../lib/perms";
import { useToast, Head, Tile, Loading, Modal } from "../components/ui";
import { fmt, dateOf, today, downloadCSV } from "../lib/format";

// net actually paid out for one wage payment
const paidNet = (w) => (w.amount || 0) + (w.bonus || 0) - (w.deduction || 0);

export default function Payroll({ role }) {
  const { t } = useLang();
  const toast = useToast();
  const [staff, setStaff] = useState(null);
  const [payments, setPayments] = useState([]);
  const [month, setMonth] = useState(today().slice(0, 7)); // "YYYY-MM"
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null);   // staff record or "new"
  const [paying, setPaying] = useState(null);     // staff record being paid
  const editable = canEdit(role, "staff");

  const load = useCallback(async () => {
    try {
      const [s, w] = await Promise.all([
        pb.collection("staff").getFullList({ sort: "name" }),
        pb.collection("wage_payments").getFullList().catch(() => []),
      ]);
      setStaff(s);
      setPayments(w);
    } catch (_) {
      toast(t("connErr"));
      setStaff([]);
    }
  }, [t, toast]);

  useEffect(() => { load(); }, [load]);

  if (!staff) return <Loading t={t} />;

  const visible = staff.filter((s) => showInactive || s.active);
  const activeStaff = staff.filter((s) => s.active);
  const wageBill = activeStaff.reduce((a, s) => a + (s.monthly_wage || 0), 0);
  const monthPay = {};
  payments.filter((w) => w.period === month).forEach((w) => { monthPay[w.staff] = w; });
  const paidTotal = Object.values(monthPay).reduce((a, w) => a + paidNet(w), 0);
  const unpaid = activeStaff.filter((s) => !monthPay[s.id]).length;

  function exportCSV() {
    downloadCSV(`payroll-${month}.csv`,
      ["name", "position", "monthly_wage", "paid_amount", "bonus", "deduction", "paid_net", "paid_on"],
      visible.map((s) => {
        const w = monthPay[s.id];
        return [s.name, s.title || "", s.monthly_wage || 0,
          w ? w.amount : "", w ? w.bonus || 0 : "", w ? w.deduction || 0 : "",
          w ? paidNet(w) : "", w ? dateOf(w.paid_on) : ""];
      }));
    toast("✓ CSV");
  }

  async function removeStaff(s) {
    try {
      await pb.collection("staff").delete(s.id);
      toast("✓");
      load();
    } catch (_) {
      toast(t("connErr"));
    }
  }

  return (
    <>
      <Head title={t("payroll")} sub={t("staff")} actions={
        <>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            style={{ padding: "6px 10px", fontSize: 13 }} title={t("month")} />
          <button className="btn ghost sm" onClick={exportCSV}>{t("export")} CSV</button>
          {editable && <button className="btn sm" onClick={() => setEditing("new")}>+ {t("addStaff")}</button>}
        </>
      } />
      <div className="grid3" style={{ marginBottom: 16 }}>
        <Tile label={t("staff")} big={activeStaff.length} bigStyle={{ fontSize: 24 }}
          sub={<span className="muted" style={{ fontSize: 12 }}>{t("active").toLowerCase()}</span>} />
        <Tile label={t("wageBill")} big={fmt(wageBill)} bigStyle={{ fontSize: 24 }} />
        <Tile label={t("paidThisMonth")} big={fmt(paidTotal)}
          bigStyle={{ color: "var(--green)", fontSize: 24 }}
          sub={unpaid > 0
            ? <span className="chip r">{unpaid} {t("unpaid").toLowerCase()}</span>
            : <span className="chip g">✓</span>} />
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>{t("name")}</th><th>{t("position")}</th><th>{t("monthlyWage")}</th>
              <th>{month} · {t("status")}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan="5" className="muted" style={{ fontSize: 13 }}>—</td></tr>
            )}
            {visible.map((s) => {
              const w = monthPay[s.id];
              return (
                <tr key={s.id} style={s.active ? undefined : { opacity: 0.5 }}>
                  <td><b>{s.name}</b>{!s.active && <span className="muted"> · {t("inactive").toLowerCase()}</span>}</td>
                  <td>{s.title || "—"}</td>
                  <td>{fmt(s.monthly_wage)}</td>
                  <td>
                    {w ? (
                      <span className="tag paid" title={dateOf(w.paid_on)}>
                        {t("paid")} {fmt(paidNet(w))}{w.paid_on ? ` · ${dateOf(w.paid_on)}` : ""}
                      </span>
                    ) : s.active && editable ? (
                      <button className="btn sm" onClick={() => setPaying(s)}>₮ {t("pay")}</button>
                    ) : (
                      <span className="tag pending">{t("unpaid")}</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                    {editable && <button className="btn ghost sm" onClick={() => setEditing(s)}>✎</button>}
                    {role === "admin" && (
                      <button className="btn ghost sm" style={{ marginLeft: 4 }} onClick={() => removeStaff(s)}>✕</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="card-pad" style={{ paddingTop: 10 }}>
          <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 13 }} className="muted">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            {t("showInactive")}
          </label>
        </div>
      </div>
      {editing && (
        <StaffModal t={t} toast={toast} staff={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
      {paying && (
        <PayModal t={t} toast={toast} staff={paying} month={month}
          onClose={() => setPaying(null)}
          onSaved={() => { setPaying(null); load(); }} />
      )}
    </>
  );
}

function StaffModal({ t, toast, staff, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: staff?.name || "", title: staff?.title || "", phone: staff?.phone || "",
    monthly_wage: staff?.monthly_wage || 0, active: staff ? !!staff.active : true,
    note: staff?.note || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.name.trim()) return toast(t("required"));
    setBusy(true);
    try {
      const payload = { ...form, monthly_wage: Number(form.monthly_wage) || 0 };
      if (staff) await pb.collection("staff").update(staff.id, payload);
      else await pb.collection("staff").create(payload);
      toast("✓");
      onSaved();
    } catch (_) {
      toast(t("connErr"));
      setBusy(false);
    }
  }

  return (
    <Modal title={staff ? t("editStaff") : t("addStaff")} onClose={onClose}>
      <label className="field"><span>{t("name")} *</span>
        <input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus /></label>
      <label className="field"><span>{t("position")}</span>
        <input value={form.title} onChange={(e) => set("title", e.target.value)} /></label>
      <label className="field"><span>{t("phone")}</span>
        <input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></label>
      <label className="field"><span>{t("monthlyWage")} (₮)</span>
        <input type="number" min="0" value={form.monthly_wage} onChange={(e) => set("monthly_wage", e.target.value)} /></label>
      <label className="field"><span>{t("notes")}</span>
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

function PayModal({ t, toast, staff, month, onClose, onSaved }) {
  const [amount, setAmount] = useState(staff.monthly_wage || 0);
  const [bonus, setBonus] = useState(0);
  const [deduction, setDeduction] = useState(0);
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const net = (Number(amount) || 0) + (Number(bonus) || 0) - (Number(deduction) || 0);

  async function save() {
    setBusy(true);
    try {
      await pb.collection("wage_payments").create({
        staff: staff.id, period: month,
        amount: Number(amount) || 0, bonus: Number(bonus) || 0, deduction: Number(deduction) || 0,
        paid_on: paidOn ? paidOn + " 00:00:00.000Z" : "", note,
      });
      toast("✓");
      onSaved();
    } catch (_) {
      // unique (staff, period) index - someone already paid this month
      toast(t("connErr"));
      setBusy(false);
    }
  }

  return (
    <Modal title={`₮ ${t("pay")} — ${staff.name} · ${month}`} onClose={onClose}>
      <label className="field"><span>{t("amount")} (₮)</span>
        <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
      <label className="field"><span>{t("bonus")} (₮)</span>
        <input type="number" min="0" value={bonus} onChange={(e) => setBonus(e.target.value)} /></label>
      <label className="field"><span>{t("deduction")} (₮)</span>
        <input type="number" min="0" value={deduction} onChange={(e) => setDeduction(e.target.value)} /></label>
      <label className="field"><span>{t("paidOn")}</span>
        <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
      <label className="field"><span>{t("note")}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="kv" style={{ marginTop: 12, fontSize: 15 }}>
        <span><b>{t("profit")}</b></span><b>{fmt(net)}</b>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn" onClick={save} disabled={busy}>{t("save")}</button>
      </div>
    </Modal>
  );
}
