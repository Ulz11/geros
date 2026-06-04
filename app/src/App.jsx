import { useEffect, useState } from "react";
import { pb, currentUser } from "./lib/pb";
import { PERMS, NAV } from "./lib/perms";
import { useLang } from "./lib/i18n";
import Login from "./views/Login";
import Dashboard from "./views/Dashboard";
import GerMap from "./views/GerMap";
import Bookings from "./views/Bookings";
import Operators from "./views/Operators";
import Finance from "./views/Finance";
import Kitchen from "./views/Kitchen";
import Reports from "./views/Reports";
import Audit from "./views/Audit";
import Settings from "./views/Settings";
import { Deny } from "./components/ui";

const VIEWS = {
  dashboard: Dashboard,
  gers: GerMap,
  bookings: Bookings,
  operators: Operators,
  finance: Finance,
  kitchen: Kitchen,
  reports: Reports,
  audit: Audit,
  settings: Settings,
};

const ROLE_LABEL = {
  en: { admin: "Administrator", manager: "Manager", kitchen: "Kitchen", worker: "Worker" },
  mn: { admin: "Админ", manager: "Менежер", kitchen: "Тогооч", worker: "Ажилтан" },
};

export default function App() {
  const { lang, setLang, t } = useLang();
  const [user, setUser] = useState(currentUser());
  const [view, setView] = useState("dashboard");

  useEffect(() => {
    // keep React state in sync with the SDK's auth store (login/logout/expiry)
    const unsub = pb.authStore.onChange(() => setUser(currentUser()));
    return unsub;
  }, []);

  const langPill = (
    <div className="lang-pill">
      <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
      <button className={lang === "mn" ? "on" : ""} onClick={() => setLang("mn")}>MN</button>
    </div>
  );

  if (!user) {
    return (
      <>
        {langPill}
        <Login onLogin={() => { setUser(currentUser()); setView(PERMS[currentUser()?.role]?.[0] || "dashboard"); }} />
      </>
    );
  }

  const role = user.role || "worker";
  const allowed = PERMS[role] || ["dashboard"];
  const active = allowed.includes(view) ? view : allowed[0];
  const ViewComp = VIEWS[active] || Dashboard;
  const displayName = user.full_name || user.email;

  return (
    <>
      {langPill}
      <div className="layout">
        <aside>
          <div className="side-brand">
            <div className="logo" />
            <b>GerOS</b>
          </div>
          <nav>
            {NAV.filter((n) => allowed.includes(n.k)).map((n) => (
              <button key={n.k} className={"nav-i" + (n.k === active ? " on" : "")} onClick={() => setView(n.k)}>
                <span className="ic">{n.ic}</span>
                {t(n.k)}
              </button>
            ))}
          </nav>
          <div className="nav-sp" />
          <div className="userbox">
            <div className="who">
              <div className="avatar">{(displayName || "?").trim().split(" ").pop()[0]?.toUpperCase()}</div>
              <div>
                <div className="nm">{displayName}</div>
                <div className="rl">{ROLE_LABEL[lang]?.[role] || role}</div>
              </div>
            </div>
            <button className="logout" onClick={() => pb.authStore.clear()}>
              {t("signout")}
            </button>
          </div>
        </aside>
        <main>
          {allowed.includes(active) ? <ViewComp user={user} role={role} go={setView} /> : <Deny t={t} />}
        </main>
      </div>
    </>
  );
}
