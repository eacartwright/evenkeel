import { useEffect, useRef, useState } from "react";
import { transcribe } from "./ai";
import { showToast } from "./toast";

// A voice ramble (DESIGN.md §5.6), sideshow's dictation: the app records the audio itself and the
// server transcribes it with a better model than the keyboard's mic. The text arrives once you
// stop. If sending fails the recording is kept in memory with Try again, so it isn't lost to a
// dropped connection. (Not yet kept across closing the app: that needs IndexedDB, §5.6.)

/** A long ramble is fine; a forgotten recording isn't. */
const MAX_MS = 15 * 60_000;

/** The first format this browser can record. */
function recorderType(): string | undefined {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
}

export const canRecord = () => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

export type DictationState = "idle" | "starting" | "recording" | "sending";

export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const [startedAt, setStartedAt] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout>>(undefined);
  const textRef = useRef(onText);
  textRef.current = onText;

  const send = async (blob: Blob, seconds: number) => {
    setState("sending");
    try {
      const text = (await transcribe(blob, seconds)).trim();
      if (text) textRef.current(text);
      else showToast("Didn't catch any words in that");
    } catch (err) {
      showToast(`Couldn't transcribe that: ${(err as Error).message}`, { label: "Try again", run: () => void send(blob, seconds) }, 120_000);
    }
    setState("idle");
  };

  const start = async () => {
    if (state !== "idle") return;
    setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("idle");
      showToast("The microphone is blocked for this app: allow it in the browser's site settings");
      return;
    }
    const type = recorderType();
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    const began = Date.now();
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      clearTimeout(limit.current);
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      void send(new Blob(chunks, { type: rec.mimeType || type || "audio/webm" }), (Date.now() - began) / 1000);
    };
    recorder.current = rec;
    rec.start();
    setStartedAt(began);
    setState("recording");
    limit.current = setTimeout(() => {
      if (rec.state === "recording") rec.stop();
    }, MAX_MS);
  };

  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  // Leaving the page mid-recording: let go of the microphone (and drop the audio).
  useEffect(
    () => () => {
      clearTimeout(limit.current);
      const rec = recorder.current;
      if (rec) {
        rec.onstop = null;
        if (rec.state === "recording") rec.stop();
        rec.stream.getTracks().forEach((t) => t.stop());
      }
    },
    [],
  );

  return { state, startedAt, start, stop };
}
