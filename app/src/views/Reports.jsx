import { useEffect, useState } from "react";
import { pb } from "../lib/pb";
import { useLang } from "../lib/i18n";
import { useToast, Head, Tile, Loading, BarRow } from "../components/ui";
import { fmt, dateOf, today, monthKey, downloadCSV } from "../lib/format";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// which date "places" a record in a season
const invoiceDate = (i) => i.issued || i.created;
const kitchenDate = (k) => k.date || k.created;
const bookingDate = (b) => b.check_in || b.created;
const yearOf = (v) => dateOf(v).slice(0, 4);

export default function Reports() {
  const { t } = useLang();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [siteMeta, setSiteMeta] = useState({});
  const [season, setSeason] = useState("all");
  const [printOpen, setPrintOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [gers, bookings, invoices, kitchen, operators] = await Promise.all([
          pb.collection("gers").getFullList({ fields: "id,status" }),
          pb.collection("bookings").getFullList(),
          pb.collection("invoices").getFullList(),
          pb.collection("kitchen_txns").getFullList(),
          pb.collection("tour_operators").getFullList().catch(() => []),
        ]);
        if (alive) setData({ gers, bookings, invoices, kitchen, operators });
      } catch (_) {
        if (alive) setData({ gers: [], bookings: [], invoices: [], kitchen: [], operators: [] });
      }
    })();
    // camp identity for the printable report header (same source as the invoice)
    pb.collection("site_content")
      .getFullList({ filter: "published = true" })
      .then((rows) => {
        const meta = {};
        rows.forEach((r) => {
          const d = document.createElement("div");
          d.innerHTML = r.value_en || r.value_mn || "";
          meta[r.key] = d.textContent.trim();
        });
        if (alive) setSiteMeta(meta);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data) return <Loading t={t} />;
  const { gers, bookings, invoices, kitchen, operators } = data;

  // season (year) filter — "all" keeps the original all-time behaviour
  const years = [...new Set([
    ...invoices.map((i) => yearOf(invoiceDate(i))),
    ...kitchen.map((k) => yearOf(kitchenDate(k))),
    ...bookings.map((b) => yearOf(bookingDate(b))),
  ].filter(Boolean))].sort().reverse();
  const inSeason = (v) => season === "all" || yearOf(v) === season;

  const fInv = invoices.filter((i) => inSeason(invoiceDate(i)));
  const fKitchen = kitchen.filter((k) => inSeason(kitchenDate(k)));
  const fBookings = bookings.filter((b) => inSeason(bookingDate(b)));
  const active = fBookings.filter((b) => b.status !== "cancelled");

  const totalRev = fInv.reduce((s, i) => s + (i.amount || 0), 0);
  const kIn = fKitchen.filter((k) => k.type === "income").reduce((s, k) => s + k.amount, 0);
  const kOut = fKitchen.filter((k) => k.type === "expense").reduce((s, k) => s + k.amount, 0);
  const net = totalRev + kIn - kOut;
  const margin = totalRev + kIn > 0 ? Math.round((net / (totalRev + kIn)) * 100) : 0;

  const chan = { operator: 0, website: 0, phone: 0, walkin: 0 };
  active.forEach((b) => { chan[b.channel] = (chan[b.channel] || 0) + 1; });
  const cmax = Math.max(...Object.values(chan), 1);

  const byStatus = {};
  fBookings.forEach((b) => { byStatus[b.status] = (byStatus[b.status] || 0) + 1; });

  const occ = gers.length ? Math.round((gers.filter((g) => g.status === "occupied").length / gers.length) * 100) : 0;
  const guests = active.reduce((s, b) => s + (b.party || 0), 0);
  const nights = active.reduce((s, b) => s + (b.nights || 0), 0);
  const avgBooking = active.length ? Math.round(active.reduce((s, b) => s + (b.amount || 0), 0) / active.length) : 0;

  // monthly breakdown: invoice revenue + kitchen income/expense per month
  const months = {};
  const monthRow = (mk) => (months[mk] = months[mk] || { rev: 0, kin: 0, exp: 0 });
  fInv.forEach((i) => { const mk = monthKey(invoiceDate(i)); if (mk) monthRow(mk).rev += i.amount || 0; });
  fKitchen.forEach((k) => {
    const mk = monthKey(kitchenDate(k));
    if (!mk) return;
    if (k.type === "income") monthRow(mk).kin += k.amount || 0;
    else monthRow(mk).exp += k.amount || 0;
  });
  const monthly = Object.entries(months).sort(([a], [b]) => a.localeCompare(b))
    .map(([mk, v]) => ({ mk, ...v, net: v.rev + v.kin - v.exp }));

  // top operators by invoice revenue (the financial truth), top 5
  const byOp = {};
  fInv.forEach((i) => {
    if (!i.operator) return;
    byOp[i.operator] = byOp[i.operator] || { total: 0, count: 0 };
    byOp[i.operator].total += i.amount || 0;
    byOp[i.operator].count += 1;
  });
  const topOps = Object.entries(byOp)
    .map(([id, v]) => ({ name: operators.find((o) => o.id === id)?.name || "—", ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const top = topOps[0]?.name || "—";

  // invoice status summary
  const invStatus = ["paid", "advance", "pending"].map((s) => {
    const rows = fInv.filter((i) => (i.status || "pending") === s);
    return { s, count: rows.length, sum: rows.reduce((a, i) => a + (i.amount || 0), 0) };
  });

  const stats = { totalRev, kIn, kOut, net, margin, chan, byStatus, guests, nights,
    avgBooking, monthly, topOps, invStatus, bookings: active.length };

  function exportSummary() {
    downloadCSV(`season-report-${season}.csv`,
      ["metric", "value"],
      [
        ["season", season],
        ["total_invoice_revenue", totalRev],
        ["kitchen_income", kIn],
        ["kitchen_expense", kOut],
        ["net", net],
        ["margin_pct", margin],
        ["occupancy_now_pct", occ],
        ["total_bookings", active.length],
        ["total_guests", guests],
        ["total_nights", nights],
        ["avg_booking_value", avgBooking],
        ["top_operator", top],
        ...Object.entries(chan).map(([k, v]) => ["bookings_" + k, v]),
        ...monthly.map((m) => [`month_${m.mk}_net`, m.net]),
      ]
    );
    toast("✓ CSV");
  }

  return (
    <>
      <Head title={t("reports")} sub={t("seasonReport")}
        actions={
          <>
            <select value={season} onChange={(e) => setSeason(e.target.value)}
              style={{ padding: "6px 10px", fontSize: 13 }} title={t("season")}>
              <option value="all">{t("allTime")}</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className="btn ghost sm" onClick={exportSummary}>{t("export")} CSV</button>
            <button className="btn sm" onClick={() => setPrintOpen(true)}>🖨 {t("printReport")}</button>
          </>
        } />
      <div className="grid3" style={{ marginBottom: 16 }}>
        <Tile label={t("totalRev")} big={fmt(totalRev + kIn)} bigStyle={{ color: "var(--green)", fontSize: 24 }} />
        <Tile label={t("expense")} big={fmt(kOut)} bigStyle={{ color: "var(--red)", fontSize: 24 }} />
        <Tile label={t("profit")} big={fmt(net)} bigStyle={{ fontSize: 24 }}
          sub={<span className="chip g">{margin}% {t("margin")}</span>} />
      </div>
      <div className="grid2">
        <div className="panel card-pad">
          <div className="sec-title">{t("byChannel")}</div>
          <div style={{ marginTop: 12 }}>
            {Object.entries(chan).map(([k, v]) => (
              <BarRow key={k} name={k} pct={(v / cmax) * 100} value={v} />
            ))}
          </div>
        </div>
        <div className="panel card-pad">
          <div className="sec-title">{t("seasonReport")}</div>
          <div className="kv" style={{ marginTop: 8 }}><span>{t("occupancyNow")}</span><b>{occ}%</b></div>
          <div className="kv"><span>{t("totalBookings")}</span><b>{active.length}</b></div>
          <div className="kv"><span>{t("avgBooking")}</span><b>{fmt(avgBooking)}</b></div>
          <div className="kv"><span>{t("topOperator")}</span><b>{top}</b></div>
          <div className="kv"><span>{t("kitchenNet")}</span><b>{fmt(kIn - kOut)}</b></div>
          <button className="btn sm" style={{ marginTop: 14 }} onClick={() => setPrintOpen(true)}>
            📄 {t("printReport")} (PDF)
          </button>
        </div>
      </div>
      {printOpen && (
        <ReportSheet t={t} meta={siteMeta} season={season} stats={stats}
          onClose={() => setPrintOpen(false)} />
      )}
    </>
  );
}

/* Printable end-of-season report. Bilingual like the invoice sheet - a formal
   document the owner hands to a partner or accountant. Browser print = PDF. */
const CH_LBL = { operator: "Оператор / Operator", website: "Вэбсайт / Website", phone: "Утас / Phone", walkin: "Шууд ирсэн / Walk-in" };
const ST_LBL = { pending: "Хүлээгдэж буй / Pending", confirmed: "Баталгаажсан / Confirmed", checked_in: "Бүртгэгдсэн / Checked-in", checked_out: "Гарсан / Checked-out", cancelled: "Цуцалсан / Cancelled" };
const PAY_LBL = { paid: "Төлсөн / Paid", advance: "Урьдчилгаа / Advance", pending: "Хүлээгдэж буй / Pending" };

function ReportSheet({ t, meta, season, stats, onClose }) {
  const campName = meta.camp_name || "Ger Camp";
  const period = season === "all" ? "Бүх хугацаа / All time" : `${season} он / Season ${season}`;
  const monthLbl = (mk) => {
    const m = parseInt(mk.slice(5), 10);
    return `${mk.slice(0, 4)} · ${m}-р сар / ${MONTH_NAMES[m - 1] || mk}`;
  };

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
            <b style={{ fontSize: 17 }}>УЛИРЛЫН ТАЙЛАН / SEASON REPORT</b><br />
            {period}<br />
            Гаргасан / Generated: {today()}
          </div>
        </div>

        <div className="rep-sec">Санхүүгийн дүн / Financial summary</div>
        <table className="inv-table">
          <tbody>
            <tr><td>Нэхэмжлэхийн орлого / Invoice revenue</td><td className="num">{fmt(stats.totalRev)}</td></tr>
            <tr><td>Гал тогооны орлого / Kitchen income</td><td className="num">{fmt(stats.kIn)}</td></tr>
            <tr><td>Гал тогооны зарлага / Kitchen expense</td><td className="num">−{fmt(stats.kOut)}</td></tr>
            <tr style={{ fontWeight: 700 }}>
              <td>ЦЭВЭР / NET ({stats.margin}% {t("margin")})</td>
              <td className="num">{fmt(stats.net)}</td>
            </tr>
          </tbody>
        </table>

        {stats.monthly.length > 0 && (
          <>
            <div className="rep-sec">Сарын задаргаа / Monthly breakdown</div>
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Сар / Month</th>
                  <th className="num">Орлого / Revenue</th>
                  <th className="num">Гал тогоо / Kitchen</th>
                  <th className="num">Зарлага / Expense</th>
                  <th className="num">Цэвэр / Net</th>
                </tr>
              </thead>
              <tbody>
                {stats.monthly.map((m) => (
                  <tr key={m.mk}>
                    <td>{monthLbl(m.mk)}</td>
                    <td className="num">{fmt(m.rev)}</td>
                    <td className="num">{fmt(m.kin)}</td>
                    <td className="num">{fmt(m.exp)}</td>
                    <td className="num"><b>{fmt(m.net)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="rep-sec">Захиалга / Bookings</div>
        <div className="rep-cols">
          <table className="inv-table">
            <tbody>
              <tr><td>Нийт захиалга / Total bookings</td><td className="num">{stats.bookings}</td></tr>
              <tr><td>Зочид / Guests</td><td className="num">{stats.guests}</td></tr>
              <tr><td>Хоног / Nights</td><td className="num">{stats.nights}</td></tr>
              <tr><td>Дундаж дүн / Avg value</td><td className="num">{fmt(stats.avgBooking)}</td></tr>
            </tbody>
          </table>
          <table className="inv-table">
            <tbody>
              {Object.entries(stats.chan).map(([k, v]) => (
                <tr key={k}><td>{CH_LBL[k] || k}</td><td className="num">{v}</td></tr>
              ))}
              {Object.entries(stats.byStatus).filter(([s]) => s === "cancelled").map(([s, v]) => (
                <tr key={s}><td>{ST_LBL[s] || s}</td><td className="num">{v}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        {stats.topOps.length > 0 && (
          <>
            <div className="rep-sec">Шилдэг операторууд / Top operators</div>
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Оператор / Operator</th>
                  <th className="num">Нэхэмжлэх / Invoices</th>
                  <th className="num">Дүн / Amount</th>
                </tr>
              </thead>
              <tbody>
                {stats.topOps.map((o, i) => (
                  <tr key={i}><td>{o.name}</td><td className="num">{o.count}</td><td className="num">{fmt(o.total)}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="rep-sec">Нэхэмжлэхийн төлөв / Invoice status</div>
        <table className="inv-table">
          <tbody>
            {stats.invStatus.map(({ s, count, sum }) => (
              <tr key={s}><td>{PAY_LBL[s]}</td><td className="num">{count}</td><td className="num">{fmt(sum)}</td></tr>
            ))}
          </tbody>
        </table>

        <div className="inv-foot">
          GerOS — улирлын автомат тайлан / automated season report · {today()}
        </div>
      </div>
    </div>
  );
}
