// Tab + mic capture → webm recording, 1 FPS JPEG frames and 16 kHz PCM16 mic chunks for Live (SPEC §0, §4).
import { finalizeSession, processSession, putRecording, uploadUrl } from "../api/client";

const FRAME_MAX_EDGE = 768;
const JPEG_QUALITY = 0.7;
const AUDIO_RATE = 16000;
const CHUNK_SAMPLES = (AUDIO_RATE * 40) / 1000; // 40 ms

export type Capture = {
  startedAt: number;
  stop: () => Promise<Blob>;
  onFrame: (cb: (jpegBase64: string) => void) => void;
  onAudio: (cb: (pcmBase64: string) => void) => void;
  ended: Promise<void>; // resolves if the user stops sharing from Chrome's bar
};

const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(${CHUNK_SAMPLES}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice().buffer, []); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("pcm16", Pcm16);`;

export const toBase64 = (buf: ArrayBuffer) => {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function startCapture(): Promise<Capture> {
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 15 },
    audio: true,
    // Chrome hints: prefer a tab, never offer this app's own tab.
    ...({ preferCurrentTab: false, selfBrowserSurface: "exclude", surfaceSwitching: "include" } as object),
  });
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    display.getTracks().forEach((t) => t.stop());
    throw e;
  }

  // Recording = screen video + (tab audio + mic) mixed. Live gets mic only (SPEC §4).
  const mixCtx = new AudioContext();
  const mixOut = mixCtx.createMediaStreamDestination();
  mixCtx.createMediaStreamSource(mic).connect(mixOut);
  if (display.getAudioTracks().length) mixCtx.createMediaStreamSource(display).connect(mixOut);
  const recStream = new MediaStream([...display.getVideoTracks(), ...mixOut.stream.getAudioTracks()]);

  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
  const recorder = new MediaRecorder(recStream, { mimeType: mime, videoBitsPerSecond: 1_500_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(1000);
  const startedAt = Date.now();

  // Frames for Live
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = new MediaStream(display.getVideoTracks());
  await video.play();
  const canvas = document.createElement("canvas");
  let frameCb: ((b64: string) => void) | null = null;
  const frameTimer = setInterval(() => {
    if (!frameCb || !video.videoWidth) return;
    const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (b) => b && frameCb && b.arrayBuffer().then((buf) => frameCb?.(toBase64(buf))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  }, 1000);

  // Mic PCM16 @16 kHz for Live
  const pcmCtx = new AudioContext({ sampleRate: AUDIO_RATE });
  const workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  await pcmCtx.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);
  const node = new AudioWorkletNode(pcmCtx, "pcm16");
  pcmCtx.createMediaStreamSource(mic).connect(node);
  let audioCb: ((b64: string) => void) | null = null;
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => audioCb?.(toBase64(e.data));

  const ended = new Promise<void>((resolve) => {
    display.getVideoTracks()[0]?.addEventListener("ended", () => resolve(), { once: true });
  });

  const stop = () =>
    new Promise<Blob>((resolve) => {
      clearInterval(frameTimer);
      frameCb = audioCb = null;
      recorder.onstop = () => {
        [...display.getTracks(), ...mic.getTracks()].forEach((t) => t.stop());
        void mixCtx.close();
        void pcmCtx.close();
        resolve(new Blob(chunks, { type: "video/webm" }));
      };
      if (recorder.state !== "inactive") recorder.stop();
      else recorder.onstop(new Event("stop"));
    });

  return {
    startedAt,
    stop,
    ended,
    onFrame: (cb) => (frameCb = cb),
    onAudio: (cb) => (audioCb = cb),
  };
}

// Signed-URL upload → finalize → start processing (SPEC §3, ARCHITECTURE §4).
export async function uploadAndProcess(sessionId: string, blob: Blob, durationS: number, endedAt: string): Promise<void> {
  const up = await uploadUrl(sessionId, blob.size);
  await putRecording(up.url, up.headers, blob);
  await finalizeSession(sessionId, durationS, endedAt);
  await processSession(sessionId);
}
