import { useEffect, useState, useCallback } from "react";
import { pb } from "../lib/pb";
import { useLang } from "../lib/i18n";
import { useToast, Head, Loading } from "../components/ui";
import { today } from "../lib/format";

// Availability calendar: gers x days, fed by GET /api/camp/availability.
// Teal = reserved (confirmed), red = guests in the ger (checked_in).
const WINDOW = 21; // 3 weeks on screen; arrows shift by a week

const addDays = (iso, n) =>
  new Date(new Date(iso + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

export default function Calendar() {
  const { t, lang } = useLang();
  const toast = useToast();
  const [from, setFrom] = useState(today());
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await pb.send(`/api/camp/availability?from=${from}&days=${WINDOW}`, { method: "GET" });
      setData(r);
    } catch (_) {
      toast(t("connErr"));
      setData({ from, days: WINDOW, gers: [] });
    }
  }, [from, t, toast]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <Loading t={t} />;

  const days = Array.from({ length: data.days }, (_, i) => addDays(data.from, i));
  const todayStr = today();
  const dow = (iso) =>
    new Date(iso + "T00:00:00Z").toLocaleDateString(lang === "mn" ? "mn-MN" : "en-US", { weekday: "narrow", timeZone: "UTC" });

  // cell -> reservation covering that day ([check_in, check_out) half-open)
  const at = (ger, d) => ger.bookings.find((b) => b.check_in <= d && d < b.check_out);

  return (
    <>
      <Head title={t("calendar")} sub={`${data.from} → ${addDays(data.from, data.days - 1)}`}
        actions={
          <>
            <button className="btn ghost sm" onClick={() => setFrom(addDays(from, -7))}>←</button>
            <button className="btn ghost sm" onClick={() => setFrom(today())}>{t("todayBtn")}</button>
            <button className="btn ghost sm" onClick={() => setFrom(addDays(from, 7))}>→</button>
          </>
        } />
      <div className="panel card-pad" style={{ overflowX: "auto" }}>
        <div className="cal-legend">
          <span><i className="cal-key res" /> {t("reserved")}</span>
          <span><i className="cal-key occ" /> {t("occupied")}</span>
        </div>
        <table className="cal">
          <thead>
            <tr>
              <th className="cal-ger">{t("gerCol")}</th>
              {days.map((d) => (
                <th key={d} className={d === todayStr ? "cal-today" : ""}>
                  <div className="cal-dow">{dow(d)}</div>
                  {parseInt(d.slice(8), 10)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.gers.length === 0 && (
              <tr><td colSpan={days.length + 1} className="muted" style={{ fontSize: 13 }}>—</td></tr>
            )}
            {data.gers.map((g) => (
              <tr key={g.id}>
                <td className="cal-ger">
                  <span className={"cal-dot " + g.status} />
                  <b>{g.code}</b>
                  <span className="muted" style={{ marginLeft: 5, fontSize: 11 }}>{g.capacity}</span>
                </td>
                {days.map((d) => {
                  const b = at(g, d);
                  if (!b) return <td key={d} className={"cal-cell" + (d === todayStr ? " cal-today" : "")} />;
                  const first = b.check_in === d || d === data.from;
                  return (
                    <td key={d}
                      className={"cal-cell " + (b.status === "checked_in" ? "occ" : "res") + (d === todayStr ? " cal-today" : "")}
                      title={`${b.ref} · ${b.guest} · ${b.party}p · ${b.check_in} → ${b.check_out}`}>
                      {first ? <span className="cal-ref">{b.ref.replace(/^BK-/, "")}</span> : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
