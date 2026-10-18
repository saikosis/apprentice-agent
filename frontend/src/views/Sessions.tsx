import { CircleDotIcon } from "lucide-react";
import { listSessions } from "../api/client";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { cn } from "../lib/utils";
import type { Session } from "../types/contract";
import { Empty, Loadable, PageHeader, scenarioInfo, fmtDate, fmtDuration, go, useAsync, useWs } from "../ui";

export const SESSION_STATUS: Record<Session["status"], string> = {
  created: "Not recorded",
  uploading: "Uploading",
  uploaded: "Uploaded",
  processing: "Analysing",
  processed: "Ready",
  failed: "Failed",
};

export function SessionStatus({ s }: { s: Session }) {
  const dot = s.status === "processed" ? "bg-success" : s.status === "failed" ? "bg-destructive" : "bg-warning";
  return (
    <Badge variant="secondary" title={s.error ?? undefined}>
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
      {SESSION_STATUS[s.status]}
    </Badge>
  );
}

const RecordButton = () => (
  <Button asChild>
    <a href="#/record">
      <CircleDotIcon data-icon="inline-start" />
      Record a session
    </a>
  </Button>
);

export function Sessions() {
  const { ws, readOnly } = useWs();
  const state = useAsync(() => listSessions(ws), [ws]);

  return (
    <>
      <PageHeader
        title="Sessions"
        description={`Each recording of the expert working through ${scenarioInfo().item_label}s (${scenarioInfo().title.toLowerCase()}).`}
        actions={!readOnly && <RecordButton />}
      />
      <Loadable state={state}>
        {(sessions) =>
          sessions.length === 0 ? (
            <Empty title="No sessions yet" action={!readOnly && <RecordButton />}>
              Record the expert working through a few {scenarioInfo().item_label}s. Apprentice watches for steps that depart from the SOP and asks about
              them.
            </Empty>
          ) : (
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="eyebrow pl-4">Session</TableHead>
                    <TableHead className="eyebrow">Recorded</TableHead>
                    <TableHead className="eyebrow text-right">Length</TableHead>
                    <TableHead className="eyebrow">Use</TableHead>
                    <TableHead className="eyebrow">Live questions</TableHead>
                    <TableHead className="eyebrow pr-4">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...sessions]
                    .sort((a, b) => b.started_at.localeCompare(a.started_at))
                    .map((s) => (
                      <TableRow key={s.id} className="cursor-pointer" onClick={() => go(`/sessions/${s.id}`)}>
                        <TableCell className="pl-4">
                          <a href={`#/sessions/${s.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-3 font-medium">
                            <span className="flex size-8 items-center justify-center rounded-md bg-muted font-mono text-xs">
                              {s.id.replace("s-", "")}
                            </span>
                            {s.id}
                          </a>
                        </TableCell>
                        <TableCell>{fmtDate(s.started_at)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtDuration(s.duration_s)}</TableCell>
                        <TableCell>{s.kind === "heldout" ? <Badge variant="outline">Held out for exam</Badge> : "Training"}</TableCell>
                        <TableCell className={s.live_enabled ? undefined : "text-muted-foreground"}>{s.live_enabled ? "On" : "Off"}</TableCell>
                        <TableCell className="pr-4">
                          <SessionStatus s={s} />
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </Card>
          )
        }
      </Loadable>
    </>
  );
}
