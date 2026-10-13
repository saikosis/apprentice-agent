import { useEffect, useRef, useState } from "react";
import { createSession, sheetSnapshot } from "../api/client";
import { startLive, type LiveProbe, type LiveStatus } from "../live/live";
import { PipPortal, pipSupported, usePip } from "../pip/pip";
import { startCapture, uploadAndProcess, type Capture } from "../recorder/recorder";
import { readInvoices, requestSheetsToken, sheetsConfigured } from "../recorder/sheets";
import type { Session } from "../types/contract";
import { Empty, fmtDuration, go, useWs } from "../ui";

type Phase = "idle" | "starting" | "recording" | "uploading" | "done" | "error";

const LIVE_LABEL: Record<LiveStatus, string> = {
  connecting: "Connecting to Apprentice…",
  watching: "Watching quietly",
  reconnecting: "Reconnecting…",
  closed: "Stopped",
  error: "Live questions unavailable",
};

function Companion(props: {
  phase: Phase;
  elapsed: number;
  live: LiveStatus | null;
  liveNote: string | null;
  probe: LiveProbe | null;
  answered: string | null;
  error: string | null;
  onStart: () => void;
  onStop: () => void;
}) {
  const { phase, elapsed, live, liveNote, probe, answered, error } = props;
  return (
    <div className="companion">
      <div className="companion-bar">
        {phase === "recording" ? (
          <>
            <span className="rec-dot" aria-hidden />
            <strong>Recording</strong>
            <span className="companion-timer">{fmtDuration(elapsed)}</span>
          </>
        ) : (
          <strong>Apprentice</strong>
        )}
      </div>

      {phase === "recording" && live && (
        <p className="faint" style={{ fontSize: "var(--t-sm)" }}>
          {LIVE_LABEL[live]}
          {liveNote ? `. ${liveNote}` : ""}
        </p>
      )}

      {probe ? (
        <div className="companion-probe">
          <span className="sop">SOP {probe.sopRule}</span>
          {probe.invoiceId && <span className="faint">, {probe.invoiceId}</span>}
          <p style={{ fontSize: "var(--t-lg)", marginTop: 6 }}>
            <span className="why">{probe.question}</span>
          </p>
          <p className="faint" style={{ fontSize: "var(--t-sm)", marginTop: 6 }}>
            {answered ? "Answer saved. You can edit it later under Questions." : "Answer out loud, or later under Questions."}
          </p>
          {answered && <p className="quote">{answered}</p>}
        </div>
      ) : phase === "recording" ? (
        <p className="muted">Work as you normally would. If something departs from the SOP, a question appears here.</p>
      ) : null}

      {phase === "uploading" && <p className="muted">Uploading the recording…</p>}
      {error && <p className="error">{error}</p>}

      <div style={{ marginTop: "auto" }}>
        {phase === "recording" ? (
          <button className="btn quiet" style={{ width: "100%", justifyContent: "center" }} onClick={props.onStop}>
            Stop and upload
          </button>
        ) : phase === "idle" || phase === "error" ? (
          <button className="btn record" style={{ width: "100%", justifyContent: "center" }} onClick={props.onStart}>
            Start recording
          </button>
        ) : phase === "starting" ? (
          <p className="faint">Pick the Sheets or Gmail tab to share…</p>
        ) : null}
      </div>
    </div>
  );
}

export function Record() {
  const { readOnly } = useWs();
  const pip = usePip();
  const [consent, setConsent] = useState(false);
  const [kind, setKind] = useState<Session["kind"]>("training");
  const [liveOn, setLiveOn] = useState(true);
  const [sheetId, setSheetId] = useState("");
  const [sheetToken, setSheetToken] = useState<string | null>(null);
  const [sheetMsg, setSheetMsg] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [probe, setProbe] = useState<LiveProbe | null>(null);
  const [answered, setAnswered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cap = useRef<Capture | null>(null);
  const liveRef = useRef<{ close: () => void } | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const stopping = useRef(false);

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => cap.current && setElapsed((Date.now() - cap.current.startedAt) / 1000), 500);
    return () => clearInterval(t);
  }, [phase]);

  const snapshot = async (phaseName: "before" | "after") => {
    if (!sheetToken || !sheetId || !sessionRef.current) return;
    try {
      await sheetSnapshot(sessionRef.current.id, phaseName, await readInvoices(sheetId, sheetToken));
    } catch (e) {
      setSheetMsg(`Sheet snapshot (${phaseName}) failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const stop = async () => {
    if (!cap.current || !sessionRef.current || stopping.current) return;
    stopping.current = true;
    liveRef.current?.close();
    setPhase("uploading");
    const c = cap.current;
    const durationS = Math.round((Date.now() - c.startedAt) / 1000);
    const endedAt = new Date().toISOString();
    try {
      const blob = await c.stop();
      await snapshot("after");
      await uploadAndProcess(sessionRef.current.id, blob, durationS, endedAt);
      setPhase("done");
      pip.close();
      go(`/sessions/${sessionRef.current.id}`);
    } catch (e) {
      setError(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("error");
    } finally {
      stopping.current = false;
    }
  };

  const start = async () => {
    setError(null);
    setProbe(null);
    setAnswered(null);
    setPhase("starting");
    try {
      // getDisplayMedia first, while the click still counts as a user gesture.
      const c = await startCapture();
      cap.current = c;
      sessionRef.current = await createSession(kind, liveOn);
      await snapshot("before");
      setElapsed(0);
      setPhase("recording");
      void c.ended.then(() => void stop());
      if (liveOn) {
        startLive(sessionRef.current.id, c, {
          onStatus: (s, d) => (setLive(s), setLiveNote(d ?? null)),
          onProbe: (p) => (setProbe(p), setAnswered(null)),
          onAnswer: (_id, text) => setAnswered(text),
        }).then(
          (l) => (liveRef.current = l),
          (e: unknown) => {
            setLive("error");
            setLiveNote(`Recording continues without live questions (${e instanceof Error ? e.message : String(e)})`);
          },
        );
      }
    } catch (e) {
      cap.current = null;
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Screen or microphone access was blocked. Allow both in Chrome and try again."
          : msg,
      );
      setPhase("error");
    }
  };

  if (readOnly)
    return (
      <Empty title="Recording is off in the demo">
        <p className="muted">Sign in with the expert account to record a session.</p>
        <a className="btn quiet" href="/">
          Sign in
        </a>
      </Empty>
    );

  const companion = (
    <Companion
      phase={phase}
      elapsed={elapsed}
      live={live}
      liveNote={liveNote}
      probe={probe}
      answered={answered}
      error={error}
      onStart={() => void start()}
      onStop={() => void stop()}
    />
  );
  const busy = phase === "starting" || phase === "recording" || phase === "uploading";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Record a session</h1>
          <p>
            Share the tab where you work the invoice queue. Apprentice records the tab and your microphone. Nothing is
            written to your Sheet or mailbox.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <section className="sheet" style={{ display: "grid", gap: 18 }}>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 5 }} />
            <span>
              I agree to record my screen and voice for this session, to capture how I make decisions. I can stop at any
              time.
            </span>
          </label>

          <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span>Use this session for</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as Session["kind"])}>
                <option value="training">Training: learn from it</option>
                <option value="heldout">Held out: keep it for the successor exam</option>
              </select>
            </label>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <input type="checkbox" checked={liveOn} onChange={(e) => setLiveOn(e.target.checked)} style={{ marginTop: 5 }} />
              <span>
                Ask me questions while I work
                <span className="faint" style={{ display: "block", fontSize: "var(--t-sm)" }}>
                  At most one every 45 seconds, three per session.
                </span>
              </span>
            </label>

            {sheetsConfigured() && (
              <div style={{ display: "grid", gap: 6 }}>
                <span>Connect the invoice Sheet (optional)</span>
                <span className="faint" style={{ fontSize: "var(--t-sm)" }}>
                  Apprentice reads the Invoices tab before and after the session to see what changed. Read-only.
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="text" placeholder="Spreadsheet ID from the Sheet's URL" value={sheetId} onChange={(e) => setSheetId(e.target.value.trim())} aria-label="Spreadsheet ID" />
                  <button
                    type="button"
                    className="btn quiet"
                    disabled={!sheetId}
                    onClick={() =>
                      requestSheetsToken().then(
                        (t) => (setSheetToken(t), setSheetMsg("Sheet connected.")),
                        (e: Error) => setSheetMsg(e.message),
                      )
                    }
                  >
                    {sheetToken ? "Connected" : "Connect"}
                  </button>
                </div>
                {sheetMsg && <span className="muted" style={{ fontSize: "var(--t-sm)" }}>{sheetMsg}</span>}
              </div>
            )}
          </fieldset>

          {pipSupported() ? (
            <button className="btn" disabled={!consent || Boolean(pip.win)} onClick={() => void pip.open()}>
              {pip.win ? "Companion window is open" : "Open companion window"}
            </button>
          ) : (
            <p className="faint" style={{ fontSize: "var(--t-sm)" }}>
              This browser can't open an always-on-top companion. Use Chrome 116 or later, or record from the panel here.
            </p>
          )}
        </section>

        <aside>
          {pip.win ? (
            <>
              <PipPortal win={pip.win}>{companion}</PipPortal>
              <p className="muted sheet">
                The companion window floats above your other tabs. Start and stop from there; questions appear there too.
              </p>
            </>
          ) : consent ? (
            <div className="sheet" style={{ minHeight: 320, display: "flex" }}>
              {companion}
            </div>
          ) : (
            <p className="faint sheet">Tick the consent box to continue.</p>
          )}
        </aside>
      </div>
    </>
  );
}
