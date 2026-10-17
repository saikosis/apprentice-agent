import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { accountChanged, currentScenario, deleteSandbox, getSandbox, quickPlan, resetSandbox } from "../api/client";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import type { SandboxUsage } from "../types/contract";
import { ErrorNote, Loadable, PageHeader, go, useAsync } from "../ui";

const LIMITS: [keyof SandboxUsage, string][] = [
  ["recordings", "Recordings"],
  ["graph_builds", "Graph builds and pattern runs"],
  ["exam_runs", "Exam runs"],
  ["case_generations", "Exam case sets"],
];

// A judge's start page: what's left, what to record, the files to work in, and reset/delete.
export function SandboxHome() {
  const state = useAsync(() => getSandbox(), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scenario = currentScenario();
  const plan = quickPlan(scenario.id);

  const act = (what: string, run: () => Promise<unknown>, after: () => void) => {
    if (!window.confirm(what)) return;
    setBusy(true);
    setErr(null);
    run().then(after, (e: Error) => setErr(e.message)).finally(() => setBusy(false));
  };

  return (
    <>
      <PageHeader
        title="Your sandbox"
        description="A private copy of Apprentice. Record a few minutes of work, answer its questions, then watch the patterns, the graph and the exam change. Only you and the organisers can see it; it is deleted after 14 days."
      />
      <Loadable state={state}>
        {(info) => (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {LIMITS.map(([k, label]) => (
                <Card key={k}>
                  <CardHeader>
                    <CardDescription>{label}</CardDescription>
                    <CardTitle className="text-2xl tabular-nums">
                      {info.usage?.[k] ?? 0} of {info.limit_each}
                    </CardTitle>
                  </CardHeader>
                </Card>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              All sandboxes together: {info.global_today} of {info.global_limit} actions used today.
            </p>

            {plan && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">What to record ({scenario.title.toLowerCase()})</CardTitle>
                  <CardDescription>
                    About 3–5 minutes: work through these {plan.items.length} {scenario.item_label}s in the files below.
                    Each unwritten rule appears twice, so Apprentice can spot it as a pattern. Two or three items is
                    fine for a first try.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <ol className="flex flex-col gap-2">
                    {Object.entries(plan.rules).map(([rule, what]) => (
                      <li key={rule}>
                        <span className="font-medium">{(plan.planted_items[rule] ?? []).join(", ")}</span>
                        <span className="text-muted-foreground">: {what}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap gap-2">
                    {plan.files.map((f) => (
                      <Button key={f} variant="outline" asChild>
                        <a href={`/api/packs/${scenario.id}/${f}`} download>
                          <DownloadIcon data-icon="inline-start" />
                          {f}
                        </a>
                      </Button>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Upload the files to Google Drive and open them with Google Sheets or Google Docs. Read the starter
                    emails as if they were in your inbox. Then press Record a session and share that tab.
                  </p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Start over</CardTitle>
                <CardDescription>
                  Resetting deletes your recordings, answers, graph and exams in every workflow. Used limits stay used.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => act("Delete everything and reload the sample run?", () => resetSandbox("sample"), () => go("/"))}
                >
                  Reset to sample
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => act("Delete everything and start empty?", () => resetSandbox("empty"), () => go("/sessions"))}
                >
                  Start empty
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => act("Delete your sandbox, its recordings and your access? You'd need the judge code again.", deleteSandbox, accountChanged)}
                >
                  Delete my sandbox
                </Button>
              </CardContent>
            </Card>
            {err && <ErrorNote>{err}</ErrorNote>}
          </div>
        )}
      </Loadable>
    </>
  );
}
