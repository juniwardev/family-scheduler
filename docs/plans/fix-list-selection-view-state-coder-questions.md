# Coder questions: fix-list-selection-view-state

**Status:** Blocked partway through implementation. App-code changes are done and typecheck-clean; `App.test.tsx` (required by the plan's §8.1 / DC1-DC5) cannot mount and needs a plan amendment before I continue.

## What's done (in scope, verified)

1. `web/src/types.ts:77` — `AppView` extended to `"list" | "calendar" | "admin"`. Matches plan §5.1 exactly.
2. `web/src/App.tsx` — `showAdmin` deleted, `view` renamed to `activeView`, List/Calendar/Admin tab handlers, sidebar `onSelect`, and the render conditional all updated to switch on the single `activeView`. Matches plan §5.2-5.5 exactly (diffed line-for-line against the plan's code blocks).
3. `tests/setup/jsdom.setup.ts` — added the `window.matchMedia` stub exactly as specified in plan §8.0 (gated behind `typeof window.matchMedia !== "function"`).
4. `npm run typecheck` — clean (both `tsconfig.worker.json` and `tsconfig.web.json`).
5. Drafted `web/src/App.test.tsx` with DC1-DC4 per plan §8.1 (mocks `getMe`/`adminGetUsers`/`getItems`/`getOccurrences` via `vi.mock("./apiClient", ...)`, awaits `screen.findByRole("button", { name: "Admin" })` before interacting, per the async-mount note).

## The blocker: a SECOND unguarded browser API crashes `<App/>` in jsdom, independent of `matchMedia`

`App.tsx:60` renders `<InstallBanner />` unconditionally (sibling to the sidebar, always mounted — not gated by role or view). `InstallBanner.tsx:21` calls `localStorage.getItem("install-banner-dismissed")` **unguarded**, inside a `useEffect` that runs on every mount, with no `typeof localStorage !== "undefined"` check (unlike its own `isStandalone()` at `:9-15`, which IS guarded with `typeof window !== "undefined"`).

In this repo's jsdom Vitest project (jsdom 29.1.1, vitest 2.0.5, Node v26.4.0), `window.localStorage` is `undefined`:

```
(node:XXXXX) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
```

I confirmed this with a standalone probe test (`typeof window.localStorage` → `"undefined"`) and by constructing a raw `jsdom.JSDOM` directly (which DOES implement `localStorage` when given a `url`), so this is specifically a Vitest jsdom-environment + Node 26 interaction, not a jsdom limitation per se. I did not go further down that investigation since fixing the *environment* is out of scope for a Coder — flagging the *symptom* and the two fix shapes below instead.

Because `InstallBanner` throws inside a passive effect and there is no error boundary anywhere in the tree, React unmounts the ENTIRE `<App/>` tree on this error (`<body><div /></body>` is what's left). This means:

- It reproduces on EVERY `<App/>` render in a jsdom test — admin or member, regardless of `activeView`/`showAdmin`. It is unrelated to this plan's `activeView` change.
- It reproduces even with the plan's §8.0 `matchMedia` stub correctly in place (verified — the `matchMedia` stub is necessary but not sufficient).
- `App.test.tsx` cannot mount at all, so none of DC1-DC5 can run, and the plan's automated gate (§11: "the DC1-DC5 component tests as the automated gate") cannot execute — the same category of problem the plan's own M1 amendment addressed for `NotificationSetup`/`matchMedia`, just for a second component (`InstallBanner`) and a second unguarded API (`localStorage`).

Evidence (reproduced with current working-tree changes, i.e. §8.0 stub in place):

```
TypeError: Cannot read properties of undefined (reading 'getItem')
    at web/src/components/InstallBanner.tsx:21:36
    ...
The above error occurred in the <InstallBanner> component:
    at InstallBanner (web/src/components/InstallBanner.tsx:13:49)
    at div
    at App (web/src/App.tsx:18:49)
Consider adding an error boundary to your tree to customize error handling behavior.
```

Resulting `App.test.tsx` run: 4/4 tests fail, all with `Unable to find an accessible element with the role "button" and name "Admin"` (tree is empty).

I also confirmed the ONE pre-existing worker-project test failure (`tests/unit/dev-auth-shim.test.ts` — T4, "loopback host + DEV_AUTH_IDENTITY unset -> full verification -> 401") is unrelated to any of my changes: it reproduces identically with my changes fully `git stash`ed out. This looks like `DEV_AUTH_IDENTITY` leaking into the test process from the shell/`.dev.vars` environment rather than being unset, not something this plan touches. Per the guardrail on pre-existing unrelated bugs, I have NOT touched it and will record it as an out-of-scope observation in the impl notes once I'm unblocked — flagging it here too since it affects the "full `npm test` is green" done-condition.

## Why I'm stopping instead of fixing this myself

The plan's scope note (§5, m2) and checklist step 9 authorize exactly ONE test-infra change outside `web/src/` — the `matchMedia` stub in `tests/setup/jsdom.setup.ts` — and that specific stub went through two review passes (Pass 1 blocker M1, Pass 2 re-review confirming it's sufficient). Silently adding a second, un-reviewed polyfill (for `localStorage`) to the same shared setup file, or silently editing `InstallBanner.tsx` (which is explicitly not part of the plan's affected-files list — `App.tsx` + `types.ts` + `App.test.tsx` + `jsdom.setup.ts` only), would be scope creep the plan-reviewer hasn't seen, even though the shape of the fix is small and mechanical. Given "If the plan is wrong, ambiguous, or incomplete, stop and write a note... Do NOT silently improvise outside the plan," I'm stopping here rather than choosing a fix unilaterally.

## Proposed remediation options (for the Architect / plan-reviewer to choose, not me)

**Option 1 (parallel to the approved M1 pattern) — extend the `tests/setup/jsdom.setup.ts` stub to also cover `localStorage`.** Same file already touched by the approved plan; same rationale the plan already accepted for `matchMedia` ("one shared place, benefits all current/future jsdom component tests"). A minimal in-memory `Storage` polyfill (`getItem`/`setItem`/`removeItem`/`clear`/`key`/`length`), gated behind `if (typeof window.localStorage === "undefined")`, mirrors the existing stub's structure and would let both `InstallBanner` and `NotificationSetup` mount harmlessly.

**Option 2 — guard the call site in `InstallBanner.tsx`.** Add a `typeof localStorage !== "undefined"` (or `typeof window !== "undefined" && window.localStorage`) guard around the `:21` read (and the `:53` write), mirroring the pattern already used for `isStandalone()` in the same file (`:11`). This is a one-line defensive-coding fix to actual app code, which is arguably a legitimate hardening (unguarded global access is fragile in any non-browser host, not just tests) but is explicitly outside this plan's "Locked / do not touch" list ("Don't redesign component internals beyond the view-state fix... Keep the diff focused to the plan's affected-files list") and outside its non-goals framing.

**Option 3 — mock `InstallBanner` (or `localStorage`) only inside `App.test.tsx`** via `vi.mock("./components/InstallBanner", () => ({ InstallBanner: () => null }))` or `vi.stubGlobal("localStorage", ...)` in a `beforeEach`. Narrowest blast radius (touches only the new test file, nothing shared), but reintroduces exactly the downside the plan's own M1 §8.0 rationale rejected for `matchMedia` — a one-off fix that doesn't help any other future jsdom test that mounts `InstallBanner` or `App`.

I lean toward Option 1 for consistency with the already-approved pattern, but I'm surfacing the tradeoff per the "surface tradeoffs rather than silently picking one" instruction rather than deciding it myself.

## What I need to proceed

An amendment to `docs/plans/fix-list-selection-view-state.md` (or explicit owner sign-off) choosing one of the above, ideally re-reviewed the same lightweight way M1 was (Pass 1 blocker → Pass 2 confirm). Once that's resolved I can finish `App.test.tsx`, run the DC1 genuine-guard sanity check (temporarily revert the `App.tsx` sidebar `onSelect` change and confirm DC1 fails, then restore), run the full `npm test` + `npm run typecheck`, and commit per the task's Process section.

## Current working-tree state (uncommitted)

- Modified: `web/src/App.tsx`, `web/src/types.ts`, `tests/setup/jsdom.setup.ts` — all match the approved plan exactly, typecheck-clean.
- Untracked: `web/src/App.test.tsx` (drafted per plan §8.1, currently failing 4/4 for the reason above — not because of a defect in the test or the fix, but because the tree can't mount at all).
- Untracked (not yet staged): `docs/bugs/list-selection-view-state.md`, `docs/bugs/list-selection-view-state-investigation.md`, `docs/plans/fix-list-selection-view-state.md`, `docs/reviews/fix-list-selection-view-state-review.md` — per the task's Process section these travel with the eventual commit.
- Nothing has been committed.
