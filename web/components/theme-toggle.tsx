"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "./icons";

// The choice lives in <html data-theme> (absent means dark) and in localStorage. The inline
// script in app/layout.tsx applies it before first paint.
const THEMES = [
  { id: "dark", name: "Dark theme", Icon: Moon },
  { id: "light", name: "Light theme", Icon: Sun },
  { id: "system", name: "Match system theme", Icon: Monitor },
] as const;
type Theme = (typeof THEMES)[number]["id"];

const watchers = new Set<() => void>();
const subscribe = (notify: () => void) => {
  watchers.add(notify);
  return () => { watchers.delete(notify); };
};
const current = () => (document.documentElement.dataset.theme ?? "dark") as Theme;

function choose(theme: Theme) {
  // Every colour changes at once; switch transitions off for that frame so nothing smears.
  const off = document.createElement("style");
  off.textContent = "*,*::before,*::after{transition:none !important}";
  document.head.append(off);
  if (theme === "dark") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  void document.body.offsetHeight; // forces a synchronous style flush
  requestAnimationFrame(() => requestAnimationFrame(() => off.remove()));
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // Storage is blocked: the choice lasts until the page reloads.
  }
  watchers.forEach((notify) => notify());
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, current, () => "dark" as Theme);
  return (
    <div role="group" aria-label="Theme" className="flex rounded-[2px] border border-line p-0.5">
      {THEMES.map(({ id, name, Icon }) => (
        <button
          key={id} type="button" aria-label={name} title={name} aria-pressed={theme === id}
          onClick={() => choose(id)}
          className="grid size-6 cursor-pointer place-items-center rounded-[1px] text-muted sm:size-7 hover:text-ink aria-pressed:bg-raised aria-pressed:text-ink"
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}
