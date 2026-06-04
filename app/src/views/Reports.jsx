import { useEffect, useState } from "react";
import { pb } from "../lib/pb";
import { useLang } from "../lib/i18n";
import { useToast, Head, Tile, Loading, BarRow } from "../components/ui";
import { fmt, downloadCSV } from "../lib/format";

export default function Reports() {
  const { t } = useLang();
  const toast = useToast();
  const [data, setData] = useState(null);

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
    return () => { alive = false; };
  }, []);

  if (!data) return <Loading t={t} />;
  const { gers, bookings, invoices, kitchen, operators } = data;

  const active = bookings.filter((b) => b.status !== "cancelled");
  const totalRev = invoices.reduce((s, i) => s + (i.amount || 0), 0);
  const kIn = kitchen.filter((k) => k.type === "income").reduce((s, k) => s + k.amount, 0);
  const kOut = kitchen.filter((k) => k.type === "expense").reduce((s, k) => s + k.amount, 0);
  const totalExp = kOut;
  const net = totalRev + kIn - kOut;
  const margin = totalRev + kIn > 0 ? Math.round((net / (totalRev + kIn)) * 100) : 0;

  const chan = { operator: 0, website: 0, phone: 0, walkin: 0 };
  active.forEach((b) => { chan[b.channel] = (chan[b.channel] || 0) + 1; });
  const cmax = Math.max(...Object.values(chan), 1);

  const occ = gers.length ? Math.round((gers.filter((g) => g.status === "occupied").length / gers.length) * 100) : 0;
  const avgBooking = active.length ? Math.round(active.reduce((s, b) => s + (b.amount || 0), 0) / active.length) : 0;

  // top operator by booking revenue
  let top = "—";
  if (operators.length) {
    const byOp = {};
    active.forEach((b) => { if (b.operator) byOp[b.operator] = (byOp[b.operator] || 0) + (b.amount || 0); });
    const best = Object.entries(byOp).sort(([, a], [, b]) => b - a)[0];
    if (best) top = operators.find((o) => o.id === best[0])?.name || "—";
  }

  function exportSummary() {
    downloadCSV("season-report.csv",
      ["metric", "value"],
      [
        ["total_invoice_revenue", totalRev],
        ["kitchen_income", kIn],
        ["kitchen_expense", kOut],
        ["net", net],
        ["margin_pct", margin],
        ["occupancy_now_pct", occ],
        ["total_bookings", active.length],
        ["avg_booking_value", avgBooking],
        ["top_operator", top],
        ...Object.entries(chan).map(([k, v]) => ["bookings_" + k, v]),
      ]
    );
    toast("✓ CSV");
  }

  return (
    <>
      <Head title={t("reports")} sub={t("seasonReport")}
        actions={<button className="btn ghost sm" onClick={exportSummary}>{t("export")} CSV</button>} />
      <div className="grid3" style={{ marginBottom: 16 }}>
        <Tile label={t("totalRev")} big={fmt(totalRev + kIn)} bigStyle={{ color: "var(--green)", fontSize: 24 }} />
        <Tile label={t("expense")} big={fmt(totalExp)} bigStyle={{ color: "var(--red)", fontSize: 24 }} />
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
          <div className="ph" style={{ marginTop: 14 }}>📄 PDF — Day 3</div>
        </div>
      </div>
    </>
  );
}
