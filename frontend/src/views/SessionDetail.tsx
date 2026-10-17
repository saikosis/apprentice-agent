import { LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { getSession, processSession } from "../api/client";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { cn } from "../lib/utils";
import {
  ClipButton,
  DecisionChip,
  Empty,
  ErrorNote,
  Loadable,
  ModerationTag,
  PageHeader,
  ITEM,
  Sop,
  fmtDate,
  fmtDuration,
  tsPlus,
  useAsync,
  useWs,
} from "../ui";
import { SessionStatus } from "./Sessions";

const APP = { sheets: "Sheets", gmail: "Gmail", docs: "Docs", forms: "Forms", calendar: "Calendar", other: "Other" } as const;

export function SessionDetail({ id }: { id: string }) {
  const { ws, readOnly } = useWs();
  const state = useAsync(() => getSession(ws, id), [ws, id]);
  const [err, setErr] = useState<string | null>(null);
  const status = state.data?.session.status;

  // SPEC §4 batch: poll every 3 s while the pipeline runs.
  useEffect(() => {
    if (status !== "processing" && status !== "uploading") return;
    const t = setInterval(state.reload, 3000);
    return () => clearInterval(t);
  }, [status, state.reload]);

  return (
    <Loadable state={state}>
      {({ session, segments, deviations, diff }) => {
        const clipFor = (start: string, end: string) => ({ session_id: session.id, start_ts: start, end_ts: end });
        return (
          <>
            <PageHeader
              crumb={
                <>
                  <a href="#/sessions" className="hover:text-foreground">
                    Sessions
                  </a>{" "}
                  / {session.id}
                </>
              }
              title={`Session ${session.id}`}
              description={
                <>
                  {fmtDate(session.started_at)}, {fmtDuration(session.duration_s)} long.{" "}
                  {session.kind === "heldout" ? "Held out for the successor exam." : "Training session."}
                </>
              }
              actions={
                <>
                  <SessionStatus s={session} />
                  {!readOnly && session.status === "uploaded" && (
                    <Button onClick={() => processSession(session.id).then(state.reload, (e: Error) => setErr(e.message))}>
                      Analyse recording
                    </Button>
                  )}
                </>
              }
            />
            <div className="mb-4 flex flex-col gap-3 empty:hidden">
              {err && <ErrorNote>{err}</ErrorNote>}
              {session.status === "processing" && (
                <Alert>
                  <LoaderIcon className="animate-spin" />
                  <AlertTitle>Analysing the recording</AlertTitle>
                  <AlertDescription>
                    Splitting it into steps, then checking each decision against the SOP. This page updates on its own.
                  </AlertDescription>
                </Alert>
              )}
              {session.status === "failed" && <ErrorNote>Analysis failed: {session.error ?? "unknown error"}</ErrorNote>}
            </div>

            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <Card className="gap-0 pb-0">
                <CardHeader className="border-b">
                  <CardTitle className="text-lg">What the expert did</CardTitle>
                  <CardDescription>Every step, with the moment it happened in the recording.</CardDescription>
                </CardHeader>
                {segments.length === 0 ? (
                  <CardContent className="py-4">
                    <Empty title="No steps yet">Steps appear here once the recording has been analysed.</Empty>
                  </CardContent>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="eyebrow pl-4">Time</TableHead>
                        <TableHead className="eyebrow">Step</TableHead>
                        <TableHead className="eyebrow">{ITEM}</TableHead>
                        <TableHead className="eyebrow pr-4">Decision</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {segments.map((s) => (
                        <TableRow key={s.id} className="align-top">
                          <TableCell className="pl-4">
                            <ClipButton clip={clipFor(s.start_ts, s.end_ts)}>{s.start_ts}</ClipButton>
                            <div className="text-xs text-muted-foreground">{APP[s.app]}</div>
                          </TableCell>
                          <TableCell className="max-w-md whitespace-normal">
                            <div>{s.action}</div>
                            {s.transcript_excerpt && <p className="quote mt-1.5">“{s.transcript_excerpt}”</p>}
                            {s.quarantined && (
                              <div className="mt-2 flex flex-col items-start gap-1">
                                <ModerationTag quarantined />
                                <span className="text-xs text-muted-foreground">{s.on_screen_text}</span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {s.invoice_id ?? <span className="text-muted-foreground">—</span>}
                            {s.vendor && <div className="text-xs text-muted-foreground">{s.vendor}</div>}
                          </TableCell>
                          <TableCell className="pr-4">{s.decision !== "none" && <DecisionChip d={s.decision} />}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>

              <div className="flex flex-col gap-4">
                <h2 className="eyebrow mt-1">Departures from the SOP</h2>
                {deviations.length === 0 ? (
                  <Empty title="None found">Either every step followed the SOP, or analysis hasn't finished.</Empty>
                ) : (
                  deviations.map((d) => (
                    <Card key={d.id} size="sm" className={cn(d.dedup_of && "opacity-60")}>
                      <CardHeader>
                        <div className="flex flex-wrap items-center gap-2">
                          <Sop rule={d.sop_rule} />
                          <ClipButton clip={clipFor(d.timestamp, tsPlus(d.timestamp, 20))}>{d.timestamp}</ClipButton>
                          {d.invoice_id && <span className="text-muted-foreground">{d.invoice_id}</span>}
                          <Badge variant={d.source === "live" ? "default" : "secondary"} className="ml-auto">
                            {d.source === "live" ? "Caught live" : "Found after"}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-2">
                        <p>{d.description}</p>
                        <p className="quote font-medium">{d.question}</p>
                        <p className="text-xs text-muted-foreground">
                          {Math.round(d.confidence * 100)}% confident
                          {d.dedup_of ? `. Same moment as ${d.dedup_of}, asked once.` : ""}
                        </p>
                      </CardContent>
                    </Card>
                  ))
                )}

                {diff && diff.changes.length > 0 && (
                  <Card className="gap-0 pb-0">
                    <CardHeader className="border-b">
                      <CardTitle>Sheet changes during the session</CardTitle>
                    </CardHeader>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-4">{ITEM}</TableHead>
                          <TableHead>Column</TableHead>
                          <TableHead>Before</TableHead>
                          <TableHead className="pr-4">After</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {diff.changes.map((c) => (
                          <TableRow key={`${c.invoice_id}-${c.column}`}>
                            <TableCell className="pl-4">{c.invoice_id}</TableCell>
                            <TableCell>{c.column}</TableCell>
                            <TableCell className="text-muted-foreground">{c.before ?? "—"}</TableCell>
                            <TableCell className="pr-4">{c.after ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                )}
              </div>
            </div>
          </>
        );
      }}
    </Loadable>
  );
}
