import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import { generateCases, getReport, labelCase, latestReport, listSessions, runExam } from "../api/client";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../components/ui/chart";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { cn } from "../lib/utils";
import type { ArmSummary, Decision, ExamCase, ExamReport } from "../types/contract";
import { DecisionChip, Empty, ErrorNote, Loadable, PageHeader, fmtDate, useAsync, useWs } from "../ui";

const TRAP: Record<string, string> = {
  none: "",
  consignment_lookalike: "Lookalike vendor name",
  prompt_injection: "Instructions hidden in an email",
  duplicate_renumbered: "Duplicate with a new number",
};
const DECISIONS: Decision[] = ["approve", "reject", "hold", "escalate"];
const DECISION_LABEL: Record<Decision, string> = { approve: "Approve", reject: "Reject", hold: "On hold", escalate: "Escalate" };
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function ArmCard({ title, sub, s, traps, strong }: { title: string; sub: string; s: ArmSummary; traps: number; strong?: boolean }) {
  return (
    <Card className={cn(strong && "ring-2 ring-primary/60")}>
      <CardHeader>
        <CardDescription className="eyebrow">{title}</CardDescription>
        <CardTitle className="text-6xl font-semibold tracking-tight">{Math.round(s.agreement_pct)}%</CardTitle>
        <p className="text-muted-foreground">of cases decided the way the expert did</p>
        {strong && <CardAction><Badge>Graph</Badge></CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        <p className="text-muted-foreground">{sub}</p>
        <p>
          Judge score <span className="font-semibold">{s.judge_mean.toFixed(1)}</span> of 5. Traps handled{" "}
          <span className="font-semibold">
            {s.traps_correct} of {traps}
          </span>
          .{s.blocked_runs > 0 && ` ${s.blocked_runs} runs blocked by Model Armor.`}
        </p>
      </CardContent>
    </Card>
  );
}

const armConfig = { v: { label: "Score" } } satisfies ChartConfig;

function PilotCharts({ r }: { r: ExamReport }) {
  const so = r.per_arm.sop_only;
  const sg = r.per_arm.sop_graph;
  if (!so || !sg) return null;
  const charts = [
    { title: "Agreement with expert", unit: "%", max: 100, data: [{ arm: "SOP only", v: Math.round(so.agreement_pct) }, { arm: "SOP + graph", v: Math.round(sg.agreement_pct) }] },
    { title: "Judge score, 1 to 5", unit: "", max: 5, data: [{ arm: "SOP only", v: so.judge_mean }, { arm: "SOP + graph", v: sg.judge_mean }] },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {charts.map((c) => (
        <Card key={c.title}>
          <CardHeader>
            <CardDescription className="eyebrow">{c.title}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={armConfig} className="aspect-auto h-52 w-full">
              <BarChart data={c.data} margin={{ top: 22, left: -20, right: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="arm" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis domain={[0, c.max]} tickLine={false} axisLine={false} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Bar dataKey="v" radius={[6, 6, 0, 0]} maxBarSize={72} isAnimationActive={false}>
                  {c.data.map((d, i) => (
                    <Cell key={d.arm} fill={i ? "var(--chart-1)" : "var(--chart-2)"} />
                  ))}
                  <LabelList dataKey="v" position="top" className="fill-foreground" fontSize={12} fontWeight={600} formatter={(v) => `${String(v)}${c.unit}`} />
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Agreement({ d, agree, stability, runs }: { d: Decision | null; agree: boolean; stability: number; runs: number }) {
  return (
    <div className={cn("flex flex-col items-start gap-1", !agree && "opacity-60")}>
      <DecisionChip d={d} />
      <span className="text-xs text-muted-foreground">
        {agree ? "Matches" : "Differs"}, {Math.round(stability * runs)}/{runs} runs
      </span>
    </div>
  );
}

function Report({ r }: { r: ExamReport }) {
  const so = r.per_arm.sop_only;
  const sg = r.per_arm.sop_graph;
  const traps = r.cases.filter((c) => c.trap_type !== "none").length;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Pilot run, {fmtDate(r.created_at)}: {r.n_cases} cases, {r.runs_per_arm} runs per agent, synthetic invoices, one expert.
        Graph version {r.graph_version}.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {so && <ArmCard title="SOP only" sub="A new analyst agent given the written SOP." s={so} traps={traps} />}
        {sg && <ArmCard title="SOP + decision graph" sub="Same agent, also given the expert's reasons." s={sg} traps={traps} strong />}
      </div>

      <PilotCharts r={r} />

      <Card className="gap-0 pb-0">
        <CardHeader className="border-b">
          <CardTitle className="text-lg">Case by case</CardTitle>
          <CardDescription>
            Each agent ran {r.runs_per_arm} times per case; the badge shows its majority decision. Labels are only seen by the
            judge, never by the agents or the graph.
          </CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="eyebrow pl-4">Case</TableHead>
              <TableHead className="eyebrow">Expert</TableHead>
              <TableHead className="eyebrow">SOP only</TableHead>
              <TableHead className="eyebrow">SOP + graph</TableHead>
              <TableHead className="eyebrow text-right">Judge, SOP only</TableHead>
              <TableHead className="eyebrow pr-4 text-right">Judge, SOP + graph</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.cases.map((c) => (
              <TableRow key={c.case_id} className="align-top">
                <TableCell className="pl-4">
                  <div className="flex flex-col items-start gap-1">
                    <span className="font-medium">{c.case_id}</span>
                    {TRAP[c.trap_type] && <Badge variant="outline">Trap: {TRAP[c.trap_type]}</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  <DecisionChip d={c.expert_decision} />
                </TableCell>
                <TableCell>
                  <Agreement d={c.sop_only_majority} agree={c.sop_only_agree} stability={c.sop_only_stability} runs={r.runs_per_arm} />
                </TableCell>
                <TableCell>
                  <Agreement d={c.sop_graph_majority} agree={c.sop_graph_agree} stability={c.sop_graph_stability} runs={r.runs_per_arm} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.sop_only_judge_mean.toFixed(2)}</TableCell>
                <TableCell className="pr-4 text-right tabular-nums">{c.sop_graph_judge_mean.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {r.new_probe_ids.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {r.new_probe_ids.length === 1 ? "1 new question" : `${r.new_probe_ids.length} new questions`} for the expert
            </CardTitle>
            <CardDescription>
              Where the graph agent got a case wrong, Apprentice asks the expert about that situation. It describes the case,
              never the expected answer.
            </CardDescription>
            <CardAction>
              <Button variant="outline" asChild>
                <a href="#/probes">Answer them</a>
              </Button>
            </CardAction>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

function CaseLabel({ c }: { c: ExamCase }) {
  const [decision, setDecision] = useState<Decision | "">(c.expert_label?.decision ?? "");
  const [rationale, setRationale] = useState(c.expert_label?.rationale ?? "");
  const [saved, setSaved] = useState(Boolean(c.expert_label));
  const [err, setErr] = useState<string | null>(null);
  const inv = c.invoice;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {c.id}: {inv.vendor_name} ({inv.vendor_id}), {inv.invoice_no}, {inr(inv.amount_inr)}
        </CardTitle>
        <CardDescription>
          PO {inv.po_number ?? "none"}, GRN {inv.grn_number ?? "none"}, due {inv.due_date}
        </CardDescription>
        <CardAction>
          <Badge variant="secondary">{c.origin === "heldout" ? "From a held-out session" : "Generated"}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground">{c.context}</p>
        {c.emails.map((e) => (
          <details key={e.id} className="rounded-lg border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">
              Email from {e.sender}: {e.subject}
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{e.body}</p>
          </details>
        ))}
        <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
          <Select value={decision} onValueChange={(v) => (setDecision(v as Decision), setSaved(false))}>
            <SelectTrigger aria-label={`Your decision for ${c.id}`} className="w-full">
              <SelectValue placeholder="Your decision" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {DECISIONS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {DECISION_LABEL[d]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Input
            aria-label={`One-line reason for ${c.id}`}
            placeholder="One-line reason"
            value={rationale}
            onChange={(e) => (setRationale(e.target.value), setSaved(false))}
          />
          <Button
            disabled={!decision || !rationale.trim() || saved}
            onClick={() =>
              decision &&
              labelCase(c.id, decision, rationale).then(
                () => (setSaved(true), setErr(null)),
                (e: Error) => setErr(e.message),
              )
            }
          >
            {saved ? "Saved" : "Save label"}
          </Button>
        </div>
        {err && <ErrorNote>{err}</ErrorNote>}
      </CardContent>
    </Card>
  );
}

function Prepare({ onReport }: { onReport: (r: ExamReport) => void }) {
  const { ws } = useWs();
  const sessions = useAsync(() => listSessions(ws), [ws]);
  const [cases, setCases] = useState<ExamCase[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const heldout = (sessions.data ?? []).filter((s) => s.kind === "heldout" && s.status === "processed").map((s) => s.id);

  const generate = async () => {
    setBusy("Writing exam cases from the graph and held-out sessions…");
    setErr(null);
    try {
      setCases(await generateCases(heldout.slice(0, 2)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    setBusy("Running both agents three times per case, then scoring. This takes a few minutes.");
    setErr(null);
    try {
      const { report_id } = await runExam(3);
      for (let i = 0; ; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          onReport(await getReport(report_id));
          break;
        } catch (e) {
          if (i >= 180) throw e; // ~15 min: give up and show why
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-10 flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">Prepare a new exam</h2>
          <p className="text-muted-foreground">The expert labels each case with the decision they would make. Labels go to the judge only.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" disabled={Boolean(busy) || heldout.length < 2} onClick={() => void generate()}>
            Generate cases
          </Button>
          <Button disabled={Boolean(busy) || !cases?.length} aria-busy={Boolean(busy)} onClick={() => void run()}>
            Run the exam
          </Button>
        </div>
      </div>
      {heldout.length < 2 && (
        <p className="text-sm text-muted-foreground">Generating cases needs 2 analysed held-out sessions. You have {heldout.length}.</p>
      )}
      {busy && (
        <Alert>
          <AlertDescription>{busy}</AlertDescription>
        </Alert>
      )}
      {err && <ErrorNote>{err}</ErrorNote>}
      {cases?.map((c) => <CaseLabel key={c.id} c={c} />)}
    </section>
  );
}

export function Exam() {
  const { ws, readOnly } = useWs();
  const state = useAsync(() => latestReport(ws), [ws]);
  const [fresh, setFresh] = useState<ExamReport | null>(null);

  return (
    <>
      <PageHeader
        title="Successor exam"
        description="Two new-analyst agents face the same invoices. One has only the SOP. The other also has the expert's decision graph. A judge compares both against the expert's own calls."
      />
      <Loadable state={state}>
        {(report) => {
          const r = fresh ?? report;
          return r ? (
            <Report r={r} />
          ) : (
            <Empty title="No exam has run yet">Build the decision graph first, then generate and label cases below.</Empty>
          );
        }}
      </Loadable>
      {!readOnly && <Prepare onReport={setFresh} />}
    </>
  );
}
