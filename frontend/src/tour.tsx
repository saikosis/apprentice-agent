// Guided tour: coach marks that point at the sidebar and header, a spotlight around the target, and a pulsing
// beacon. Starts by itself on an account's first sign-in; the header's tour button restarts it. The page stays
// usable underneath (the dimming ignores clicks). "Seen" lives in localStorage: a per-viewer convenience only.
import { Popover } from "radix-ui";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Button } from "./components/ui/button";

// `optional`: the target exists only for some roles or pages (drop the step when absent). Other steps whose
// target is missing, such as the folded-away sidebar on a phone, show as a centred card.
export type TourStep = { target?: string; optional?: boolean; title: string; body: string };

export const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to Apprentice",
    body: "Apprentice watches an expert work, asks why they made each call, and checks that the reasons carry over to whoever comes next. This tour takes about a minute.",
  },
  {
    target: "workflow",
    title: "Pick a workflow",
    body: "Invoices, essay marking or volunteer sign-ups. Each has its own SOP, sessions and graph, and every page shows the one picked here.",
  },
  {
    target: "nav-sandbox",
    optional: true,
    title: "Your sandbox",
    body: "The files to practise with, your limits, and buttons to reset to the sample run or start empty.",
  },
  {
    target: "record",
    optional: true,
    title: "Record a session",
    body: "Share the tab you work in and talk as you go. When you step outside the SOP, Apprentice asks why, out loud.",
  },
  {
    target: "nav-sessions",
    title: "Sessions",
    body: "Every recording with its summary, the steps per item, and the clips where you departed from the SOP.",
  },
  {
    target: "nav-probes",
    title: "Questions",
    body: "Apprentice's why questions. Answer in your own words: your reasons become the rules in the graph.",
  },
  {
    target: "nav-discovery",
    title: "Patterns",
    body: "Departures you made more than once, and the workflow you actually followed, marked against the SOP.",
  },
  {
    target: "nav-graph",
    title: "Decision graph",
    body: "The SOP plus your exceptions and reasons, each linked to the video moment and SOP section it came from.",
  },
  {
    target: "nav-exam",
    title: "Successor exam",
    body: "An AI successor with only the SOP against one that also has your graph, on cases you label. The gap is what Apprentice learned.",
  },
  {
    target: "tour",
    title: "Come back any time",
    body: "This button replays the tour. Pulsing dots in the sidebar point at what to try next.",
  },
];

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null; // storage blocked: behaves like a first visit
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // storage blocked: remembered for this page only
    }
  },
};

const seenKey = (account: string) => `apprentice:tour-seen:${account}`;

/** Opens by itself only the first time an account signs in: it counts as seen the moment it opens, so leaving
 * mid-tour (reload, sign out) doesn't bring it back. `run` changes on every start, so keying the Tour on it
 * restarts from step 1 even mid-tour. */
export function useTour(account: string | null) {
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (!account || store.get(seenKey(account))) return;
    store.set(seenKey(account), "1");
    setOpen(true);
  }, [account]);
  const start = useCallback(() => {
    setOpen(true);
    setRun((n) => n + 1);
  }, []);
  const end = useCallback(() => setOpen(false), []);
  return { open, run, start, end };
}

const find = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${target}"]`);

/** Follows the target's box every frame (sidebar collapse, scrolling); null when it isn't on screen. */
function useBox(el: HTMLElement | null) {
  const [box, setBox] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!el) {
      setBox(null);
      return;
    }
    el.scrollIntoView?.({ block: "nearest" });
    let frame = 0;
    const tick = () => {
      const r = el.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
      setBox((old) =>
        !visible ? null : old && old.x === r.x && old.y === r.y && old.width === r.width && old.height === r.height ? old : r,
      );
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [el]);
  return box;
}

export function Tour({ steps, open, onClose }: { steps: TourStep[]; open: boolean; onClose: () => void }) {
  // Optional steps whose target isn't on this page drop out. Checked after commit, so targets mounting in
  // the same render (the first sign-in) count.
  const [present, setPresent] = useState<TourStep[]>([]);
  const [index, setIndex] = useState(0);
  useLayoutEffect(() => {
    setPresent(open ? steps.filter((s) => !s.optional || (s.target && find(s.target))) : []);
    setIndex(0);
  }, [steps, open]);
  const step = present[Math.min(index, present.length - 1)];
  const el = step?.target ? find(step.target) : null;
  const box = useBox(el);
  const showing = open && Boolean(step);
  const anchored = Boolean(box);

  // Escape ends it from anywhere; focus goes back where it was afterwards.
  useEffect(() => {
    if (!showing) return;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("keydown", esc);
      back?.focus();
    };
  }, [showing, onClose]);
  // Each step puts focus on its Next button, so Enter moves on.
  useEffect(() => {
    if (showing) document.querySelector<HTMLElement>("[data-tour-next]")?.focus();
  }, [showing, index, anchored]);
  if (!showing) return null;

  const total = present.length;
  const card = (
    <TourCard
      step={step}
      at={index + 1}
      total={total}
      onBack={index > 0 ? () => setIndex(index - 1) : undefined}
      onNext={index + 1 >= total ? onClose : () => setIndex(index + 1)}
      onClose={onClose}
    />
  );
  const pad = 6;
  return (
    <>
      {box ? (
        <>
          <div
            aria-hidden
            className="tour-spot pointer-events-none fixed z-[60] rounded-xl outline-2 outline-primary transition-all duration-200"
            style={{ top: box.top - pad, left: box.left - pad, width: box.width + 2 * pad, height: box.height + 2 * pad }}
          />
          <span
            aria-hidden
            className="beacon pointer-events-none fixed z-[61]"
            style={{ top: box.top - pad - 5, left: box.right + pad - 7 }}
          />
          <Popover.Root open>
            <Popover.Anchor virtualRef={{ current: el! }} />
            <Popover.Portal>
              <Popover.Content
                key={step.title}
                side={box.left < window.innerWidth / 3 ? "right" : "bottom"}
                align="start"
                sideOffset={pad + 10}
                collisionPadding={16}
                updatePositionStrategy="always"
                onEscapeKeyDown={(e) => e.preventDefault()} // Escape is handled once, above
                onInteractOutside={(e) => e.preventDefault()} // the page stays usable; only End closes
                className="z-[62] outline-none"
              >
                {card}
                <Popover.Arrow className="fill-popover" width={14} height={7} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </>
      ) : (
        // No target on screen (welcome, or the sidebar is folded away on a phone): a centred card.
        <div className="tour-dim pointer-events-none fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="pointer-events-auto">{card}</div>
        </div>
      )}
    </>
  );
}

function TourCard({
  step,
  at,
  total,
  onBack,
  onNext,
  onClose,
}: {
  step: TourStep;
  at: number;
  total: number;
  onBack?: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  return (
    <section
      role="dialog"
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
      className="w-[min(22rem,calc(100vw-2rem))] rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="tour-title" className="text-base font-semibold">
          {step.title}
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {`${at} of ${total}`}
        </span>
      </div>
      <p id="tour-body" className="mt-1.5 text-sm text-muted-foreground">
        {step.body}
      </p>
      <div className="mt-2 flex gap-1" aria-hidden>
        {Array.from({ length: total }, (_, n) => (
          <span key={n} className={`h-1 flex-1 rounded-full ${n < at ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          End tour
        </Button>
        <div className="ml-auto flex gap-2">
          {onBack && (
            <Button variant="outline" size="sm" onClick={onBack}>
              Back
            </Button>
          )}
          <Button size="sm" onClick={onNext} data-tour-next>
            {at === total ? "Finish" : "Next"}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Just-in-time discovery: one pulsing dot on the next sidebar item not opened yet, with a short tip. */
export function useBeacons(account: string | null, order: string[], current: string) {
  const key = `apprentice:beacons-seen:${account ?? "anon"}`; // per account, like the tour
  const [seen, setSeen] = useState<string[] | null>(null); // null until read: no flash of a dot
  useEffect(() => setSeen((store.get(key) ?? "").split(",").filter(Boolean)), [key]);
  const loaded = seen !== null;
  const mark = useCallback(
    (id: string) =>
      setSeen((old) => {
        if (!old || old.includes(id)) return old;
        const next = [...old, id];
        store.set(key, next.join(","));
        return next;
      }),
    [key],
  );
  useEffect(() => {
    if (order.includes(current)) mark(current); // opening the page counts as discovering it
  }, [current, mark, order, loaded]);
  return { next: seen && order.find((id) => !seen.includes(id)), mark };
}

export function Beacon({ tip, onSeen }: { tip: string; onSeen: () => void }) {
  return (
    <Popover.Root onOpenChange={(open) => !open && onSeen()}>
      <Popover.Trigger
        aria-label="What's this?"
        className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=icon]:top-1 group-data-[collapsible=icon]:right-1 group-data-[collapsible=icon]:translate-y-0"
      >
        <span className="beacon" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-64 rounded-xl border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
        >
          <p className="text-muted-foreground">{tip}</p>
          <Popover.Close asChild>
            <Button size="sm" className="mt-3">
              Got it
            </Button>
          </Popover.Close>
          <Popover.Arrow className="fill-popover" width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
