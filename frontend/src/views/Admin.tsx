import { listSandboxes, viewSandbox } from "../api/client";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import type { SandboxUsage } from "../types/contract";
import { Empty, Loadable, PageHeader, fmtDate, go, useAsync } from "../ui";

const LIMITS: [keyof SandboxUsage, string][] = [
  ["recordings", "Recordings"],
  ["graph_builds", "Graph builds"],
  ["exam_runs", "Exam runs"],
  ["case_generations", "Case generations"],
];

// ADMIN_UIDS only (the server refuses everyone else). "View" opens a judge's sandbox read-only.
export function Admin() {
  const state = useAsync(() => listSandboxes(), []);
  return (
    <>
      <PageHeader title="Judge sandboxes" description="Each judge's private sandbox, what it has used, and a read-only view of it." />
      <Loadable state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty title="No sandboxes yet">A judge's sandbox appears here once they enter the judge code.</Empty>
          ) : (
            <Card className="py-0">
              <p className="px-4 pt-4 text-sm text-muted-foreground">
                Sandbox actions today: {rows[0].global_today} of {rows[0].global_limit}.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Judge</TableHead>
                    <TableHead>Joined</TableHead>
                    {LIMITS.map(([, label]) => (
                      <TableHead key={label}>{label}</TableHead>
                    ))}
                    <TableHead className="pr-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.uid}>
                      <TableCell className="pl-4 font-medium">{r.email}</TableCell>
                      <TableCell>{fmtDate(r.created_at)}</TableCell>
                      {LIMITS.map(([k]) => (
                        <TableCell key={k} className="tabular-nums">
                          {r.usage?.[k] ?? 0} of {r.limits?.[k] ?? 0}
                        </TableCell>
                      ))}
                      <TableCell className="pr-4 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`View ${r.email}'s sandbox`}
                          onClick={() => (viewSandbox({ uid: r.uid, email: r.email }), go("/"))}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )
        }
      </Loadable>
    </>
  );
}
