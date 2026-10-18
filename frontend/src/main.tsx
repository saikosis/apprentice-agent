import type { User } from "firebase/auth";
import {
  CircleDotIcon,
  CompassIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
  UsersIcon,
  FlaskConicalIcon,
  MessageCircleQuestionIcon,
  MoonIcon,
  NetworkIcon,
  Repeat2Icon,
  SunIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react";
import { StrictMode, Suspense, lazy, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import {
  SCENARIOS,
  currentScenario,
  me,
  subscribeScenario,
  switchScenario,
  viewKey,
  viewSandbox,
  viewingSandbox,
} from "./api/client";
import { authConfigured, signIn, signOut, watchUser } from "./auth";
import { Avatar, AvatarFallback } from "./components/ui/avatar";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Separator } from "./components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "./components/ui/sidebar";
import { Skeleton } from "./components/ui/skeleton";
import { TooltipProvider } from "./components/ui/tooltip";
import "./index.css";
import { Beacon, TOUR_STEPS, Tour, useBeacons, useTour } from "./tour";
import { ClipProvider, ErrorNote, WsContext, useRoute } from "./ui";
import { Admin } from "./views/Admin";
import { SandboxHome } from "./views/SandboxHome";
import { Discovery } from "./views/Discovery";
import { JoinSandbox } from "./views/JoinSandbox";
import { Probes } from "./views/Probes";
import { SessionDetail } from "./views/SessionDetail";
import { Sessions } from "./views/Sessions";

// Heavy deps (Live SDK, cytoscape, recharts) load only when their view opens.
const Record = lazy(() => import("./views/Record").then((m) => ({ default: m.Record })));
const GraphView = lazy(() => import("./views/Graph").then((m) => ({ default: m.GraphView })));
const Exam = lazy(() => import("./views/Exam").then((m) => ({ default: m.Exam })));
const Overview = lazy(() => import("./views/Overview").then((m) => ({ default: m.Overview })));

const IS_DEMO = location.pathname.startsWith("/demo");
const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === "1";
// Laptop-only: talk to a local backend running with LOCAL_DB + DEV_USER_EMAIL, no Firebase.
// import.meta.env.DEV is false in every production build, so this can't ship.
const DEV_AUTH = import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH === "1";
const SKIP_AUTH = IS_DEMO || USE_FIXTURES;
type Me = Awaited<ReturnType<typeof me>>;

const NAV: [string, string, LucideIcon][] = [
  ["", "Overview", LayoutDashboardIcon],
  ["sessions", "Sessions", VideoIcon],
  ["probes", "Questions", MessageCircleQuestionIcon],
  ["discovery", "Patterns", Repeat2Icon],
  ["graph", "Decision graph", NetworkIcon],
  ["exam", "Successor exam", GraduationCapIcon],
];

// The sidebar's "try this next" dots, in the order the work happens.
const BEACON_TIPS: Record<string, string> = {
  sessions: "Open a recording to see its summary and jump to the moments that mattered.",
  probes: "Apprentice's why questions wait here. Your answers become the graph's rules.",
  discovery: "Departures you made more than once, and the workflow you actually followed.",
  graph: "The SOP plus your exceptions, each linked to its video moment.",
  exam: "Test an AI successor with and without your graph on cases you label.",
};
const BEACON_ORDER = Object.keys(BEACON_TIPS);

function Page({ parts }: { parts: string[] }) {
  const [head, id] = parts;
  if (head === "sessions" && id) return <SessionDetail id={id} />;
  if (head === "sessions") return <Sessions />;
  if (head === "record") return <Record />;
  if (head === "probes") return <Probes />;
  if (head === "discovery") return <Discovery />;
  if (head === "graph") return <GraphView />;
  if (head === "exam") return <Exam />;
  if (head === "admin") return <Admin />;
  if (head === "sandbox") return <SandboxHome />;
  return <Overview />;
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const flip = () => {
    document.documentElement.classList.toggle("dark", !dark);
    try {
      localStorage.setItem("theme", dark ? "light" : "dark");
    } catch {
      // storage blocked: the choice lasts for this page only
    }
    setDark(!dark);
  };
  return (
    <Button variant="outline" size="icon" onClick={flip} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

function TourButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="icon" onClick={onClick} aria-label="Start the guided tour" title="Guided tour" data-tour="tour">
      <CompassIcon />
    </Button>
  );
}

function Brand() {
  return (
    <a href="#/" className="flex items-center gap-2.5 px-2 py-1.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <NetworkIcon className="size-4" />
      </span>
      <span className="text-base font-semibold">Apprentice</span>
    </a>
  );
}

// The landing page: what Apprentice does, and one way in (Google sign-in).
const STEPS: [LucideIcon, string, string][] = [
  [VideoIcon, "Record real work", "Share the tab you work in, Sheets, Docs or Gmail, and talk as you go."],
  [MessageCircleQuestionIcon, "Answer why", "When you step outside the SOP, Apprentice asks what you saw and why you chose it."],
  [GraduationCapIcon, "Test the successor", "An AI with only the SOP takes the same exam as one that also has your reasons."],
];

// The product in one picture: a written rule, the expert's exception that overrides it, and the reason behind it.
function GraphMotif() {
  const node = (x: number, y: number, w: number, title: string, text: string, strong = false) => (
    <g>
      <rect x={x} y={y} width={w} height={52} rx={12} className={strong ? "fill-card stroke-primary" : "fill-card stroke-border"} strokeWidth={strong ? 2 : 1.5} />
      <text x={x + 14} y={y + 21} className={strong ? "fill-primary text-[11px] font-semibold" : "fill-muted-foreground text-[11px] font-medium"}>
        {title}
      </text>
      <text x={x + 14} y={y + 39} className="fill-foreground text-[13px]">
        {text}
      </text>
    </g>
  );
  return (
    <svg viewBox="0 0 360 196" className="w-full max-w-sm" role="img" aria-label="A decision graph: the SOP rule, the expert's exception that overrides it, and the reason">
      <path d="M110 58 C110 84, 180 84, 180 110" className="fill-none stroke-primary" strokeWidth={2} strokeDasharray="4 4" />
      <path d="M262 58 C262 84, 200 84, 200 110" className="fill-none stroke-border" strokeWidth={1.5} />
      {node(8, 6, 204, "SOP §3.2", "Match every invoice to a PO")}
      {node(224, 6, 128, "Why", "No PO ever exists")}
      {node(30, 112, 300, "Expert's exception", "Consignment vendor: tick the statement", true)}
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function SignIn() {
  const [err, setErr] = useState<string | null>(null);
  return (
    <main className="grid min-h-svh bg-background lg:grid-cols-[1.15fr_1fr]">
      <section className="flex flex-col justify-between gap-12 px-6 py-8 sm:px-10 lg:px-16 lg:py-12">
        <Brand />
        <div className="max-w-xl">
          <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
            Keep the judgement when your expert moves on.
          </h1>
          <p className="mt-5 max-w-lg text-lg text-muted-foreground">
            Apprentice watches an expert work, asks why whenever they depart from the written procedure, and proves the
            reasons carried over to whoever comes next.
          </p>
          <ol className="mt-10 flex flex-col gap-6">
            {STEPS.map(([Icon, title, text]) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <p className="text-sm text-muted-foreground">Built with Gemini on Google Cloud for the AI Builder Cup 2026.</p>
      </section>

      <section className="flex flex-col items-center justify-center gap-8 border-t bg-accent/40 px-6 py-12 lg:border-t-0 lg:border-l">
        <GraphMotif />
        <Card className="w-full max-w-sm shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>Use any Google account. Nothing is posted to it, and Apprentice never writes to your Sheets or Gmail.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              size="lg"
              variant="outline"
              className="h-11 gap-3 bg-card text-base"
              disabled={!authConfigured()}
              onClick={() => signIn().catch((e: Error) => setErr(e.message))}
            >
              <GoogleMark />
              Sign in with Google
            </Button>
            {err && <ErrorNote>{err}</ErrorNote>}
          </CardContent>
          <CardFooter className="text-sm text-muted-foreground">
            {authConfigured()
              ? "Judges: after signing in, enter the code from the submission notes to open your own sandbox."
              : "Sign-in isn't configured on this build."}
          </CardFooter>
        </Card>
      </section>
    </main>
  );
}

function AccessError({ error }: { error: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="gap-3">
          <Brand />
          <CardTitle className="text-xl">Couldn't open Apprentice</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button size="lg" onClick={() => location.reload()}>
            Try again
          </Button>
          {!DEV_AUTH && (
            <Button size="lg" variant="outline" onClick={() => void signOut()}>
              Sign in with another account
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

const useScenarioId = () => useSyncExternalStore(subscribeScenario, () => currentScenario().id);
const useViewKey = () => useSyncExternalStore(subscribeScenario, viewKey);

function AppSidebar({
  current,
  readOnly,
  admin,
  judge,
  beacons,
  account,
}: {
  current: string;
  readOnly: boolean;
  admin: boolean;
  judge: boolean;
  beacons: boolean;
  account: string | null;
}) {
  const scenario = useScenarioId();
  const beacon = useBeacons(account, BEACON_ORDER, current);
  return (
    <Sidebar>
      <SidebarHeader className="h-16 justify-center border-b">
        <Brand />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel asChild>
            <label htmlFor="scenario">Workflow</label>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <Select value={scenario} onValueChange={(v) => switchScenario(v as (typeof SCENARIOS)[number]["id"])}>
              <SelectTrigger id="scenario" className="w-full" data-tour="workflow">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {SCENARIOS.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {[
                ...(judge ? ([["sandbox", "My sandbox", FlaskConicalIcon]] as typeof NAV) : []),
                ...NAV,
                ...(admin ? ([["admin", "Judge sandboxes", UsersIcon]] as typeof NAV) : []),
              ].map(([path, label, Icon]) => (
                <SidebarMenuItem key={path}>
                  <SidebarMenuButton asChild isActive={current === path} size="lg" tooltip={label}>
                    <a
                      href={`#/${path}`}
                      aria-current={current === path ? "page" : undefined}
                      data-tour={`nav-${path || "overview"}`}
                    >
                      <Icon />
                      <span>{label}</span>
                    </a>
                  </SidebarMenuButton>
                  {beacons && beacon.next === path && (
                    <Beacon tip={BEACON_TIPS[path]} onSeen={() => beacon.mark(path)} />
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {!readOnly && (
        <SidebarFooter className="p-3">
          <Button asChild>
            <a href="#/record" data-tour="record">
              <CircleDotIcon data-icon="inline-start" />
              Record a session
            </a>
          </Button>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}

function App() {
  const parts = useRoute();
  const [user, setUser] = useState<User | null | undefined>(SKIP_AUTH || DEV_AUTH ? null : undefined);
  useEffect(() => (SKIP_AUTH || DEV_AUTH ? undefined : watchUser(setUser)), []);
  const signedIn = DEV_AUTH || Boolean(user);
  // Only the expert's account may use the live workspace; ask the backend who we are. The answer is
  // tied to the account it was asked for, so a late reply or an account switch can't gate the wrong one.
  const account = DEV_AUTH ? "dev" : (user?.uid ?? null);
  const [answer, setAnswer] = useState<{ account: string; who: Me | { error: string } } | null>(null);
  const [meNonce, setMeNonce] = useState(0); // bumped after the judge code is accepted
  useEffect(() => {
    if (SKIP_AUTH || !account) return;
    let current = true;
    me().then(
      (who) => current && setAnswer({ account, who }),
      (e: unknown) => current && setAnswer({ account, who: { error: e instanceof Error ? e.message : String(e) } }),
    );
    return () => {
      current = false;
    };
  }, [account, meNonce]);
  useEffect(() => {
    const again = () => setMeNonce((n) => n + 1); // e.g. the judge deleted their sandbox
    window.addEventListener("apprentice:account", again);
    return () => window.removeEventListener("apprentice:account", again);
  }, []);
  const who = answer && answer.account === account ? answer.who : undefined;

  const ws = IS_DEMO ? "demo" : "live";
  const scenario = useViewKey(); // remount key: workflow switch or admin view
  const viewing = viewingSandbox();
  const isAdmin = Boolean(who && "is_admin" in who && who.is_admin);
  const current = parts[0] ?? "";
  // Starts by itself on each account's first sign-in (never in the demo, which has no sign-in).
  const tour = useTour(SKIP_AUTH || !who || "error" in who || who.role === "none" ? null : account);

  const checking = (label: string) => (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Skeleton className="h-72 w-full max-w-md rounded-xl" aria-label={label} />
    </main>
  );
  if (!SKIP_AUTH) {
    if (user === undefined) return checking("Checking sign-in");
    if (!signedIn) return <SignIn />;
    if (who === undefined) return checking("Checking access");
    if ("error" in who) return <AccessError error={who.error} />;
    if (who.role === "none")
      return (
        <main className="flex min-h-svh items-center justify-center p-4">
          <JoinSandbox
            email={who.email}
            onJoined={() => ((window.location.hash = "#/sandbox"), setMeNonce((n) => n + 1))}
            footer={
              !DEV_AUTH && (
                <Button variant="ghost" onClick={() => void signOut()}>
                  Use another account
                </Button>
              )
            }
          />
        </main>
      );
  }
  const email = user?.email ?? (who && "email" in who ? who.email : undefined);

  return (
    <WsContext.Provider
      value={{ ws, readOnly: IS_DEMO || Boolean(viewing), sandbox: Boolean(who && "role" in who && who.role === "judge") }}
    >
      <ClipProvider>
        <SidebarProvider>
          <AppSidebar
            current={current}
            readOnly={IS_DEMO || Boolean(viewing)}
            admin={isAdmin}
            judge={Boolean(who && "role" in who && who.role === "judge")}
            beacons={!tour.open}
            account={IS_DEMO ? "demo" : account}
          />
          <SidebarInset className="min-w-0">
            <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur md:px-6">
              <SidebarTrigger />
              <Separator orientation="vertical" className="data-vertical:h-5 data-vertical:self-center" />
              {viewing ? (
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <Badge variant="secondary">Read-only</Badge>
                  <span className="truncate text-muted-foreground">Viewing {viewing.email}'s sandbox</span>
                  <Button variant="outline" size="sm" onClick={() => (viewSandbox(null), (window.location.hash = "#/admin"))}>
                    Stop viewing
                  </Button>
                </div>
              ) : IS_DEMO ? (
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <Badge variant="secondary">Demo</Badge>
                  <span className="truncate text-muted-foreground">
                    One accounts-payable expert, synthetic data. Read-only.
                  </span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {who && "role" in who && who.role === "judge" ? (
                    <Badge variant="secondary">Judge sandbox</Badge>
                  ) : (
                    "Live workspace"
                  )}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <TourButton onClick={tour.start} />
                <ThemeToggle />
                {IS_DEMO ? (
                  <Button variant="outline" asChild>
                    <a href="/">Sign in to record</a>
                  </Button>
                ) : signedIn ? (
                  <>
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-accent text-xs text-accent-foreground">
                        {(user?.displayName ?? email ?? "?").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden text-sm md:inline">{email}</span>
                    {DEV_AUTH ? (
                      <Badge variant="outline">Local dev</Badge>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                        Sign out
                      </Button>
                    )}
                  </>
                ) : null}
              </div>
            </header>
            <main className="mx-auto w-full max-w-[1400px] p-4 md:p-6 lg:p-8">
              {/* key: switching workflow remounts every page so it refetches that workflow's data */}
              <Suspense key={scenario} fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
                <Page parts={parts} />
              </Suspense>
            </main>
          </SidebarInset>
          <Tour key={tour.run} steps={TOUR_STEPS} open={tour.open} onClose={tour.end} />
        </SidebarProvider>
      </ClipProvider>
    </WsContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
