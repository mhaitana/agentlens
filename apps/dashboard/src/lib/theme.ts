/**
 * Dark/light theme store. Persisted to localStorage, applied by
 * setting `data-theme` on <html> (see styles.css). Defaults to the OS
 * preference.
 */
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "agentlens-theme";
type Theme = "light" | "dark";

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

function stored(): Theme | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : null;
}

function apply(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

let current: Theme = stored() ?? (prefersDark() ? "dark" : "light");
const listeners = new Set<() => void>();
apply(current);

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot(): Theme {
  return current;
}

function setTheme(t: Theme): void {
  current = t;
  apply(t);
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, t);
  for (const l of listeners) l();
}

/** Current theme (reactive). */
export function useTheme(): { theme: Theme; toggle: () => void; set: (t: Theme) => void } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    theme,
    set: setTheme,
    toggle() {
      setTheme(current === "dark" ? "light" : "dark");
    },
  };
}
