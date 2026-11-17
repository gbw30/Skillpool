"use client";
// Whether the visitor paused the motion that runs on its own: the background light, the brain and
// the rotating examples (WCAG 2.2.2). Kept like the theme: <html data-motion="paused"> and
// localStorage, applied before first paint by the inline script in app/layout.tsx.
import { useSyncExternalStore } from "react";

const watchers = new Set<() => void>();
const subscribe = (notify: () => void) => {
  watchers.add(notify);
  return () => { watchers.delete(notify); };
};
const current = () => document.documentElement.dataset.motion === "paused";

export const useMotionPaused = () => useSyncExternalStore(subscribe, current, () => false);

export function setMotionPaused(paused: boolean) {
  if (paused) document.documentElement.dataset.motion = "paused";
  else delete document.documentElement.dataset.motion;
  try {
    localStorage.setItem("motion", paused ? "paused" : "on");
  } catch {
    // Storage is blocked: the choice lasts until the page reloads.
  }
  watchers.forEach((notify) => notify());
}
