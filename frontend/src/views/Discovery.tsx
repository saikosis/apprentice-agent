import { useState } from "react";
import { discoverVariants, listSessions, listVariants } from "../api/client";
import { ClipButton, Empty, Loadable, Sop, useAsync, useWs } from "../ui";

export function Discovery() {
  const { ws, readOnly } = useWs();
  const state = useAsync(() => Promise.all([listVariants(ws), listSessions(ws)]), [ws]);
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
      <div className="page-head">
        <div>
          <h1>Patterns across sessions</h1>
          <p>Departures from the SOP that the expert repeats. A repeated departure usually means an unwritten rule.</p>
        </div>
        {!readOnly && (
          <div className="actions">
            <button className="btn" onClick={() => void discover()}>
              Find patterns
            </button>
          </div>
        )}
      </div>
      {msg && <p className="muted" style={{ marginBottom: 16 }}>{msg}</p>}
      <Loadable state={state}>
        {([variants, sessions]) => {
          const processed = sessions.filter((s) => s.status === "processed").length;
          if (variants.length === 0)
            return (
              <Empty title="No patterns yet">
                <p className="muted">
                  {processed < 3
                    ? `Patterns need at least 3 analysed sessions. You have ${processed}.`
                    : "Run Find patterns to compare all analysed sessions."}
                </p>
              </Empty>
            );
          return (
            <div style={{ display: "grid", gap: 16, maxWidth: 900 }}>
              {[...variants]
                .sort((a, b) => b.frequency - a.frequency)
                .map((v) => (
                  <article key={v.id} className="sheet" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 20px" }}>
                    <div style={{ gridRow: "span 3", textAlign: "center", minWidth: 56 }}>
                      <div style={{ fontSize: "var(--t-xxl)", fontWeight: 400, lineHeight: 1 }}>{v.frequency}×</div>
                      <div className="faint" style={{ fontSize: "var(--t-xs)" }}>
                        in {v.session_ids.length} sessions
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                      <h2 style={{ fontSize: "var(--t-lg)", fontWeight: 500 }}>{v.name}</h2>
                      {v.sop_rules.map((r) => (
                        <Sop key={r} rule={r} />
                      ))}
                    </div>
                    <p>{v.description}</p>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: "var(--t-sm)" }}>
                      {v.exemplar_clips.map((c) => (
                        <ClipButton key={`${c.session_id}-${c.start_ts}`} clip={c}>
                          {c.session_id} at {c.start_ts}
                        </ClipButton>
                      ))}
                      <span className="faint">
                        Sessions:{" "}
                        {v.session_ids.map((id, i) => (
                          <span key={id}>
                            {i > 0 && ", "}
                            <a href={`#/sessions/${id}`}>{id}</a>
                          </span>
                        ))}
                      </span>
                    </div>
                  </article>
                ))}
            </div>
          );
        }}
      </Loadable>
    </>
  );
}
