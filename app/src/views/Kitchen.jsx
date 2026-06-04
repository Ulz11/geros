import { useEffect, useState, useCallback } from "react";
import { pb } from "../lib/pb";
import { useLang } from "../lib/i18n";
import { canEdit } from "../lib/perms";
import { useToast, Head, Tile, Loading } from "../components/ui";
import { fmt, today, dateOf, monthKey, downloadCSV } from "../lib/format";

export default function Kitchen({ role, user }) {
  const { t } = useLang();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ type: "income", category: "restaurant", note: "", amount: "" });
  const editable = canEdit(role, "kitchen_txns");

  const load = useCallback(async () => {
    try {
      setRows(await pb.collection("kitchen_txns").getFullList({ sort: "-date,-created" }));
    } catch (_) {
      toast(t("connErr"));
      setRows([]);
    }
  }, [t, toast]);

  useEffect(() => { load(); }, [load]);

  async function add() {
    const amt = Number(f.amount);
    if (!amt || amt <= 0) return toast(t("required"));
    try {
      await pb.collection("kitchen_txns").create({
        date: today(),
        type: f.type,
        category: f.category,
        note: f.note || "—",
        amount: amt,
        created_by: user.full_name || user.email,
      });
      setF((x) => ({ ...x, note: "", amount: "" }));
      toast(`${t("add")} ✓`);
      load();
    } catch (_) {
      toast(t("connErr"));
    }
  }

  function exportCSV() {
    downloadCSV(
      "kitchen.csv",
      ["date", "type", "category", "note", "amount", "user"],
      (rows || []).map((k) => [dateOf(k.date), k.type, k.category, k.note, k.amount, k.created_by])
    );
  }

  if (!rows) return <Loading t={t} />;

  const mk = monthKey(today());
  const month = rows.filter((k) => monthKey(k.date) === mk);
  const inc = month.filter((k) => k.type === "income").reduce((s, k) => s + k.amount, 0);
  const exp = month.filter((k) => k.type === "expense").reduce((s, k) => s + k.amount, 0);

  return (
    <>
      <Head title={t("kitchen")} sub={t("thisMonth")}
        actions={<button className="btn ghost sm" onClick={exportCSV}>{t("export")} CSV</button>} />
      <div className="grid3" style={{ marginBottom: 16 }}>
        <Tile label={t("income")} big={fmt(inc)} bigStyle={{ color: "var(--green)", fontSize: 24 }} />
        <Tile label={t("expense")} big={fmt(exp)} bigStyle={{ color: "var(--red)", fontSize: 24 }} />
        <Tile label={t("profit")} big={fmt(inc - exp)} bigStyle={{ fontSize: 24 }} />
      </div>
      <div className="panel">
        {editable && (
          <div className="card-pad" style={{ paddingBottom: 12, borderBottom: "1px solid var(--line)" }}>
            <div className="sec-title">{t("quickAdd")}</div>
            <div className="form-row">
              <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                <option value="income">{t("income")}</option>
                <option value="expense">{t("expense")}</option>
              </select>
              <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {["restaurant", "groceries", "wages", "utilities", "other"].map((c) => (
                  <option key={c} value={c}>{t(c)}</option>
                ))}
              </select>
              <input placeholder={t("note")} value={f.note} style={{ flex: 1, minWidth: 140 }}
                onChange={(e) => setF({ ...f, note: e.target.value })} />
              <input type="number" placeholder="₮" value={f.amount} style={{ width: 120 }}
                onChange={(e) => setF({ ...f, amount: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && add()} />
              <button className="btn sm" onClick={add}>{t("add")}</button>
            </div>
          </div>
        )}
        <table>
          <thead>
            <tr>
              <th>{t("date")}</th><th>{t("status")}</th><th>{t("category")}</th>
              <th>{t("note")}</th><th>{t("amount")}</th><th>{t("user")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k.id}>
                <td className="muted">{dateOf(k.date)}</td>
                <td><span className={"chip " + (k.type === "income" ? "g" : "r")}>{t(k.type)}</span></td>
                <td>{t(k.category) || k.category}</td>
                <td>{k.note}</td>
                <td style={{ fontWeight: 600, color: k.type === "income" ? "var(--green)" : "var(--red)" }}>
                  {k.type === "income" ? "+" : "−"}{fmt(k.amount)}
                </td>
                <td className="muted">{k.created_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
