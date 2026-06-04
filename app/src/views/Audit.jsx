import { useEffect, useState } from "react";
import { pb } from "../lib/pb";
import { useLang } from "../lib/i18n";
import { Head, Loading } from "../components/ui";

export default function Audit() {
  const { t, lang } = useLang();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    pb.collection("audit_log")
      .getList(1, 200, { sort: "-ts" })
      .then((r) => alive && setRows(r.items))
      .catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, []);

  if (!rows) return <Loading t={t} />;

  const fmtTs = (ts) => String(ts || "").slice(0, 16).replace("T", " ");

  return (
    <>
      <Head title={t("audit")} sub={`${rows.length} ${t("entries")}`} />
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>{t("time")}</th><th>{t("user")}</th><th>{t("role")}</th>
              <th>{t("action")}</th><th>Entity</th><th>{t("detail")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtTs(a.ts)}</td>
                <td>
                  <span className="avatar" style={{ width: 22, height: 22, fontSize: 10, display: "inline-flex", marginRight: 6 }}>
                    {(a.user || "?").trim().split(" ").pop()[0]?.toUpperCase()}
                  </span>
                  {a.user}
                </td>
                <td><span className="badge-soft">{a.role}</span></td>
                <td><b>{t(a.action) || a.action}</b></td>
                <td>{a.entity}</td>
                <td className="muted">{a.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
