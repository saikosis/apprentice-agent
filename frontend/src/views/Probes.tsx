import { useState } from "react";
import { answerProbe, editAnswer, listProbes, type ProbeWithAnswer } from "../api/client";
import type { Probe } from "../types/contract";
import { ClipButton, Empty, Loadable, ModerationTag, Sop, fmtDate, useAsync, useWs } from "../ui";

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

const ANSWER_SOURCE = { voice_live: "spoken", typed: "typed", edited: "edited" } as const;

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
    <article className="sheet" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: "var(--t-sm)" }}>
        <strong>{CDM[probe.cdm_type]}</strong>
        <Sop rule={probe.sop_rule} />
        {probe.clip && <ClipButton clip={probe.clip}>Watch {probe.clip.start_ts}</ClipButton>}
        <span className={`tag${probe.source === "live" ? " live" : ""}`}>{SOURCE[probe.source]}</span>
        <span className="faint" style={{ marginLeft: "auto" }}>
          {fmtDate(probe.created_at)}
        </span>
      </div>
      <h3 style={{ fontWeight: 500, maxWidth: "52ch" }}>{probe.question}</h3>

      {editing && !readOnly ? (
        <>
          <label className="faint" htmlFor={`a-${probe.id}`} style={{ fontSize: "var(--t-sm)" }}>
            Your answer, in your own words. A sentence or two is enough.
          </label>
          <textarea id={`a-${probe.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={3} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled={busy || !text.trim()} onClick={() => void save()}>
              {busy ? "Saving…" : "Save answer"}
            </button>
            {probe.answer && (
              <button className="btn quiet" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
          {err && <p className="error">{err}</p>}
        </>
      ) : probe.answer ? (
        <div style={{ display: "grid", gap: 6 }}>
          <p className="quote">{probe.answer.text}</p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: "var(--t-xs)" }}>
            <span className="faint">
              {ANSWER_SOURCE[probe.answer.source]}, {fmtDate(probe.answer.answered_at)}
            </span>
            <ModerationTag m={probe.answer.moderation} />
            {!readOnly && (
              <button className="btn quiet small" onClick={() => setEditing(true)}>
                Edit answer
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="faint">Not answered yet.</p>
      )}
    </article>
  );
}

export function Probes() {
  const { ws, readOnly } = useWs();
  const [tab, setTab] = useState<"open" | "answered">("open");
  const state = useAsync(() => listProbes(ws), [ws]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Questions for the expert</h1>
          <p>
            Each one asks why a decision went the way it did. Answers become the reasons in the decision graph. Flagged
            answers stay out.
          </p>
        </div>
      </div>
      <Loadable state={state}>
        {(probes) => {
          const open = probes.filter((p) => p.status === "open");
          const answered = probes.filter((p) => p.status !== "open");
          const shown = tab === "open" ? open : answered;
          return (
            <>
              <div className="nav" role="tablist" style={{ marginBottom: 16 }}>
                {(["open", "answered"] as const).map((t) => (
                  <a
                    key={t}
                    role="tab"
                    href="#/probes"
                    aria-selected={tab === t}
                    aria-current={tab === t ? "page" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      setTab(t);
                    }}
                  >
                    {t === "open" ? `Waiting (${open.length})` : `Answered (${answered.length})`}
                  </a>
                ))}
              </div>
              {shown.length === 0 ? (
                <Empty title={tab === "open" ? "Nothing waiting" : "No answers yet"}>
                  <p className="muted">
                    {tab === "open"
                      ? "New questions arrive after each recording is analysed, and when the successor exam finds a gap."
                      : "Answer a waiting question to see it here."}
                  </p>
                </Empty>
              ) : (
                <div style={{ display: "grid", gap: 14, maxWidth: 820 }}>
                  {shown.map((p) => (
                    <ProbeCard key={p.id} probe={p} readOnly={readOnly} onSaved={state.reload} />
                  ))}
                </div>
              )}
            </>
          );
        }}
      </Loadable>
    </>
  );
}
