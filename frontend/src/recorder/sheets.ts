// Connect Sheet (US9): GIS token client for spreadsheets.readonly, then read the scenario's work tab. Read-only,
// token in memory.
import { sheetValues } from "../api/client";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

type TokenClient = { requestAccessToken: () => void };
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (c: {
            client_id: string;
            scope: string;
            callback: (r: { access_token?: string; error?: string }) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

export const sheetsConfigured = () => Boolean(CLIENT_ID);

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load Google sign-in for Sheets."));
    document.head.appendChild(s);
  });
}

export async function requestSheetsToken(): Promise<string> {
  if (!CLIENT_ID) throw new Error("Connect Sheet isn't configured: set VITE_GOOGLE_CLIENT_ID.");
  await loadGis();
  return new Promise((resolve, reject) => {
    window
      .google!.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error ?? "Sheets access was declined."))),
      })
      .requestAccessToken();
  });
}

// Header -> cell text, one record per non-empty row. Headers are normalised ("Response ID" -> "response_id")
// so they match the scenario's id column.
export function rowsToRecords(values: string[][]): Record<string, string>[] {
  const [header, ...rows] = values;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows
    .filter((r) => r.some((c) => c?.trim()))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

// The tab is the scenario's (Invoices, Grades, Form responses 1); quoted because names can have spaces.
export async function readTab(spreadsheetId: string, tab: string, token: string): Promise<Record<string, string>[]> {
  return rowsToRecords(await sheetValues(spreadsheetId, `'${tab.replace(/'/g, "''")}'!A1:Z1000`, token));
}
