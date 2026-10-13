import cytoscape from "cytoscape";
import { useEffect, useRef, useState } from "react";
import { buildGraph, getGraph, listProbes, type ProbeWithAnswer } from "../api/client";
import type { DecisionGraph, DecisionNode } from "../types/contract";
import { ClipButton, Empty, Loadable, Sop, fmtDate, useAsync, useWs } from "../ui";

export const KIND: Record<DecisionNode["kind"], string> = {
  cue: "Cue",
  goal: "Goal",
  option: "Option weighed",
  rule: "Rule",
  exception: "Exception to the SOP",
};

const RELATION = {
  triggers: "triggers",
  serves: "serves",
  chooses: "weighs",
  overrides: "overrides",
  requires: "requires",
} as const;

function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#333";
}

// Columns read left to right: what's noticed → the exception → what it serves / requires / overrides → options weighed.
const COLUMN: Record<DecisionNode["kind"], number> = { cue: 0, exception: 1, goal: 2, rule: 2, option: 3 };

// One horizontal band per exception, holding everything reachable from it without crossing another exception.
export function layout(graph: DecisionGraph): Map<string, { x: number; y: number }> {
  const kind = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
  }
  const placed = new Set<string>();
  const bands: string[][] = [];
  for (const root of graph.nodes.filter((n) => n.kind === "exception")) {
    const band: string[] = [];
    const queue = [root.id];
    while (queue.length) {
      const id = queue.shift()!;
      if (placed.has(id)) continue;
      placed.add(id);
      band.push(id);
      for (const nb of adj.get(id) ?? []) if (!placed.has(nb) && kind.get(nb) !== "exception") queue.push(nb);
    }
    bands.push(band);
  }
  const rest = graph.nodes.filter((n) => !placed.has(n.id)).map((n) => n.id);
  if (rest.length) bands.push(rest);

  const pos = new Map<string, { x: number; y: number }>();
  let top = 0;
  for (const band of bands) {
    const rows = [0, 0, 0, 0];
    for (const id of band) {
      const col = COLUMN[kind.get(id)!];
      pos.set(id, { x: col * 230, y: top + rows[col]++ * 80 });
    }
    // centre short columns within the band
    const height = Math.max(...rows);
    for (const id of band) {
      const col = COLUMN[kind.get(id)!];
      pos.get(id)!.y += ((height - rows[col]) * 80) / 2;
    }
    top += height * 80 + 50;
  }
  return pos;
}

function Canvas({ graph, onSelect }: { graph: DecisionGraph; onSelect: (id: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!box.current) return;
    const ink = css("--ink");
    const sheet = css("--sheet");
    const reject = css("--reject");
    const soft = css("--ink-soft");
    const rule = css("--rule-strong");
    const pos = layout(graph);
    const cy = cytoscape({
      container: box.current,
      elements: [
        ...graph.nodes.map((n) => ({
          position: pos.get(n.id),
          data: { id: n.id, label: n.label, kind: n.kind, sop: n.kind === "rule" && n.sop_rule && !n.probe_ids.length ? 1 : 0 },
        })),
        ...graph.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, rel: RELATION[e.relation] } })),
      ],
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "font-family": "Roboto, system-ui, sans-serif",
            "font-size": 11,
            color: ink,
            "text-wrap": "wrap",
            "text-max-width": "130px",
            "text-valign": "center",
            "text-halign": "center",
            width: 150,
            height: 52,
            shape: "round-rectangle",
            "background-color": sheet,
            "border-width": 1.5,
            "border-color": ink,
          },
        },
        { selector: 'node[kind = "goal"]', style: { shape: "ellipse" } },
        { selector: 'node[kind = "option"]', style: { "border-style": "dashed", color: soft, "border-color": soft } },
        { selector: 'node[kind = "cue"]', style: { shape: "tag" } },
        { selector: "node[sop = 1]", style: { shape: "rectangle", "border-color": rule, color: soft, "background-color": css("--paper") } },
        {
          selector: 'node[kind = "exception"]',
          style: { "border-width": 3, "border-color": reject, "font-weight": "bold", width: 170, height: 60 },
        },
        { selector: "node:selected", style: { "background-color": css("--highlight"), "border-width": 3 } },
        {
          selector: "edge",
          style: {
            width: 1.2,
            "line-color": soft,
            "target-arrow-color": soft,
            "target-arrow-shape": "triangle",
            "curve-style": "taxi",
            "taxi-direction": "horizontal",
            label: "data(rel)",
            "font-size": 9,
            color: soft,
            "text-background-color": sheet,
            "text-background-opacity": 1,
            "text-background-padding": "2px",
          },
        },
        {
          selector: 'edge[rel = "overrides"]',
          style: { "line-color": reject, "target-arrow-color": reject, "line-style": "dashed", color: reject },
        },
      ],
      layout: { name: "preset", fit: true, padding: 24 },
      wheelSensitivity: 0.3,
    });
    cy.on("tap", "node", (e) => onSelect(e.target.id() as string));
    cy.on("tap", (e) => {
      if (e.target === cy) onSelect(null);
    });
    return () => cy.destroy();
  }, [graph, onSelect]);

  return (
    <div
      ref={box}
      role="img"
      aria-label={`Decision graph with ${graph.nodes.length} nodes. Node details are listed beside it.`}
      style={{ height: "min(70vh, 640px)", background: "var(--sheet)", border: "1px solid var(--rule-strong)", borderRadius: 12 }}
    />
  );
}

function NodePanel({ node, probes }: { node: DecisionNode; probes: ProbeWithAnswer[] }) {
  const linked = probes.filter((p) => node.probe_ids.includes(p.id));
  return (
    <aside className="sheet" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span className="muted" style={{ fontSize: "var(--t-sm)", fontWeight: 500 }}>
          {KIND[node.kind]}
        </span>
        {node.kind === "exception" && <Sop rule={node.sop_rule} />}
        <span className="faint" style={{ marginLeft: "auto", fontSize: "var(--t-xs)" }}>
          {Math.round(node.confidence * 100)}% confident
        </span>
      </div>
      <h2 style={{ fontSize: "var(--t-lg)", fontWeight: 500 }}>{node.label}</h2>
      <p>{node.detail}</p>
      {node.evidence.length > 0 && (
        <div>
          <h3 style={{ fontSize: "var(--t-sm)", marginBottom: 6 }} className="muted">
            Seen in
          </h3>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {node.evidence.map((c) => (
              <ClipButton key={`${c.session_id}-${c.start_ts}`} clip={c}>
                {c.session_id} at {c.start_ts}
              </ClipButton>
            ))}
          </div>
        </div>
      )}
      {linked.map((p) => (
        <div key={p.id} style={{ borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
          <p className="muted" style={{ fontSize: "var(--t-sm)" }}>
            Asked: {p.question}
          </p>
          {p.answer ? <p className="quote">{p.answer.text}</p> : <p className="faint">Waiting for an answer.</p>}
        </div>
      ))}
    </aside>
  );
}

export function GraphView() {
  const { ws, readOnly } = useWs();
  const state = useAsync(() => Promise.all([getGraph(ws), listProbes(ws)]), [ws]);
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const rebuild = () =>
    buildGraph().then(
      () => {
        setMsg("Rebuilding from the latest answers. This takes about a minute.");
        setTimeout(state.reload, 30000);
      },
      (e: Error) => setMsg(e.message),
    );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Decision graph</h1>
          <p>
            What the expert notices, what they're protecting, and where they knowingly step outside the SOP. Every node
            links to the moment it was seen.
          </p>
        </div>
        {!readOnly && (
          <div className="actions">
            <button className="btn" onClick={() => void rebuild()}>
              Rebuild graph
            </button>
          </div>
        )}
      </div>
      {msg && <p className="muted" style={{ marginBottom: 16 }}>{msg}</p>}
      <Loadable state={state}>
        {([graph, probes]) => {
          if (!graph || graph.nodes.length === 0)
            return (
              <Empty title="No graph yet">
                <p className="muted">The graph is built from answered questions. Answer a few, then rebuild.</p>
                <a className="btn quiet" href="#/probes">
                  Go to questions
                </a>
              </Empty>
            );
          const node = graph.nodes.find((n) => n.id === selected);
          const exceptions = graph.nodes.filter((n) => n.kind === "exception");
          return (
            <>
              <p className="faint" style={{ fontSize: "var(--t-sm)", marginBottom: 10 }}>
                Version {graph.version}, built {fmtDate(graph.built_at)}. {exceptions.length} exceptions,{" "}
                {graph.nodes.length} nodes.
              </p>
              <div className="grid-2">
                <Canvas graph={graph} onSelect={setSelected} />
                {node ? (
                  <NodePanel node={node} probes={probes} />
                ) : (
                  <aside className="sheet" style={{ display: "grid", gap: 12 }}>
                    <p className="muted">Select a node to see the expert's reason and the clip it came from.</p>
                    <h3 style={{ fontSize: "var(--t-md)" }}>Exceptions to the SOP</h3>
                    <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                      {exceptions.map((n) => (
                        <li key={n.id}>
                          <button className="linkish" onClick={() => setSelected(n.id)}>
                            {n.label}
                          </button>{" "}
                          <Sop rule={n.sop_rule} />
                        </li>
                      ))}
                    </ul>
                  </aside>
                )}
              </div>
            </>
          );
        }}
      </Loadable>
    </>
  );
}
