import { useEffect, useState, useCallback } from "react";
import { pb, fileUrl } from "../lib/pb";
import { useLang } from "../lib/i18n";
import { canEdit } from "../lib/perms";
import { useToast, Head, Tile, Loading, BarRow, Modal, UploadButton } from "../components/ui";
import { fmt, dateOf, today, monthKey, downloadCSV, parseJson } from "../lib/format";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const VAT_RATE = 0.1;

export default function Finance({ role }) {
  const { t } = useLang();
  const toast = useToast();
  const [inv, setInv] = useState(null);
  const [kitchen, setKitchen] = useState([]);
  const [wages, setWages] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [services, setServices] = useState([]);
  const [siteMeta, setSiteMeta] = useState({});
  const [showNew, setShowNew] = useState(false);
  const [printInv, setPrintInv] = useState(null);
  const editable = canEdit(role, "invoices");

  const load = useCallback(async () => {
    try {
      const [i, k, b, w, sv] = await Promise.all([
        pb.collection("invoices").getFullList({ sort: "-created", expand: "operator" }),
        pb.collection("kitchen_txns").getFullList({ sort: "-date" }).catch(() => []),
        pb.collection("bookings").getFullList({ sort: "-created", expand: "operator" }).catch(() => []),
        pb.collection("wage_payments").getFullList().catch(() => []),
        pb.collection("services").getFullList({ filter: "active = true", sort: "category,name" }).catch(() => []),
      ]);
      setInv(i);
      setKitchen(k);
      setBookings(b);
      setWages(w);
      setServices(sv);
    } catch (_) {
      toast(t("connErr"));
      setInv([]);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
    // camp identity for the printable invoice (public-readable content)
    pb.collection("site_content")
      .getFullList({ filter: 'published = true' })
      .then((rows) => {
        const meta = {};
        rows.forEach((r) => {
          const d = document.createElement("div");
          d.innerHTML = r.value_en || r.value_mn || "";
          meta[r.key] = d.textContent.trim();
        });
        setSiteMeta(meta);
      })
      .catch(() => {});
  }, [load]);

  async function setStatus(i, status) {
    try {
      await pb.collection("invoices").update(i.id, { status });
      load();
    } catch (_) {
      toast(t("connErr"));
    }
  }

  async function attachPdf(i, file) {
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append("pdf", file);
      await pb.collection("invoices").update(i.id, fd);
      toast("✓ PDF");
      load();
    } catch (_) {
      toast(t("connErr"));
    }
  }

  function exportCSV() {
    downloadCSV(
      "invoices.csv",
      ["number", "booking_ref", "operator", "amount", "vat", "total", "status", "issued"],
      (inv || []).map((i) => [
        i.number, i.booking_ref, i.expand?.operator?.name || "",
        i.amount, i.vat || 0, i.total || i.amount, i.status, dateOf(i.issued),
      ])
    );
  }

  if (!inv) return <Loading t={t} />;

  const sum = (s) => inv.filter((i) => i.status === s).reduce((a, i) => a + (i.amount || 0), 0);

  // monthly revenue (invoices) vs expense (kitchen expenses) - live data
  const months = {};
  inv.forEach((i) => {
    const mk = monthKey(i.issued || i.created);
    if (!mk) return;
    months[mk] = months[mk] || { rev: 0, exp: 0 };
    months[mk].rev += i.amount || 0;
  });
  kitchen.forEach((k) => {
    if (k.type !== "expense") return;
    const mk = monthKey(k.date);
    if (!mk) return;
    months[mk] = months[mk] || { rev: 0, exp: 0 };
    months[mk].exp += k.amount || 0;
  });
  // staff wages count as expenses too (period is already a "YYYY-MM" key)
  wages.forEach((w) => {
    const mk = w.period;
    if (!/^\d{4}-\d{2}$/.test(mk || "")) return;
    months[mk] = months[mk] || { rev: 0, exp: 0 };
    months[mk].exp += (w.amount || 0) + (w.bonus || 0) - (w.deduction || 0);
  });
  const series = Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  const maxv = Math.max(...series.map(([, v]) => Math.max(v.rev, v.exp)), 1);

  return (
    <>
      <Head title={t("finance")} actions={
        <>
          <button className="btn ghost sm" onClick={exportCSV}>{t("export")} CSV</button>
          {editable && <button className="btn sm" onClick={() => setShowNew(true)}>+ {t("newInvoice")}</button>}
        </>
      } />
      <div className="grid3" style={{ marginBottom: 16 }}>
        <Tile label={t("paid")} big={fmt(sum("paid"))} bigStyle={{ color: "var(--green)", fontSize: 24 }} />
        <Tile label={t("advance")} big={fmt(sum("advance"))} bigStyle={{ color: "var(--amber)", fontSize: 24 }} />
        <Tile label={t("pending")} big={fmt(sum("pending"))} bigStyle={{ color: "var(--red)", fontSize: 24 }} />
      </div>
      <div className="grid2">
        <div className="panel card-pad">
          <div className="sec-title">{t("revExpense")}</div>
          <div style={{ marginTop: 10 }}>
            {series.length === 0 && <div className="muted" style={{ fontSize: 13 }}>—</div>}
            {series.map(([mk, v]) => {
              const label = MONTH_NAMES[parseInt(mk.slice(5), 10) - 1] || mk;
              return (
                <div key={mk}>
                  <BarRow name={label} pct={(v.rev / maxv) * 100} value={fmt(v.rev)} />
                  <BarRow name={t("expense").toLowerCase()} pct={(v.exp / maxv) * 100} value={fmt(v.exp)}
                    fillStyle={{ background: "#d9b48a" }} />
                </div>
              );
            })}
          </div>
        </div>
        <div className="panel">
          <div className="card-pad" style={{ paddingBottom: 0 }}>
            <div className="sec-title">{t("invStatus")}</div>
          </div>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>{t("invoice")}</th><th>{t("ref")}</th><th>{t("operator")}</th>
                <th>{t("amount")}</th><th>{t("status")}</th><th>{t("date")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {inv.map((i) => (
                <tr key={i.id}>
                  <td><b>{i.number}</b></td>
                  <td>{i.booking_ref || "—"}</td>
                  <td>{i.expand?.operator?.name || "—"}</td>
                  <td>{fmt(i.amount)}</td>
                  <td>
                    {editable ? (
                      <select value={i.status || "pending"} onChange={(e) => setStatus(i, e.target.value)}
                        style={{ padding: "4px 8px", fontSize: 12 }}>
                        {["pending", "advance", "paid"].map((s) => <option key={s} value={s}>{t(s)}</option>)}
                      </select>
                    ) : (
                      <span className={"tag " + (i.status || "pending")}>{t(i.status || "pending")}</span>
                    )}
                  </td>
                  <td className="muted">{dateOf(i.issued)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn ghost sm" title="print" onClick={() => setPrintInv(i)}>🖨</button>
                    {editable && (
                      i.pdf ? (
                        <a className="btn ghost sm" style={{ textDecoration: "none", marginLeft: 4 }}
                          href={fileUrl("invoices", i, i.pdf)} target="_blank" rel="noreferrer">📎</a>
                      ) : (
                        <UploadButton label="+📎" accept="application/pdf" onFile={(f) => attachPdf(i, f)} />
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showNew && (
        <NewInvoiceModal t={t} toast={toast} bookings={bookings} existing={inv} services={services}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }} />
      )}
      {printInv && <InvoiceSheet t={t} inv={printInv} meta={siteMeta} onClose={() => setPrintInv(null)} />}
    </>
  );
}

function nextInvoiceNumber(existing, bump = 0) {
  const year = new Date().getFullYear();
  let max = 0;
  existing.forEach((i) => {
    const m = new RegExp("^INV-" + year + "-(\\d+)$").exec(i.number || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return "INV-" + year + "-" + String(max + 1 + bump).padStart(3, "0");
}

function NewInvoiceModal({ t, toast, bookings, existing, services = [], onClose, onSaved }) {
  const [bookingId, setBookingId] = useState("");
  const [lines, setLines] = useState([{ desc: "Accommodation", qty: 1, price: 0 }]);
  const [vatOn, setVatOn] = useState(false);
  const [status, setStatus] = useState("pending");
  const [busy, setBusy] = useState(false);
  const [svcPick, setSvcPick] = useState("");

  const booking = bookings.find((b) => b.id === bookingId);

  // the INVOICE GENERATOR: pick a service from the camp's price list - the line
  // arrives priced; per-person/per-night units prefill qty from the booking.
  function addService(id) {
    setSvcPick("");
    const s = services.find((x) => x.id === id);
    if (!s) return;
    let qty = 1;
    if (booking) {
      const p = booking.party || 1, n = booking.nights || 1;
      if (s.unit === "per_person") qty = p;
      else if (s.unit === "per_night") qty = n;
      else if (s.unit === "per_person_night") qty = p * n;
    }
    setLines((ls) => {
      const base = ls.length === 1 && !ls[0].price && (!ls[0].desc || ls[0].desc === "Accommodation") ? [] : ls;
      return [...base, { desc: s.name, qty, price: s.price }];
    });
  }

  function pickBooking(id) {
    setBookingId(id);
    const b = bookings.find((x) => x.id === id);
    if (b) {
      const services = parseJson(b.services, []);
      const base = [{
        desc: `${t("bookings")} ${b.ref} · ${b.party}p × ${b.nights}n`,
        qty: 1,
        price: b.amount || 0,
      }];
      services.forEach((s) => {
        if (typeof s === "string" && !s.startsWith("contact:")) base.push({ desc: s, qty: 1, price: 0 });
      });
      setLines(base);
    }
  }

  const setLine = (idx, k, v) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((ls) => [...ls, { desc: "", qty: 1, price: 0 }]);
  const rmLine = (idx) => setLines((ls) => ls.filter((_, i) => i !== idx));

  const amount = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const vat = vatOn ? Math.round(amount * VAT_RATE) : 0;
  const total = amount + vat;

  async function save() {
    if (!amount) return toast(t("required"));
    setBusy(true);
    const payload = {
      booking_ref: booking?.ref || "",
      operator: booking?.operator || "",
      line_items: lines.filter((l) => l.desc.trim()),
      amount, vat, total,
      status,
      issued: today(),
    };
    // unique number: retry on collision
    for (let bump = 0; bump < 3; bump++) {
      try {
        await pb.collection("invoices").create({ ...payload, number: nextInvoiceNumber(existing, bump) });
        toast("✓");
        onSaved();
        return;
      } catch (e) {
        if (bump === 2) toast(t("connErr"));
      }
    }
    setBusy(false);
  }

  return (
    <Modal title={t("newInvoice")} onClose={onClose}>
      <label className="field"><span>{t("bookings")}</span>
        <select value={bookingId} onChange={(e) => pickBooking(e.target.value)}>
          <option value="">—</option>
          {bookings.filter((b) => b.status !== "cancelled").map((b) => (
            <option key={b.id} value={b.id}>
              {b.ref} · {b.guest_name} · {fmt(b.amount)}
            </option>
          ))}
        </select>
      </label>
      <div style={{ marginTop: 12 }}>
        <div className="muted" style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t("invoice")}</div>
        {lines.map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input style={{ flex: 1 }} placeholder="…" value={l.desc} onChange={(e) => setLine(i, "desc", e.target.value)} />
            <input style={{ width: 56 }} type="number" min="0" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} />
            <input style={{ width: 110 }} type="number" min="0" placeholder="₮" value={l.price} onChange={(e) => setLine(i, "price", e.target.value)} />
            <button className="btn ghost sm" onClick={() => rmLine(i)}>✕</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button className="btn ghost sm" onClick={addLine}>+ {t("add")}</button>
          {services.length > 0 && (
            <select value={svcPick} onChange={(e) => addService(e.target.value)}
              style={{ fontSize: 12, padding: "5px 8px", maxWidth: 240 }}>
              <option value="">✦ {t("fromPriceList")}</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {fmt(s.price)} ({t(s.unit)})</option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div className="kv" style={{ marginTop: 12 }}><span>{t("amount")}</span><b>{fmt(amount)}</b></div>
      <div className="kv">
        <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={vatOn} onChange={(e) => setVatOn(e.target.checked)} />
          VAT 10%
        </label>
        <b>{fmt(vat)}</b>
      </div>
      <div className="kv" style={{ fontSize: 15 }}><span><b>{t("amount")} + VAT</b></span><b>{fmt(total)}</b></div>
      <div className="kv">
        <span>{t("status")}</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: "5px 9px", fontSize: 12 }}>
          {["pending", "advance", "paid"].map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </select>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn" onClick={save} disabled={busy}>{t("save")}</button>
      </div>
    </Modal>
  );
}

function InvoiceSheet({ t, inv, meta, onClose }) {
  const lines = parseJson(inv.line_items, []);
  const rows = lines.length
    ? lines
    : [{ desc: `Accommodation & services · ${inv.booking_ref || ""}`, qty: 1, price: inv.amount || 0 }];
  const amount = inv.amount || rows.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const vat = inv.vat || 0;
  const total = inv.total || amount + vat;
  const campName = meta.camp_name || "Ger Camp";

  return (
    <div className="print-sheet">
      <div className="sheet-actions no-print">
        <button className="btn ghost" onClick={onClose}>{t("close")}</button>
        <button className="btn" onClick={() => window.print()}>🖨 PDF</button>
      </div>
      <div className="inv-paper">
        <div className="inv-head">
          <div>
            <h1>{campName}</h1>
            <div className="muted" style={{ fontSize: 12 }}>
              {[meta.address, meta.contact_phone, meta.contact_email].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="inv-meta">
            <b style={{ fontSize: 17 }}>НЭХЭМЖЛЭХ / INVOICE</b><br />
            № {inv.number}<br />
            {t("issued")}: {dateOf(inv.issued) || dateOf(inv.created)}
          </div>
        </div>
        <div className="inv-parties">
          <div className="p">
            <div className="lbl">Төлөгч / Bill to</div>
            {inv.expand?.operator?.name || "—"}<br />
            {inv.expand?.operator?.email || ""}
          </div>
          <div className="p" style={{ textAlign: "right" }}>
            <div className="lbl">{t("ref")}</div>
            {inv.booking_ref || "—"}
          </div>
        </div>
        <table className="inv-table">
          <thead>
            <tr>
              <th>Тайлбар / Description</th>
              <th className="num">Тоо / Qty</th>
              <th className="num">Үнэ / Price</th>
              <th className="num">Дүн / Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={i}>
                <td>{l.desc}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{fmt(l.price)}</td>
                <td className="num">{fmt((Number(l.qty) || 0) * (Number(l.price) || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="inv-totals">
          <div className="row"><span>Дүн / Subtotal</span><span>{fmt(amount)}</span></div>
          {vat > 0 && <div className="row"><span>НӨАТ / VAT 10%</span><span>{fmt(vat)}</span></div>}
          <div className="row grand"><span>НИЙТ / TOTAL</span><span>{fmt(total)}</span></div>
        </div>
        <div className="inv-foot">
          {meta.invoice_footer || "Төлбөрийг нэхэмжлэх хүлээн авснаас хойш 14 хоногийн дотор шилжүүлнэ үү. / Payment due within 14 days of invoice date."}
        </div>
      </div>
    </div>
  );
}
