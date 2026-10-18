import { useState } from "react";
import { discoverVariants, getObservedWorkflow, listSessions, listVariants } from "../api/client";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import type { ObservedWorkflow } from "../types/contract";
import { ClipButton, Empty, Loadable, ModerationTag, PageHeader, Sop, useAsync, useWs } from "../ui";

// The expert's procedure as seen in the recordings. Display only: nothing downstream reads it.
function Workflow({ w }: { w: ObservedWorkflow }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">How the expert actually works</CardTitle>
        <CardDescription>
          Written by Apprentice from the recordings and checked against the SOP. Steps the SOP doesn't mention are where
          its questions come from.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {w.flagged ? (
          <ModerationTag quarantined />
        ) : (
          <ol className="flex flex-col gap-3">
            {w.steps.map((s) => (
              <li key={s.n} className="flex gap-3">
                <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-muted-foreground">{s.n}.</span>
                <div className="flex flex-wrap items-center gap-2">
                  <span>{s.text}</span>
                  {s.in_sop ? <Sop rule={s.sop_rule} /> : <Badge variant="secondary">Not in the SOP</Badge>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export function Discovery() {
  const { ws, readOnly } = useWs();
  const state = useAsync(() => Promise.all([listVariants(ws), listSessions(ws), getObservedWorkflow(ws)]), [ws]);
  const [msg, setMsg] = useState<string | null>(null);

  const discover = () =>
    discoverVariants().then(
      () => {
        setMsg("Looking across all sessions. This takes about a minute.");
        setTimeout(state.reload, 20000);
      },
      (e: Error) => setMsg(e.message),
    );

  return (
    <>
      <PageHeader
        title="Patterns across sessions"
        description="Departures from the SOP that the expert repeats. A repeated departure usually means an unwritten rule."
        actions={!readOnly && <Button onClick={() => void discover()}>Find patterns</Button>}
      />
      {msg && (
        <Alert className="mb-4">
          <AlertDescription>{msg}</AlertDescription>
        </Alert>
      )}
      <Loadable state={state}>
        {([variants, sessions, workflow]) => {
          const processed = sessions.filter((s) => s.status === "processed").length;
          if (variants.length === 0)
            return (
              <div className="flex flex-col gap-4">
                {workflow && <Workflow w={workflow} />}
                <Empty title="No patterns yet">
                  {processed === 0
                    ? "Patterns appear once a session is analysed and the same departure shows up twice."
                    : "No departure has shown up twice yet. Record another session, or run Find patterns again."}
                </Empty>
              </div>
            );
          const max = Math.max(...variants.map((v) => v.frequency));
          return (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {[...variants]
                  .sort((a, b) => b.frequency - a.frequency)
                  .map((v) => (
                    <Card key={v.id}>
                      <CardHeader>
                        <CardDescription className="eyebrow">Seen {v.session_ids.length === 1 ? "in 1 session" : `in ${v.session_ids.length} sessions`}</CardDescription>
                        <CardTitle className="text-4xl font-semibold tracking-tight">{v.frequency}×</CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-1 flex-col gap-3">
                        <Progress value={(v.frequency / max) * 100} className="h-2 [&>[data-slot=progress-indicator]]:bg-chart-1" aria-hidden />
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-base font-semibold">{v.name}</h2>
                          {v.sop_rules.map((r) => (
                            <Sop key={r} rule={r} />
                          ))}
                        </div>
                        <p className="text-muted-foreground">{v.description}</p>
                      </CardContent>
                      <CardFooter className="flex-wrap gap-x-4 gap-y-1">
                        {v.exemplar_clips.map((c) => (
                          <ClipButton key={`${c.session_id}-${c.start_ts}`} clip={c}>
                            {c.session_id} at {c.start_ts}
                          </ClipButton>
                        ))}
                        <span className="text-xs text-muted-foreground">
                          Sessions:{" "}
                          {v.session_ids.map((id, i) => (
                            <span key={id}>
                              {i > 0 && ", "}
                              <a href={`#/sessions/${id}`} className="underline-offset-4 hover:text-foreground hover:underline">
                                {id}
                              </a>
                            </span>
                          ))}
                        </span>
                      </CardFooter>
                    </Card>
                  ))}
              </div>
              {workflow && <Workflow w={workflow} />}
            </div>
          );
        }}
      </Loadable>
    </>
  );
}
