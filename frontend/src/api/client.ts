// All data fetching goes through here. Token is held in memory only (AGENTS.md guardrails).
let idToken: string | null = null;

export function setIdToken(token: string | null): void {
  idToken = token;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (idToken) headers.set("Authorization", `Bearer ${idToken}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
