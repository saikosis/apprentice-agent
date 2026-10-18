import { CheckIcon, MessageCircleQuestionIcon, MessageSquareTextIcon, ShieldAlertIcon, TrendingUpIcon, XIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { getGraph, latestReport, listProbes, listSessions, listVariants, type ProbeWithAnswer } from "../api/client";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../components/ui/chart";
import { Progress } from "../components/ui/progress";
import { Separator } from "../components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import type { ExamReport, Session } from "../types/contract";
import { Loadable, PageHeader, scenarioInfo, fmtDate, fmtDuration, go, trapLabel, useAsync, useWs } from "../ui";
import { CDM } from "./Probes";
import { SessionStatus } from "./Sessions";


const caseConfig = {
  sop_only: { label: "SOP only", color: "var(--chart-2)" },
  sop_graph: { label: "SOP + graph", color: "var(--chart-1)" },
} satisfies ChartConfig;

// Colours go to the categories present, so six slices never reuse a hue.
const CDM_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--muted-foreground)", "var(--secondary-foreground)"];

function Delta({ value, unit, good = true }: { value: number; unit: string; good?: boolean }) {
  const up = value >= 0;
  return (
    <span className={up === good ? "font-medium text-success" : "font-medium text-destructive"}>
      {up ? "+" : ""}
      {value}
      {unit}
    </span>
  );
}

function ExamHero({ r }: { r: ExamReport }) {
  const so = r.per_arm.sop_only!;
  const sg = r.per_arm.sop_graph!;
  const data = r.cases.map((c) => ({ case: c.case_id.replace("c-", ""), sop_only: c.sop_only_judge_mean, sop_graph: c.sop_graph_judge_mean }));
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardDescription className="eyebrow">Successor exam, SOP + graph agent</CardDescription>
        <CardTitle className="text-6xl font-semibold tracking-tight">{Math.round(sg.agreement_pct)}%</CardTitle>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <TrendingUpIcon className="size-4 text-success" aria-hidden />
          <Delta value={Math.round(sg.agreement_pct - so.agreement_pct)} unit=" pts" />
          over the SOP-only agent ({Math.round(so.agreement_pct)}%) on {r.n_cases} cases
        </p>
      </CardHeader>
      <CardContent>
        <ChartContainer config={caseConfig} className="aspect-auto h-60 w-full">
          <BarChart data={data} margin={{ left: -20, right: 4, top: 8 }} barGap={3}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="case" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(v: string) => `Case ${Number(v)}`} />
            <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} tickLine={false} axisLine={false} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="sop_only" fill="var(--color-sop_only)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="sop_graph" fill="var(--color-sop_graph)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="border-t-0 bg-transparent text-sm text-muted-foreground">
        Judge score per case, 1 to 5, averaged over {r.runs_per_arm} runs. Pilot run {fmtDate(r.created_at)}.
      </CardFooter>
    </Card>
  );
}

function StatColumn({ probes, nodes, exceptions, r }: { probes: ProbeWithAnswer[]; nodes: number; exceptions: number; r: ExamReport | null }) {
  const answered = probes.filter((p) => p.status !== "open").length;
  const traps = r?.cases.filter((c) => c.trap_type !== "none").length ?? 0;
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardDescription className="eyebrow">Questions answered</CardDescription>
          <CardTitle className="text-4xl font-semibold tracking-tight">
            {answered}
            <span className="text-2xl text-muted-foreground"> of {probes.length}</span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-warning">{probes.length - answered} waiting</span> for the expert. Each answer
            becomes a reason in the graph.
          </p>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription className="eyebrow">Decision graph</CardDescription>
          <CardTitle className="text-3xl font-semibold tracking-tight">{nodes} nodes</CardTitle>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{exceptions} exceptions</span> to the written SOP, each tied to a clip.
          </p>
        </CardHeader>
        {r && (
          <>
            <Separator className="mx-4 w-auto" />
            <CardHeader>
              <CardDescription className="eyebrow">Traps handled</CardDescription>
              <CardTitle className="text-3xl font-semibold tracking-tight">
                {r.per_arm.sop_graph?.traps_correct} of {traps}
              </CardTitle>
              <p className="text-sm text-muted-foreground">The SOP-only agent handled {r.per_arm.sop_only?.traps_correct}.</p>
            </CardHeader>
          </>
        )}
      </Card>
    </div>
  );
}

function ProbeMix({ probes }: { probes: ProbeWithAnswer[] }) {
  const counts = Object.entries(CDM)
    .map(([k, label]) => ({ key: k, label, n: probes.filter((p) => p.cdm_type === k).length }))
    .filter((d) => d.n > 0)
    .map((d, i) => ({ ...d, fill: CDM_COLORS[i] }));
  const config = Object.fromEntries(counts.map((d) => [d.key, { label: d.label, color: d.fill }])) satisfies ChartConfig;
  return (
    <Card>
      <CardHeader>
        <CardDescription className="eyebrow">What the questions ask</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ChartContainer config={config} className="mx-auto aspect-square h-44">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
            <Pie data={counts} dataKey="n" nameKey="key" innerRadius={52} outerRadius={80} strokeWidth={2} stroke="var(--card)" isAnimationActive={false}>
              {counts.map((d) => (
                <Cell key={d.key} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <ul className="flex flex-col gap-2 text-sm">
          {counts.map((d) => (
            <li key={d.key} className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: d.fill }} aria-hidden />
              <span>{d.label}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">{Math.round((d.n / probes.length) * 100)}%</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Patterns({ variants }: { variants: Awaited<ReturnType<typeof listVariants>> }) {
  const top = [...variants].sort((a, b) => b.frequency - a.frequency).slice(0, 5);
  const max = Math.max(1, ...top.map((v) => v.frequency));
  return (
    <Card>
      <CardHeader>
        <CardDescription className="eyebrow">Most repeated departures</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {top.length === 0 && <p className="text-sm text-muted-foreground">Patterns appear after 3 analysed sessions.</p>}
        {top.map((v) => (
          <a key={v.id} href="#/discovery" className="flex flex-col gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <div className="flex items-baseline gap-3 text-sm">
              <span className="font-medium">{v.name}</span>
              <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{v.frequency}×</span>
            </div>
            <Progress value={(v.frequency / max) * 100} className="h-2 [&>[data-slot=progress-indicator]]:bg-chart-1" aria-label={`${v.name}: seen ${v.frequency} times`} />
            <span className="text-xs text-muted-foreground">in {v.session_ids.length} sessions</span>
          </a>
        ))}
      </CardContent>
    </Card>
  );
}

function Traps({ r }: { r: ExamReport | null }) {
  const traps = r?.cases.filter((c) => c.trap_type !== "none") ?? [];
  const mark = (ok: boolean) =>
    ok ? (
      <Badge variant="secondary" className="text-success">
        <CheckIcon data-icon="inline-start" />
        Caught
      </Badge>
    ) : (
      <Badge variant="destructive">
        <XIcon data-icon="inline-start" />
        Missed
      </Badge>
    );
  return (
    <Card>
      <CardHeader>
        <CardDescription className="eyebrow">Exam traps</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {traps.length === 0 && <p className="text-sm text-muted-foreground">No exam has run yet.</p>}
        {traps.map((c, i) => (
          <div key={c.case_id} className="flex flex-col gap-2.5">
            {i > 0 && <Separator />}
            <div className="flex items-baseline gap-2 text-sm">
              <span className="font-medium">{trapLabel(c.trap_type)}</span>
              <span className="ml-auto text-xs text-muted-foreground">{c.case_id}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
              <span>SOP only</span>
              {mark(c.sop_only_agree)}
              <span>SOP + graph</span>
              {mark(c.sop_graph_agree)}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SessionsTable({ sessions }: { sessions: Session[] }) {
  return (
    <Card className="gap-0 pb-0 lg:col-span-2">
      <CardHeader className="border-b">
        <CardTitle className="text-lg">Recent sessions</CardTitle>
        <CardDescription>Recordings of the expert working through {scenarioInfo().item_label}s. Select one to see each step.</CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="eyebrow pl-4">Session</TableHead>
            <TableHead className="eyebrow">Recorded</TableHead>
            <TableHead className="eyebrow text-right">Length</TableHead>
            <TableHead className="eyebrow">Use</TableHead>
            <TableHead className="eyebrow pr-4">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...sessions]
            .sort((a, b) => b.started_at.localeCompare(a.started_at))
            .slice(0, 6)
            .map((s) => (
              <TableRow key={s.id} className="cursor-pointer" onClick={() => go(`/sessions/${s.id}`)}>
                <TableCell className="pl-4">
                  <a href={`#/sessions/${s.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-3 font-medium">
                    <span className="flex size-8 items-center justify-center rounded-md bg-muted font-mono text-xs">{s.id.replace("s-", "")}</span>
                    Session {s.id}
                  </a>
                </TableCell>
                <TableCell>{fmtDate(s.started_at)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtDuration(s.duration_s)}</TableCell>
                <TableCell>{s.kind === "heldout" ? "Held out for exam" : "Training"}</TableCell>
                <TableCell className="pr-4">
                  <SessionStatus s={s} />
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function Activity({ probes }: { probes: ProbeWithAnswer[] }) {
  const items = probes
    .map((p) =>
      p.answer
        ? { id: p.id, at: p.answer.answered_at, icon: p.answer.moderation?.match_found ? ShieldAlertIcon : MessageSquareTextIcon, lead: "Expert answered", text: p.question }
        : { id: p.id, at: p.created_at, icon: MessageCircleQuestionIcon, lead: p.source === "exam_miss" ? "Exam miss raised" : "New question", text: p.question },
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);
  return (
    <Card>
      <CardHeader>
        <CardDescription className="eyebrow">Activity</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-5">
          {items.map(({ id, at, icon: Icon, lead, text }) => (
            <li key={id} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <p>
                  <span className="font-semibold">{lead}:</span> {text}
                </p>
                <a href="#/probes" className="text-xs text-muted-foreground hover:text-foreground">
                  {fmtDate(at)}
                </a>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export function Overview() {
  const { ws } = useWs();
  const state = useAsync(
    () => Promise.all([listSessions(ws), listProbes(ws), listVariants(ws), getGraph(ws), latestReport(ws)]),
    [ws],
  );
  return (
    <Loadable state={state}>
      {([sessions, probes, variants, graph, report]) => {
        const processed = sessions.filter((s) => s.status === "processed").length;
        return (
          <>
            <PageHeader
              title="Overview"
              description={`${sessions.length} sessions recorded, ${processed} analysed. What the expert knows that the SOP doesn't say, and whether it carries over.`}
            />
            <div className="grid gap-4 lg:grid-cols-3">
              {report?.per_arm.sop_only && report.per_arm.sop_graph ? (
                <ExamHero r={report} />
              ) : (
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardDescription className="eyebrow">Successor exam</CardDescription>
                    <CardTitle className="text-2xl">No exam has run yet</CardTitle>
                    <CardDescription>Build the decision graph, then run the exam to compare both agents.</CardDescription>
                  </CardHeader>
                </Card>
              )}
              <StatColumn probes={probes} nodes={graph?.nodes.length ?? 0} exceptions={graph?.nodes.filter((n) => n.kind === "exception").length ?? 0} r={report} />
              <ProbeMix probes={probes} />
              <Patterns variants={variants} />
              <Traps r={report} />
              <SessionsTable sessions={sessions} />
              <Activity probes={probes} />
            </div>
          </>
        );
      }}
    </Loadable>
  );
}
