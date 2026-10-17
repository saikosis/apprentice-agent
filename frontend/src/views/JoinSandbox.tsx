import { useState, type FormEvent } from "react";
import { joinSandbox } from "../api/client";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ErrorNote } from "../ui";

// Shown to any signed-in account that isn't the expert's: the judge code opens a private sandbox.
export function JoinSandbox({ email, onJoined, footer }: { email?: string; onJoined: () => void; footer?: React.ReactNode }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    joinSandbox(code).then(onJoined, (x: Error) => (setErr(x.message), setBusy(false)));
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="gap-2">
        <CardTitle className="text-xl">Try Apprentice yourself</CardTitle>
        <CardDescription>
          {email ?? "This account"} isn't the expert's account. With the judge code from the submission notes you get a
          private sandbox: record a few minutes of work, answer Apprentice's questions, and watch the graph and the exam
          change.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Label htmlFor="judge-code">Judge code</Label>
          <div className="flex gap-2">
            <Input id="judge-code" value={code} autoComplete="off" onChange={(e) => setCode(e.target.value)} />
            <Button type="submit" disabled={busy || !code.trim()}>
              Open my sandbox
            </Button>
          </div>
        </form>
        {err && <ErrorNote>{err}</ErrorNote>}
        {footer}
      </CardContent>
    </Card>
  );
}
