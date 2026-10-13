// Gemini Live client: browser connects directly with a one-use ephemeral token (SPEC §4, ARCHITECTURE §3).
// The whole setup (system prompt, SOP, log_deviation tool) is locked into the token server-side.
import { FunctionResponseScheduling, GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { answerProbe, liveToken, postDeviation } from "../api/client";
import type { Capture } from "../recorder/recorder";

const PROBE_MIN_INTERVAL_S = 45;
const PROBE_MAX_PER_SESSION = 3;
const SPEAK_TIMEOUT_MS = 4000;
const ANSWER_SILENCE_MS = 6000;
const LIVE_LAG_S = 3;

export type LiveProbe = { probeId: string; question: string; sopRule: string; invoiceId?: string };
export type LiveStatus = "connecting" | "watching" | "reconnecting" | "closed" | "error";
export type LiveEvents = {
  onStatus: (s: LiveStatus, detail?: string) => void;
  onProbe: (p: LiveProbe) => void;
  onAnswer: (probeId: string, text: string) => void;
};

type DeviationArgs = { sop_rule?: string; question?: string; invoice_id?: string; timestamp?: string };

export async function startLive(sessionId: string, capture: Capture, ev: LiveEvents): Promise<{ close: () => void }> {
  let session: Session | null = null;
  let handle: string | undefined;
  let stopped = false;
  let reconnecting = false;
  let asked = 0;
  let lastAskAt = -Infinity;

  // current probe awaiting a spoken answer
  let pending: { probeId: string; question: string; spoken: boolean; answer: string } | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;

  // model audio out: PCM16 24 kHz
  const out = new AudioContext({ sampleRate: 24000 });
  let playAt = 0;
  const play = (b64: string) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1);
    const buf = out.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = out.createBufferSource();
    src.buffer = buf;
    src.connect(out.destination);
    playAt = Math.max(playAt, out.currentTime);
    src.start(playAt);
    playAt += buf.duration;
  };

  const markSpoken = () => {
    if (pending && !pending.spoken) pending.spoken = true;
  };

  // Fallback ladder (ARCHITECTURE §3): nudge Live, then browser TTS.
  const ensureSpoken = (probeId: string, q: string) => {
    setTimeout(() => {
      if (!pending || pending.probeId !== probeId || pending.spoken) return;
      session?.sendClientContent({
        turns: [{ role: "user", parts: [{ text: `Ask the expert now, one sentence: ${q}` }] }],
        turnComplete: true,
      });
      setTimeout(() => {
        if (!pending || pending.probeId !== probeId || pending.spoken) return;
        speechSynthesis.speak(new SpeechSynthesisUtterance(q));
        markSpoken();
      }, SPEAK_TIMEOUT_MS);
    }, SPEAK_TIMEOUT_MS);
  };

  const saveAnswer = () => {
    const p = pending;
    if (!p?.answer.trim()) return;
    pending = null;
    answerProbe(p.probeId, p.answer.trim(), "voice_live").then(
      () => ev.onAnswer(p.probeId, p.answer.trim()),
      () => ev.onStatus("watching", "Couldn't save the spoken answer. You can type it under Questions."),
    );
  };

  const onToolCall = async (msg: LiveServerMessage) => {
    for (const fc of msg.toolCall?.functionCalls ?? []) {
      if (fc.name !== "log_deviation") continue;
      const args = (fc.args ?? {}) as DeviationArgs;
      const elapsed = (Date.now() - capture.startedAt) / 1000;
      const throttled = asked >= PROBE_MAX_PER_SESSION || elapsed - lastAskAt < PROBE_MIN_INTERVAL_S;
      if (throttled || !args.sop_rule || !args.question) {
        session?.sendToolResponse({
          functionResponses: [
            { id: fc.id, name: fc.name, response: { ok: false, reason: "rate_limited" }, scheduling: FunctionResponseScheduling.SILENT },
          ],
        });
        continue;
      }
      asked++;
      lastAskAt = elapsed;
      try {
        const { probe } = await postDeviation(sessionId, {
          sop_rule: args.sop_rule,
          question: args.question,
          invoice_id: args.invoice_id,
          t_seconds: Math.max(0, Math.round(elapsed - LIVE_LAG_S)),
          model_timestamp: args.timestamp,
        });
        saveAnswer(); // keep whatever was said to the previous question
        pending = { probeId: probe.id, question: probe.question, spoken: false, answer: "" };
        ev.onProbe({ probeId: probe.id, question: probe.question, sopRule: args.sop_rule, invoiceId: args.invoice_id });
        session?.sendToolResponse({
          functionResponses: [
            { id: fc.id, name: fc.name, response: { ok: true, probe_id: probe.id }, scheduling: FunctionResponseScheduling.SILENT },
          ],
        });
        ensureSpoken(probe.id, probe.question);
      } catch {
        session?.sendToolResponse({
          functionResponses: [{ id: fc.id, name: fc.name, response: { ok: false }, scheduling: FunctionResponseScheduling.SILENT }],
        });
      }
    }
  };

  const onMessage = (msg: LiveServerMessage) => {
    if (msg.toolCall) void onToolCall(msg);
    const sc = msg.serverContent;
    for (const part of sc?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) {
        play(part.inlineData.data);
        markSpoken();
      }
    }
    if (sc?.outputTranscription?.text) markSpoken();
    if (sc?.inputTranscription?.text && pending?.spoken) {
      pending.answer += sc.inputTranscription.text;
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(saveAnswer, ANSWER_SILENCE_MS);
    }
    if (msg.sessionResumptionUpdate?.newHandle) handle = msg.sessionResumptionUpdate.newHandle;
    if (msg.goAway) void reconnect();
  };

  const connect = async () => {
    const tok = await liveToken(sessionId, handle);
    const ai = new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion: "v1alpha" } });
    session = await ai.live.connect({
      model: tok.model,
      config: { responseModalities: [Modality.AUDIO] },
      callbacks: {
        onmessage: onMessage,
        onerror: (e) => ev.onStatus("error", e.message),
        onclose: () => {
          if (!stopped && !reconnecting) void reconnect();
        },
      },
    });
    ev.onStatus("watching");
  };

  const reconnect = async () => {
    if (stopped || reconnecting) return;
    reconnecting = true;
    ev.onStatus("reconnecting");
    const old = session;
    session = null;
    try {
      old?.close();
      await connect();
    } catch (e) {
      ev.onStatus("error", e instanceof Error ? e.message : String(e));
    } finally {
      reconnecting = false;
    }
  };

  capture.onFrame((data) => session?.sendRealtimeInput({ video: { data, mimeType: "image/jpeg" } }));
  capture.onAudio((data) => session?.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } }));

  ev.onStatus("connecting");
  await connect();

  return {
    close: () => {
      stopped = true;
      clearTimeout(silenceTimer);
      saveAnswer();
      session?.close();
      void out.close();
      ev.onStatus("closed");
    },
  };
}
