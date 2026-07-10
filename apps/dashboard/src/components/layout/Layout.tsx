/**
 * App shell: sidebar nav + topbar + content (spec §18.1).
 */
import type { ReactNode } from "react";
import {
  Activity,
  FolderGit2,
  LayoutDashboard,
  Lightbulb,
  Moon,
  Radio,
  Settings2,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { useRoute, navigate, type RouteName } from "../../lib/router.js";
import { useTheme } from "../../lib/theme.js";
import { useStatus } from "../../hooks/useApi.js";
import { cn } from "../../lib/cn.js";
import { Badge } from "../ui/primitives.js";

const NAV: Array<{ name: RouteName; label: string; icon: typeof Activity }> = [
  { name: "overview", label: "Overview", icon: LayoutDashboard },
  { name: "sessions", label: "Sessions", icon: Activity },
  { name: "projects", label: "Projects", icon: FolderGit2 },
  { name: "recommendations", label: "Recommendations", icon: Lightbulb },
  { name: "live", label: "Live", icon: Radio },
  { name: "privacy", label: "Privacy", icon: ShieldCheck },
  { name: "onboarding", label: "Getting started", icon: Settings2 },
];

function privacyTone(mode: string) {
  return mode === "metadata-only" ? "info" : mode === "full-local" ? "high" : "low";
}

export function Layout({ children }: { children: ReactNode }) {
  const route = useRoute();
  const { theme, toggle } = useTheme();
  const status = useStatus();

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--al-border)] bg-[var(--al-surface)]">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="text-lg">🔍</span>
          <span className="font-semibold tracking-tight">AgentLens</span>
        </div>
        <nav className="flex-1 px-2" aria-label="Primary">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = route.name === item.name;
            return (
              <button
                key={item.name}
                onClick={() => navigate(item.name)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "mb-0.5 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-[var(--al-accent-weak)] font-medium text-[var(--al-accent)]"
                    : "text-[var(--al-text-muted)] hover:bg-[var(--al-surface-2)] hover:text-[var(--al-text)]",
                )}
              >
                <Icon size={16} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-[var(--al-border)] p-3 text-xs text-[var(--al-text-muted)]">
          {status.data ? (
            <div className="flex flex-col gap-1">
              <span>
                Privacy:{" "}
                <Badge tone={privacyTone(status.data.privacyMode)}>{status.data.privacyMode}</Badge>
              </span>
              <span>
                {status.data.sessions} sessions · {status.data.projects} projects
              </span>
            </div>
          ) : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--al-border)] bg-[var(--al-surface)] px-6 py-3">
          <h1 className="text-sm font-medium text-[var(--al-text-muted)]">
            Local-first workflow intelligence for Claude Code
          </h1>
          <button
            onClick={toggle}
            className="rounded-md p-1.5 text-[var(--al-text-muted)] hover:bg-[var(--al-surface-2)] hover:text-[var(--al-text)]"
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
