// All data fetching goes through here. Token is held in memory only (AGENTS.md guardrails).
import type {
  AgentRun,
  Decision,
  DecisionGraph,
  Deviation,
  ExamCase,
  ExamReport,
  Probe,
  ProbeAnswer,
  Segment,
  Session,
  SheetDiff,
  ScenarioInfo,
  SheetSnapshot,
  Variant,
} from "../types/contract";

// ---- scenario: which workflow the app is showing (invoices, essays, volunteers) ----
// Labels come straight from the backend's domain packs, so the UI and the prompts never disagree.
const configs = import.meta.glob<ScenarioInfo>("../../../backend/app/domains/*/config.json", {
  eager: true,
  import: "default",
});
export const SCENARIOS: ScenarioInfo[] = Object.values(configs).sort((a, b) =>
  a.id === "ap" ? -1 : b.id === "ap" ? 1 : a.title.localeCompare(b.title),
);
type Scenario = ScenarioInfo["id"];
const SCENARIO_KEY = "apprentice.scenario"; // a view preference, not a token
function initialScenario(): Scenario {
  try {
    const saved = localStorage.getItem(SCENARIO_KEY);
    if (SCENARIOS.some((s) => s.id === saved)) return saved as Scenario;
  } catch {
    // storage blocked: default scenario
  }
  return "ap";
}
let scenario: Scenario = initialScenario();
export const currentScenario = (): ScenarioInfo => SCENARIOS.find((s) => s.id === scenario) ?? SCENARIOS[0];
// No page reload: sign-in lives in memory only (AGENTS.md), so a reload would sign the expert out. Drop the cached
// scenario data instead; main.tsx remounts the pages on change so every view refetches.
const scenarioListeners = new Set<() => void>();
export function subscribeScenario(cb: () => void): () => void {
  scenarioListeners.add(cb);
  return () => scenarioListeners.delete(cb);
}
export function switchScenario(next: Scenario): void {
  try {
    localStorage.setItem(SCENARIO_KEY, next);
  } catch {
    // storage blocked: the choice lasts until reload
  }
  scenario = next;
  bundlePromise = null;
  videoUrls.clear();
  scenarioListeners.forEach((cb) => cb());
}
const withScenario = (path: string) =>
  scenario === "ap" || !path.startsWith("/api/") ? path : `${path}${path.includes("?") ? "&" : "?"}scenario=${scenario}`;

let idToken: string | null = null;

export function setIdToken(token: string | null): void {
  idToken = token;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (idToken) headers.set("Authorization", `Bearer ${idToken}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(withScenario(path), { ...init, headers });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body; keep status text
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body: JSON.stringify(body) });

export type Ws = "demo" | "live";
export type ProbeWithAnswer = Probe & { answer?: ProbeAnswer | null };
export type SessionDetail = { session: Session; segments: Segment[]; deviations: Deviation[]; diff: SheetDiff | null };

// GET /api/demo/bundle per SPEC §3. segments/deviations/answers are optional extras the seed carries (SPEC §8).
export type DemoBundle = {
  sessions: Session[];
  variants: Variant[];
  probes: ProbeWithAnswer[];
  graph: DecisionGraph | null;
  report: ExamReport | null;
  segments?: Record<string, Segment[]>;
  deviations?: Record<string, Deviation[]>;
  exam_cases?: ExamCase[];
  agent_runs?: AgentRun[];
};

const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === "1";

async function fixtureBundle(): Promise<DemoBundle> {
  const [sessions, segments, deviations, variants, probes, answers, graph, report, cases, runs] = await Promise.all([
    import("../../../fixtures/sessions.json"),
    import("../../../fixtures/segments.json"),
    import("../../../fixtures/deviations.json"),
    import("../../../fixtures/variants.json"),
    import("../../../fixtures/probes.json"),
    import("../../../fixtures/probe_answers.json"),
    import("../../../fixtures/graph.json"),
    import("../../../fixtures/exam_report.json"),
    import("../../../fixtures/exam_cases.json"),
    import("../../../fixtures/agent_runs.json"),
  ]);
  const group = <X extends { session_id: string }>(xs: X[]) =>
    xs.reduce<Record<string, X[]>>((acc, x) => ((acc[x.session_id] ??= []).push(x), acc), {});
  const byProbe = new Map((answers.default as ProbeAnswer[]).map((a) => [a.probe_id, a]));
  return {
    sessions: sessions.default as Session[],
    segments: group(segments.default as Segment[]),
    deviations: group(deviations.default as Deviation[]),
    variants: variants.default as Variant[],
    probes: (probes.default as Probe[]).map((p) => ({ ...p, answer: byProbe.get(p.id) ?? null })),
    graph: graph.default as DecisionGraph,
    report: report.default as ExamReport,
    exam_cases: cases.default as ExamCase[],
    agent_runs: runs.default as AgentRun[],
  };
}

const EMPTY_BUNDLE: DemoBundle = { sessions: [], variants: [], probes: [], graph: null, report: null };

let bundlePromise: Promise<DemoBundle> | null = null;
// ponytail: falls back to bundled fixtures when the demo endpoint isn't seeded yet, so /demo always loads.
// The fixtures are invoice data, so other scenarios fall back to an empty demo instead.
export function demoBundle(): Promise<DemoBundle> {
  const fallback = () => (scenario === "ap" ? fixtureBundle() : Promise.resolve(EMPTY_BUNDLE));
  bundlePromise ??= (USE_FIXTURES ? Promise.reject(new Error("fixtures")) : api<DemoBundle>("/api/demo/bundle"))
    .then((b) => (b.sessions?.length ? b : fallback()))
    .catch(fallback);
  return bundlePromise;
}

const fromBundle = (ws: Ws) => ws === "demo" || USE_FIXTURES;

// ---- reads (work in demo + live) ----
export async function listSessions(ws: Ws): Promise<Session[]> {
  if (fromBundle(ws)) return (await demoBundle()).sessions;
  return api(`/api/sessions?ws=${ws}`);
}

export async function getSession(ws: Ws, id: string): Promise<SessionDetail> {
  if (fromBundle(ws)) {
    const b = await demoBundle();
    const session = b.sessions.find((s) => s.id === id);
    if (!session) throw new ApiError(404, `Session ${id} not found`);
    return { session, segments: b.segments?.[id] ?? [], deviations: b.deviations?.[id] ?? [], diff: null };
  }
  return api(`/api/sessions/${id}`);
}

export async function listProbes(ws: Ws, status?: Probe["status"]): Promise<ProbeWithAnswer[]> {
  if (fromBundle(ws)) {
    const all = (await demoBundle()).probes;
    return status ? all.filter((p) => p.status === status) : all;
  }
  return api(`/api/probes${status ? `?status=${status}` : ""}`);
}

export async function listVariants(ws: Ws): Promise<Variant[]> {
  if (fromBundle(ws)) return (await demoBundle()).variants;
  return api("/api/variants");
}

export async function getGraph(ws: Ws): Promise<DecisionGraph | null> {
  if (fromBundle(ws)) return (await demoBundle()).graph;
  try {
    return await api<DecisionGraph>(`/api/graph?ws=${ws}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function latestReport(ws: Ws): Promise<ExamReport | null> {
  if (fromBundle(ws)) return (await demoBundle()).report;
  try {
    return await api<ExamReport>(`/api/exam/reports/latest?ws=${ws}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

// Labelled cases survive a reload; the demo shows the report's cases.
export async function listCases(ws: Ws): Promise<ExamCase[]> {
  if (fromBundle(ws)) return (await demoBundle()).exam_cases ?? [];
  return api(`/api/exam/cases?ws=${ws}`);
}

// Both agents' runs on one case of one report, for the side-by-side view.
export async function listRuns(ws: Ws, caseId: string, reportId: string): Promise<AgentRun[]> {
  if (fromBundle(ws))
    return ((await demoBundle()).agent_runs ?? []).filter((r) => r.case_id === caseId && r.id.startsWith(`${reportId}-`));
  return api(`/api/exam/runs?ws=${ws}&case_id=${encodeURIComponent(caseId)}&report_id=${encodeURIComponent(reportId)}`);
}

const videoUrls = new Map<string, Promise<string>>();
export function videoUrl(sessionId: string): Promise<string> {
  let p = videoUrls.get(sessionId);
  if (!p) {
    p = api<{ url: string }>(`/api/sessions/${sessionId}/video-url`).then((r) => r.url);
    p.catch(() => videoUrls.delete(sessionId));
    videoUrls.set(sessionId, p);
  }
  return p;
}

// ---- writes (live workspace only) ----
export const me = () => api<{ uid: string; email: string; is_demo_expert: boolean }>("/api/me");
export const answerProbe = (id: string, text: string, source: ProbeAnswer["source"]) =>
  post<{ probe: Probe; answer: ProbeAnswer }>(`/api/probes/${id}/answer`, { text, source });
export const editAnswer = (id: string, text: string) =>
  api<{ probe: Probe; answer: ProbeAnswer }>(`/api/probes/${id}/answer`, { method: "PATCH", body: JSON.stringify({ text }) });
export const discoverVariants = () => post<unknown>("/api/variants/discover");
export const buildGraph = () => post<unknown>("/api/graph/build");
export const generateCases = (heldout_session_ids: string[], n_generated = 8) =>
  post<ExamCase[]>("/api/exam/generate", { n_generated, heldout_session_ids });
export const labelCase = (id: string, decision: Decision, rationale: string) =>
  api<ExamCase>(`/api/exam/cases/${id}/label`, { method: "PUT", body: JSON.stringify({ decision, rationale }) });
export const runExam = (runs_per_arm = 3) => post<{ report_id: string }>("/api/exam/run", { runs_per_arm });
export const getReport = (id: string) => api<ExamReport>(`/api/exam/report/${id}`);

export const createSession = (kind: Session["kind"], live_enabled: boolean) =>
  post<Session>("/api/sessions", { kind, live_enabled });
export const uploadUrl = (id: string, size_bytes: number) =>
  post<{ url: string; method: "PUT"; headers: Record<string, string>; gcs_uri: string; expires_at: string }>(
    `/api/sessions/${id}/upload-url`,
    { content_type: "video/webm", size_bytes },
  );
export const finalizeSession = (id: string, duration_s: number, ended_at: string) =>
  post<Session>(`/api/sessions/${id}/finalize`, { duration_s, ended_at });
export const processSession = (id: string) => post<{ session_id: string; status: string }>(`/api/sessions/${id}/process`);
export const liveToken = (session_id: string, resume_handle?: string) =>
  post<{ token: string; model: string; expires_at: string; new_session_expires_at: string }>("/api/live/token", {
    session_id,
    resume_handle,
  });
export const postDeviation = (
  id: string,
  body: { sop_rule: string; question: string; invoice_id?: string; t_seconds: number; model_timestamp?: string },
) => post<{ deviation: Deviation; probe: Probe }>(`/api/sessions/${id}/deviations`, body);
export const sheetSnapshot = (session_id: string, phase: "before" | "after", rows: Record<string, string>[]) =>
  post<SheetSnapshot>("/api/sheets/snapshot", { session_id, phase, rows });

// Signed GCS PUT — no bearer token, the URL carries the signature.
export async function putRecording(url: string, headers: Record<string, string>, blob: Blob): Promise<void> {
  const res = await fetch(url, { method: "PUT", headers, body: blob });
  if (!res.ok) throw new ApiError(res.status, `Upload failed: ${res.status}`);
}

// Sheets API v4, read-only, with a GIS access token held by the caller in memory.
export async function sheetValues(spreadsheetId: string, range: string, accessToken: string): Promise<string[][]> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new ApiError(res.status, `Sheets read failed: ${res.status}`);
  return ((await res.json()) as { values?: string[][] }).values ?? [];
}
