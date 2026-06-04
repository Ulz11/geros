import { useEffect, useRef, useState, useCallback } from "react";
import { pb } from "../lib/pb";
import { useLang } from "../lib/i18n";
import { canEdit, canCreate } from "../lib/perms";
import { useToast, Head, Modal, Loading } from "../components/ui";
import { parseJson, shortDate } from "../lib/format";

const GER_SIZE = 74;

export default function GerMap({ role }) {
  const { t, lang } = useLang();
  const toast = useToast();
  const [gers, setGers] = useState(null);
  const [queue, setQueue] = useState([]);
  const [selGer, setSelGer] = useState(null);
  const [selBook, setSelBook] = useState(null);
  const [rec, setRec] = useState(null); // {gers:[{id,code}], waste, reason}
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const editable = canEdit(role, "gers");

  const load = useCallback(async () => {
    try {
      const [g, b] = await Promise.all([
        pb.collection("gers").getFullList({ sort: "code" }),
        pb.collection("bookings").getFullList({
          filter: 'status = "pending"',
          sort: "check_in",
          expand: "operator",
        }),
      ]);
      setGers(g);
      setQueue(b);
    } catch (e) {
      if (!e?.isAbort) toast(t("connErr"));
    }
  }, [t, toast]);

  useEffect(() => {
    load();
    // realtime: another user's change shows up without a refresh
    let offG, offB;
    try {
      pb.collection("gers").subscribe("*", () => load()).then((u) => (offG = u)).catch(() => {});
      pb.collection("bookings").subscribe("*", () => load()).then((u) => (offB = u)).catch(() => {});
    } catch (_) {}
    return () => {
      offG && offG();
      offB && offB();
    };
  }, [load]);

  /* ---------- drag: move locally per pixel, ONE PATCH on release ---------- */
  function onPointerDown(e, ger) {
    if (!editable) {
      setSelGer(ger.id === selGer ? null : ger.id);
      return;
    }
    e.preventDefault();
    const cv = canvasRef.current.getBoundingClientRect();
    dragRef.current = {
      id: ger.id,
      offX: e.clientX - cv.left - (ger.x || 0),
      offY: e.clientY - cv.top - (ger.y || 0),
      moved: false,
      cv,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    let nx = e.clientX - d.cv.left - d.offX;
    let ny = e.clientY - d.cv.top - d.offY;
    nx = Math.max(0, Math.min(nx, d.cv.width - GER_SIZE));
    ny = Math.max(0, Math.min(ny, d.cv.height - GER_SIZE));
    d.moved = true;
    setGers((gs) => gs.map((g) => (g.id === d.id ? { ...g, x: Math.round(nx), y: Math.round(ny) } : g)));
  }
  async function onPointerUp() {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (d.moved) {
      const g = (gers || []).find((x) => x.id === d.id);
      if (g) {
        try {
          await pb.collection("gers").update(g.id, { x: g.x, y: g.y });
          toast(`${g.code} ${t("movedGer").toLowerCase()}`);
        } catch (_) {
          toast(t("connErr"));
        }
      }
    } else {
      setSelGer(d.id === selGer ? null : d.id);
      setSelBook(null);
      setRec(null);
    }
  }

  /* ---------- booking selection + recommendation ---------- */
  async function selectBooking(id) {
    setSelGer(null);
    if (selBook === id) {
      setSelBook(null);
      setRec(null);
      return;
    }
    setSelBook(id);
    setRec(null);
    try {
      const r = await pb.send(`/api/camp/recommend/${id}`, { method: "GET" });
      setRec(r);
    } catch (_) {
      toast(t("connErr"));
    }
  }

  async function assign() {
    if (!selBook || busy) return;
    setBusy(true);
    try {
      const r = await pb.send(`/api/camp/assign/${selBook}`, { method: "POST" });
      toast(`${r.gers.join(" + ")} ✓ · ${r.invoice || ""}`);
      setSelBook(null);
      setRec(null);
      load();
    } catch (e) {
      toast(e?.response?.error === "no fit" ? t("noFit") : t("connErr"));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(ger, s) {
    if (ger.status === s) return;
    try {
      await pb.collection("gers").update(ger.id, {
        status: s,
        current_booking: s === "occupied" ? ger.current_booking : "",
      });
      toast(`${ger.code} → ${t(s)}`);
      load();
    } catch (_) {
      toast(t("connErr"));
    }
  }

  if (!gers) return <Loading t={t} />;

  const occ = gers.filter((g) => g.status === "occupied").length;
  const recIds = rec?.gers?.map((g) => g.id) || [];
  const sel = gers.find((g) => g.id === selGer);
  const selBooking = queue.find((b) => b.id === selBook);

  return (
    <>
      <Head
        title={t("gers")}
        sub={t("smartAlloc")}
        actions={
          canCreate(role, "gers") ? (
            <button className="btn ghost sm" onClick={() => setShowAdd(true)}>
              + {t("addGer")}
            </button>
          ) : null
        }
      />
      <div className="map-wrap">
        <div className="map-card">
          <div className="map-head">
            <div className="legend">
              <span><span className="dot g" />{t("available")}</span>
              <span><span className="dot r" />{t("occupied")}</span>
              <span><span className="dot a" />{t("cleaning")}</span>
            </div>
            <span className="badge-soft">{t("occupancy")}: {occ}/{gers.length}</span>
          </div>
          <div className="map-canvas" ref={canvasRef}>
            <div className="path" />
            {gers.map((g) => {
              const f = parseJson(g.features, {});
              return (
                <div
                  key={g.id}
                  className={
                    "ger " + g.status +
                    (selGer === g.id ? " sel" : "") +
                    (recIds.includes(g.id) ? " rec" : "")
                  }
                  style={{ left: (g.x || 0) + "px", top: (g.y || 0) + "px" }}
                  onPointerDown={(e) => onPointerDown(e, g)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                >
                  {g.code}
                  <small>{g.capacity} {t("party").toLowerCase()}</small>
                  <span className="feat">
                    {f.stove ? <i /> : null}
                    {f.ensuite ? <i /> : null}
                    {f.view ? <i /> : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {sel ? (
          <GerPanel ger={sel} t={t} editable={editable} onClose={() => setSelGer(null)} onStatus={setStatus} />
        ) : (
          <div className="side-panel">
            <div className="panel-title">
              {t("queue")} <span className="badge-soft">{queue.length}</span>
            </div>
            {queue.length === 0 && <div className="muted" style={{ fontSize: 13 }}>—</div>}
            {queue.map((b) => (
              <div key={b.id} className={"q-card" + (selBook === b.id ? " act" : "")} onClick={() => selectBooking(b.id)}>
                <div className="q-top">
                  <span className="q-name">{b.guest_name}</span>
                  <span className={"src " + b.channel}>{b.channel}</span>
                </div>
                <div className="q-meta">
                  <span>{b.party} {t("party").toLowerCase()}</span>
                  <span>{b.nights} {t("nights").toLowerCase()}</span>
                  <span>{shortDate(b.check_in)}→{shortDate(b.check_out)}</span>
                  {b.expand?.operator ? <span>· {b.expand.operator.name}</span> : null}
                </div>
              </div>
            ))}
            {selBooking && rec && (
              <div className="rec-box">
                {rec.gers.length ? (
                  <>
                    <div className="rt">✦ {t("recommend")}: {rec.gers.map((g) => g.code).join(" + ")}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {rec.reason} · {rec.waste} {t("waste")}
                    </div>
                    {editable && (
                      <button className="btn sm" style={{ marginTop: 9, width: "100%" }} onClick={assign} disabled={busy}>
                        {t("assignRec")}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <div className="rt">{t("smartAlloc")}</div>
                    <div className="muted">{t("noFit")}</div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showAdd && <AddGerModal t={t} lang={lang} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} toast={toast} />}
    </>
  );
}

function GerPanel({ ger, t, editable, onClose, onStatus }) {
  const f = parseJson(ger.features, {});
  const feats = [f.stove && t("stove"), f.ensuite && t("ensuite"), f.view && t("view"), f.heating && t("heating")].filter(Boolean);
  const chipCls = ger.status === "available" ? "g" : ger.status === "occupied" ? "r" : "a";
  return (
    <div className="side-panel">
      <div className="panel-title">
        {ger.code}
        <button className="btn ghost sm" onClick={onClose}>✕</button>
      </div>
      <div className="kv"><span>{t("capacity")}</span><b>{ger.capacity} {t("party").toLowerCase()}</b></div>
      <div className="kv"><span>{t("status")}</span><span className={"chip " + chipCls}>{t(ger.status)}</span></div>
      <div className="kv">
        <span>{t("currentGuest")}</span>
        <b>{ger.current_booking || <span className="muted">{t("noGuest")}</span>}</b>
      </div>
      <div>
        <div className="muted" style={{ fontSize: 12, margin: "8px 0 5px" }}>{t("features")}</div>
        <div className="feat-tags">{feats.map((x) => <span key={x} className="ft">{x}</span>)}</div>
      </div>
      {editable && (
        <div>
          <div className="muted" style={{ fontSize: 12, margin: "10px 0 5px" }}>{t("status")}</div>
          <div className="status-cycle">
            {["available", "occupied", "cleaning"].map((s) => (
              <button key={s} className={"sc-btn" + (ger.status === s ? " on " + s : "")} onClick={() => onStatus(ger, s)}>
                {t(s)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AddGerModal({ t, onClose, onSaved, toast }) {
  const [form, setForm] = useState({ code: "", capacity: 2, bed_type: "2bed", stove: true, ensuite: false, view: false, heating: true });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.code.trim()) return toast(t("required"));
    try {
      await pb.collection("gers").create({
        code: form.code.trim(),
        capacity: Number(form.capacity) || 1,
        bed_type: form.bed_type,
        status: "available",
        x: 40, y: 40,
        features: { stove: !!form.stove, ensuite: !!form.ensuite, view: !!form.view, heating: !!form.heating },
      });
      onSaved();
    } catch (_) {
      toast(t("connErr"));
    }
  }

  return (
    <Modal title={t("addGer")} onClose={onClose}>
      <div className="grid-form">
        <label className="field"><span>{t("code")}</span>
          <input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="G-17" autoFocus />
        </label>
        <label className="field"><span>{t("capacity")}</span>
          <input type="number" min="1" value={form.capacity} onChange={(e) => set("capacity", e.target.value)} />
        </label>
        <label className="field"><span>{t("bedType")}</span>
          <select value={form.bed_type} onChange={(e) => set("bed_type", e.target.value)}>
            <option value="1bed">1bed</option>
            <option value="2bed">2bed</option>
            <option value="family">family</option>
          </select>
        </label>
        <div className="field"><span>{t("features")}</span>
          <div className="feat-tags" style={{ paddingTop: 6 }}>
            {["stove", "ensuite", "view", "heating"].map((k) => (
              <label key={k} className="ft" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={!!form[k]} onChange={(e) => set(k, e.target.checked)} style={{ marginRight: 4 }} />
                {t(k)}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn" onClick={save}>{t("save")}</button>
      </div>
    </Modal>
  );
}
