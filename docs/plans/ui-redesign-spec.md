# UI Direction Spec: Family Scheduler redesign (`feat/ui-redesign`)

Date: 2026-07-11. Status: APPROVED direction (brainstorm complete). This is the **UI direction spec** the backlog calls for; it feeds the architect plan next (architect → plan-review → Coder → QA).

## Goal

Replace the current minimal, inline-styled UI with a cohesive **clean & calm** visual system built on **Tailwind CSS + shadcn/ui**, working well on both the iPhone home-screen PWA and desktop. This is a **presentation-only** migration — no behavior, data, auth, engine, or API changes.

## Scope decision (locked)

This effort is the **visual redesign only**. The two feature items the backlog bundled with it are DEFERRED to their own follow-on branches, built on the new component system afterward:
- Calendar item click → opens item details.
- Custom repeat (weekly-on-selected-days RRULE `BYDAY` + optional `UNTIL`).

## Aesthetic direction: Clean & calm

Minimal, uncluttered, low-stress. Generous whitespace, muted palette, crisp typography — reduces the visual noise of a busy family schedule. Not childish, not corporate.

## 1. Tech foundation

- **Tailwind CSS** + **shadcn/ui**. shadcn components are **copied into `web/src/components/ui/`** (not an npm import), so the frontend stays self-contained.
- **`lucide-react`** for icons.
- **Dark mode = `prefers-color-scheme`** (Tailwind `darkMode: 'media'`) — follows the device's system appearance. No manual toggle to build or persist.
- All styling driven by **semantic CSS tokens** (shadcn convention: CSS variables in `:root` and the media-dark block), defined once for light and dark. Components reference tokens, never raw hex.
- Vite already builds the PWA; Tailwind slots into the existing build. Must remain **offline-capable** (no external font/CDN requests — consistent with the PWA + service worker).

## 2. Palette (semantic tokens)

| Token | Light | Dark |
|---|---|---|
| background | `#fbfbfd` cool white | `#0f1417` deep slate |
| surface / card | `#ffffff` | `#1a2126` |
| foreground (text) | `#1f2933` slate | `#e6edf3` |
| muted foreground | `#64748b` | `#8b97a3` |
| border | `#e5e7eb` | `#2b353c` |
| **primary (accent)** | `#4a9d8e` teal/sage | `#5cb3a3` (lifted for contrast) |
| primary foreground | `#ffffff` | `#0f1417` |
| destructive | `#e05252` (soft) | `#f0716f` |

- Replaces the current bright green `#22aa66`.
- **Update the PWA `theme-color`** (`web/index.html` meta + manifest) to the teal so the iOS status bar matches.
- Exact token names follow shadcn's set (`--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--border`, `--destructive`, `--ring`, etc.); the hexes above map to those. Architect to finalize the full token list (incl. `--ring`, `--accent`, `--popover`, `--input`) consistent with these anchors.

## 3. Typography, density, shape

- **Type:** the existing **system sans stack** (`-apple-system`/Segoe UI/Roboto). Crisp, geometric-ish (SF on iPhone), zero bundle weight, offline. Self-hosted **Inter (bundled woff2)** is a documented easy later swap if a distinct brand face is wanted — NOT in v1.
- **Density:** comfortable / spacious — generous padding, roomy line-height.
- **Corners:** base radius **8px**; cards/surfaces ~10–12px.
- **Shadows:** one soft, low shadow token — barely there.

## 4. Layout & navigation

- **Desktop (≥ ~768px):** restyled **left sidebar** (view navigation + list selector) + main content pane — the existing two-pane structure, cleaned up.
- **Mobile (< ~768px):** **bottom tab bar** — List · Calendar · Admin (Admin tab only for `role === 'admin'`) — plus a slim **top bar** holding the **Lists ▾** selector (opens a shadcn **Sheet**) and a primary **+ New** action.
- The existing `activeView` state (`list` | `calendar` | `admin`) maps directly to the tabs/nav; list selection (which list's items) stays a separate concern (sidebar on desktop, Sheet on mobile). Do NOT regress the `activeView` single-source-of-truth model (PR #4) or the `?item=` deep-link one-shot (PR #6/#9).
- **Item form (`ItemEditor`):** move from inline rendering into a **modal Dialog on desktop / full-screen Sheet on mobile** — a focused editing surface with the list visible behind on desktop. `ReminderEditor`, `RecurrenceEditor`, and `AttachmentsEditor` render inside it.

## 5. shadcn primitives to introduce

Button, Card, Input, Textarea, Select, Checkbox, Label, Dialog, Sheet, Tabs, Badge, Separator, Tooltip. (Architect confirms the final set; add only what the views actually use.)

## 6. Migration scope — every view, presentation-only

Each component moves from inline styles → Tailwind + shadcn, **behavior unchanged**:
`App` (shell + nav), `ListSidebar`, `ItemListView`, `CalendarView`, `ItemEditor`, `ReminderEditor`, `RecurrenceEditor`, `AdminPanel`, `NotificationSetup`, `InstallBanner`, `AttachmentsEditor`, `AttachmentsView`, plus the global `index.css`.

**Phased:**
1. Tailwind + shadcn install/config; token layer (light+dark); base primitives (`components/ui/`); `theme-color` update.
2. App shell + navigation (desktop sidebar, mobile bottom-tabs + top bar + Sheet + New action).
3. Migrate views one at a time (List, Calendar, ItemEditor + sub-editors, Admin, Notification/Install, Attachments).
4. Consistency + dark-mode + responsive sweep (audit every view in light/dark at mobile + desktop widths).

## 7. Non-goals (explicit)

- **No** calendar-click-to-open; **no** custom-repeat — deferred follow-ons.
- **Zero** changes to auth, the reminder engine, the data model, the API, or any `src/worker/` code — **`web/src` (+ config: `tailwind.config`, `postcss`, `web/index.html` theme-color, `package.json` deps) only**.
- No new features or behavior changes. Pure presentation.

## 8. Testing / verification

- **Existing web component tests must still pass** (`ItemEditor.test.tsx`, `App.test.tsx`, `App.deeplink.test.tsx`, `NotificationSetup.test.tsx`, `InstallBanner.test.tsx`, `AttachmentsEditor/View.test.tsx`). Keep accessible text and roles stable so queries survive; update a test only where the markup it queries genuinely changes, and note why.
- `npm run typecheck` clean; `npm run lint` 0 errors (Tailwind class strings are fine; watch for any new hooks/exhaustive-deps).
- **QA:** visual review of every view in **light and dark**, at **mobile and desktop** widths, via the dev-auth shim + a browser. Confirm no behavior regression (create/edit/delete item, list selection, view switching, deep link, attachments upload/view, notification setup, admin roster). This is a big diff — QA's core job is "looks cohesive + nothing broke," not new-feature verification.
- No E2E or worker changes.

## 9. Deferred follow-ons (post-redesign, own branches)

1. `feat/calendar-click-details` — clicking a Calendar item opens its editor (reuse the new Dialog/Sheet).
2. `feat/custom-repeat` — weekday multi-select building RRULE `BYDAY` + optional `UNTIL`, shown only when the item repeats; confirm the engine's expansion handles the generated combinations.

## Process note

Per project workflow, the next step is the **architect** (plan → plan-review → Coder → QA), not a direct implementation. The architect turns this direction into a phased implementation plan with exact files, the full shadcn token set, and the test-preservation strategy.
