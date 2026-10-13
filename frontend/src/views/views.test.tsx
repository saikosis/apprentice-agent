import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rowsToInvoices } from "../recorder/sheets";
import { ClipProvider, WsContext } from "../ui";
import { Discovery } from "./Discovery";
import { Exam } from "./Exam";
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

describe("rowsToInvoices", () => {
  it("maps header names, parses rupees, nulls empty optionals, skips blank rows", () => {
    const rows = rowsToInvoices([
      ["Invoice ID", "Vendor ID", "Amount INR", "PO Number", "Status"],
      ["INV-1041", "V-007", "₹42,300", "", "Pending"],
      ["", "", "", "", ""],
    ]);
    expect(rows).toEqual([{ invoice_id: "INV-1041", vendor_id: "V-007", amount_inr: 42300, po_number: null, status: "Pending" }]);
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
