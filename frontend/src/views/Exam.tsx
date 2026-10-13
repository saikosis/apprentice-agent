import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { generateCases, getReport, labelCase, latestReport, listSessions, runExam } from "../api/client";
import type { ArmSummary, Decision, ExamCase, ExamReport } from "../types/contract";
import { Empty, Loadable, DecisionChip, fmtDate, useAsync, useWs } from "../ui";

const TRAP: Record<string, string> = {
  none: "",
  consignment_lookalike: "Lookalike vendor name",
  prompt_injection: "Instructions hidden in an email",
  duplicate_renumbered: "Duplicate with a new number",
};
const DECISIONS: Decision[] = ["approve", "reject", "hold", "escalate"];
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function ArmColumn({ title, sub, s, traps, strong }: { title: string; sub: string; s: ArmSummary; traps: number; strong?: boolean }) {
  return (
    <div style={{ display: "grid", gap: 4, paddingLeft: 16, borderLeft: `4px solid ${strong ? "var(--primary)" : "var(--rule-strong)"}` }}>
      <h3>{title}</h3>
      <p className="faint" style={{ fontSize: "var(--t-sm)" }}>
        {sub}
      </p>
      <div style={{ fontSize: "clamp(2.6rem, 6vw, 4rem)", fontWeight: 400, lineHeight: 1.05 }}>
        {Math.round(s.agreement_pct)}%
      </div>
      <p className="muted">of cases decided the way the expert did</p>
      <p style={{ fontSize: "var(--t-sm)", marginTop: 6 }}>
        Judge score {s.judge_mean.toFixed(1)} of 5. Traps handled {s.traps_correct} of {traps}.
        {s.blocked_runs > 0 && ` ${s.blocked_runs} runs blocked by Model Armor.`}
      </p>
    </div>
  );
}

function PilotCharts({ r }: { r: ExamReport }) {
  const so = r.per_arm.sop_only;
  const sg = r.per_arm.sop_graph;
  if (!so || !sg) return null;
  const charts = [
    { title: "Agreement with expert (%)", max: 100, data: [{ arm: "SOP only", v: Math.round(so.agreement_pct) }, { arm: "SOP + graph", v: Math.round(sg.agreement_pct) }] },
    { title: "Judge score (1–5)", max: 5, data: [{ arm: "SOP only", v: so.judge_mean }, { arm: "SOP + graph", v: sg.judge_mean }] },
  ];
  const ink = "var(--ink)";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
      {charts.map((c) => (
        <figure key={c.title} className="sheet" style={{ margin: 0 }}>
          <figcaption style={{ fontWeight: 500, fontSize: "var(--t-sm)", marginBottom: 8 }}>{c.title}</figcaption>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={c.data} margin={{ top: 18, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} stroke="var(--rule)" />
              <XAxis dataKey="arm" tick={{ fill: ink, fontSize: 12 }} axisLine={{ stroke: "var(--rule-strong)" }} tickLine={false} />
              <YAxis domain={[0, c.max]} tick={{ fill: "var(--ink-faint)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "var(--paper)" }} contentStyle={{ background: "var(--sheet)", border: "1px solid var(--rule-strong)" }} />
              <Bar dataKey="v" name={c.title} fill="var(--ink)" maxBarSize={64} isAnimationActive={false}>
                {c.data.map((d, i) => (
                  <Cell key={d.arm} fill={i ? "var(--primary)" : "var(--ink-faint)"} />
                ))}
                <LabelList dataKey="v" position="top" fill={ink} fontSize={12} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </figure>
      ))}
    </div>
  );
}

function Report({ r }: { r: ExamReport }) {
  const so = r.per_arm.sop_only;
  const sg = r.per_arm.sop_graph;
  const traps = r.cases.filter((c) => c.trap_type !== "none").length;
  return (
    <div style={{ display: "grid", gap: 32 }}>
      <section className="sheet" style={{ display: "grid", gap: 20 }}>
        <p className="muted" style={{ fontSize: "var(--t-sm)" }}>
          Pilot run, {fmtDate(r.created_at)}: {r.n_cases} cases, {r.runs_per_arm} runs per agent, synthetic invoices, one
          expert. Graph version {r.graph_version}.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 24 }}>
          {so && <ArmColumn title="SOP only" sub="A new analyst agent given the written SOP" s={so} traps={traps} />}
          {sg && <ArmColumn title="SOP + decision graph" sub="Same agent, also given the expert's reasons" s={sg} traps={traps} strong />}
        </div>
      </section>

      <PilotCharts r={r} />

      <section>
        <h2 style={{ marginBottom: 6 }}>Case by case</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Each agent ran {r.runs_per_arm} times per case; the chip shows its majority decision. Labels are only seen by the
          judge, never by the agents or the graph.
        </p>
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>Case</th>
                <th>Expert</th>
                <th>SOP only</th>
                <th>SOP + graph</th>
                <th className="num">Judge, SOP only</th>
                <th className="num">Judge, SOP + graph</th>
              </tr>
            </thead>
            <tbody>
              {r.cases.map((c, i) => (
                <tr key={c.case_id}>
                  <td>
                    <strong>{c.case_id}</strong>
                    {TRAP[c.trap_type] && <div className="tag" style={{ display: "inline-block", marginLeft: 8 }}>Trap: {TRAP[c.trap_type]}</div>}
                  </td>
                  <td>
                    <DecisionChip d={c.expert_decision} />
                  </td>
                  <td style={{ opacity: c.sop_only_agree ? 1 : 0.55 }}>
                    <DecisionChip d={c.sop_only_majority} />{" "}
                    <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
                      {c.sop_only_agree ? "matches" : "differs"}, {Math.round(c.sop_only_stability * r.runs_per_arm)}/{r.runs_per_arm} runs
                    </span>
                  </td>
                  <td style={{ opacity: c.sop_graph_agree ? 1 : 0.55 }}>
                    <DecisionChip d={c.sop_graph_majority} />{" "}
                    <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
                      {c.sop_graph_agree ? "matches" : "differs"}, {Math.round(c.sop_graph_stability * r.runs_per_arm)}/{r.runs_per_arm} runs
                    </span>
                  </td>
                  <td className="num">{c.sop_only_judge_mean.toFixed(2)}</td>
                  <td className="num">{c.sop_graph_judge_mean.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {r.new_probe_ids.length > 0 && (
        <section className="sheet" style={{ display: "grid", gap: 8, justifyItems: "start" }}>
          <h3>
            {r.new_probe_ids.length === 1 ? "1 new question" : `${r.new_probe_ids.length} new questions`} for the expert
          </h3>
          <p className="muted">
            Where the graph agent got a case wrong, Apprentice asks the expert about that situation. It describes the case,
            never the expected answer.
          </p>
          <a className="btn quiet" href="#/probes">
            Answer them
          </a>
        </section>
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
    <article className="sheet" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <strong>{c.id}</strong>
        <span>
          {inv.vendor_name} ({inv.vendor_id}), {inv.invoice_no}, {inr(inv.amount_inr)}
        </span>
        <span className="faint">
          PO {inv.po_number ?? "none"}, GRN {inv.grn_number ?? "none"}, due {inv.due_date}
        </span>
        <span className="tag">{c.origin === "heldout" ? "From a held-out session" : "Generated"}</span>
      </div>
      <p className="muted">{c.context}</p>
      {c.emails.map((e) => (
        <details key={e.id}>
          <summary>
            Email from {e.sender}: {e.subject}
          </summary>
          <p style={{ whiteSpace: "pre-wrap", marginTop: 6, fontSize: "var(--t-sm)" }}>{e.body}</p>
        </details>
      ))}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 200px) 1fr auto", gap: 8, alignItems: "start" }}>
        <select aria-label={`Your decision for ${c.id}`} value={decision} onChange={(e) => (setDecision(e.target.value as Decision), setSaved(false))}>
          <option value="">Your decision…</option>
          {DECISIONS.map((d) => (
            <option key={d} value={d}>
              {d === "hold" ? "On hold" : d[0].toUpperCase() + d.slice(1)}
            </option>
          ))}
        </select>
        <input
          type="text"
          aria-label={`One-line reason for ${c.id}`}
          placeholder="One-line reason"
          value={rationale}
          onChange={(e) => (setRationale(e.target.value), setSaved(false))}
        />
        <button
          className="btn"
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
        </button>
      </div>
      {err && <p className="error">{err}</p>}
    </article>
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
    <section style={{ display: "grid", gap: 14, marginTop: 40 }}>
      <h2>Prepare a new exam</h2>
      <p className="muted">
        The expert labels each case with the decision they would make. Labels go to the judge only.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn quiet" disabled={Boolean(busy) || heldout.length < 2} onClick={() => void generate()}>
          Generate cases
        </button>
        <button className="btn" disabled={Boolean(busy) || !cases?.length} onClick={() => void run()}>
          Run the exam
        </button>
      </div>
      {heldout.length < 2 && (
        <p className="faint">Generating cases needs 2 analysed held-out sessions. You have {heldout.length}.</p>
      )}
      {busy && <p className="muted">{busy}</p>}
      {err && <p className="error">{err}</p>}
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
      <div className="page-head">
        <div>
          <h1>Successor exam</h1>
          <p>
            Two new-analyst agents face the same invoices. One has only the SOP. The other also has the expert's decision
            graph. A judge compares both against the expert's own calls.
          </p>
        </div>
      </div>
      <Loadable state={state}>
        {(report) => {
          const r = fresh ?? report;
          return r ? (
            <Report r={r} />
          ) : (
            <Empty title="No exam has run yet">
              <p className="muted">Build the decision graph first, then generate and label cases below.</p>
            </Empty>
          );
        }}
      </Loadable>
      {!readOnly && <Prepare onReport={setFresh} />}
    </>
  );
}
