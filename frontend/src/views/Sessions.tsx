import { listSessions } from "../api/client";
import type { Session } from "../types/contract";
import { Empty, Loadable, fmtDate, fmtDuration, go, useAsync, useWs } from "../ui";

const STATUS: Record<Session["status"], string> = {
  created: "Not recorded",
  uploading: "Uploading",
  uploaded: "Uploaded",
  processing: "Analysing",
  processed: "Ready",
  failed: "Failed",
};

export function Sessions() {
  const { ws, readOnly } = useWs();
  const state = useAsync(() => listSessions(ws), [ws]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <p>Each recording of the expert working through the invoice queue in Sheets and Gmail.</p>
        </div>
        {!readOnly && (
          <div className="actions">
            <a className="btn record" href="#/record">
              Record a session
            </a>
          </div>
        )}
      </div>
      <Loadable state={state}>
        {(sessions) =>
          sessions.length === 0 ? (
            <Empty title="No sessions yet">
              <p className="muted">
                Record the expert clearing a few invoices. Apprentice watches for steps that depart from the SOP and asks
                about them.
              </p>
              {!readOnly && (
                <a className="btn record" href="#/record">
                  Record a session
                </a>
              )}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Recorded</th>
                    <th className="num">Length</th>
                    <th>Use</th>
                    <th>Live questions</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sessions]
                    .sort((a, b) => b.started_at.localeCompare(a.started_at))
                    .map((s) => (
                      <tr key={s.id} className="link" onClick={() => go(`/sessions/${s.id}`)}>
                        <td>
                          <a href={`#/sessions/${s.id}`} onClick={(e) => e.stopPropagation()}>
                            <strong>{s.id}</strong>
                          </a>
                        </td>
                        <td>{fmtDate(s.started_at)}</td>
                        <td className="num">{fmtDuration(s.duration_s)}</td>
                        <td>{s.kind === "heldout" ? <span className="tag">Held out for exam</span> : "Training"}</td>
                        <td>{s.live_enabled ? "On" : <span className="faint">Off</span>}</td>
                        <td className={s.status === "failed" ? "error" : undefined}>
                          {STATUS[s.status]}
                          {s.error ? `: ${s.error}` : ""}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>
    </>
  );
}
