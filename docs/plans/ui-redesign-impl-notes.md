# Implementation notes: `feat/ui-redesign`

Coder implementation of `docs/plans/ui-redesign.md` (round-2 APPROVE in
`docs/reviews/ui-redesign-review.md`). Base branch: `feat/ui-redesign`, starting commit
`7e2c97a` (docs: UI direction spec). All work committed per-phase on `feat/ui-redesign` — no new
branch created (the plan specified working directly on the already-checked-out branch).

## 1. Phase-1 spike result

`web/src/RadixSpike.test.tsx` (kept, see §7 below) mounts a shadcn `Dialog` + `Select` + `Tabs`
under the jsdom "web" Vitest project and drives each via `user-event`:

- **Tabs**: mounts with default tab content visible; clicking the "Two" tab trigger switches to
  the second panel — passes.
- **Select**: opens via click on the trigger, `SelectItem` options are queryable by
  `role="option"`, clicking an option updates the trigger's displayed value — passes.
- **Dialog**: mounted `open`, closing it via an in-content button that flips `open` to `false`
  removes the dialog's content from the DOM, asserted via `waitFor` — passes without hanging on
  any `animationend` event (jsdom never fires one). This proves the vendored shadcn
  `Dialog`/`Sheet` (Radix) unmount is **state-driven**, not animation-gated.

**Exact polyfills used** (appended to `tests/setup/jsdom.setup.ts`, all gated with
`if (!...)` so they never clobber a real implementation): `ResizeObserver` (no-op class),
`Element.prototype.hasPointerCapture`/`setPointerCapture`/`releasePointerCapture` (no-op),
`Element.prototype.scrollIntoView` (no-op), `Element.prototype.scrollTo` + `window.scrollTo`
(no-op), a `DOMRect` global fallback (with `toJSON`), `window.PointerEvent` aliased to
`MouseEvent` (no real `pointerId` was needed — the alias was sufficient), and a
`prefers-reduced-motion: reduce` override layered onto the existing `matchMedia` stub
(belt-and-suspenders per Decision 3/B2, on top of the already-proven state-driven unmount).

**No polyfill beyond the plan's pre-listed set was needed.** The spike passed on the first
attempt after fixing a test-harness bug on my end (the Dialog defaulted to `open=true`, so Radix's
focus-trap/`aria-hidden` correctly hid the Tabs/Select behind it from the accessibility tree —
not a polyfill gap, just an ordering issue in the harness; fixed by making the harness mount the
Dialog closed for the Tabs/Select assertions and only opening it for the Dialog-unmount
assertion).

## 2. B1 proof — did `App.deeplink.test.tsx` pass unchanged?

**Yes — verified twice**, per the plan's mandatory gate:

1. After Phase 2 (App shell restyle only, editor not yet moved): ran `App.deeplink.test.tsx`
   unchanged — all 3 tests passed, including NEW-1 (Calendar→List round-trip does not reopen).
2. After the editor-move commit (Phase 3, `4e45568`): ran `App.deeplink.test.tsx` unchanged again
   — all 3 tests still passed. `git diff` confirms this file was never edited in this branch.

The structural choice honored throughout: `showCreate`/`editingItem` remain `useState` local to
`ItemListView`; the Dialog/Sheet is rendered inside `ItemListView`'s own render tree; `App.tsx`'s
conditional view-swap (`activeView === "admin" ? <AdminPanel/> : activeView === "calendar" ?
<CalendarView/> : <ItemListView/>`) is byte-for-byte the same three-way conditional as the
pre-work code, just reformatted with Tailwind classes around it. `ItemListView` still unmounts
whenever `activeView !== "list"`.

Also verified: `ItemEditor.test.tsx`'s exact-once `onCancel` assertion (`toHaveBeenCalledTimes(1)`)
passed unchanged both before and after the editor-move — `ItemEditor` was never given a modal
wrapper of its own; the Dialog/Sheet wrapper lives exclusively in `ItemListView`.

## 3. Files changed by phase

**Phase 1 — foundation** (commit `64cc2fe`):
- `package.json`, `package-lock.json` — new deps (see §4)
- `components.json`, `postcss.config.js`, `tailwind.config.ts` — new, repo root
- `web/src/index.css` — `@tailwind` directives + full light/dark HSL token layer added; legacy
  `.btn*`/`.sidebar`/`.app-layout`/`.error-banner`/`.loading` kept temporarily
- `web/index.html`, `web/manifest.webmanifest` — theme-color → teal light/dark pair
- `vite.config.ts`, `tsconfig.web.json`, `vitest.workspace.ts` — `@` alias added in all three
  places
- `tests/setup/jsdom.setup.ts` — Radix polyfills + reduced-motion override appended
- `web/src/lib/utils.ts` — `cn()` helper (new)
- `web/src/components/ui/{button,card,input,label,textarea,dialog,sheet,select,tabs}.tsx` — new,
  hand-vendored (see §4 note on why not `npx shadcn add`)
- `web/src/RadixSpike.test.tsx` — new, Phase-1 exit-gate spike

**Phase 2 — shell + nav** (commit `69cfdce`):
- `web/src/App.tsx` — responsive shell (desktop sidebar / mobile top-bar + bottom-tabs), same
  `activeView` state + view-swap + deep-link one-shot
- `web/src/components/ItemListView.tsx` — added optional `createRequestToken` prop (routes the
  mobile "+ New" button through the existing local create-flow instead of lifting state)
- `web/src/App.test.tsx` — DC2's two `toHaveClass("btn-outline")` assertions →
  `toHaveAttribute("aria-current", "page")` / `not.toHaveAttribute("aria-current")` (the one
  sanctioned edit)
- `web/src/components/ui/{separator,tooltip,badge}.tsx`, `web/src/hooks/useMediaQuery.ts` — new
- `web/src/index.css` — removed now-fully-unused `.app-layout`/`.sidebar`/`.main-content`

**Phase 3 — per-view migration** (commits `d5c9655`, `39b9c32`, `a1a86e6`, `0d0dcb2`, `cef5c31`,
`cbc77b3`, `4e45568`):
- `web/src/components/ListSidebar.tsx`
- `web/src/components/CalendarView.tsx`
- `web/src/components/AdminPanel.tsx`
- `web/src/components/InstallBanner.tsx`
- `web/src/components/NotificationSetup.tsx`
- `web/src/components/AttachmentsView.tsx`, `web/src/components/AttachmentsEditor.tsx`
- `web/src/components/ItemListView.tsx` (rows restyled + editor moved into responsive Dialog/Sheet)
- `web/src/components/ItemEditor.tsx`, `web/src/components/ReminderEditor.tsx`,
  `web/src/components/RecurrenceEditor.tsx`
- `web/src/index.css` — removed now-fully-unused `.btn`/`.btn-*`/`.error-banner` (fixed a
  `*/`-inside-comment CSS syntax break introduced by my own edit here — caught by `vite build`,
  not vitest; see §6)

**Phase 4 — sweep** (commit `50ac798`):
- `web/src/App.tsx` — one stale-comment fix (no functional change)
- Verification-only otherwise (M3 grep gate, theme-color pair, inline-style sweep, SW precache
  check) — see §6.

## 4. New dependencies installed

**`dependencies`** (runtime): `tailwindcss-animate@^1.0.7`, `class-variance-authority@^0.7.1`,
`clsx@^2.1.1`, `tailwind-merge@^3.6.0` (plan said `^2`; npm resolved `^3` — no API break used),
`lucide-react@^1.24.0` (plan's guessed `^0.4xx` was stale; current major is `1.x` — same icon API
used), `@radix-ui/react-dialog`, `@radix-ui/react-select`, `@radix-ui/react-tabs`,
`@radix-ui/react-label`, `@radix-ui/react-separator`, `@radix-ui/react-tooltip`,
`@radix-ui/react-slot` (pulled in explicitly via `npm install`, not via `npx shadcn add` — see
deviation note below).

**`devDependencies`** (build-time): `tailwindcss@^3.4.19`, `autoprefixer@^10.5.2`,
`postcss@^8.5.17`.

No other script/tooling changes.

## 5. Typecheck / lint / test results

- `npm run typecheck` — clean (both `tsconfig.worker.json` and `tsconfig.web.json`) at every
  phase boundary and at the final state.
- `npm run lint` — **0 errors** throughout. Warning count: baseline was 4 pre-existing warnings
  (`push.ts` unused-disable, `App.tsx`/`ItemListView.tsx`/`RecurrenceEditor.tsx` exhaustive-deps);
  final state has 2 (`push.ts`, `ItemListView.tsx`) — the `App.tsx` and `RecurrenceEditor.tsx`
  warnings disappeared as a side effect of the restyle (no behavior change; the effects'
  dependency arrays are unchanged in substance).
- `npm test` — **all green** at every phase boundary. Final count: **178/178** (174 baseline +
  4 new spike tests in `RadixSpike.test.tsx`; the App.test.tsx edit changed assertions, not test
  count). Worker project (25 test files, 174 tests) completely untouched and green throughout.
- `npx vite build` — production build succeeds (verified at Phase 3's editor-move commit and
  again at the final state); emits a real compiled Tailwind CSS bundle (~26.6 kB, ~5.8 kB gzip).

## 6. Confirmation: frontend-only, `.dark`-grep clean

- `git diff 7e2c97a..HEAD --stat -- src/ tests/ wrangler.toml migrations/ .github/` → **empty**
  except `tests/setup/jsdom.setup.ts` (the one sanctioned test-infra file, additions only). Zero
  edits to `src/worker/`, `src/shared/`, migrations, `wrangler.toml`, or any `.github/workflows/*`.
- `grep -rn "\.dark" web/src/components/ui web/src/index.css` → returns only two comment lines
  documenting the gate itself (in `index.css`'s header comment); no live `.dark` class selector
  anywhere. Re-verified at the end of Phase 1, Phase 3, and Phase 4.
- Full diff-stat against the pre-work commit (`7e2c97a`) touches exactly: `components.json`,
  `postcss.config.js`, `tailwind.config.ts` (new, root), `package.json`/`package-lock.json`
  (deps), `tsconfig.web.json`/`vite.config.ts`/`vitest.workspace.ts` (alias), `web/index.html`,
  `web/manifest.webmanifest`, `web/src/**` (components/hooks/lib/ui + index.css + App.tsx +
  App.test.tsx + the new RadixSpike.test.tsx), and `tests/setup/jsdom.setup.ts`. Matches the
  plan's declared scope surface exactly (plan §2 non-goals list).

## 7. Deferred / notes / one test file beyond App.test.tsx

- **Calendar-click-to-open and custom-repeat**: correctly out of scope, untouched (deferred
  per spec §9 to their own follow-on branches). `RecurrenceEditor`'s existing freq/interval/
  byday/end build/parse logic is restyled only, logic byte-identical.
- **`web/src/RadixSpike.test.tsx` kept, not removed.** The plan left this as the Coder's call
  ("may be removed or kept as a smoke test after it passes — your call, note it"). I kept it as a
  cheap regression guard for the Radix-in-jsdom wiring (polyfills + alias + state-driven unmount)
  — if a future dependency bump silently breaks any of those, this file fails fast with a clear
  signal, rather than surfacing as a confusing failure inside an unrelated view's test. This is
  the **only test file beyond `App.test.tsx`** that differs from the pre-work tree, and it is a
  wholly new file (not an edit to an existing test), so it does not violate the "exactly one file
  edited" invariant for pre-existing tests.
- **shadcn CLI was not invoked (`npx shadcn add ...`).** I hand-vendored the `ui/*` primitives
  instead of running the CLI. Reason: the available `shadcn` CLI resolved to v4.13.0, whose
  default `init`/`add` scaffolding targets Tailwind v4 conventions (CSS-first `@theme`,
  `@custom-variant dark`), which would have fought the plan's explicit Tailwind v3.4 + `darkMode:
  'media'` + hand-authored HSL token block requirement (Decision 1). Hand-vendoring let me pin the
  file contents to the plan's exact `new-york`-style, v3-targeting shadcn source (which is what
  the CLI would produce under a v3 project) without a version-mismatch risk. All vendored files
  are self-contained and committed, matching spec §1 ("shadcn components are copied into
  `web/src/components/ui/`, not an npm import").
- **`lucide-react` and `tailwind-merge` resolved to newer majors than the plan's placeholder
  versions** (`^1.24.0` vs the plan's guessed `^0.4xx`; `^3.6.0` vs the plan's guessed `^2`). Both
  are drop-in for the APIs actually used (icon components; `twMerge()`); no code changes were
  needed to accommodate either. Noted here since the plan's exact version strings were
  illustrative, not pinned.
- **`dist/` must exist locally for `npm test` to pass** (the worker Vitest project's Wrangler
  Static Assets binding requires the directory to exist, independent of this migration — a
  pre-existing project characteristic, not something introduced here). I discovered this when I
  ran `rm -rf dist` to clean up a sanity build and the next `npm test` failed with an unrelated
  Wrangler config error; `npx vite build` restored it. Not a plan deviation, just a note for
  whoever runs this locally after a clean clone: run `npm run build` (or `npm run dev`, which
  builds first) before `npm test` if `dist/` doesn't already exist.
- **CSS-only bug I introduced and fixed within the same commit**: while trimming dead legacy CSS
  in Phase 3, a comment I wrote contained the literal substring `.btn-*/.error-banner`, whose
  `*/` prematurely closed the CSS block comment it was inside, breaking `vite build` (PostCSS
  parse error) while `npm test` stayed green throughout (Vitest never parses `index.css`). Caught
  by manually re-running `vite build` as a sanity check before the Phase-3 commit; fixed in the
  same commit (rewrote the comment to avoid the `*/` substring). Flagging this because it is a
  gap in the plan's own verification checklist — `vitest`'s green status does not guarantee the
  production CSS bundle compiles — and I added an explicit `vite build` check to my own workflow
  from that point forward (also re-run at the final state, confirmed clean).

## Out-of-scope observations (not fixed, filed here per guardrails)

- The two pre-existing `react-hooks/exhaustive-deps` **warnings** that remain
  (`web/src/components/ItemListView.tsx`'s `getItems` effect missing `onItemsChange`, and
  `src/worker/channels/push.ts`'s unused eslint-disable) predate this branch and are unrelated to
  the UI redesign; left untouched per the "presentation-only, no adjacent fixes" guardrail.
- `ItemListView.tsx`'s list-visibility/delete icon-toggles in `ListSidebar.tsx` use
  `role="button"` `<span>`s (keyboard-accessible via `onKeyDown`) rather than native `<button>`,
  because they are nested inside the row's own native `<button>` (an interactive element cannot
  contain another interactive element per HTML semantics) — this is a structural necessity of
  moving the whole row to a single clickable `<button>` for accessible-name/keyboard support, not
  a shortcut; no existing test depended on their prior nested-`<button>` DOM shape.
