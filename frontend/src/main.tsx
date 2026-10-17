import type { User } from "firebase/auth";
import {
  CircleDotIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
  UsersIcon,
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
import { ClipProvider, ErrorNote, WsContext, useRoute } from "./ui";
import { Admin } from "./views/Admin";
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

function SignIn() {
  const [err, setErr] = useState<string | null>(null);
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center gap-3 text-center">
          <div className="flex justify-center">
            <Brand />
          </div>
          <CardTitle className="text-xl">Capture why your expert decides</CardTitle>
          <CardDescription>
            Apprentice watches an expert work, asks why, and checks that the reasons carry over to whoever comes next.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button size="lg" disabled={!authConfigured()} onClick={() => signIn().catch((e: Error) => setErr(e.message))}>
            Sign in with Google
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href="/demo/">Open the demo</a>
          </Button>
          {err && <ErrorNote>{err}</ErrorNote>}
        </CardContent>
        <CardFooter className="justify-center text-center text-xs text-muted-foreground">
          {authConfigured()
            ? "Sign in with the expert's Google account to record sessions and answer questions."
            : "Sign-in isn't configured on this build. The demo works without it."}
        </CardFooter>
      </Card>
    </main>
  );
}

function NotExpert({ email, error }: { email?: string; error?: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center gap-3 text-center">
          <div className="flex justify-center">
            <Brand />
          </div>
          <CardTitle className="text-xl">{error ? "Couldn't open the live workspace" : "This account can't open the live workspace"}</CardTitle>
          <CardDescription>
            {error ??
              `The live workspace belongs to the expert being recorded. ${email ?? "This account"} isn't that account. The demo shows a full run on synthetic data.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button size="lg" asChild>
            <a href="/demo/">Open the demo</a>
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

function AppSidebar({ current, readOnly, admin }: { current: string; readOnly: boolean; admin: boolean }) {
  const scenario = useScenarioId();
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
              <SelectTrigger id="scenario" className="w-full">
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
              {[...NAV, ...(admin ? ([["admin", "Judge sandboxes", UsersIcon]] as typeof NAV) : [])].map(([path, label, Icon]) => (
                <SidebarMenuItem key={path}>
                  <SidebarMenuButton asChild isActive={current === path} size="lg" tooltip={label}>
                    <a href={`#/${path}`} aria-current={current === path ? "page" : undefined}>
                      <Icon />
                      <span>{label}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {!readOnly && (
        <SidebarFooter className="p-3">
          <Button asChild>
            <a href="#/record">
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
  const who = answer && answer.account === account ? answer.who : undefined;

  const ws = IS_DEMO ? "demo" : "live";
  const scenario = useViewKey(); // remount key: workflow switch or admin view
  const viewing = viewingSandbox();
  const isAdmin = Boolean(who && "is_admin" in who && who.is_admin);
  const current = parts[0] ?? "";

  const checking = (label: string) => (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Skeleton className="h-72 w-full max-w-md rounded-xl" aria-label={label} />
    </main>
  );
  if (!SKIP_AUTH) {
    if (user === undefined) return checking("Checking sign-in");
    if (!signedIn) return <SignIn />;
    if (who === undefined) return checking("Checking access");
    if ("error" in who) return <NotExpert error={who.error} />;
    if (who.role === "none")
      return (
        <main className="flex min-h-svh items-center justify-center p-4">
          <JoinSandbox
            email={who.email}
            onJoined={() => setMeNonce((n) => n + 1)}
            footer={
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild>
                  <a href="/demo/">Open the read-only demo</a>
                </Button>
                {!DEV_AUTH && (
                  <Button variant="ghost" onClick={() => void signOut()}>
                    Use another account
                  </Button>
                )}
              </div>
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
          <AppSidebar current={current} readOnly={IS_DEMO || Boolean(viewing)} admin={isAdmin} />
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
