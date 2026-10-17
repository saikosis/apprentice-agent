import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCENARIOS } from "../api/client";
import { rowsToRecords } from "../recorder/sheets";
import { ClipProvider, WsContext } from "../ui";
import { Discovery } from "./Discovery";
import { Exam } from "./Exam";
import { Overview } from "./Overview";
import { GraphView } from "./Graph";
import { Probes } from "./Probes";
import { Record } from "./Record";
import { SessionDetail } from "./SessionDetail";
import { Sessions } from "./Sessions";

// jsdom has no canvas/layout: stub cytoscape and ResizeObserver.
vi.mock("cytoscape", () => ({ default: () => ({ on: () => undefined, destroy: () => undefined }) }));
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Demo workspace reads the bundle; with no backend it falls back to /fixtures.
const demo = (ui: ReactNode) =>
  render(
    <WsContext.Provider value={{ ws: "demo", readOnly: true }}>
      <ClipProvider>{ui}</ClipProvider>
    </WsContext.Provider>,
  );

afterEach(cleanup);

describe("views render against fixtures", () => {
  it("Overview", async () => {
    demo(<Overview />);
    expect(await screen.findByText("Most repeated departures")).toBeTruthy();
    expect(screen.getByText("Instructions hidden in an email")).toBeTruthy();
  });

  it("Sessions", async () => {
    demo(<Sessions />);
    expect(await screen.findByText("s-01")).toBeTruthy();
    expect(screen.getAllByText("Held out for exam")).toHaveLength(2);
  });

  it("SessionDetail shows the quarantined injection email", async () => {
    demo(<SessionDetail id="s-03" />);
    expect(await screen.findByText(/kept out of graph/)).toBeTruthy();
  });

  it("Probes", async () => {
    demo(<Probes />);
    expect(await screen.findByText(/What would have made you stop/)).toBeTruthy();
  });

  it("Discovery", async () => {
    demo(<Discovery />);
    expect(await screen.findByText("Consignment vendor bypasses PO match")).toBeTruthy();
  });

  it("Graph lists exceptions", async () => {
    demo(<GraphView />);
    expect(await screen.findByText("Renumbered duplicate: reject")).toBeTruthy();
  });

  it("Exam report", async () => {
    demo(<Exam />);
    expect(await screen.findByText("90%")).toBeTruthy();
    expect(screen.getByText("40%")).toBeTruthy();
  });

  it("Record is disabled in demo", () => {
    demo(<Record />);
    expect(screen.getByText("Recording is off in the demo")).toBeTruthy();
  });
});

describe("rowsToRecords", () => {
  it("keys any tab's rows by normalised header, keeps cell text, skips blank rows", () => {
    const rows = rowsToRecords([
      ["Response ID", "Name", "Preferred shift", "Notes"],
      ["R-307", "Riya Sen", "SH-3"],
      ["", "", "", ""],
    ]);
    expect(rows).toEqual([{ response_id: "R-307", name: "Riya Sen", preferred_shift: "SH-3", notes: "" }]);
  });
});

describe("scenarios", () => {
  it("come from the backend's domain packs, invoices first", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(["ap", "essays", "volunteers"]);
    expect(SCENARIOS[2].decision_labels.approve).toBe("Accept");
  });
});

describe("graph layout", () => {
  it("puts cue → exception → goal in left-to-right columns, one band per exception", async () => {
    const { layout } = await import("./Graph");
    const graph = (await import("../../../fixtures/graph.json")).default as import("../types/contract").DecisionGraph;
    const pos = layout(graph);
    expect(pos.size).toBe(graph.nodes.length);
    expect(pos.get("n-c1")!.x).toBeLessThan(pos.get("n-x1")!.x);
    expect(pos.get("n-x1")!.x).toBeLessThan(pos.get("n-g1")!.x);
    expect(pos.get("n-x2")!.y).toBeGreaterThan(pos.get("n-x1")!.y);
  });
});

describe("exam", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("compares both agents' reasoning on a case (demo)", async () => {
    demo(<Exam />);
    const buttons = await screen.findAllByRole("button", { name: "Compare reasoning" });
    fireEvent.click(buttons[6]); // c-07, the renumbered duplicate
    expect(await screen.findByText(/same 25 LED panels as INV-1050/)).toBeTruthy();
    expect(screen.getByText(/so §3.4 passes/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide reasoning" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("restores labelled cases after a reload (live)", async () => {
    const cases = (await import("../../../fixtures/exam_cases.json")).default;
    const reply = (status: number, body: unknown) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", (url: string) =>
      url.startsWith("/api/exam/cases")
        ? reply(200, cases.slice(0, 1))
        : url.startsWith("/api/sessions")
          ? reply(200, [])
          : reply(404, { error: { code: "not_found", message: "No exam has run yet." } }),
    );
    render(
      <WsContext.Provider value={{ ws: "live", readOnly: false }}>
        <ClipProvider>
          <Exam />
        </ClipProvider>
      </WsContext.Provider>,
    );
    expect(await screen.findByDisplayValue(/reconcile against the statement tab/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Saved" })).toBeTruthy();
  });
});
