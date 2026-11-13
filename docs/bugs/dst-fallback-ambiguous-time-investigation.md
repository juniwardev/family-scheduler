# Investigation: ambiguous fall-back times resolve by the date the code runs

**Bug slug:** `dst-fallback-ambiguous-time`
**Investigated:** 2026-11-13, on `main` (f50a872)

While tracing this bug a second, larger defect turned up in the same function: the query window
is filtered in the wrong coordinate space, so occurrences in the first ~5–6 hours of any query
window are silently dropped. It is not in the original report. It is documented separately below
("Second defect") because it affects the calendar, the daily digest and reminder materialization,
and it would not be caught by the fix for the reported bug.

## Root cause statement

`expandOccurrences` (`src/worker/recurrence.ts:30-109`) maps each expanded wall-clock candidate
to UTC with `DateTime.fromObject({...}, { zone: tz })` (`src/worker/recurrence.ts:80-90`). In
luxon 3.7.2, `fromObject` takes its provisional offset from the zone's offset at
`Settings.now()` (`node_modules/luxon/src/datetime.js:800-803`), and `fixOffset`
(`node_modules/luxon/src/datetime.js:102-125`) returns the first self-consistent candidate. An
ambiguous wall-clock time (01:00–01:59 on fall-back night) is self-consistent under both offsets,
so the instant chosen is whichever offset was in effect at the clock time when the code runs. The
comments at `src/worker/recurrence.ts:9` and `:92-94` ("choose the earlier of the two instants
(luxon default)") are incorrect for the installed luxon version. The `fixOffset` source comment
at `node_modules/luxon/src/datetime.js:101` says the guessed offset "determines which offset
we'll pick in ambiguous cases", which is the behaviour observed.

## Why the bug occurs

The mechanism, for local wall time 2026-11-01 01:30 in `America/Los_Angeles`:

1. `fromObject` computes the provisional offset `o` from `Settings.now()`.
2. It forms `utcGuess = localTS - o`.
3. It checks `tz.offset(utcGuess)` against `o`. If they match, it returns `utcGuess`.

- Clock in PDT (`o` = -7h): `utcGuess` = 08:30Z. `tz.offset(08:30Z)` = -7h, which matches. Result: 08:30Z (01:30 PDT).
- Clock in PST (`o` = -8h): `utcGuess` = 09:30Z. `tz.offset(09:30Z)` = -8h, which matches. Result: 09:30Z (01:30 PST).

Both answers are self-consistent, so luxon never has a reason to prefer one. The choice is made by
the clock. Nothing in `recurrence.ts`, its test, or the `luxon` pin (`^3.5.0` in `package.json`,
resolved to 3.7.2 in `package-lock.json`) has changed since the initial scaffold (commit
`15c6df3`). The only input that changed between the passing run (2026-09-21, PDT) and the
failing run (2026-11-13, PST) is the clock.

The spring-forward gap does not have this problem. For local 02:30 on 2026-03-08 the
provisional offset leads to a "hole" in `fixOffset` (`datetime.js:123-124`), which returns
`localTS - min(o2, o3)`. That value does not depend on the guess, so the result is 10:30Z
(03:30 PDT) in both seasons.

## Second defect: the window pre-filter compares wall-clock time with real UTC

`expandOccurrences` builds the RRULE with `DTSTART` set to the item's wall-clock time encoded as
UTC (`src/worker/recurrence.ts:48-57`, `:67`). `rule.between(...)` therefore returns candidates
whose UTC fields are the local wall-clock time. The window is applied to those candidates with a
2 h buffer (`src/worker/recurrence.ts:61-63`, `:73`). Only after that is each candidate mapped to
its real instant (`:80-98`), and the real-instant filter is applied last (`:102`).

A candidate with wall-clock `W` has real instant `W + 7h` (PDT) or `W + 8h` (PST) in LA. It passes
the pre-filter only if `W >= windowStart - 2h`, which means its real instant must be at least
`windowStart + 5h` (PDT) or `windowStart + 6h` (PST). Occurrences with real instants in
`[windowStart, windowStart + 5h)` (or `+6h` in PST) are dropped before the timezone mapping runs.
The 2 h buffer was intended for DST shifts of ±1 h, but the offset between the two spaces is 7–8 h.

Probe (Node, bundled from `src/worker/recurrence.ts`): daily 12:00 PDT item, window start
measured before the Jun 15 12:00 PDT occurrence (19:00Z):

| window start | hours before occurrence | included |
| --- | --- | --- |
| 10:00Z | 9.0 | yes |
| 13:00Z | 6.0 | yes |
| 14:00Z | 5.0 | yes |
| 14:30Z | 4.5 | **no** |
| 15:00Z | 4.0 | **no** |
| 18:30Z | 0.5 | **no** |

## Answers to the open questions in the report

1. **Spring-forward gap.** Date-independent. Local 02:30 on Mar 8 resolves to 10:30Z (03:30 PDT)
   for a clock in PST and for a clock in PDT. A sweep of every 15-minute slot in 2026 gives
   identical results for the two clocks in every gap slot. It matches D10 and test (i)
   (`tests/unit/recurrence.test.ts:16-36`).
2. **Which callers persist the resulting instants.** Yes, one:
   - `src/worker/reminders/materialize.ts:54-83` writes `reminder_dispatch.occurrence_at` and
     `fire_at` via `insertDispatchIgnore` (`src/worker/db.ts:1377-1393`). The unique key is
     `(item_reminder_id, occurrence_at, channel, recipient_email)`, so a season-dependent
     `occurrence_at` would create a second row and a second reminder. `send.ts` selects by
     `fire_at` only (`src/worker/db.ts:1401-1415`, `src/worker/reminders/send.ts:35`) and does not
     recompute occurrences.
   - Completion stores the client-supplied `occurrence_at` in `item_occurrence_state`
     (`src/worker/db.ts:1156-1158`, `:1167`). The client gets that value from the calendar read
     (`web/src/components/CalendarView.tsx:247`), which is computed at read time by
     `src/worker/routes/items.ts:77-84`. Materialize skips completed occurrences by exact
     millisecond match (`materialize.ts:67`, `db.ts:1361-1373`), and the pending-dispatch purge
     matches by exact value (`db.ts:1502`). A completion recorded from a view that rendered the
     other-season instant would not match the stored dispatch row.
   - The daily digest (`src/worker/reminders/send.ts:249-256`) also computes instants at run time,
     but nothing is persisted from it.

   **Does production actually hit the ambiguity?** Not in this geometry, by luck rather than
   design. `LOOKAHEAD_DAYS` is 60 (`src/worker/config.ts:8`), so a fall-back occurrence first
   enters the materialize window about 60 days ahead, in September when PDT is in effect. That
   first insert stores 08:30Z. Later PST-clock ticks cannot add a second row, because the window
   defect above drops the 09:30Z candidate once `now` passes about 03:30Z on Nov 1. Simulation
   (materialize every 5 minutes, daily 01:30 item, 15-minute reminder, real `expandOccurrences`
   bundle with the tick time injected as the clock) produced exactly one dispatch row for the Nov 1
   slot, `occurrence_at=08:30Z`. A zone or lookahead for which the first insert happens in
   standard time would store the later instant. Not checked against production data.
3. **Other zone-aware construction in `src/` or `web/src/`.**
   - `src/worker/recurrence.ts:43` uses `DateTime.fromMillis(startAt, { zone: tz })`. This is a
     pure UTC-to-zone conversion and is not affected.
   - `DateTime.local()` and `DateTime.utc()` (which use the `quickDT` path with the same
     `guessOffsetForZone` cache, `datetime.js:410-426`, `:432`, `:644`, `:677`) are not called
     anywhere in `src/`, `web/src/`, `tests/` or `e2e/`.
   - `src/shared/itemLabels.ts` is Intl-only (no luxon construction).
   - `web/src/` does not import luxon.
4. **Does the client do its own local-to-UTC conversion with the same issue?** It does its own
   conversion, but it is not affected in the same way, because it uses the browser's zone and the
   browser's zone rules (not the clock):
   - `web/src/components/ItemEditor.tsx:43` (`new Date(s).getTime()`) and `:276`, `:296`
     (`new Date(value + "T00:00:00")`).
   - `web/src/components/ItemEditor.tsx:37-40` (`epochToDatetimeLocal`, local getters).
   - `web/src/lib/duplicateItem.ts:32-50` (`new Date(y, m, d, H, M)`).

   In Node/V8 with `TZ=America/Los_Angeles`: `2026-11-01T01:30` gives 08:30Z (earlier) and
   `2026-03-08T02:30` gives 10:30Z (shift forward). Both match D10 and do not depend on the current
   date. ECMA-262 specifies the same disambiguation, but this was not run in Safari or Firefox.
   Two client-side caveats, neither caused by this bug:
   - The client converts with the browser's zone, not `item.timezone`. `duplicateItem.ts` already
     documents this as a known limitation.
   - Opening and re-saving an item whose stored instant is the later 01:30 (09:30Z) would move it
     to 08:30Z, because the editor shows 01:30 and re-parses it as the earlier instant. The client
     never creates such items, so this is low risk.
5. **"Output B suggests the choice tracks the offset at now."** Confirmed. See mechanism above.
6. **"Nothing in recurrence.ts, its test, or luxon changed."** Confirmed by git history:
   `src/worker/recurrence.ts` and `tests/unit/recurrence.test.ts` last changed in `15c6df3`
   (initial scaffold), and `git log -S luxon -- package-lock.json` shows only that same commit.

## Suggested fix approach

High level only. The Architect should design the change.

- **Make the ambiguous-time choice explicit and clock-independent.** The earlier-instant rule in D10
  should be enforced in `expandOccurrences`, not left to luxon's clock-based guess. Options with
  tradeoffs:
  - (a) Compute the candidate offsets from the zone at the candidate wall time itself, and pick the
    earlier instant when both are valid. Keeps luxon but avoids relying on `Settings.now()`.
  - (b) Use luxon's `specificOffset` option (`datetime.js:800-801`) with an explicitly chosen
    offset. Same behaviour, but the choice is visible at the call site.
  - (c) Use `Intl.DateTimeFormat` directly for the offset lookup. Removes the luxon dependency from
    this path, which may conflict with D11 if luxon is being kept on purpose.
- **Pinning `Settings.now` in the test is not a fix.** It would make the test deterministic, but
  production would still produce a clock-dependent result for any future caller that uses
  `fromObject` directly. The fix belongs in the production code path. The test should be
  clock-independent, or it should assert both seasons.
- **Fix the window pre-filter in the same change.** Either widen the RRULE query window by the
  maximum zone offset in each direction (about ±14 h) and let the real-instant filter (`:102`) do
  the work, or convert `windowStart`/`windowEnd` to wall-clock time in the item's zone before
  calling `between`. The widening option is simpler and adds negligible cost for a 60-day
  lookahead. The UNTIL rule (N6) is evaluated in the real-instant space, so it is unaffected.
- **Keep the change inside `expandOccurrences`.** All four callers (materialize, digest, calendar
  and the completion key) go through it, so a single fix updates them together.
- **Data check before deploying.** Any dispatch row written by the old code keeps the old
  `occurrence_at`. The Architect should decide whether that matters (a read-only query for
  recurring items with reminders and occurrences in the window, against remote D1, would answer
  it), and whether the fix needs a migration. This was not checked here (no production access).

## Regression risk areas

Every caller of the changed function, what could change, and the tests that cover it:

| Caller | What could change | Coverage today |
| --- | --- | --- |
| `src/worker/reminders/materialize.ts:54-83` (reminder dispatch rows, every 5 min) | Occurrences within ~5–6 h of `now` become materializable. Items created or retimed shortly before an occurrence will get dispatch rows they currently never get. Past-`fire_at` rows are left inert by send's grace window (`send.ts:35-36`), so this should not cause a flood. Ambiguous-hour values change under fix. | Only non-recurring materialize paths are tested (`tests/unit/archive-db.test.ts:436-480`). No recurring materialize test. |
| `src/worker/reminders/send.ts:249-256` (daily digest, cron `0 14 * * *`, `wrangler.toml:36`) | "Today" section gains recurring items starting in the next ~6 h. Digest content changes for every user with morning recurring items. Ambiguous-hour value changes for that hour. | `tests/unit/digest-content.test.ts` covers composition only. `sendDailyDigest` itself has no test. |
| `src/worker/routes/items.ts:77-84` (GET occurrences, used by calendar) | Month view gains occurrences on the first day of the window (see probes). Sort order and `end_at` computation unchanged. | Server route tests use non-recurring items (`tests/unit/items-archive-http.test.ts`, `items-get-by-id.test.ts`). `web/src/components/CalendarView.test.tsx` mocks the server. `e2e/fixtures/api-mocks.ts:213-215` states that every fixture item is non-recurring, so e2e cannot catch this. |
| Completion and un-completion (`src/worker/db.ts:1136-1175`, `:1361-1373`, `:1502`) | Completion key is the `occurrence_at` the client received. Changing the instant for the ambiguous hour changes the key for that hour only. Existing `item_occurrence_state` rows for that instant become unmatched. | `tests/unit/db.test.ts` and `archive-db.test.ts` cover completion. Ambiguous-hour completion is not tested. |
| `web/src/components/CalendarView.tsx:57-67, 83, 247` and `ItemModal`/`ItemDetails` (`occurrenceAt` consumers) | Client receives different occurrence lists (edge and ambiguous hour). Client code is unchanged. | Web tests mock the API (`CalendarView.test.tsx`, `ItemDetails.test.tsx`). |
| `src/worker/recurrence.ts:35, 37-40` (timezone fallback and non-recurring path) | Non-recurring path must stay unchanged. The `DEFAULT_TIMEZONE` fallback must remain. | Covered by `recurrence.test.ts` non-recurring tests (`:111-126`). |
| `computeFireAt` (`recurrence.ts:116-118`) | No change expected. Its UTC arithmetic is not zone-dependent. | Covered by test (iii) (`recurrence.test.ts:66-73`). |

### Existing test coverage and gaps

- `tests/unit/recurrence.test.ts` has six tests. Five pass. Test (ii) (`:41-61`) fails on any day
  when PST is in effect, because its expected value is the PDT instant.
- Test (i) (`:16-36`) covers the spring-forward gap, which is date-independent. N6 (`:78-108`)
  uses a window starting Oct 25 UTC, not local midnight, so it does not hit the window defect.
- Gaps: no test pins or varies the clock; no test checks a window that starts within ~6 h before an
  occurrence; no test uses a window starting at local midnight (the calendar case); no test checks
  the PST-side ambiguous instant; no recurring-item materialize or digest test exists.

## Reproduction result

### A. Test suite

Command: `NODE_EXTRA_CA_CERTS= npx vitest run tests/unit/recurrence.test.ts`

```
 ❯ |worker| tests/unit/recurrence.test.ts  (6 tests | 1 failed) 42ms
   × expandOccurrences — D10 DST cases > (ii) daily 01:30 across fall-back — ambiguous time chooses earlier (PDT) offset
     → expected [ 1793435400000, 1793525400000, …(1) ] to include 1793521800000
 ❯ tests/unit/recurrence.test.ts:56:21
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

Command: `NODE_EXTRA_CA_CERTS= npm test` (full suite, 2026-11-13)

```
 Test Files  1 failed | 38 passed (39)
      Tests  1 failed | 388 passed (389)
```

The only failure is test (ii). This ran under the `@cloudflare/vitest-pool-workers` bundled
workerd, so the Workers runtime result matches the report.

### B. Pinned-clock reproduction (plain Node, luxon from `node_modules`)

Script: `repro-b.cjs` in the session scratchpad. Output:

```
now=2026-09-21 -> 2026-11-01T01:30:00.000-07:00
now=2026-11-13 -> 2026-11-01T01:30:00.000-08:00
now=2026-01-15 -> 2026-11-01T01:30:00.000-08:00
now=2026-07-15 -> 2026-11-01T01:30:00.000-07:00
```

### C. Full-year sweep (every 15-minute wall slot in 2026, PST clock vs PDT clock)

Script: `sweep.cjs`. Output:

```
differing local times (PST-now vs PDT-now): 4
2026-11-1 1:0 pstNow=2026-11-01T09:00:00.000Z pdtNow=2026-11-01T08:00:00.000Z
2026-11-1 1:15 pstNow=2026-11-01T09:15:00.000Z pdtNow=2026-11-01T08:15:00.000Z
2026-11-1 1:30 pstNow=2026-11-01T09:30:00.000Z pdtNow=2026-11-01T08:30:00.000Z
2026-11-1 1:45 pstNow=2026-11-01T09:45:00.000Z pdtNow=2026-11-01T08:45:00.000Z
Mar 8 02:xx gap samples: all 10:00Z/10:15Z/10:30Z/10:45Z in both seasons
```

### D. Window-start probe (Node, `recurrence.ts` bundled with esbuild)

Script: `window-edge.cjs`. Output: the table in "Second defect". Daily 03:00 PDT item, calendar
day Jun 1 (local), `[Jun 1 07:00Z, Jun 2 06:59:59Z]`: `[]`, although the Jun 1 03:00 PDT occurrence
(10:00Z) is inside the window.

### E. Calendar month-start probe

Script: `month-view.cjs` and `month-view-mar.cjs`. Daily 01:30 PST/PDT item:

- November 2026 view (`[Nov 1 07:00Z, Dec 1 07:59:59Z]`): first occurrence Nov 2 09:30Z. Nov 1 is missing.
- March 2026 view (`[Mar 1 08:00Z, Apr 1 06:59:59Z]`): first occurrence Mar 2 09:30Z. Mar 1 is missing.
- Daily 09:00 item, November view: Nov 1 17:00Z is present.

### F. Digest-window probe

Script: `digest-edge.cjs`. Daily 08:00 PST item, cron fire `2026-11-13T14:00:00Z` (06:00 PST),
window +48 h: the only occurrence returned is `2026-11-14T16:00:00.000Z`. Today's 08:00 occurrence
(`2026-11-13T16:00:00Z`) is missing.

### G. Materialize simulation

Scripts: `simulate-materialize.cjs` (5-minute ticks, injected tick clock, 15-minute reminder) and
`late-create.cjs`.

- Daily 01:30 item, ticks from Oct 31 08:00Z to Nov 1 11:00Z: one dispatch row for the Nov 1 slot,
  `occurrence_at=2026-11-01T08:30:00.000Z`, inserted at the first tick.
- Daily 08:00 PST item created at 10:00Z Nov 13 for the 16:00Z occurrence: one tick inserts it
  (the one sitting exactly on the 6 h boundary). The same item existing from 22:00Z Nov 12 gets
  145 ticks.

The 10:05Z-onward case was not run separately. It follows from the same threshold, which the probe
in D confirms.

Scripts are in the session scratchpad (`/private/tmp/claude-501/-Users-juniorwarner-Projects-React-family-scheduler-pwa/9489548d-bf1a-46db-9ddb-b97c8ec72350/scratchpad/`).
They were not committed.

## Could not verify

- Production D1 contents: whether any dispatch row exists with `occurrence_at` `08:30Z` or `09:30Z`
  for 2026-11-01, and whether any reminder was missed because of the window defect. No production
  access was used.
- Ambiguous-time behaviour in Safari, Firefox and WebKit. Only V8 was run.
- The window-start defect for zones east of UTC. Analysis says the end-of-window side can be cut
  instead (for example Asia/Tokyo, where real = wall - 9 h), but this was not run.
- Node versus workerd for the pinned-clock and window probes. The failing test (ii) was reproduced
  under workerd, and the window and luxon logic is the same JavaScript, but the probes ran under
  plain Node.
