import cytoscape from "cytoscape";
import { useEffect, useRef, useState } from "react";
import { buildGraph, getGraph, listProbes, type ProbeWithAnswer } from "../api/client";
import type { DecisionGraph, DecisionNode } from "../types/contract";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Separator } from "../components/ui/separator";
import { ClipButton, Empty, Loadable, PageHeader, Sop, fmtDate, useAsync, useWs } from "../ui";

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

// Cytoscape can't parse oklch(): paint the token onto a 1px canvas and read back sRGB.
let probe: CanvasRenderingContext2D | null | undefined;
function css(name: string) {
  if (probe === undefined) probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!probe || !v) return "#888888";
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = v;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

// Re-read colours when the theme class on <html> flips.
function useThemeKey() {
  const [key, setKey] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setKey((k) => k + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return key;
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
  const themeKey = useThemeKey();

  useEffect(() => {
    if (!box.current) return;
    const ink = css("--foreground");
    const sheet = css("--card");
    const reject = css("--destructive");
    const soft = css("--muted-foreground");
    const rule = css("--border");
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
            "font-family": "Geist Variable, system-ui, sans-serif",
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
        { selector: "node[sop = 1]", style: { shape: "rectangle", "border-color": rule, color: soft, "background-color": css("--muted") } },
        {
          selector: 'node[kind = "exception"]',
          style: { "border-width": 3, "border-color": reject, "font-weight": "bold", width: 170, height: 60 },
        },
        { selector: "node:selected", style: { "background-color": css("--accent"), "border-color": css("--primary"), "border-width": 3 } },
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
  }, [graph, onSelect, themeKey]);

  return (
    <div
      ref={box}
      role="img"
      aria-label={`Decision graph with ${graph.nodes.length} nodes. Node details are listed beside it.`}
      className="h-[min(70vh,640px)] rounded-xl bg-card ring-1 ring-foreground/10"
    />
  );
}

function NodePanel({ node, probes }: { node: DecisionNode; probes: ProbeWithAnswer[] }) {
  const linked = probes.filter((p) => node.probe_ids.includes(p.id));
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">{KIND[node.kind]}</span>
          {node.kind === "exception" && <Sop rule={node.sop_rule} />}
        </div>
        <CardAction className="text-xs text-muted-foreground">{Math.round(node.confidence * 100)}% confident</CardAction>
        <CardTitle className="mt-1 text-lg">{node.label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p>{node.detail}</p>
        {node.evidence.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="eyebrow">Seen in</h3>
            <div className="flex flex-wrap gap-x-4">
              {node.evidence.map((c) => (
                <ClipButton key={`${c.session_id}-${c.start_ts}`} clip={c}>
                  {c.session_id} at {c.start_ts}
                </ClipButton>
              ))}
            </div>
          </div>
        )}
        {linked.map((p) => (
          <div key={p.id} className="flex flex-col gap-2">
            <Separator />
            <p className="text-sm text-muted-foreground">Asked: {p.question}</p>
            {p.answer ? <p className="quote">{p.answer.text}</p> : <p className="text-muted-foreground">Waiting for an answer.</p>}
          </div>
        ))}
      </CardContent>
    </Card>
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
      <PageHeader
        title="Decision graph"
        description="What the expert notices, what they're protecting, and where they knowingly step outside the SOP. Every node links to the moment it was seen."
        actions={!readOnly && <Button onClick={() => void rebuild()}>Rebuild graph</Button>}
      />
      {msg && (
        <Alert className="mb-4">
          <AlertDescription>{msg}</AlertDescription>
        </Alert>
      )}
      <Loadable state={state}>
        {([graph, probes]) => {
          if (!graph || graph.nodes.length === 0)
            return (
              <Empty
                title="No graph yet"
                action={
                  <Button variant="outline" asChild>
                    <a href="#/probes">Go to questions</a>
                  </Button>
                }
              >
                The graph is built from answered questions. Answer a few, then rebuild.
              </Empty>
            );
          const node = graph.nodes.find((n) => n.id === selected);
          const exceptions = graph.nodes.filter((n) => n.kind === "exception");
          return (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Version {graph.version}, built {fmtDate(graph.built_at)}. {exceptions.length} exceptions, {graph.nodes.length} nodes.
              </p>
              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <Canvas graph={graph} onSelect={setSelected} />
                {node ? (
                  <NodePanel node={node} probes={probes} />
                ) : (
                  <Card>
                    <CardHeader>
                      <CardDescription className="eyebrow">Exceptions to the SOP</CardDescription>
                      <CardDescription>Select a node to see the expert's reason and the clip it came from.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ul className="flex flex-col gap-1">
                        {exceptions.map((n) => (
                          <li key={n.id}>
                            <Button
                              variant="ghost"
                              className="h-auto w-full justify-start gap-2 py-2 text-left whitespace-normal"
                              onClick={() => setSelected(n.id)}
                            >
                              <span className="size-2 shrink-0 rounded-full bg-destructive" aria-hidden />
                              <span className="flex-1">{n.label}</span>
                              <Sop rule={n.sop_rule} />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          );
        }}
      </Loadable>
    </>
  );
}
