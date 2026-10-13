import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { User } from "firebase/auth";
import { authConfigured, signIn, signOut, watchUser } from "./auth";
import { ClipProvider, WsContext, useRoute } from "./ui";
import { Discovery } from "./views/Discovery";
import { Probes } from "./views/Probes";
import { SessionDetail } from "./views/SessionDetail";
import { Sessions } from "./views/Sessions";
import "./styles.css";

// Heavy deps (Live SDK, cytoscape, recharts) load only when their view opens.
const Record = lazy(() => import("./views/Record").then((m) => ({ default: m.Record })));
const GraphView = lazy(() => import("./views/Graph").then((m) => ({ default: m.GraphView })));
const Exam = lazy(() => import("./views/Exam").then((m) => ({ default: m.Exam })));

const IS_DEMO = location.pathname.startsWith("/demo");
const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === "1";

const NAV: [string, string][] = [
  ["", "Sessions"],
  ["probes", "Questions"],
  ["discovery", "Patterns"],
  ["graph", "Decision graph"],
  ["exam", "Successor exam"],
];

function Page({ parts }: { parts: string[] }) {
  const [head, id] = parts;
  if (head === "sessions" && id) return <SessionDetail id={id} />;
  if (head === "record") return <Record />;
  if (head === "probes") return <Probes />;
  if (head === "discovery") return <Discovery />;
  if (head === "graph") return <GraphView />;
  if (head === "exam") return <Exam />;
  return <Sessions />;
}

function SignIn() {
  const [err, setErr] = useState<string | null>(null);
  return (
    <main>
      <div className="sheet signin">
        <h1>Apprentice</h1>
        <p style={{ fontSize: "var(--t-lg)", color: "var(--ink-soft)" }}>Watches an expert work, asks why, and checks that the reasons carry over to whoever comes next.</p>
        <p className="muted">Sign in with the expert's Google account to record sessions and answer questions.</p>
        <div className="actions">
          <button className="btn" disabled={!authConfigured()} onClick={() => signIn().catch((e: Error) => setErr(e.message))}>
            Sign in with Google
          </button>
          <a className="btn quiet" href="/demo/">
            Open the demo
          </a>
        </div>
        {!authConfigured() && <p className="faint">Sign-in isn't configured on this build. The demo works without it.</p>}
        {err && <p className="error">{err}</p>}
      </div>
    </main>
  );
}

function App() {
  const parts = useRoute();
  const [user, setUser] = useState<User | null | undefined>(IS_DEMO || USE_FIXTURES ? null : undefined);
  useEffect(() => (IS_DEMO || USE_FIXTURES ? undefined : watchUser(setUser)), []);

  const ws = IS_DEMO ? "demo" : "live";
  const needsLogin = !IS_DEMO && !USE_FIXTURES && !user;
  const current = parts[0] === "sessions" ? "" : (parts[0] ?? "");

  return (
    <WsContext.Provider value={{ ws, readOnly: IS_DEMO }}>
      <ClipProvider>
        <div className="shell">
          <div>
            <header className="topbar">
              <a className="wordmark" href="#/">
                Apprentice <small>asks why</small>
              </a>
              {!needsLogin && (
                <nav className="nav" aria-label="Main">
                  {NAV.map(([path, label]) => (
                    <a key={path} href={`#/${path}`} aria-current={current === path ? "page" : undefined}>
                      {label}
                    </a>
                  ))}
                </nav>
              )}
              <div className="topbar-end">
                {IS_DEMO ? (
                  <a href="/">Sign in to record</a>
                ) : user ? (
                  <>
                    <span className="muted">{user.email}</span>
                    <button className="btn quiet small" onClick={() => void signOut()}>
                      Sign out
                    </button>
                  </>
                ) : null}
              </div>
            </header>
            {IS_DEMO && (
              <div className="ws-banner">
                Demo workspace: six training sessions and two held-out sessions from one accounts-payable expert, on
                synthetic data. Read-only.
              </div>
            )}
          </div>
          {user === undefined ? (
            <main>
              <p className="faint">Checking sign-in…</p>
            </main>
          ) : needsLogin ? (
            <SignIn />
          ) : (
            <main>
              <Suspense fallback={<p className="faint">Loading…</p>}>
                <Page parts={parts} />
              </Suspense>
            </main>
          )}
        </div>
      </ClipProvider>
    </WsContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
