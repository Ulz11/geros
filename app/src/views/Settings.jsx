import { useEffect, useState, useCallback } from "react";
import { pb } from "../lib/pb";
import { useLang } from "../lib/i18n";
import { useToast, Head, Loading } from "../components/ui";

// The public site reads these keys. Pre-listed so the admin doesn't have to
// remember them; saving creates the row if it doesn't exist yet.
const KNOWN_KEYS = [
  { key: "camp_name", hint: "Camp name (header, footer, page title)" },
  { key: "hero_title", hint: "Big headline on the landing page" },
  { key: "hero_sub", hint: "Sentence under the headline" },
  { key: "about", hint: "About section (rich text allowed)" },
  { key: "promo_1", hint: "Promo banner 1 (rich text allowed)" },
  { key: "promo_2", hint: "Promo banner 2" },
  { key: "address", hint: "Footer address" },
  { key: "contact_phone", hint: "Footer phone" },
  { key: "contact_email", hint: "Footer email" },
  { key: "invoice_footer", hint: "Payment terms / bank details printed on invoices" },
];

export default function Settings() {
  const { t } = useLang();
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [rows, setRows] = useState(null); // site_content records
  const [edit, setEdit] = useState(null); // key being edited
  const [form, setForm] = useState({ value_en: "", value_mn: "", published: true });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [u, c] = await Promise.all([
      pb.collection("users").getFullList({ sort: "created" }).catch(() => []),
      pb.collection("site_content").getFullList({ sort: "sort" }).catch(() => []),
    ]);
    setUsers(u);
    setRows(c);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!users || !rows) return <Loading t={t} />;

  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const allKeys = [
    ...KNOWN_KEYS,
    ...rows.filter((r) => !KNOWN_KEYS.some((k) => k.key === r.key)).map((r) => ({ key: r.key, hint: "" })),
  ];

  function openEdit(key) {
    const r = byKey[key];
    setForm({
      value_en: r?.value_en || "",
      value_mn: r?.value_mn || "",
      published: r ? !!r.published : true,
    });
    setEdit(key);
  }

  async function save() {
    setBusy(true);
    try {
      const r = byKey[edit];
      const data = {
        value_en: form.value_en,
        value_mn: form.value_mn,
        published: form.published,
      };
      if (r) await pb.collection("site_content").update(r.id, data);
      else await pb.collection("site_content").create({ key: edit, sort: rows.length + 1, ...data });
      toast("✓");
      setEdit(null);
      load();
    } catch (_) {
      toast(t("connErr"));
    } finally {
      setBusy(false);
    }
  }

  async function togglePublish(r) {
    try {
      await pb.collection("site_content").update(r.id, { published: !r.published });
      load();
    } catch (_) {
      toast(t("connErr"));
    }
  }

  const plain = (html) => {
    const d = document.createElement("div");
    d.innerHTML = html || "";
    return d.textContent.trim();
  };

  return (
    <>
      <Head title={t("settings")} sub={t("publicSite")}
        actions={<a className="btn ghost sm" href="/" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>🌐 {t("publicSite")} →</a>} />
      <div className="grid2">
        <div className="panel" style={{ overflow: "hidden" }}>
          <div className="card-pad" style={{ paddingBottom: 10 }}>
            <div className="sec-title">🌐 {t("publicSite")}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              EN/MN content the public site renders. Edit, publish, done.
            </div>
          </div>
          <table>
            <thead>
              <tr><th>Key</th><th>EN</th><th>MN</th><th>{t("status")}</th><th></th></tr>
            </thead>
            <tbody>
              {allKeys.map(({ key, hint }) => {
                const r = byKey[key];
                return (
                  <tr key={key}>
                    <td title={hint}><b>{key}</b></td>
                    <td className="muted" style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {plain(r?.value_en) || "—"}
                    </td>
                    <td className="muted" style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {plain(r?.value_mn) || "—"}
                    </td>
                    <td>
                      {r ? (
                        <button className={"chip " + (r.published ? "g" : "r")} onClick={() => togglePublish(r)}
                          style={{ cursor: "pointer" }}>
                          {r.published ? "live" : "off"}
                        </button>
                      ) : (
                        <span className="badge-soft">—</span>
                      )}
                    </td>
                    <td><button className="btn ghost sm" onClick={() => openEdit(key)}>✎</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <div className="panel card-pad">
            <div className="sec-title">👥 {t("usersRoles")}</div>
            {users.map((u) => (
              <div key={u.id} className="kv" style={{ marginTop: 6 }}>
                <span>{u.full_name || u.email}</span>
                <span className="badge-soft">{u.role || "—"}</span>
              </div>
            ))}
            <div className="ph" style={{ marginTop: 12 }}>
              Add / edit users in the PocketBase admin UI ( /_/ ) · max 5
            </div>
          </div>
          {edit && (
            <div className="panel card-pad" style={{ marginTop: 16 }}>
              <div className="sec-title">✎ {edit}</div>
              <label className="field" style={{ marginTop: 8 }}>
                <span>EN</span>
                <textarea rows={3} value={form.value_en} onChange={(e) => setForm({ ...form, value_en: e.target.value })} />
              </label>
              <label className="field" style={{ marginTop: 8 }}>
                <span>MN</span>
                <textarea rows={3} value={form.value_mn} onChange={(e) => setForm({ ...form, value_mn: e.target.value })} />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13 }}>
                <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
                published
              </label>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setEdit(null)}>{t("cancel")}</button>
                <button className="btn" onClick={save} disabled={busy}>{t("save")}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
