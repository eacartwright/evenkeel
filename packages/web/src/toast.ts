import { useSyncExternalStore } from "react";

// One short-lived message at a time, optionally with an action (e.g. Undo).

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function showToast(text: string, action?: Toast["action"], ms = 6000) {
  current = { id: nextId++, text, action };
  clearTimeout(timer);
  timer = setTimeout(dismissToast, ms);
  emit();
}

export function dismissToast() {
  current = null;
  emit();
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}
