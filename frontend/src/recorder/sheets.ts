// Connect Sheet (US9): GIS token client for spreadsheets.readonly, then read the Invoices tab. Read-only, token in memory.
import { sheetValues } from "../api/client";
import type { InvoiceRow } from "../types/contract";

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

const NUM = new Set(["amount_inr", "gst_inr"]);
const NULLABLE = new Set(["po_number", "grn_number", "approver_1", "approver_2"]);

export function rowsToInvoices(values: string[][]): InvoiceRow[] {
  const [header, ...rows] = values;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows
    .filter((r) => r[0]?.trim())
    .map((r) => {
      const o: Record<string, string | number | null> = {};
      keys.forEach((k, i) => {
        const v = (r[i] ?? "").trim();
        o[k] = NUM.has(k) ? Number(v.replace(/[₹,\s]/g, "")) || 0 : NULLABLE.has(k) && !v ? null : v;
      });
      return o as unknown as InvoiceRow;
    });
}

export async function readInvoices(spreadsheetId: string, token: string): Promise<InvoiceRow[]> {
  return rowsToInvoices(await sheetValues(spreadsheetId, "Invoices!A1:O500", token));
}
