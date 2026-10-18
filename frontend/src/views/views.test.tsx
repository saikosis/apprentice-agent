import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCENARIOS, currentScenario, subscribeScenario, switchScenario, viewingSandbox } from "../api/client";
import { rowsToRecords } from "../recorder/sheets";
import { ClipProvider, WsContext } from "../ui";
import { Admin } from "./Admin";
import { Discovery } from "./Discovery";
import { JoinSandbox } from "./JoinSandbox";
import { Exam } from "./Exam";
import { Overview } from "./Overview";
import { SandboxHome } from "./SandboxHome";
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

  it("SessionDetail shows the session summary and the steps per item", async () => {
    demo(<SessionDetail id="s-01" />);
    expect(await screen.findByText(/Worked through three invoices/)).toBeTruthy();
    expect(screen.getByText("Opens the Consignment Statement tab")).toBeTruthy();
  });

  it("Probes", async () => {
    demo(<Probes />);
    expect(await screen.findByText(/What would have made you stop/)).toBeTruthy();
  });

  it("Discovery", async () => {
    demo(<Discovery />);
    expect(await screen.findByText("Consignment vendor bypasses PO match")).toBeTruthy();
  });

  it("Discovery shows the expert's observed workflow, marked against the SOP", async () => {
    demo(<Discovery />);
    expect(await screen.findByText(/Compare vendor, amount and items/)).toBeTruthy();
    expect(screen.getAllByText("Not in the SOP").length).toBeGreaterThan(0);
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

  it("Record in a judge sandbox says recordings stop at 5:00", () => {
    render(
      <WsContext.Provider value={{ ws: "live", readOnly: false, sandbox: true }}>
        <Record />
      </WsContext.Provider>,
    );
    expect(screen.getByText(/stops automatically at 5:00/)).toBeTruthy();
    expect(screen.getByText(/visible to you and the Apprentice organisers, and are deleted after 14 days/)).toBeTruthy();
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

  it("switch in place and tell the app, so sign-in (memory only) survives", () => {
    const seen: string[] = [];
    const stop = subscribeScenario(() => seen.push(currentScenario().id));
    const before = window.location.href;
    switchScenario("volunteers");
    switchScenario("ap");
    stop();
    expect(seen).toEqual(["volunteers", "ap"]);
    expect(window.location.href).toBe(before);
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

describe("judge code", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("redeems the code with the server and reports a wrong one", async () => {
    const reply = (status: number, body: unknown) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      const { code } = JSON.parse(String(init.body)) as { code: string };
      sent.push(code);
      return code === "river-42"
        ? reply(200, { uid: "u", email: "j@example.com", created_at: "2026-10-17T10:00:00Z" })
        : reply(403, { error: { code: "forbidden", message: "That judge code isn't right." } });
    });
    const joined = vi.fn();
    render(<JoinSandbox email="j@example.com" onJoined={joined} />);
    const input = screen.getByLabelText("Judge code");
    fireEvent.change(input, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Open my sandbox" }));
    expect(await screen.findByText("That judge code isn't right.")).toBeTruthy();
    fireEvent.change(input, { target: { value: "river-42" } });
    fireEvent.click(screen.getByRole("button", { name: "Open my sandbox" }));
    await vi.waitFor(() => expect(joined).toHaveBeenCalled());
    expect(sent).toEqual(["wrong", "river-42"]);
  });
});

describe("admin", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists sandboxes and opens one read-only; reads then target that sandbox", async () => {
    const urls: string[] = [];
    const row = {
      uid: "u-j1",
      email: "judge1@example.com",
      created_at: "2026-10-17T10:00:00Z",
      usage: { recordings: 2, graph_builds: 1, exam_runs: 0, case_generations: 0 },
      limit_each: 5,
      global_today: 3,
      global_limit: 100,
    };
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      return Promise.resolve(new Response(JSON.stringify(url.startsWith("/api/admin") ? [row] : []), { status: 200 }));
    });
    render(<Admin />);
    expect(await screen.findByText("judge1@example.com")).toBeTruthy();
    expect(screen.getByText("2 of 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View judge1@example.com's sandbox" }));
    expect(viewingSandbox()).toEqual({ uid: "u-j1", email: "judge1@example.com" });
    const { listVariants } = await import("../api/client");
    await listVariants("live");
    expect(urls.at(-1)).toBe("/api/variants?ws=sandbox&uid=u-j1");
    const { viewSandbox } = await import("../api/client");
    viewSandbox(null);
  });
});

describe("judge sandbox home", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows usage, the quick plan and the downloads for this workflow", async () => {
    const info = {
      uid: "u-j1",
      email: "judge1@example.com",
      created_at: "2026-10-17T10:00:00Z",
      usage: { recordings: 1, graph_builds: 0, exam_runs: 0, case_generations: 0 },
      limit_each: 5,
      global_today: 7,
      global_limit: 100,
    };
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify(info), { status: 200 })));
    render(
      <WsContext.Provider value={{ ws: "live", readOnly: false, sandbox: true }}>
        <SandboxHome />
      </WsContext.Provider>,
    );
    expect(await screen.findByText("1 of 5")).toBeTruthy();
    expect(screen.getByText(/INV-2101, INV-2102/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /ap\.xlsx/ });
    expect(link.getAttribute("href")).toBe("/api/packs/ap/ap.xlsx");
    expect(screen.getByRole("button", { name: "Reset to sample" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete my sandbox" })).toBeTruthy();
  });
});
