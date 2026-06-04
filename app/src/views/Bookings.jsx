import { useEffect, useState, useCallback } from "react";
import { pb, fileUrl } from "../lib/pb";
import { useLang } from "../lib/i18n";
import { canEdit } from "../lib/perms";
import { useToast, Head, Modal, Loading, UploadButton } from "../components/ui";
import { fmt, shortDate, dateOf, nightsBetween, today, downloadCSV } from "../lib/format";

export default function Bookings({ role, go }) {
  const { t } = useLang();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [operators, setOperators] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [openRow, setOpenRow] = useState(null);
  const editable = canEdit(role, "bookings");
  const managerial = role === "admin" || role === "manager";

  const load = useCallback(async () => {
    try {
      const [b, ops] = await Promise.all([
        pb.collection("bookings").getFullList({ sort: "-created", expand: "operator,assigned_gers" }),
        pb.collection("tour_operators").getFullList({ sort: "name" }).catch(() => []),
      ]);
      setRows(b);
      setOperators(ops);
    } catch (_) {
      toast(t("connErr"));
      setRows([]);
    }
  }, [t, toast]);

  useEffect(() => { load(); }, [load]);

  async function setBookingStatus(b, status) {
    // check-in/check-out are SERVER-SIDE endpoints (one call that moves the
    // gers + booking + audit together) - no client-side multi-writes that can
    // be half-applied if the connection drops.
    try {
      if (status === "checked_in") {
        await pb.send(`/api/camp/checkin/${b.id}`, { method: "POST" });
        toast(`${b.ref} → ${t("checked_in")}`);
      } else if (status === "checked_out") {
        const r = await pb.send(`/api/camp/checkout/${b.id}`, { method: "POST" });
        toast(r.freed?.length ? t("freedGers") : `${b.ref} → ${t("checked_out")}`);
      } else if (status === "cancelled") {
        // a checked-in booking frees its gers first, then cancels
        if (b.status === "checked_in") {
          await pb.send(`/api/camp/checkout/${b.id}`, { method: "POST" }).catch(() => {});
        }
        await pb.collection("bookings").update(b.id, { status });
        toast(`${b.ref} → ${t(status)}`);
      } else {
        await pb.collection("bookings").update(b.id, { status });
        toast(`${b.ref} → ${t(status)}`);
      }
      setOpenRow(null);
      load();
    } catch (ex) {
      toast(ex?.status === 409 ? t("gerOccupied") : t("connErr"));
    }
  }

  async function setPay(b, pay_status) {
    try {
      await pb.collection("bookings").update(b.id, { pay_status });
      load();
    } catch (_) {
      toast(t("connErr"));
    }
  }

  async function attachPdfs(b, files) {
    // maxSelect is 3 TOTAL - PB rejects (not truncates) appends past the cap
    const room = 3 - (b.source_pdf || []).length;
    const batch = files.slice(0, Math.max(0, room));
    if (!batch.length) return;
    try {
      const fd = new FormData();
      batch.forEach((f) => fd.append("source_pdf+", f));
      await pb.collection("bookings").update(b.id, fd);
      toast("✓ PDF");
      load();
    } catch (_) {
      toast(t("connErr"));
    }
  }

  function exportCSV() {
    downloadCSV(
      "bookings.csv",
      ["ref", "channel", "guest", "operator", "party", "guides", "check_in", "check_out", "nights", "amount", "pay_status", "status"],
      (rows || []).map((b) => [
        b.ref, b.channel, b.guest_name, b.expand?.operator?.name || "", b.party, b.guides,
        dateOf(b.check_in), dateOf(b.check_out), b.nights, b.amount, b.pay_status, b.status,
      ])
    );
  }

  if (!rows) return <Loading t={t} />;

  return (
    <>
      <Head
        title={t("bookings")}
        sub={`${rows.length} ${t("bookings").toLowerCase()}`}
        actions={
          <>
            <button className="btn ghost sm" onClick={exportCSV}>{t("export")} CSV</button>
            <button className="btn ghost sm" onClick={() => go("gers")}>{t("smartAlloc")} →</button>
            {editable && <button className="btn sm" onClick={() => setShowNew(true)}>+ {t("newBooking")}</button>}
          </>
        }
      />
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>{t("ref")}</th><th>{t("channel")}</th><th>{t("guest")}</th><th>{t("operator")}</th>
              <th>{t("party")}/{t("nights")}</th><th>{t("dates")}</th><th>{t("gerCol")}</th>
              <th>{t("amount")}</th><th>{t("payStatus")}</th><th>{t("status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <BookingRow
                key={b.id} b={b} t={t}
                open={openRow === b.id}
                onToggle={() => setOpenRow(openRow === b.id ? null : b.id)}
                managerial={managerial}
                onStatus={setBookingStatus}
                onPay={setPay}
                onAttach={attachPdfs}
              />
            ))}
          </tbody>
        </table>
      </div>
      {showNew && (
        <NewBookingModal
          t={t} toast={toast} operators={operators}
          existing={rows}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}
    </>
  );
}

function BookingRow({ b, t, open, onToggle, managerial, onStatus, onPay, onAttach }) {
  const gers = (b.expand?.assigned_gers || []).map((g) => g.code).join("+") || "—";
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: managerial ? "pointer" : "default" }}>
        <td><b>{b.ref}</b></td>
        <td><span className={"src " + b.channel}>{b.channel}</span></td>
        <td>{b.guest_name}</td>
        <td>{b.expand?.operator?.name || "—"}</td>
        <td>{b.party} / {b.nights}{t("nights")[0]}</td>
        <td>{shortDate(b.check_in)} → {shortDate(b.check_out)}</td>
        <td>{gers}</td>
        <td>{fmt(b.amount)}</td>
        <td><span className={"tag " + (b.pay_status || "pending")}>{t(b.pay_status || "pending")}</span></td>
        <td><span className={"tag " + b.status}>{t(b.status)}</span></td>
      </tr>
      {open && managerial && (
        <tr>
          <td colSpan={10} style={{ background: "#fbfaf6" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 12 }}>{t("payStatus")}:</span>
              {["pending", "advance", "paid"].map((p) => (
                <button key={p} className={"btn sm " + (b.pay_status === p ? "" : "ghost")} onClick={() => onPay(b, p)}>
                  {t(p)}
                </button>
              ))}
              <span style={{ flex: 1 }} />
              {b.status === "confirmed" && (
                <button className="btn sm" onClick={() => onStatus(b, "checked_in")}>{t("markCheckedIn")}</button>
              )}
              {(b.status === "confirmed" || b.status === "checked_in") && (
                <button className="btn ghost sm" onClick={() => onStatus(b, "checked_out")}>{t("markCheckedOut")}</button>
              )}
              {b.status !== "cancelled" && b.status !== "checked_out" && (
                <button className="btn ghost sm" style={{ color: "var(--red)" }} onClick={() => onStatus(b, "cancelled")}>
                  {t("markCancelled")}
                </button>
              )}
            </div>
            <div className="file-chips" style={{ marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>PDF:</span>
              {(b.source_pdf || []).map((f) => (
                <a key={f} href={fileUrl("bookings", b, f)} target="_blank" rel="noreferrer">{f}</a>
              ))}
              {(b.source_pdf || []).length < 3 && (
                <UploadButton label="+ PDF" accept="application/pdf" multiple onFile={(files) => onAttach(b, files)} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function NewBookingModal({ t, toast, operators, existing, onClose, onSaved }) {
  const [f, setF] = useState({
    channel: "phone", guest_name: "", operator: "", party: 2, guides: 0,
    check_in: today(), check_out: "", amount: "", pay_status: "pending", services: "",
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false);

  function nextRef() {
    let max = 1000;
    existing.forEach((b) => {
      const m = /^BK-(\d+)$/.exec(b.ref || "");
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return "BK-" + (max + 1);
  }

  async function save() {
    if (!f.guest_name.trim() || !f.check_in || !f.check_out || !f.amount) return toast(t("required"));
    const nights = nightsBetween(f.check_in, f.check_out);
    if (!nights) return toast(t("required"));
    setBusy(true);
    try {
      await pb.collection("bookings").create({
        ref: nextRef(),
        channel: f.channel,
        operator: f.channel === "operator" ? f.operator || null : null,
        guest_name: f.guest_name.trim(),
        party: Number(f.party) || 1,
        guides: Number(f.guides) || 0,
        check_in: f.check_in,
        check_out: f.check_out,
        nights,
        status: "pending",
        amount: Number(f.amount) || 0,
        pay_status: f.pay_status,
        services: f.services ? f.services.split(",").map((s) => s.trim()).filter(Boolean) : [],
      });
      toast("✓");
      onSaved();
    } catch (_) {
      toast(t("connErr"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("newBooking")} onClose={onClose}>
      <div className="grid-form">
        <label className="field"><span>{t("channel")}</span>
          <select value={f.channel} onChange={(e) => set("channel", e.target.value)}>
            {["phone", "walkin", "operator", "website"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {f.channel === "operator" ? (
          <label className="field"><span>{t("operator")}</span>
            <select value={f.operator} onChange={(e) => set("operator", e.target.value)}>
              <option value="">—</option>
              {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        ) : <div />}
        <label className="field wide"><span>{t("guest")}</span>
          <input value={f.guest_name} onChange={(e) => set("guest_name", e.target.value)} autoFocus />
        </label>
        <label className="field"><span>{t("party")}</span>
          <input type="number" min="1" value={f.party} onChange={(e) => set("party", e.target.value)} />
        </label>
        <label className="field"><span>{t("guides")}</span>
          <input type="number" min="0" value={f.guides} onChange={(e) => set("guides", e.target.value)} />
        </label>
        <label className="field"><span>{t("checkIn")}</span>
          <input type="date" value={f.check_in} onChange={(e) => set("check_in", e.target.value)} />
        </label>
        <label className="field"><span>{t("checkOut")}</span>
          <input type="date" value={f.check_out} onChange={(e) => set("check_out", e.target.value)} />
        </label>
        <label className="field"><span>{t("amount")} (₮)</span>
          <input type="number" min="0" value={f.amount} onChange={(e) => set("amount", e.target.value)} />
        </label>
        <label className="field"><span>{t("payStatus")}</span>
          <select value={f.pay_status} onChange={(e) => set("pay_status", e.target.value)}>
            {["pending", "advance", "paid"].map((p) => <option key={p} value={p}>{t(p)}</option>)}
          </select>
        </label>
        <label className="field wide"><span>{t("services")}</span>
          <input value={f.services} onChange={(e) => set("services", e.target.value)} placeholder={t("servicesHint")} />
        </label>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn" onClick={save} disabled={busy}>{t("save")}</button>
      </div>
    </Modal>
  );
}
