# Impl notes — `docs/plans/dst-fallback-ambiguous-time.md` (v3)

**Status:** implemented per plan §9, on branch `fix/dst-fallback-ambiguous-time`. Base: `main`
(`f50a872`); the branch started at `0cce263` (plan v3 + review). Committed, not pushed.

**Review verdict consulted:** `docs/reviews/dst-fallback-ambiguous-time-review.md`, APPROVE (round 3).

## Files changed

- `src/worker/recurrence.ts`
  - `wallClockToInstant` (`:33`): explicit, clock-independent resolver (A1). Overlap takes the
    earlier instant, gap shifts forward.
  - `WINDOW_BUFFER_MS = 24 h` (`:28`, used `:96-97`): replaces the 2 h buffer.
  - `Info.normalizeZone(tz)` plus `if (!zone.isValid) return [];` after the non-recurring return
    (`:73-74`).
  - `wallClockToInstant(candidate.getTime(), zone)` (`:113`); real-instant filter kept (`:116`).
  - Comments corrected at each §4.5 location. No call to `DateTime.fromObject`/`local`/`now`
    remains (grep per AC-5 is empty).
- `tests/unit/recurrence.test.ts` — existing (i)/(ii) now run under both pinned luxon clocks with
  exact `toEqual`; added U2, U3, U5-U14. Pin is set in `beforeEach` inside `describe.each`;
  `afterEach` restores `Settings.now`.
- `tests/unit/recurrence-consumers.test.ts` (new) — C0-C7, with the F1 network layers.
- `tests/unit/occurrences-http.test.ts` (new) — H1.

No change to `web/src`, `e2e`, migrations, `wrangler.toml`, `package*.json`, `.dev.vars`, `db.ts`.

## Commands

    NODE_EXTRA_CA_CERTS= npm test
    NODE_EXTRA_CA_CERTS= npx vitest run --project worker tests/unit/recurrence.test.ts tests/unit/recurrence-consumers.test.ts tests/unit/occurrences-http.test.ts
    npm run typecheck && npm run lint && npm run build

## Baseline (step 2, unmodified code, today = Nov 13 2026, PST)

`Test Files 1 failed | 38 passed (39)`, `Tests 1 failed | 388 passed (389)`. The one failure is
existing test (ii) (`expected [ 1793435400000, 1793525400000, … ] to include 1793521800000`): the bug.

## F1 safety (real-email guard)

Layers in place before any sending test ran: `TEST_ENV` (dummy key and sender) on all three send
calls (`recurrence-consumers.test.ts:237,252,322`), `fetchMock.activate()` +
`disableNetConnect()` first in `beforeEach`, and a `vi.spyOn(globalThis, "fetch")` capture. C0 was
run alone (`-t C0`) and was green before any other consumer test ran. Observed C0 error:
`MockNotMatchedError | Mock dispatch not matched for path '/': subsequent request to origin
https://example.invalid was not allowed (net.connect disabled)`; C0 asserts on `net.connect disabled`.
Capture method: the `vi.spyOn(globalThis, "fetch")` spy works under workerd (C2, C7 read bodies from
it); no `fetchMock` interceptor fallback was needed.

## Red-proof (step 4, unfixed `src/`, tests committed-to-be)

Command: `NODE_EXTRA_CA_CERTS= npx vitest run --project worker tests/unit/recurrence.test.ts
tests/unit/recurrence-consumers.test.ts tests/unit/occurrences-http.test.ts`

`Test Files 3 failed (3)`, `Tests 16 failed | 19 passed (35)`. Matches §7.4 exactly:

- RED (16, all on a wrong or missing value): U1[CLOCK_W] (`[…, 1793525400000, …]` vs `1793521800000`),
  U2[CLOCK_S], U3[CLOCK_W], U7, U8, U10, U11, U12 (each `expected [] to deeply equal [ … ]`),
  C1, C2, C3 (row set `[]`), C5[CLOCK_W] (row at E2), C6 S->W (row created), C6 W->S, C7
  (`[ 'Sat, Nov 14, 2026, 8:00 AM PST' ]`, one line), H1 (29 values, Jun 1 missing).
- GREEN (19): U1[S], U2[W], U3[S], U4 x2, U5 x2, U6 x2, U9, U13, U14, C0, C4, C5[S], and the
  4 existing tests (iii), N6, non-recurring x2.
- The pin reached `src/`: the red/green split is by clock, as §7.4 requires.
- Observation: C6 W->S fails at the `keys` assertion (`expected [ 1793525400000 ] to deeply equal
  [ 1793521800000 ]`) under the unfixed code, rather than at the dispatch-row assertion. Still a
  value failure and still red; S->W fails at the row assertion.

## Green run (step 8, fixed code)

`Test Files 41 passed (41)`, `Tests 418 passed (418)` (389 baseline + 29 new: 18 in
`recurrence.test.ts`, 10 in `recurrence-consumers.test.ts`, 1 in `occurrences-http.test.ts`).

## Sabotage (step 9; each applied to the fixed code, run, then reverted with `git checkout`)

| Id | Result observed (red tests) |
|---|---|
| S1 `Math.max` | U1, U2, U3 under both clocks (6), C5 both clocks, C6 x2. 10 red. **Plan §7.5 predicts C6 stays green under S1; it goes red because C6 also asserts `keys` equals `[E1]` (§7.3).** Not a defect, a plan inconsistency |
| S2 gap uses `offAfter` | U4 (i) and U6, both clocks. 4 red |
| S3a buffer 2 h | U7, U8, U10, U11, U12, C1, C2, C3, C7, H1. 10 red, exactly the listed set |
| S3b buffer 13.5 h | U11 only |
| S3c buffer 10.5 h | U11, U12 |
| S4 no real-instant filter | U9 and C4 red as listed, plus 19 more (every test that depends on the filter dropping the +-24 h buffer candidates). 21 red. Superset of the plan |
| S5 no dedupe | U5 both clocks |
| S6 old `DateTime.fromObject` resolver, window fix kept | U1[W], U2[S], U3[W], C5[W], C6 x2. Exactly the listed set |
| S7 remove `AND fire_at > ?` and its bind in `db.ts` | C3 only, on the assertion (`expected [ { …(3) } ] to deeply equal [ { …(3) } ]`, status `sent` vs `pending`; the send went to the spy, offline). No bind exception |
| S8 `IANAZone.create(tz)` | U14: `expected [] to deeply equal [ 1780286400000, 1780372800000 ]`. As predicted (`IANAZone` rejects `"UTC+5"`) |
| S9 remove `disableNetConnect()` | C0: `expected [Function] to throw error matching /net\.connect disabled/ but got 'internal error'`. The request was to `.invalid`, so nothing left the machine |

Each sabotage was reverted by `git checkout -- src tests`; `git status --short` was empty after every
run, so no residual diff in `src/worker/db.ts` or the consumer test's `beforeEach`.

## Final gates

- `npm run typecheck`: pass (worker, web, e2e).
- `npm run lint`: 0 errors, 2 warnings (both pre-existing: `push.ts:150`, `ItemListView.tsx:77`).
- `NODE_EXTRA_CA_CERTS= npm test`: 41 files, 418 tests, 0 failures.
- `npm run build`: pass.
- AC-5 grep `DateTime\.(fromObject|local|now)\(` on `recurrence.ts`: no output.
- AC-9 grep of `(sendDue|sendDailyDigest)\(` in the consumer test: 3 call sites, all `TEST_ENV`.

## AC checklist (code-verifiable ones)

| AC | Result |
|---|---|
| AC-1 gates | pass (418 vs baseline 389) |
| AC-2 clock-independent | pass (every DST case runs under CLOCK_S and CLOCK_W; no real-date assertion) |
| AC-3 red-proof | pass, see above |
| AC-4 sabotage | pass, see table (S1, S4 differ from the plan's lists as noted) |
| AC-5 no calls | pass |
| AC-6 path-filtered diff | pass, see below |
| AC-7 e2e | not required (no `web/src` change); not run |
| AC-8 browser day-1 check | not run (QA, local) |
| AC-9 no real-send path | pass |

AC-6, run on the committed branch:
`git diff --stat main -- src web e2e migrations wrangler.toml package.json package-lock.json tests`
lists only `src/worker/recurrence.ts`, `tests/unit/recurrence.test.ts`,
`tests/unit/recurrence-consumers.test.ts`, `tests/unit/occurrences-http.test.ts`.

## Deviations

- None in design or scope. Two plan-text inconsistencies observed (S1/C6 and S4's superset) are
  recorded above; no code change followed from either.
- U3's expected array is built from the E3/E4 start constants with an offset of 60 min rather than
  as a hand-written literal; the value set is the plan's.

## Out-of-scope observations

- OQ-1 (UNTIL semantics), OQ-2 (lint rule), OQ-3 (design-doc D10/D11 wording), OQ-6 (repo-wide
  `fetchMock` guard) remain as the plan lists them. Not touched.
- No production query (Q-0 ... Q-I) or R-1/R-2 was run (DevOps steps).

## Bug fix verification approach

Follows the bug report's steps to reproduce (`docs/bugs/dst-fallback-ambiguous-time.md`):
1. On `main` (date in PST, or with the pinned clock), `expandOccurrences` for a daily 01:30 LA item
   across Nov 1 2026 returns the later instant (1793525400000); `recurrence.test.ts` (ii) fails.
2. On this branch the same call returns 1793521800000 whichever season the code runs in. Verify with
   `NODE_EXTRA_CA_CERTS= npx vitest run --project worker tests/unit/recurrence.test.ts` (U1, both clocks).
3. For the window defect: a daily 03:00 PDT item's June 1 occurrence is missing from the calendar
   response on `main` and present here (H1), and AC-8 shows it on day 1 of the next month in an
   `America/Los_Angeles` browser.
