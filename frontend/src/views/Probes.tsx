import { useState } from "react";
import { answerProbe, editAnswer, listProbes, type ProbeWithAnswer } from "../api/client";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Field, FieldDescription, FieldLabel } from "../components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import type { Probe } from "../types/contract";
import { ClipButton, Empty, ErrorNote, Loadable, ModerationTag, PageHeader, Sop, fmtDate, useAsync, useWs } from "../ui";

export const CDM: Record<Probe["cdm_type"], string> = {
  cue: "What you noticed",
  goal: "What you were protecting",
  option: "Other options",
  experience: "Where you learned it",
  rule: "Rule of thumb",
  anomaly: "What would change it",
  hypothetical: "What if",
};

const SOURCE: Record<Probe["source"], string> = {
  live: "Asked live",
  batch: "From the recording",
  exam_miss: "From an exam miss",
};

const ANSWER_SOURCE = { voice_live: "Spoken", typed: "Typed", edited: "Edited" } as const;

function ProbeCard({ probe, readOnly, onSaved }: { probe: ProbeWithAnswer; readOnly: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(probe.status === "open");
  const [text, setText] = useState(probe.answer?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await (probe.answer ? editAnswer(probe.id, text) : answerProbe(probe.id, text, "typed"));
      setEditing(false);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="eyebrow">{CDM[probe.cdm_type]}</span>
          <Sop rule={probe.sop_rule} />
          <Badge variant={probe.source === "live" ? "default" : "secondary"}>{SOURCE[probe.source]}</Badge>
          {probe.clip && <ClipButton clip={probe.clip}>Watch {probe.clip.start_ts}</ClipButton>}
        </div>
        <CardAction className="text-xs text-muted-foreground">{fmtDate(probe.created_at)}</CardAction>
        <CardTitle className="mt-2 max-w-[60ch] text-lg">{probe.question}</CardTitle>
      </CardHeader>

      <CardContent>
        {editing && !readOnly ? (
          <Field>
            <FieldLabel htmlFor={`a-${probe.id}`}>Your answer</FieldLabel>
            <Textarea id={`a-${probe.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={3} />
            <FieldDescription>In your own words. A sentence or two is enough.</FieldDescription>
          </Field>
        ) : probe.answer ? (
          <p className="quote">{probe.answer.text}</p>
        ) : (
          <p className="text-muted-foreground">Not answered yet.</p>
        )}
        {err && (
          <div className="mt-3">
            <ErrorNote>{err}</ErrorNote>
          </div>
        )}
      </CardContent>

      {editing && !readOnly ? (
        <CardFooter className="gap-2">
          <Button disabled={busy || !text.trim()} aria-busy={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save answer"}
          </Button>
          {probe.answer && (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </CardFooter>
      ) : probe.answer ? (
        <CardFooter className="flex-wrap gap-2 text-xs text-muted-foreground">
          <span>
            {ANSWER_SOURCE[probe.answer.source]}, {fmtDate(probe.answer.answered_at)}
          </span>
          <ModerationTag m={probe.answer.moderation} />
          {!readOnly && (
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => setEditing(true)}>
              Edit answer
            </Button>
          )}
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function Probes() {
  const { ws, readOnly } = useWs();
  const state = useAsync(() => listProbes(ws), [ws]);

  return (
    <>
      <PageHeader
        title="Questions for the expert"
        description="Each one asks why a decision went the way it did. Answers become the reasons in the decision graph. Flagged answers stay out."
      />
      <Loadable state={state}>
        {(probes) => {
          const open = probes.filter((p) => p.status === "open");
          const answered = probes.filter((p) => p.status !== "open");
          const list = (items: ProbeWithAnswer[], empty: [string, string]) =>
            items.length === 0 ? (
              <Empty title={empty[0]}>{empty[1]}</Empty>
            ) : (
              <div className="flex max-w-3xl flex-col gap-4">
                {items.map((p) => (
                  <ProbeCard key={p.id} probe={p} readOnly={readOnly} onSaved={state.reload} />
                ))}
              </div>
            );
          return (
            <Tabs defaultValue="open">
              <TabsList className="mb-2">
                <TabsTrigger value="open">Waiting ({open.length})</TabsTrigger>
                <TabsTrigger value="answered">Answered ({answered.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="open">
                {list(open, [
                  "Nothing waiting",
                  "New questions arrive after each recording is analysed, and when the successor exam finds a gap.",
                ])}
              </TabsContent>
              <TabsContent value="answered">{list(answered, ["No answers yet", "Answer a waiting question to see it here."])}</TabsContent>
            </Tabs>
          );
        }}
      </Loadable>
    </>
  );
}
