import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tour, useTour, type TourStep } from "./tour";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// A real Storage: Node's own localStorage global shadows jsdom's here.
const saved = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => saved.get(k) ?? null,
  setItem: (k: string, v: string) => void saved.set(k, v),
});

afterEach(() => {
  cleanup();
  saved.clear();
});

const STEPS: TourStep[] = [
  { title: "Welcome", body: "Hello." },
  { target: "a", title: "Step A", body: "A." },
  { target: "missing", optional: true, title: "Step B", body: "Not for this role." },
  { target: "c", title: "Step C", body: "C." },
];

describe("Tour", () => {
  it("walks the steps whose targets exist, back and forth, and ends", () => {
    const onClose = vi.fn();
    render(
      <>
        <button data-tour="a">a</button>
        <button data-tour="c">c</button>
        <Tour steps={STEPS} open onClose={onClose} />
      </>,
    );
    expect(screen.getByText("Welcome")).toBeTruthy();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step A")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step C")).toBeTruthy(); // B's target isn't here: skipped
    expect(screen.getByText("3 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step A")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "End tour" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps a step whose target is folded away (phone sidebar), as a centred card", () => {
    render(<Tour steps={[{ target: "gone", title: "Sessions", body: "x" }]} open onClose={() => {}} />);
    expect(screen.getByText("Sessions")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish" })).toBe(document.activeElement);
  });

  it("Finish on the last step closes it", () => {
    const onClose = vi.fn();
    render(<Tour steps={[{ title: "Only", body: "x" }]} open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(onClose).toHaveBeenCalled();
  });
});

function Harness({ account }: { account: string | null }) {
  const tour = useTour(account);
  return (
    <>
      <span>{tour.open ? "open" : "closed"}</span>
      <button onClick={tour.end}>end</button>
      <button onClick={tour.start}>start</button>
    </>
  );
}

describe("useTour", () => {
  it("starts by itself once per account, and on demand", () => {
    const first = render(<Harness account="u1" />);
    expect(screen.getByText("open")).toBeTruthy();
    act(() => fireEvent.click(screen.getByText("end")));
    expect(screen.getByText("closed")).toBeTruthy();
    first.unmount();

    const again = render(<Harness account="u1" />);
    expect(screen.getByText("closed")).toBeTruthy(); // seen already
    act(() => fireEvent.click(screen.getByText("start")));
    expect(screen.getByText("open")).toBeTruthy();
    again.unmount();

    render(<Harness account="u2" />);
    expect(screen.getByText("open")).toBeTruthy(); // a different account's first login
  });

  it("never starts by itself without an account", () => {
    render(<Harness account={null} />);
    expect(screen.getByText("closed")).toBeTruthy();
  });
});
