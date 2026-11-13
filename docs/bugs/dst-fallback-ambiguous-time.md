# Bug: ambiguous fall-back times resolve differently depending on today's date

- **Slug:** `dst-fallback-ambiguous-time`
- **Source:** Found 2026-11-13 while running `npm test` to verify an unrelated change. The same
  single failure appears on `main` (f50a872) and was absent from the last recorded green run
  (2026-09-21, 389/389).
- **Severity:** Low user impact, real correctness defect. Only an occurrence whose local
  wall-clock time falls inside the repeated hour on fall-back night (01:00–01:59 in
  `America/Los_Angeles`) is affected, but for those the instant chosen is not deterministic.
  The test suite is red every year from early November to mid-March, which hides other
  regressions during that window.
- **Area:** Worker — recurrence expansion (`src/worker/recurrence.ts`), and whatever consumes
  its output (reminder materialization, calendar/list occurrence reads).

## Steps to reproduce

**A. Via the test suite** (works any time Pacific time is on standard time, ~Nov–Mar):

1. `NODE_EXTRA_CA_CERTS= npm test`
   (the env override is an unrelated local workaround: `~/.zshenv` points
   `NODE_EXTRA_CA_CERTS` at a cert bundle workerd cannot parse, so without it no tests run).
2. Observe the failure in `tests/unit/recurrence.test.ts:41`,
   `expandOccurrences — D10 DST cases > (ii) daily 01:30 across fall-back — ambiguous time
   chooses earlier (PDT) offset`.

**B. Directly, independent of the calendar date** (pin "now" to each side of the change):

```bash
node -e '
const {DateTime,Settings}=require("luxon");
const at=(nowIso)=>{Settings.now=()=>Date.parse(nowIso);
  return DateTime.fromObject({year:2026,month:11,day:1,hour:1,minute:30},
    {zone:"America/Los_Angeles"}).toISO();};
console.log("now=2026-09-21 ->",at("2026-09-21T12:00:00Z"));
console.log("now=2026-11-13 ->",at("2026-11-13T12:00:00Z"));'
```

This mirrors the `DateTime.fromObject(..., { zone: tz })` call at `src/worker/recurrence.ts:80`.

## Actual behavior

- **A:** the test fails with
  `AssertionError: expected [ 1793435400000, 1793525400000, …(1) ] to include 1793521800000`
  at `tests/unit/recurrence.test.ts:56`. The Nov 1 occurrence comes back as
  `1793525400000` = **09:30 UTC (01:30 PST, the later instant)** instead of
  `1793521800000` = 08:30 UTC (01:30 PDT, the earlier instant). The other two days
  (Oct 31 08:30 UTC, Nov 2 09:30 UTC) are correct.
- **B:** observed output on 2026-11-13:
  ```
  now=2026-09-21 -> 2026-11-01T01:30:00.000-07:00
  now=2026-11-13 -> 2026-11-01T01:30:00.000-08:00
  ```
  The same local time resolves to different instants depending only on the date the code runs.

## Expected behavior

The ambiguous local time always resolves to the **earlier** instant (PDT, -07:00), regardless
of when the code runs — as specified by Decision D10 and as the comments at
`src/worker/recurrence.ts:9` and `:92-94` state.

## Initial observations (not yet a confirmed root cause)

- The comments at `src/worker/recurrence.ts:9` and `:92-94` say luxon's default picks the
  earlier offset. Output B suggests the choice instead tracks the offset in effect at "now".
- The test passed on 2026-09-21 (PDT in effect) and fails on 2026-11-13 (PST in effect),
  which fits that pattern. Nothing in `recurrence.ts`, its test or `luxon` (3.7.2 installed,
  `^3.5.0` in `package.json`) appears to have changed in between — not yet verified.
- Open questions for investigation: is the spring-forward gap handling (D10, same comment
  block) also date-dependent? Which callers persist the resulting instants (e.g. reminder
  `fire_at`), so that a value computed in one season would be stored wrong? Does anything else
  in the codebase call `DateTime.fromObject` / `DateTime.local` with a zone?
