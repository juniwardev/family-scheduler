# QA Report — `dst-fallback-ambiguous-time` (branch `fix/dst-fallback-ambiguous-time`)

**Plan:** `docs/plans/dst-fallback-ambiguous-time.md` (v3, APPROVE)
**Impl notes:** `docs/plans/dst-fallback-ambiguous-time-impl-notes.md`
**Bug / investigation / review:** `docs/bugs/dst-fallback-ambiguous-time*.md`, `docs/reviews/dst-fallback-ambiguous-time-review.md`
**Head under test:** `f3316c1`. Working tree was clean before and after QA.

## Environment

- macOS, host timezone America/Los_Angeles (PST on the test date, 2026-11-13), so the real clock is the
  "winter" clock that triggers the original bug. Browser timezone confirmed `America/Los_Angeles`
  through `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- `NODE_EXTRA_CA_CERTS= npm run dev` (wrangler dev, `localhost:8787`), dev-auth shim as owner, local D1
  (`migrations apply --local`: "No migrations to apply").
- Browser: Playwright MCP (Chromium) for all UI work. Chrome DevTools MCP was not needed (no network
  timing / performance surface). `curl` against the real local API and `wrangler d1 execute --local`
  for exact epoch values and DB state.
- The scheduled/cron handler was NOT triggered. Items created had no reminders, so no dispatch rows
  existed. Dev log shows only the startup banner mention of the scheduled URL.
- Dev server stopped at the end (`pkill workerd`, port 8787 only has a lingering browser client socket).

## Summary verdict

**PASS WITH NITS.** Every acceptance criterion is met with evidence. Both Coder deviations are
explained correctly and hide no problem. Real Worker + D1 behaviour matches the plan to the exact
epoch. The nits are a pre-existing UI limitation seen during regression and a plan-text inconsistency.
No FAIL-level defect found.

## 1. Automated gates (independently re-run)

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | PASS | worker, web, e2e tsc all clean |
| `npm run lint` | PASS | 0 errors, 2 warnings (`push.ts:150`, `ItemListView.tsx:77`), both pre-existing and in untouched files |
| `NODE_EXTRA_CA_CERTS= npm test` | PASS | `Test Files 41 passed (41)`, `Tests 418 passed (418)` (baseline 389 + 29 new) |
| `npm run build` | PASS | vite build ok, `built in 942ms` |
| AC-5 `grep -nE "DateTime\.(fromObject\|local\|now)\(" src/worker/recurrence.ts` | PASS | no output (exit 1). Diff read: comments at all section 4.5 locations corrected; `wallClockToInstant` matches the plan algorithm; `Info.normalizeZone` + `isValid` check placed after the non-recurring return; `WINDOW_BUFFER_MS = DAY_MS`; real-instant filter retained |
| AC-6 `git diff --stat main -- src web e2e migrations wrangler.toml package.json package-lock.json tests` | PASS | exactly 4 files: `src/worker/recurrence.ts`, `tests/unit/recurrence.test.ts`, `tests/unit/recurrence-consumers.test.ts`, `tests/unit/occurrences-http.test.ts`. Tree clean, so no residual sabotage |
| AC-9 `grep -nE "(sendDue\|sendDailyDigest)\(" tests/unit/recurrence-consumers.test.ts` | PASS | 3 call sites (`:237`, `:252`, `:322`), all take `TEST_ENV`. `fetchMock.disableNetConnect()` present at `:170`. S9 below shows C0 goes red without it |
| AC-2 clock independence | PASS | DST cases run under CLOCK_S and CLOCK_W via `describe.each` with the pin in `beforeEach`; no assertion on the real date (test suite is green on today's PST date and the red-proof split is by clock, which also proves the pin reaches `src/`) |

### Red-proof on main's `recurrence.ts` (AC-3) — PASS

Method: throwaway `git worktree` (detached at HEAD, scratchpad), `git show main:src/worker/recurrence.ts`
over the source file only, `node_modules` symlinked, empty `dist/` created (wrangler asset check).
Command: `NODE_EXTRA_CA_CERTS= npx vitest run --project worker tests/unit/recurrence.test.ts tests/unit/recurrence-consumers.test.ts tests/unit/occurrences-http.test.ts`.

Result: `Tests 16 failed | 19 passed (35)`. The 16 red are exactly the plan section 7.4 list:
U1[CLOCK_W] (shown as existing "(ii)" test), U2[CLOCK_S], U3[CLOCK_W], U7, U8, U10, U11, U12, C1, C2, C3,
C5[CLOCK_W], C6 W->S, C6 S->W, C7, H1. Red/green split by clock confirms the pin is effective. The
worktree was removed afterwards (`git worktree list` shows only the main checkout).

## 2. Sabotage re-runs (S1, S4, S9) and the two deviations

All run in the scratchpad worktree on the fixed code, each reverted with `git checkout`; the real
working tree was never touched.

| Sabotage | Observed red | Plan prediction | Verdict |
|---|---|---|---|
| S1 `Math.min` to `Math.max` | 10 red: (ii)/U1, U2, U3 under both clocks (6), C5 both clocks (2), C6 x2 | U1, U2, U3, C5 | superset (C6) |
| S4 remove real-instant filter | 21 red | U9, C4 | superset |
| S9 remove `disableNetConnect()` | 1 red: C0 only | C0 | exact |

**Deviation 1 (S1 also turns C6 red): Coder's explanation is correct.** Plan section 7.3 C6 asserts
`keys` equals `[E1]`, so a resolver that returns E2 fails C6 on that assertion; plan section 7.5's
remark "C6 stays green under S1" holds only for the agreement part. It is a plan-text inconsistency,
not a test defect, and it does not weaken coverage (C6 is stricter than the plan said). No code
follow-up needed.

**Deviation 2 (S4 turns 21 tests red, not 2): Coder's explanation is correct.** Without the final
filter, the 24 h pre-filter buffer leaks out-of-window candidates into every output, so every exact
`toEqual` test with a bounded window fails (U7-U12, (i)/(ii), U2, U6, U14, C1, C6, C7, H1 observed).
This shows the filter is load-bearing and widely covered; it is not a hidden problem. One note:
U3/U5 are not in the red set because their windows contain every candidate, which is expected.

## 3. Real Worker + D1 behaviour (browser + API)

Items created through the real API (and one through the UI) in `America/Los_Angeles`, list "Test List",
no reminders. Window arguments are the browser-local month bounds the calendar uses.

| Check | Expected | Observed | Result |
|---|---|---|---|
| Daily 01:30 item (start `Date.UTC(2026,9,25,8,30)`), `GET /api/lists/:id/items` for Nov 2026 month `[1793516400000, 1796111999999]`: Nov 1 occurrence | E1 = `1793521800000` (08:30Z, 01:30 PDT), the earlier instant | `1793521800000`; Nov 2 = `1793611800000` (09:30Z, 01:30 PST, correct) | PASS |
| UI view modal for that Nov 1 occurrence | "Sun, Nov 1, 2026, 1:30 AM PDT" | exactly that | PASS |
| Same item created through the UI (start typed `2026-10-30T01:30`, Daily): Nov 1 occurrence | E1 | `1793521800000`, stored `start_at=1793349000000` | PASS |
| Whatever today's date: today is PST, so on `main` this value would have been E2 (`1793525400000`); the fix returns E1 | E1 | E1 | PASS (season-independence itself is proven by the pinned-clock unit tests, since the real clock cannot be changed in the browser) |
| Window drop, November 2026: daily 03:00 item, month view day 1 | present, first = `1793530800000` (Nov 1 03:00 PST), 30 occurrences | first `1793530800000`, `n=30`; UI calendar Nov 1 cell shows "QA day1 0300" and "QA fb 0130" | PASS |
| Window drop, March 2027: same 03:00 item, day 1 | first = `1803898800000` (Mar 1 03:00 PST), 31 occurrences | first `1803898800000`, `n=31`; UI calendar shows "QA day1 0300 — March 1" | PASS |
| Near-term occurrence ahead of the window start: daily 14:00 PST item, window `[now, now+8h]` with now `1794596674785` | `1794607200000` (Nov 13 14:00 PST = 22:00Z), 3 h ahead, previously dropped (Lost_start 6 h) | `[1794607200000]` | PASS |
| Spring-forward Mar 14 2027, daily 02:30 item (start Mar 10 02:30 PST), window Mar 13-15 | Mar 13 `1804933800000` (02:30 PST), Mar 14 `1805020200000` (gap shifted to 03:30 PDT = 10:30Z), Mar 15 `1805103000000` (02:30 PDT = 09:30Z) | `[1804933800000, 1805020200000, 1805103000000]` exactly; UI shows "Sun, Mar 14, 2027, 3:30 AM PDT" | PASS |
| Mar 2027 month for the spring item | 22 occurrences from Mar 10 | `n=22`, first `1804674600000` | PASS |

Screenshots: `docs/qa/screenshots/dst-nov2026-desktop.png`, `dst-mar2027-desktop.png`,
`dst-nov2026-calendar-390.png`, `dst-item-view-390.png`, `dst-list-after-archive-390.png`
(gitignored directory).

### Regression use (desktop 1280 and 390 px)

| Check | Result |
|---|---|
| Calendar month view, desktop and 390 px: renders recurring and non-recurring items, no horizontal overflow at 390 (`scrollWidth <= innerWidth`) | PASS |
| Create event through the UI with a Daily repeat | PASS (Create succeeded, item present in list and calendar, correct occurrences) |
| View item modal (recurring and non-recurring) | PASS |
| Complete a non-recurring task via the list checkbox | PASS (`completed_at` set) |
| Complete a recurring occurrence with a key via API (`occurrence_at = E1`), then un-complete | PASS (`item_occurrence_state` row `occurrence_at=1793521800000` written, then removed; key is the earlier instant) |
| Archive a past non-recurring item via the UI (confirm dialog accepted) | PASS (`archived_at` set). Archiving a future item is correctly rejected ("cannot be archived until its date has passed") |
| Console / network | only a favicon 404 and the expected 400 below; no other errors |

## 4. e2e (AC-7)

`git diff --stat main -- web` is empty (this branch changes only `src/worker/recurrence.ts` and three
test files), so `npm run test:e2e` is not mandatory per `CLAUDE.md` (mandatory only for branches
touching `web/src/**`). It was not run. Also, e2e intercepts every `/api/*` request and its fixtures
are non-recurring, so it could not observe this change anyway.

## Issues found

No FAIL-level defects.

1. **NIT (pre-existing, not caused by this branch), severity: low.** Ticking the "Mark complete" checkbox
   on a recurring item's list row returns `400 VALIDATION: occurrence_at is required for recurring
   items` (console shows the 400, UI gives no feedback beyond that). `db.ts` and `web/src/**` are
   untouched on this branch, so this is existing behaviour. Repro: create a daily task, open the list
   view, tick the checkbox. MCP: Playwright.
2. **NIT (documentation), severity: trivial.** Plan section 7.5 predicts C6 stays green under S1 and
   S4 turns only U9/C4 red; the observed behaviour (10 and 21 red) is the correct one. Suggest the
   plan text be aligned if it is reused. No code change.
3. **Observation, not a defect:** all-day recurring day-1 behaviour (plan 4.7) was not exercised with
   an all-day item in the browser (none exist in production). The 00:00-05:59 day-1 window loss is
   covered by U7/U8/U12 and H1, and the 03:00 item here showed day 1 on both months.
4. **Observation:** Local QA created fixture rows ("QA ..." items) in the gitignored local D1;
   nothing remote or committed was touched.

## Console errors and warnings

- Errors: `favicon.ico` 404 (pre-existing), one 400 on `/api/items/:id/complete` for the recurring
  list-row checkbox (nit 1).
- Warnings: `apple-mobile-web-app-capable` deprecation meta tag (pre-existing).

## Network failures and slow responses

None beyond the 404 and 400 above; all local API calls returned in single-digit milliseconds.

## Accessibility observations

Calendar cells and chips expose accessible names with the date ("QA fb 0130 — November 1"); dialogs
are exposed as `dialog` with headings. Nothing new from this branch (no `web/src` changes).

## Performance notes

Not measured (plan risk K4, CPU per cron tick, remains unmeasured as the plan states). Month-view
requests with several recurring items returned in single-digit ms locally.

## Safety confirmations

- Cron/scheduled handler never invoked; no email path reached.
- No deploys, no `--remote` D1 commands, no application/test/config edits.
- Report contains no personal data beyond fixture names.

PASS WITH NITS


## Re-verdict (after coordinator follow-up)

Checked without re-running the browser session:

- `git diff --stat main -- web src/worker/db.ts` is empty, so the list-row "Mark complete" 400 (nit 1)
  is outside this branch's diff. `docs/backlog.md` now carries it as a NEW, separately tracked bug.
  A defect that pre-exists and that this change neither causes nor touches does not count against
  this branch. It would only matter if the fix had altered that path, and it did not (the 400 comes
  from `db.ts:1147`, untouched).
- Plan §7.5 S1 and S4 rows and the v4 revision-log entry now state the observed red sets (S1: adds
  C6; S4: all exact-`toEqual` window tests, 21 red). That matches what I measured (10 and 21 red).
  It is documentation only, with no change to design, tests or ACs, so it changes none of my findings.
- Observation 3 (no all-day item exercised in the browser) is not a gap: the day-1 window loss is
  covered by U7, U8, U12 and H1, and was observed with a 03:00 item in two months. Production has
  no all-day recurring items. It does not block.

No unmet AC and no defect remains in this branch's scope, so the original nits are resolved or
out of scope. Verdict upgraded.

PASS
