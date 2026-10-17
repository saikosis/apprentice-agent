import { CircleAlertIcon, PlayIcon, ShieldAlertIcon } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { currentScenario, videoUrl, type Ws } from "./api/client";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Empty as EmptyRoot, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./components/ui/empty";
import { Skeleton } from "./components/ui/skeleton";
import { cn } from "./lib/utils";
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
  if (state.error) return <ErrorNote>Couldn't load this: {state.error}</ErrorNote>;
  if (state.data === undefined)
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  return <>{children(state.data)}</>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

// ---- page frame ----
export function PageHeader({ title, description, actions, crumb }: { title: string; description?: ReactNode; actions?: ReactNode; crumb?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        {crumb && <div className="text-sm text-muted-foreground">{crumb}</div>}
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-[68ch] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// ---- marks ----
// Labels for the current scenario. Read at render time: switching remounts the pages (main.tsx), no reload.
export const scenarioInfo = currentScenario;
export const decisionLabel = (d: Decision | "none") =>
  d === "none" ? "No decision" : (currentScenario().decision_labels[d] ?? d);
export const trapLabel = (t: string) => (t === "none" ? "" : (currentScenario().traps[t] ?? t));
export const itemTitle = () => {
  const l = currentScenario().item_label;
  return l.charAt(0).toUpperCase() + l.slice(1); // "Invoice"
};
const DECISION_DOT = { approve: "bg-success", reject: "bg-destructive", hold: "bg-warning", escalate: "bg-chart-5", none: "bg-muted-foreground" };

export function DecisionChip({ d }: { d: Decision | "none" | null | undefined }) {
  const value = d ?? "none";
  return (
    <Badge variant="secondary">
      <span className={cn("size-1.5 rounded-full", DECISION_DOT[value])} aria-hidden />
      {decisionLabel(value)}
    </Badge>
  );
}

export const Sop = ({ rule }: { rule?: string | null }) =>
  rule ? (
    <Badge variant="outline" className="font-mono">
      SOP {rule}
    </Badge>
  ) : null;

export function ModerationTag({ m, quarantined }: { m?: ModerationResult | null; quarantined?: boolean }) {
  if (!quarantined && !m?.match_found) return null;
  const hits = m ? Object.entries(m.filters).filter(([, v]) => v === "MATCH_FOUND").map(([k]) => k) : [];
  return (
    <Badge variant="destructive" title="Model Armor flagged this text. It is excluded from the decision graph.">
      <ShieldAlertIcon data-icon="inline-start" />
      Flagged{hits.length ? `: ${hits.join(", ")}` : ""}, kept out of graph
    </Badge>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <EmptyRoot className="border">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {children && <EmptyDescription>{children}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </EmptyRoot>
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
    <Button variant="link" size="sm" className="h-auto px-0" onClick={() => open(clip)} title={`Play ${clip.session_id} from ${clip.start_ts}`}>
      <PlayIcon data-icon="inline-start" />
      {children ?? `${clip.start_ts}–${clip.end_ts}`}
    </Button>
  );
}

export function ClipProvider({ children }: { children: ReactNode }) {
  const [clip, setClip] = useState<ClipRef | null>(null);
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  const show = useCallback((c: ClipRef) => {
    setClip(c);
    setSrc(null);
    setErr(null);
    setOpen(true);
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
    <ClipContext.Provider value={show}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Session {clip?.session_id}</DialogTitle>
            <DialogDescription>
              {clip?.start_ts} to {clip?.end_ts}
            </DialogDescription>
          </DialogHeader>
          {err && (
            <Alert>
              <AlertTitle>Recording unavailable</AlertTitle>
              <AlertDescription>{err}</AlertDescription>
            </Alert>
          )}
          {src && (
            <video ref={video} src={src} controls onLoadedMetadata={onLoaded} onTimeUpdate={onTime} preload="metadata" className="w-full rounded-lg bg-black" />
          )}
          {!src && !err && <Skeleton className="aspect-video w-full rounded-lg" />}
        </DialogContent>
      </Dialog>
    </ClipContext.Provider>
  );
}

export const fmtDuration = (s?: number | null) =>
  s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
