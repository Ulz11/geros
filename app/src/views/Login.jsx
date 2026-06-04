import { useState } from "react";
import { pb } from "../lib/pb";
import { useLang } from "../lib/i18n";

export default function Login({ onLogin }) {
  const { t } = useLang();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await pb.collection("users").authWithPassword(email.trim(), pass);
      onLogin();
    } catch (ex) {
      setErr(ex?.status === 0 ? t("connErr") : t("loginFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand">
          <div className="logo" />
          <h1>GerOS</h1>
        </div>
        <p>{t("tagline")}</p>
        <form className="login-form" onSubmit={submit}>
          <input
            type="email"
            placeholder={t("email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
          <input
            type="password"
            placeholder={t("password")}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            required
          />
          <div className="login-err">{err}</div>
          <button className="btn" type="submit" disabled={busy}>
            {t("signIn")}
          </button>
        </form>
      </div>
    </div>
  );
}
