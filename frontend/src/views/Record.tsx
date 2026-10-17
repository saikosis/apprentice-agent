import { CircleDotIcon, PictureInPicture2Icon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createSession, sheetSnapshot } from "../api/client";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import { Switch } from "../components/ui/switch";
import { startLive, type LiveProbe, type LiveStatus } from "../live/live";
import { PipPortal, pipSupported, usePip } from "../pip/pip";
import { startCapture, uploadAndProcess, type Capture } from "../recorder/recorder";
import { readTab, requestSheetsToken, sheetsConfigured } from "../recorder/sheets";
import type { Session } from "../types/contract";
import { Empty, ErrorNote, PageHeader, SCENARIO, fmtDuration, go, useWs } from "../ui";

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
    <div className="flex min-h-full flex-1 flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        {phase === "recording" ? (
          <>
            <span className="rec-dot" aria-hidden />
            <strong>Recording</strong>
            <span className="ml-auto font-semibold tabular-nums">{fmtDuration(elapsed)}</span>
          </>
        ) : (
          <strong>Apprentice</strong>
        )}
      </div>
      <Separator />

      {phase === "recording" && live && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {LIVE_LABEL[live]}
          {liveNote ? `. ${liveNote}` : ""}
        </p>
      )}

      {probe ? (
        <div className="flex flex-col gap-2 border-l-2 border-primary pl-3" aria-live="assertive">
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className="font-mono">
              SOP {probe.sopRule}
            </Badge>
            {probe.invoiceId && <span className="text-muted-foreground">{probe.invoiceId}</span>}
          </div>
          <p className="text-lg font-medium">{probe.question}</p>
          <p className="text-sm text-muted-foreground">
            {answered ? "Answer saved. You can edit it later under Questions." : "Answer out loud, or later under Questions."}
          </p>
          {answered && <p className="quote">{answered}</p>}
        </div>
      ) : phase === "recording" ? (
        <p className="text-muted-foreground">Work as you normally would. If something departs from the SOP, a question appears here.</p>
      ) : null}

      {phase === "uploading" && <p className="text-muted-foreground">Uploading the recording…</p>}
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mt-auto">
        {phase === "recording" ? (
          <Button variant="outline" size="lg" className="w-full" onClick={props.onStop}>
            <SquareIcon data-icon="inline-start" />
            Stop and upload
          </Button>
        ) : phase === "idle" || phase === "error" ? (
          <Button size="lg" className="w-full bg-live text-background hover:bg-live/85" onClick={props.onStart}>
            <CircleDotIcon data-icon="inline-start" />
            Start recording
          </Button>
        ) : phase === "starting" ? (
          <p className="text-sm text-muted-foreground">Pick the tab you work in to share…</p>
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
      await sheetSnapshot(sessionRef.current.id, phaseName, await readTab(sheetId, SCENARIO.sheet_tab, sheetToken));
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
      <Empty
        title="Recording is off in the demo"
        action={
          <Button variant="outline" asChild>
            <a href="/">Sign in</a>
          </Button>
        }
      >
        Sign in with the expert account to record a session.
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
      <PageHeader
        title="Record a session"
        description={`Share the tab where you work (${SCENARIO.title.toLowerCase()}). Apprentice records the tab and your microphone. Nothing is written to your Sheet, documents or mailbox.`}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Before you start</CardTitle>
            <CardDescription>Settings apply to this session only.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal">
                <Checkbox id="consent" checked={consent} disabled={busy} onCheckedChange={(v) => setConsent(v === true)} />
                <FieldContent>
                  <FieldLabel htmlFor="consent">I agree to record my screen and voice for this session</FieldLabel>
                  <FieldDescription>It captures how I make decisions. I can stop at any time.</FieldDescription>
                </FieldContent>
              </Field>
              <Separator />
              <Field data-disabled={busy || undefined}>
                <FieldLabel htmlFor="kind">Use this session for</FieldLabel>
                <Select value={kind} disabled={busy} onValueChange={(v) => setKind(v as Session["kind"])}>
                  <SelectTrigger id="kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="training">Training: learn from it</SelectItem>
                      <SelectItem value="heldout">Held out: keep it for the successor exam</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field orientation="horizontal" data-disabled={busy || undefined}>
                <FieldContent>
                  <FieldLabel htmlFor="live">Ask me questions while I work</FieldLabel>
                  <FieldDescription>At most one every 45 seconds, three per session.</FieldDescription>
                </FieldContent>
                <Switch id="live" checked={liveOn} disabled={busy} onCheckedChange={setLiveOn} />
              </Field>
              {sheetsConfigured() && (
                <Field data-disabled={busy || undefined}>
                  <FieldLabel htmlFor="sheet">Connect the work Sheet (optional)</FieldLabel>
                  <div className="flex gap-2">
                    <Input id="sheet" placeholder="Spreadsheet ID from the Sheet's URL" value={sheetId} disabled={busy} onChange={(e) => setSheetId(e.target.value.trim())} />
                    <Button
                      variant="outline"
                      disabled={busy || !sheetId}
                      onClick={() =>
                        requestSheetsToken().then(
                          (t) => (setSheetToken(t), setSheetMsg("Sheet connected.")),
                          (e: Error) => setSheetMsg(e.message),
                        )
                      }
                    >
                      {sheetToken ? "Connected" : "Connect"}
                    </Button>
                  </div>
                  <FieldDescription>
                    {sheetMsg ?? `Apprentice reads the "${SCENARIO.sheet_tab}" tab before and after the session to see what changed. Read-only.`}
                  </FieldDescription>
                </Field>
              )}
            </FieldGroup>
          </CardContent>
          <CardFooter>
            {pipSupported() ? (
              <Button disabled={!consent || Boolean(pip.win)} onClick={() => void pip.open()}>
                <PictureInPicture2Icon data-icon="inline-start" />
                {pip.win ? "Companion window is open" : "Open companion window"}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                This browser can't open an always-on-top companion. Use Chrome 116 or later, or record from the panel here.
              </p>
            )}
          </CardFooter>
        </Card>

        {pip.win ? (
          <>
            <PipPortal win={pip.win}>{companion}</PipPortal>
            <Alert>
              <AlertDescription>
                The companion window floats above your other tabs. Start and stop from there; questions appear there too.
              </AlertDescription>
            </Alert>
          </>
        ) : consent ? (
          <Card className="min-h-80 py-0">{companion}</Card>
        ) : (
          <Empty title="Companion">Tick the consent box to continue.</Empty>
        )}
      </div>
    </>
  );
}
