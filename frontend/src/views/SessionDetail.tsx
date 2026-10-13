import { useEffect, useState } from "react";
import { getSession, processSession } from "../api/client";
import { ClipButton, Empty, Loadable, ModerationTag, Sop, DecisionChip, fmtDate, fmtDuration, tsPlus, useAsync, useWs } from "../ui";

const APP = { sheets: "Sheets", gmail: "Gmail", other: "Other" } as const;

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
            <div className="page-head">
              <div>
                <p className="muted" style={{ marginTop: 0 }}>
                  <a href="#/">Sessions</a> / {session.id}
                </p>
                <h1>Session {session.id}</h1>
                <p>
                  {fmtDate(session.started_at)}, {fmtDuration(session.duration_s)} long.{" "}
                  {session.kind === "heldout" ? "Held out for the successor exam." : "Training session."}
                </p>
              </div>
              {!readOnly && session.status === "uploaded" && (
                <div className="actions">
                  <button
                    className="btn"
                    onClick={() =>
                      processSession(session.id).then(state.reload, (e: Error) => setErr(e.message))
                    }
                  >
                    Analyse recording
                  </button>
                </div>
              )}
            </div>
            {err && <p className="error">{err}</p>}
            {session.status === "processing" && (
              <p className="sheet" style={{ marginBottom: 24 }}>
                Analysing the recording: splitting it into steps, then checking each decision against the SOP. This page
                updates on its own.
              </p>
            )}
            {session.status === "failed" && <p className="error">Analysis failed: {session.error ?? "unknown error"}</p>}

            <div className="grid-2">
              <section>
                <h2 style={{ marginBottom: 12 }}>What the expert did</h2>
                {segments.length === 0 ? (
                  <Empty title="No steps yet">
                    <p className="muted">Steps appear here once the recording has been analysed.</p>
                  </Empty>
                ) : (
                  <div className="table-wrap">
                    <table className="ledger">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Step</th>
                          <th>Invoice</th>
                          <th>Decision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {segments.map((s, i) => (
                          <tr key={s.id}>
                            <td>
                              <ClipButton clip={clipFor(s.start_ts, s.end_ts)}>{s.start_ts}</ClipButton>
                              <div className="faint">{APP[s.app]}</div>
                            </td>
                            <td>
                              <div>{s.action}</div>
                              {s.transcript_excerpt && <div className="quote" style={{ marginTop: 4 }}>“{s.transcript_excerpt}”</div>}
                              {s.quarantined && (
                                <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                                  <ModerationTag quarantined />
                                  <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
                                    {s.on_screen_text}
                                  </span>
                                </div>
                              )}
                            </td>
                            <td>
                              {s.invoice_id ?? <span className="faint">—</span>}
                              {s.vendor && <div className="faint">{s.vendor}</div>}
                            </td>
                            <td>{s.decision !== "none" && <DecisionChip d={s.decision} />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section>
                <h2 style={{ marginBottom: 12 }}>Departures from the SOP</h2>
                {deviations.length === 0 ? (
                  <Empty title="None found">
                    <p className="muted">Either every step followed the SOP, or analysis hasn't finished.</p>
                  </Empty>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {deviations.map((d) => (
                      <article key={d.id} className="sheet" style={{ opacity: d.dedup_of ? 0.6 : 1 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                          <Sop rule={d.sop_rule} />
                          <ClipButton clip={clipFor(d.timestamp, tsPlus(d.timestamp, 20))}>{d.timestamp}</ClipButton>
                          {d.invoice_id && <span className="muted">{d.invoice_id}</span>}
                          <span className={`tag${d.source === "live" ? " live" : ""}`}>
                            {d.source === "live" ? "Caught live" : "Found after"}
                          </span>
                        </div>
                        <p>{d.description}</p>
                        <p className="quote" style={{ marginTop: 6 }}>
                          <span className="why">{d.question}</span>
                        </p>
                        <p className="faint" style={{ fontSize: "var(--t-xs)", marginTop: 6 }}>
                          {Math.round(d.confidence * 100)}% confident
                          {d.dedup_of ? `. Same moment as ${d.dedup_of}, asked once.` : ""}
                        </p>
                      </article>
                    ))}
                  </div>
                )}

                {diff && diff.changes.length > 0 && (
                  <>
                    <h3 style={{ margin: "24px 0 8px" }}>Sheet changes during the session</h3>
                    <table className="ledger">
                      <thead>
                        <tr>
                          <th>Invoice</th>
                          <th>Column</th>
                          <th>Before</th>
                          <th>After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diff.changes.map((c) => (
                          <tr key={`${c.invoice_id}-${c.column}`}>
                            <td>{c.invoice_id}</td>
                            <td>{c.column}</td>
                            <td className="faint">{c.before ?? "—"}</td>
                            <td>{c.after ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </section>
            </div>
          </>
        );
      }}
    </Loadable>
  );
}
