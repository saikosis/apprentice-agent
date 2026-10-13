import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { videoUrl, type Ws } from "./api/client";
import type { ClipRef, Decision, ModerationResult } from "./types/contract";

// ---- workspace ----
export const WsContext = createContext<{ ws: Ws; readOnly: boolean }>({ ws: "demo", readOnly: true });
export const useWs = () => useContext(WsContext);

// ---- hash router: works on "/" and "/demo/" without server rewrites ----
export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return parts;
}
export const go = (path: string) => {
  location.hash = path;
};

// ---- async data ----
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => live && setState({ data, loading: false }),
      (e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e), loading: false }),
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function Loadable<T>({
  state,
  children,
}: {
  state: { data?: T; error?: string; loading: boolean };
  children: (data: T) => ReactNode;
}) {
  if (state.error) return <p className="error">Couldn't load this: {state.error}</p>;
  if (state.data === undefined) return <p className="faint">Loading…</p>;
  return <>{children(state.data)}</>;
}

// ---- marks ----
const DECISION_LABEL = { approve: "Approve", reject: "Reject", hold: "On hold", escalate: "Escalate", none: "No decision" };
export function DecisionChip({ d }: { d: Decision | "none" | null | undefined }) {
  const value = d ?? "none";
  return <span className={`chip ${value}`}>{DECISION_LABEL[value]}</span>;
}

export const Sop = ({ rule }: { rule?: string | null }) => (rule ? <span className="sop">SOP {rule}</span> : null);

export function ModerationTag({ m, quarantined }: { m?: ModerationResult | null; quarantined?: boolean }) {
  if (!quarantined && !m?.match_found) return null;
  const hits = m ? Object.entries(m.filters).filter(([, v]) => v === "MATCH_FOUND").map(([k]) => k) : [];
  return (
    <span className="tag flag" title="Model Armor flagged this text. It is excluded from the decision graph.">
      Flagged{hits.length ? `: ${hits.join(", ")}` : ""}, kept out of graph
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

// ---- clips ----
export const tsToSeconds = (ts: string) => ts.split(":").reduce((acc, n) => acc * 60 + Number(n), 0);

export const tsPlus = (ts: string, s: number) => {
  const t = tsToSeconds(ts) + s;
  const mmss = `${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  return t >= 3600 ? `${Math.floor(t / 3600)}:${mmss}` : mmss;
};

type ClipCtx = (clip: ClipRef) => void;
const ClipContext = createContext<ClipCtx>(() => undefined);

export function ClipButton({ clip, children }: { clip: ClipRef; children?: ReactNode }) {
  const open = useContext(ClipContext);
  return (
    <button type="button" className="clip-btn" onClick={() => open(clip)} title={`Play ${clip.session_id} from ${clip.start_ts}`}>
      {children ?? `${clip.start_ts}–${clip.end_ts}`}
    </button>
  );
}

export function ClipProvider({ children }: { children: ReactNode }) {
  const [clip, setClip] = useState<ClipRef | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  const open = useCallback((c: ClipRef) => {
    setClip(c);
    setSrc(null);
    setErr(null);
    dialog.current?.showModal();
    videoUrl(c.session_id).then(setSrc, () => setErr("This recording isn't available here. The clip reference is still valid."));
  }, []);

  const onLoaded = () => {
    if (video.current && clip) {
      video.current.currentTime = tsToSeconds(clip.start_ts);
      void video.current.play().catch(() => undefined);
    }
  };
  const onTime = () => {
    if (video.current && clip && video.current.currentTime >= tsToSeconds(clip.end_ts)) video.current.pause();
  };

  return (
    <ClipContext.Provider value={open}>
      {children}
      <dialog ref={dialog} className="clip" onClose={() => video.current?.pause()}>
        {clip && (
          <>
            <div className="clip-head">
              <strong>Session {clip.session_id}</strong>
              <span className="muted">
                {clip.start_ts} to {clip.end_ts}
              </span>
              <button type="button" className="btn quiet small" onClick={() => dialog.current?.close()}>
                Close
              </button>
            </div>
            {err && <p className="muted">{err}</p>}
            {src && (
              <video ref={video} src={src} controls onLoadedMetadata={onLoaded} onTimeUpdate={onTime} preload="metadata" />
            )}
            {!src && !err && <p className="faint">Loading recording…</p>}
          </>
        )}
      </dialog>
    </ClipContext.Provider>
  );
}

export const fmtDuration = (s?: number | null) =>
  s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
