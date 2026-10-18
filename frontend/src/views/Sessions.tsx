import { CircleDotIcon, FileTextIcon, Trash2Icon, VideoIcon } from "lucide-react";
import { useState } from "react";
import { deleteSession, listSessions } from "../api/client";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { cn } from "../lib/utils";
import type { Session } from "../types/contract";
import { Empty, ErrorNote, Loadable, PageHeader, scenarioInfo, fmtDate, fmtDuration, go, useAsync, useWs } from "../ui";

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

// The copied sample run has no recorder; every other session is numbered oldest first.
const isSample = (s: Pick<Session, "expert_uid">) => s.expert_uid === "sample";

export function sessionNames(sessions: Pick<Session, "id" | "started_at" | "expert_uid">[]): Map<string, string> {
  const names = new Map<string, string>();
  let n = 0;
  for (const s of [...sessions].sort((a, b) => a.started_at.localeCompare(b.started_at)))
    names.set(s.id, isSample(s) ? "Sample session" : `Session ${++n}`);
  return names;
}

export function SessionName({ s, name }: { s: Session; name: string }) {
  const Icon = isSample(s) ? FileTextIcon : VideoIcon;
  return (
    <a href={`#/sessions/${s.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-3 font-medium">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      {name}
    </a>
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
  const { ws, readOnly, sandbox } = useWs();
  const state = useAsync(() => listSessions(ws), [ws]);
  const [err, setErr] = useState<string | null>(null);
  const canDelete = sandbox && !readOnly; // judges only: the expert's recordings stay
  const remove = (s: Session, name: string) => {
    const credit = isSample(s) ? "" : " You get the recording back to use again.";
    const ask = `Delete ${name}? Its recording, steps, summary and questions are removed for good, and patterns forget it.${credit} The decision graph and exam keep what they learned until you rebuild them.`;
    if (!window.confirm(ask)) return;
    setErr(null);
    deleteSession(s.id).then(state.reload, (e: Error) => setErr(e.message));
  };

  return (
    <>
      <PageHeader
        title="Sessions"
        description={`Each recording of the expert working through ${scenarioInfo().item_label}s (${scenarioInfo().title.toLowerCase()}).`}
        actions={!readOnly && <RecordButton />}
      />
      {err && <ErrorNote>{err}</ErrorNote>}
      <Loadable state={state}>
        {(sessions) => {
          const names = sessionNames(sessions);
          return sessions.length === 0 ? (
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
                    <TableHead className="eyebrow">Status</TableHead>
                    {canDelete && <TableHead className="pr-4"><span className="sr-only">Delete</span></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...sessions]
                    .sort((a, b) => b.started_at.localeCompare(a.started_at))
                    .map((s) => (
                      <TableRow key={s.id} className="cursor-pointer" onClick={() => go(`/sessions/${s.id}`)}>
                        <TableCell className="pl-4">
                          <SessionName s={s} name={names.get(s.id) ?? s.id} />
                        </TableCell>
                        <TableCell>{fmtDate(s.started_at)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtDuration(s.duration_s)}</TableCell>
                        <TableCell>{s.kind === "heldout" ? <Badge variant="outline">Held out for exam</Badge> : "Training"}</TableCell>
                        <TableCell className={s.live_enabled ? undefined : "text-muted-foreground"}>{s.live_enabled ? "On" : "Off"}</TableCell>
                        <TableCell>
                          <SessionStatus s={s} />
                        </TableCell>
                        {canDelete && (
                          <TableCell className="pr-4 text-right">
                            {s.status !== "processing" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Delete ${names.get(s.id) ?? s.id}`}
                                title="Delete session"
                                onClick={(e) => (e.stopPropagation(), remove(s, names.get(s.id) ?? s.id))}
                              >
                                <Trash2Icon />
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </Card>
          );
        }}
      </Loadable>
    </>
  );
}
