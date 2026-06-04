import { useEffect, useState } from "react";
import { pb } from "../lib/pb";
import { useLang } from "../lib/i18n";
import { canDo } from "../lib/perms";
import { Head, Tile, Loading } from "../components/ui";
import { fmt, today, dateOf, monthKey } from "../lib/format";

export default function Dashboard({ role, go }) {
  const { t } = useLang();
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [gers, bookings, invoices, kitchen] = await Promise.all([
          pb.collection("gers").getFullList({ fields: "id,status,capacity" }),
          pb.collection("bookings").getFullList({ sort: "-created" }),
          pb.collection("invoices").getFullList({ sort: "-created" }),
          pb.collection("kitchen_txns").getFullList({ sort: "-date" }),
        ]);
        if (alive) setData({ gers, bookings, invoices, kitchen });
      } catch (_) {
        if (alive) setData({ gers: [], bookings: [], invoices: [], kitchen: [] });
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!data) return <Loading t={t} />;
  const { gers, bookings, invoices, kitchen } = data;

  const total = gers.length || 1;
  const o = gers.filter((g) => g.status === "occupied").length;
  const a = gers.filter((g) => g.status === "available").length;
  const c = gers.filter((g) => g.status === "cleaning").length;
  const pct = Math.round((o / total) * 100);

  const td = today();
  const arrivals = bookings.filter((b) => dateOf(b.check_in) === td && b.status !== "cancelled");
  const departures = bookings.filter((b) => dateOf(b.check_out) === td && b.status !== "cancelled").length;

  const mk = monthKey(td);
  const revMonth = invoices.filter((i) => monthKey(i.issued) === mk).reduce((s, i) => s + (i.amount || 0), 0);
  const pendInv = invoices.filter((i) => i.status !== "paid");
  const pendSum = pendInv.reduce((s, i) => s + (i.amount || 0), 0);

  const kToday = kitchen.filter((k) => dateOf(k.date) === td);
  const kIn = kToday.filter((k) => k.type === "income").reduce((s, k) => s + k.amount, 0);
  const kOut = kToday.filter((k) => k.type === "expense").reduce((s, k) => s + k.amount, 0);

  return (
    <>
      <Head
        title={t("dashboard")}
        sub={new Date().toDateString()}
        actions={canDo(role, "bookings") ? (
          <button className="btn" onClick={() => go("bookings")}>+ {t("newBooking")}</button>
        ) : null}
      />
      <div className="bento">
        <Tile label={t("occupancy")} big={pct + "%"} sub={`${o}/${total} ${t("occupied").toLowerCase()}`} />
        <Tile label={t("available")} big={a} bigStyle={{ color: "var(--green)" }}
          sub={<span className="chip a">{c} {t("cleaning").toLowerCase()}</span>} />
        <div className="tile span2">
          <div className="lbl">{t("occupancy")} · live</div>
          <div className="occ-bars">
            {gers.slice(0, 12).map((g) => (
              <div key={g.id} className="b" style={{
                height: 30 + (g.capacity || 1) * 9 + "%",
                background: g.status === "occupied" ? "var(--red)" : g.status === "cleaning" ? "var(--amber)" : "var(--green)",
              }} />
            ))}
          </div>
        </div>
        <Tile label={t("revenueMonth")} big={fmt(revMonth)} />
        <Tile label={t("pendingInv")} big={pendInv.length} bigStyle={{ color: "var(--amber)" }} sub={fmt(pendSum)} />
        <div className="tile span2r">
          <div className="lbl">{t("todayArr")}</div>
          <div className="mini-list">
            {arrivals.length === 0 && <div className="muted">—</div>}
            {arrivals.map((b) => (
              <div key={b.id} className="mini-row">
                <div>
                  <b>{b.guest_name}</b>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {b.party} {t("party").toLowerCase()} · {b.nights} {t("nights").toLowerCase()}
                  </div>
                </div>
                <span className={"src " + b.channel}>{b.channel}</span>
              </div>
            ))}
          </div>
        </div>
        <Tile label={t("arrivalsToday")} big={arrivals.length} bigStyle={{ color: "var(--accent)" }} />
        <Tile label={t("kitchenPnl")} big={fmt(kIn - kOut)}
          bigStyle={{ color: kIn - kOut >= 0 ? "var(--green)" : "var(--red)" }}
          sub={`${t("income")} ${fmt(kIn)} · ${t("expense")} ${fmt(kOut)}`} />
        <Tile label={t("departuresToday")} big={departures} />
      </div>
    </>
  );
}
