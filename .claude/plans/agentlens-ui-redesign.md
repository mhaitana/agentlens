# Plan: Professional UI refresh for AgentLens dashboard & GitHub Pages

## 1. Current-state critique

### Dashboard (`apps/dashboard/src/`)

- **Visual identity is generic**: flat white/grey cards, system-only typography, no brand expression.
- **Emoji in production UI**: sidebar logo uses `🔍`, violating the "no emoji as structural icons" rule.
- **Weak hierarchy**: page titles, cards, and tables all share similar weights and greys.
- **Charts look bare**: no gradients, no accessible legend on the donut, no direct labels.
- **Motion is minimal and inconsistent**: nav items have `transition-colors` but no tactile press feedback; modals snap in.
- **Token surface is thin**: only 8 CSS variables, so surfaces and borders feel muddy in dark mode.
- **Responsive behaviour is basic**: sidebar is fixed 14rem on all widths; tables overflow without consideration.

### GitHub Pages (`docs/`)

- **Better aesthetic but still uses emoji icons** in hero pill, feature cards, search, privacy checkmarks, and gallery placeholders (`🛡️`, `📊`, `💡`, etc.).
- **No light-mode support**: marketing page is dark-only, which can feel hostile in bright environments.
- **Footer grid mismatch**: CSS expects 4 columns (`2fr repeat(3, 1fr)`) but markup only has 3 columns, leaving an empty cell.
- **Mobile nav missing**: nav links overflow on narrow viewports; no hamburger or collapsible menu.
- **Reduced motion not honoured**: all hover lifts and gradient backgrounds animate unconditionally.
- **Terminal tabs overflow** horizontally on small screens.
- **Some muted text is low-contrast** (`#64748b` on `#0f131d`) and needs bumping.

## 2. Design direction

Adopt a single **"Developer Intelligence"** design system that spans both surfaces:

- **Style**: modern dark primary with a clean light variant (cinematic dark / executive dashboard hybrid). Deep slate backgrounds, emerald primary accent, cyan and violet as secondary accents.
- **Tokens**: full semantic token map — surfaces, elevations, borders, text, accents, status colors, radii, shadows, typography.
- **Typography**: `Inter` for body/UI, `JetBrains Mono` for data/code, `Outfit` for display headings.
- **Icons**: Lucide SVG everywhere; no emoji used as icons.
- **Motion**: 150–250ms micro-interactions, `cubic-bezier(0.16, 1, 0.3, 1)` easing, `prefers-reduced-motion` fallback.
- **Elevation**: 1px hairline borders plus subtle layered shadows; never pure black backgrounds.

### Color tokens (dark / light)

| Role           | Dark                     | Light                  |
| -------------- | ------------------------ | ---------------------- |
| bg-base        | `#0b0e14`                | `#f8fafc`              |
| bg-elevated    | `#131722`                | `#ffffff`              |
| bg-inset       | `#090c12`                | `#f1f5f9`              |
| border         | `rgba(255,255,255,0.08)` | `#e2e8f0`              |
| border-subtle  | `rgba(255,255,255,0.05)` | `#f1f5f9`              |
| text           | `#f8fafc`                | `#0f172a`              |
| text-secondary | `#94a3b8`                | `#475569`              |
| text-muted     | `#64748b`                | `#64748b`              |
| accent         | `#10b981`                | `#059669`              |
| accent-weak    | `rgba(16,185,129,0.12)`  | `rgba(5,150,105,0.10)` |
| info           | `#06b6d4`                | `#0891b2`              |
| warning        | `#f59e0b`                | `#d97706`              |
| danger         | `#f43f5e`                | `#dc2626`              |

## 3. Implementation scope

### A. Dashboard design tokens (`apps/dashboard/src/styles.css` + `lib/theme.ts`)

1. Expand CSS variables to the full semantic map above.
2. Switch theme application from `.dark` class to `data-theme="dark" | "light"`, while keeping the existing localStorage key.
3. Add `color-scheme` and `prefers-reduced-motion` handling.
4. Define font-family CSS variables (Inter, Outfit, JetBrains Mono) loaded via `index.html` Google Fonts.

### B. Dashboard primitives (`components/ui/primitives.tsx`)

1. **Button**: primary, secondary, ghost, danger, subtle variants; visible focus ring; disabled opacity + cursor; press scale feedback via `active:scale-[0.98]`.
2. **Card**: optional `elevated` prop; consistent padding; hover lift on interactive cards.
3. **Badge**: refined status colors with guaranteed contrast; sizes `sm`/`md`.
4. **Stat**: larger value, clear label, optional hint/icon.
5. **Spinner / ErrorState / EmptyState**: polish and better empty-state illustrations (Lucide icons, no emoji).
6. **ProvenanceTag**: icon + text chip.

### C. Dashboard widgets (`components/ui/widgets.tsx`)

1. **ConfidenceBadge**: icon + badge + numeric score; never colour-alone.
2. **Pagination**: icon buttons (`ChevronLeft`/`ChevronRight`), page info.
3. **Field / TextInput / Select**: focus ring using accent, better label spacing.
4. **ConfirmDialog**: modal with scrim, centered panel, entry animation.

### D. Dashboard layout (`components/layout/Layout.tsx`)

1. Replace emoji logo with a composed Lucide `ScanSearch` + "AgentLens" wordmark.
2. Add active-route indicator (left accent bar or filled pill).
3. Improve sidebar styling: elevated surface, hairline border, rounded content area.
4. Add topbar subtitle/breadcrumb area with better typography.
5. Keep responsive behaviour simple but safe: min-width on sidebar, overflow on main.

### E. Dashboard feature screens

1. **Overview** (`features/overview/Overview.tsx`)
   - KPI grid with 4-6 large stat cards.
   - Segmented period control as a styled button group.
   - Bar chart with gradient fill and proper axes/tooltips.
   - Donut chart with percentage legend (not just colour swatches).
   - Data completeness as horizontal progress bars.
2. **Sessions** (`features/sessions/SessionsList.tsx`)
   - Filter bar on an elevated card with improved spacing.
   - Table with sticky header, row hover, status badges, truncation.
3. **Projects** (`features/projects/Projects.tsx`)
   - Project cards with icon, metadata chips, "View sessions" CTA.
4. **Recommendations** (`features/recommendations/Recommendations.tsx`)
   - Cards with left severity border, expanded evidence panel, remediation code block styling.
5. **Coaching** (`features/coaching/Coaching.tsx`)
   - Metric cards, improved bar chart, prompt list as accordion with cleaner detail.
6. **Doctor** (`features/doctor/Doctor.tsx`)
   - Health score, scope chips, patch rows with diff block styling.
7. **Privacy** (`features/privacy/Privacy.tsx`)
   - Mode selector cards with icons, better toggles, retention input with save button.
8. **Live** (`features/live/Live.tsx`)
   - Pulsing status dots, cleaner feed items.
9. **Onboarding** (`features/onboarding/Onboarding.tsx`)
   - Step cards with Lucide icons, clearer CTAs.

### F. GitHub Pages refresh (`docs/`)

1. **index.html**
   - Replace every emoji icon with inline Lucide SVGs.
   - Add skip-to-main link, semantic landmarks, improved alt text.
   - Add theme toggle and `prefers-color-scheme` support via `data-theme`.
   - Add mobile hamburger menu with toggle in `script.js`.
   - Update footer markup to match the intended grid.
2. **styles.css**
   - Refactor around the same token map as the dashboard.
   - Add light-mode variant under `:root[data-theme="light"]` and `prefers-color-scheme`.
   - Fix footer grid to 3 columns (or 1 on mobile).
   - Make terminal tabs wrap gracefully on mobile.
   - Add visible focus states and `prefers-reduced-motion` fallbacks.
   - Improve contrast on muted text.
3. **script.js**
   - Keep existing terminal simulator, privacy comparator, rules explorer, lightbox, copy buttons.
   - Add mobile nav toggle.
   - Add theme toggle respecting OS preference.
   - Respect `prefers-reduced-motion`.

## 4. Files to modify

- `apps/dashboard/src/styles.css`
- `apps/dashboard/src/index.html` (add fonts)
- `apps/dashboard/src/lib/theme.ts`
- `apps/dashboard/src/components/ui/primitives.tsx`
- `apps/dashboard/src/components/ui/widgets.tsx`
- `apps/dashboard/src/components/layout/Layout.tsx`
- `apps/dashboard/src/features/overview/Overview.tsx`
- `apps/dashboard/src/features/sessions/SessionsList.tsx`
- `apps/dashboard/src/features/projects/Projects.tsx`
- `apps/dashboard/src/features/recommendations/Recommendations.tsx`
- `apps/dashboard/src/features/coaching/Coaching.tsx`
- `apps/dashboard/src/features/doctor/Doctor.tsx`
- `apps/dashboard/src/features/privacy/Privacy.tsx`
- `apps/dashboard/src/features/live/Live.tsx`
- `apps/dashboard/src/features/onboarding/Onboarding.tsx`
- `docs/index.html`
- `docs/styles.css`
- `docs/script.js`

## 5. Dependencies

No new runtime dependencies. Dashboard already uses `lucide-react`. For the docs site, inline Lucide SVGs are used; no additional package is required.

## 6. Verification plan

After implementation, run the §26 gate scoped to affected surfaces:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @agentlens/dashboard test
pnpm --filter @agentlens/dashboard test:e2e
pnpm build
```

- Update Playwright reference screenshots if E2E uses visual regression.
- Validate docs HTML/CSS manually or with a lightweight validator.
- Report exact pass/fail honestly per §27.

## 7. Open decisions

1. **Screenshots in `docs/img/`** will become outdated after the dashboard redesign. Regenerate them after the dashboard changes, or leave a follow-up task.
2. **Light mode for docs**: implement full light-mode tokens, or keep dark-only with improved contrast? Plan proposes full light-mode tokens.
3. **Mobile sidebar for dashboard**: keep fixed sidebar (it is a desktop-local dashboard) or add a collapse affordance? Plan keeps fixed sidebar but improves responsive spacing.
