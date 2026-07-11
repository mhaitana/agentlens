/**
 * App shell: sidebar nav + topbar + content (spec §18.1).
 */
import type { ReactNode } from "react";
import {
  Activity,
  FolderGit2,
  GraduationCap,
  LayoutDashboard,
  Lightbulb,
  Moon,
  Radio,
  ScanSearch,
  Settings2,
  ShieldCheck,
  Stethoscope,
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
  { name: "coaching", label: "Coaching", icon: GraduationCap },
  { name: "doctor", label: "Doctor", icon: Stethoscope },
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
    <div className="flex h-full min-h-0 bg-[var(--al-bg-base)]">
      <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--al-border)] bg-[var(--al-bg-elevated)] shadow-[var(--al-shadow-sm)]">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--al-radius-md)] bg-[var(--al-accent-weak)] text-[var(--al-accent)]">
            <ScanSearch size={20} aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <span className="font-display text-lg font-semibold tracking-tight">AgentLens</span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--al-text-muted)]">
              Local-first
            </span>
          </div>
        </div>
        <nav className="flex-1 px-3" aria-label="Primary">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = route.name === item.name;
            return (
              <button
                key={item.name}
                onClick={() => navigate(item.name)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative mb-0.5 flex w-full items-center gap-3 rounded-[var(--al-radius-md)] px-3 py-2 text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-[var(--al-accent-weak)] text-[var(--al-accent)]"
                    : "text-[var(--al-text-secondary)] hover:bg-[var(--al-bg-hover)] hover:text-[var(--al-text)]",
                )}
              >
                {active ? (
                  <span
                    className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[var(--al-accent)]"
                    aria-hidden="true"
                  />
                ) : null}
                <Icon size={18} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-[var(--al-border)] p-3 text-xs text-[var(--al-text-muted)]">
          {status.data ? (
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2">
                Privacy:
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
        <header className="flex items-center justify-between border-b border-[var(--al-border)] bg-[var(--al-bg-elevated)] px-6 py-3 shadow-[var(--al-shadow-sm)]">
          <h1 className="text-sm font-medium text-[var(--al-text-secondary)]">
            Local-first workflow intelligence for Claude Code
          </h1>
          <button
            onClick={toggle}
            className="rounded-[var(--al-radius-md)] p-2 text-[var(--al-text-secondary)] transition-colors hover:bg-[var(--al-bg-hover)] hover:text-[var(--al-text)]"
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
