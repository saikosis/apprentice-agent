import type { User } from "firebase/auth";
import {
  CircleDotIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
  MessageCircleQuestionIcon,
  MoonIcon,
  NetworkIcon,
  Repeat2Icon,
  SunIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react";
import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { authConfigured, signIn, signOut, watchUser } from "./auth";
import { Avatar, AvatarFallback } from "./components/ui/avatar";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./components/ui/card";
import { Separator } from "./components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
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
import { Discovery } from "./views/Discovery";
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

function AppSidebar({ current, readOnly }: { current: string; readOnly: boolean }) {
  return (
    <Sidebar>
      <SidebarHeader className="h-16 justify-center border-b">
        <Brand />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(([path, label, Icon]) => (
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
  const [user, setUser] = useState<User | null | undefined>(IS_DEMO || USE_FIXTURES ? null : undefined);
  useEffect(() => (IS_DEMO || USE_FIXTURES ? undefined : watchUser(setUser)), []);

  const ws = IS_DEMO ? "demo" : "live";
  const needsLogin = !IS_DEMO && !USE_FIXTURES && !user;
  const current = parts[0] ?? "";

  if (user === undefined)
    return (
      <main className="flex min-h-svh items-center justify-center p-4">
        <Skeleton className="h-72 w-full max-w-md rounded-xl" aria-label="Checking sign-in" />
      </main>
    );
  if (needsLogin) return <SignIn />;

  return (
    <WsContext.Provider value={{ ws, readOnly: IS_DEMO }}>
      <ClipProvider>
        <SidebarProvider>
          <AppSidebar current={current} readOnly={IS_DEMO} />
          <SidebarInset className="min-w-0">
            <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur md:px-6">
              <SidebarTrigger />
              <Separator orientation="vertical" className="data-vertical:h-5 data-vertical:self-center" />
              {IS_DEMO ? (
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <Badge variant="secondary">Demo</Badge>
                  <span className="truncate text-muted-foreground">
                    One accounts-payable expert, synthetic data. Read-only.
                  </span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Live workspace</span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <ThemeToggle />
                {IS_DEMO ? (
                  <Button variant="outline" asChild>
                    <a href="/">Sign in to record</a>
                  </Button>
                ) : user ? (
                  <>
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-accent text-xs text-accent-foreground">
                        {(user.displayName ?? user.email ?? "?").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden text-sm md:inline">{user.email}</span>
                    <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                      Sign out
                    </Button>
                  </>
                ) : null}
              </div>
            </header>
            <main className="mx-auto w-full max-w-[1400px] p-4 md:p-6 lg:p-8">
              <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
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
