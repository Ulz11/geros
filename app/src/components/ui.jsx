import { createContext, useContext, useState, useRef, useCallback } from "react";

/* ---------- Toast ---------- */
const ToastCtx = createContext(() => {});

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef(null);
  const toast = useCallback((m) => {
    setMsg(m);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 2200);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className={"toast" + (show ? " show" : "")}>{msg}</div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ---------- Small bits ---------- */
export function Tile({ label, big, bigStyle, sub, className = "" }) {
  return (
    <div className={"tile " + className}>
      <div className="lbl">{label}</div>
      <div className="big" style={bigStyle}>{big}</div>
      {sub != null && <div className="sm">{sub}</div>}
    </div>
  );
}

export function Head({ title, sub, actions }) {
  return (
    <div className="topbar">
      <div>
        <h2>{title}</h2>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      <div className="top-actions">{actions}</div>
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Deny({ t }) {
  return (
    <div className="deny">
      <div className="lock">🔒</div>
      <div>{t("noAccess")}</div>
    </div>
  );
}

export function Loading({ t }) {
  return <div className="loading">{t("loading")}</div>;
}

export function UploadButton({ label, accept, multiple, onFile }) {
  const ref = useRef(null);
  return (
    <>
      <button className="upload-btn" onClick={() => ref.current?.click()}>{label}</button>
      <input type="file" hidden ref={ref} accept={accept} multiple={!!multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) onFile(multiple ? files : files[0]);
          e.target.value = "";
        }} />
    </>
  );
}

export function BarRow({ name, pct, value, fillStyle }) {
  return (
    <div className="bar-row">
      <span className="nm">{name}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: pct + "%", ...fillStyle }} />
      </div>
      <span className="vl">{value}</span>
    </div>
  );
}
