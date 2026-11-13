# Review — `docs/plans/dst-fallback-ambiguous-time.md` (v1)

**Reviewer:** Plan-Reviewer · **Date:** 2026-11-13 · **Round:** 1

---

## 0. Summary

The design is right. I checked both mechanisms against the library source rather than the plan's
prose:

- **A1 (explicit resolver).** It is correct for overlaps, gaps, southern-hemisphere zones, non-1 h
  shifts and fixed-offset zones.
- **The ±24 h buffer.** It is sufficient at both ends, and it leaves UNTIL, COUNT and the dedupe
  unchanged.
- **The first-deploy "burst" analysis.** It matches the real send and grace code.
- **The "no repair expected" conclusion.** It is sound. There is one gap in the operator's
  decision table (F5).

I traced every red/green prediction in §7.4 by hand and found none wrong.

The defects are in the **harness and acceptance text**, not in the design:

- The test env loads a real `RESEND_API_KEY` from `.dev.vars`, and the plan's fetch interception
  only detects a miss after a real request has gone out (F1).
- Two acceptance checks go red on a correct build (F2, F3).
- The clock-pin placement is under-specified in a way that produces a misleading diagnosis (F4).
- The repair decision table bounds a completion check by the 60-day lookahead, which does not apply
  to completions (F5).
- One required property has no criterion, although the timezone field is free text (F6).

None of these needs a redesign. **No BLOCKERs.** Six REQUIRED findings, all small.

---

## 1. What I sampled from the self-check manifest, and what I took on trust

**Independently confirmed (I opened the source and checked it):**

- **luxon 3.7.2.**
  - `datetime.js:100-125` (`fixOffset`, hole branch `:124` returns `localTS − min(o2,o3)`).
  - `:800-803` (`Settings.now()` read on every `fromObject` call). I also checked that the
    **shipped build** `build/es6/luxon.mjs:6327-6330` (the `exports.import` target) has the same
    code. The `guessOffsetForZone` cache (`luxon.mjs:5937-5954`) is on the `quickDT` path only, so
    the plan's "no cache on this path" is correct.
  - `zoneUtil.js:13-34`, `IANAZone.js:183-208` (`offset(ts)` is a pure function of `ts`),
    `info.js:47-49` (`Info.normalizeZone`), `settings.js:27-40`.
  - `@types/luxon` `settings.d.ts:19,28` (getter and setter typed) and `info.d.ts:71`.
    `luxon.d.ts` re-exports `Zone`. `specificOffset` has 0 matches in `@types/luxon`.
- **rrule** `dist/esm/iter/index.js:11-64`. Iteration starts at `dtstart`. `until` is compared
  with the generated (wall-as-UTC) date (`:27`, `:54`) and `count` is decremented independently of
  the query window (`:35-37`, `:62-64`). §1.3 item 1 and §4.3's "UNTIL and COUNT are unaffected"
  are both correct.
- **Worker.** `recurrence.ts` (whole file); `reminders/materialize.ts:38-63`;
  `reminders/send.ts:221-224`, `:249-258`; `index.ts:71-77`; `routes/items.ts:77-91`;
  `db.ts:1151-1172`, `:1363-1374`, `:1377-1397`, `:1403-1420` (predicate `:1414`, bind `:1417`);
  `config.ts:8-9`; `channels/email.ts:31-43` (body `to: [msg.to]`, so C2's `["owner@example.com"]`
  is right).
- **`item_occurrence_state` has a single reader** (`getCompletedOccurrences`, called only from
  `materialize.ts:46`). I re-grepped `src/` and confirmed it.
- **Harness.** `vitest.workspace.ts:17` (project `worker`); `archive-db.test.ts:25-105`;
  `items-archive-http.test.ts:23-28`, `:119-129` (`DEV_AUTH_IDENTITY` merge at `:122`);
  `tsconfig.worker.json:6` (tests **are** typechecked).
- **Epoch constants E1–E6.** I recomputed them from 2026-01-01 = 1767225600 s, and from
  2027-01-01 = 1798761600 s for E5. All six are correct. Weekdays: Nov 1 2026, Apr 5 2026,
  Mar 29 2026 and Nov 7 2027 are all Sundays. E6 = Sep 8 2027 09:00Z is correct.
- **Counts and expected arrays.** C1 = 60, U3 = 96 (8 + 88), U5 = 92, H1 = 30. U2's three values
  and the Sydney transition (Apr 4 16:00Z) are correct. U6's Berlin gap value is correct.
- **Every row of §7.4 traced by hand on the unfixed code:** U1–U13, C1–C7, H1. All 16 REDs fail on
  a value, and all GREENs pass. U2 is red under CLOCK_S (guess +600 → 16:30Z), which matches the
  plan, so the A5 rejection is backed by a real criterion.
- **Sabotage table.** S1–S7 each turn the listed tests red. S7 correctly removes the bind as well.
- **SQL.** It contains no compound SELECT and no `UNION`, so the D1 compound-term limit does not
  apply. `strftime('%s', …)`, the alias in `GROUP BY which`, and the `NOT EXISTS` guard in R-1 are
  valid SQLite.

**Taken on trust:**

- `migrations/0001_init.sql:57`. Both test DDLs carry the same UNIQUE key, which is consistent
  with it.
- The investigation's 389-test baseline and its git-history claims.
- That `vi.spyOn(globalThis, "fetch")` intercepts under workerd (K2). I believe it does, but see F1
  for why "believe" is not good enough here.

**Not covered by the manifest, reviewed in full:**

- What `env` contains inside the worker test pool. This is the source of F1.
- Whether the plan's own verification commands agree with the plan's own prescribed comments
  (F2).
- What `git diff --stat main` will contain on this branch (F3).
- Where `Settings.now` is assigned relative to `describe.each` (F4).
- The repair table's horizon (F5).
- Whether the timezone input is constrained (F6).

---

## 2. Correctness of the design (no findings, recorded so the next round need not redo it)

- **Overlap.** For LA Nov 1 01:30, `offBefore = offset(Oct 31 01:30Z) = −420` and
  `offAfter = offset(Nov 2 01:30Z) = −480`. Both candidates are self-consistent, and
  `Math.min` returns E1. For Sydney Apr 5 02:30 the result is 15:30Z (AEDT), the earlier instant.
  The algorithm does not assume a direction, so it works in both hemispheres.
- **Gap.** A1 returns `W − offBefore`. luxon's hole branch returns `localTS − min(o2, o3)`, and
  across a gap the minimum is the pre-transition offset. The two are identical. I also traced
  `fixOffset` under both guesses for LA Mar 8 02:30; both reach the hole branch and give 10:30Z.
  §4.4's equivalence argument holds.
- **Bracket width.** The real instant is t = W − off with |off| ≤ 14 h. A transition that affects W
  lies within one DST delta of t, so it lies inside (W − 24 h, W + 24 h). The ±1 day sample
  therefore always brackets it.
  - A transition near W that does **not** affect it gives exactly one self-consistent candidate,
    which is correct.
  - Non-1 h shifts are handled generically: Lord Howe (30 min), Troll (2 h), and even the 24 h
    gap at Apia in 2011.
  - The only blind spot is two transitions within the ±24 h sample, which is the stated
    assumption. Minor wording point: the sample window is ±1 day around W, not
    "±(1 day + |off|)" as §4.2 states. This is cosmetic.
- **Fixed-offset, `UTC`, `local` and unknown zones.**
  - `Info.normalizeZone` is the same `normalizeZone(input, Settings.defaultZone)` that
    `fromObject`/`fromMillis` already use, so parsing is unchanged.
  - Fixed zones take the fast path.
  - `SystemZone` is UTC in workerd, as it is today.
  - An invalid zone returns `[]` today through the `toISOString()` RangeError inside the `try` at
    `recurrence.ts:66-71`; I confirmed this. The early `isValid` return gives the same result.
- **Window.** The candidate is W = t + off(t) with off ∈ [−12 h, +14 h], so the 24 h buffer covers
  both ends. The gap branch still satisfies W = t + offBefore, which is inside that range.
  - Widening does not change values, only which candidates are generated.
  - `:102` stays authoritative.
  - The dedupe runs after the filter.
  - Cost is about +2 candidates per daily rule per call.
- **All-day items.** `ItemEditor.tsx:276` stores browser-local midnight. No supported zone has an
  ambiguous midnight in LA, and gap handling is unchanged. The only effect is the window fix, which
  restores day-1 all-day occurrences in the month view (see N7).
- **First-deploy burst.** Checked against `db.ts:1411-1417` and `index.ts:75-76`. The three-way
  split in §4.7 (on time / up to G late / inert) is exact.
  - `sent` and `failed` rows block re-insert through the UNIQUE key.
  - Completed occurrences are skipped by key, and outside the overlap the keys are unchanged.
  - Purge-driven gaps (retime, reminder edit, visibility flip) are the only rows that newly appear
    near-term. Re-inserting them is the intended fix.
  - East-zone end-of-window rows newly appear about 60 days out, so they are harmless (the table
    omits them; not a finding).
- **No-repair conclusion.** It holds for dispatch. For LA, a future later-instant dispatch row can
  only come from a PST-clock tick that sees an overlap within 60 days, and that only happens during
  the overlap hour itself, which is now in the past. So Q-C is 0 whenever it is run, not only
  before E6. The plan's gating is conservative, which is fine.
- **Completion.** Completion rows **can** hold a future later instant: a calendar read on a PST
  server clock for next November. Q-B exists for this case. See F5 for the gap in how its result
  is judged.

---

## 3. Findings

### F1 — REQUIRED. The consumer tests run with the real `.dev.vars` `RESEND_API_KEY`, and the fetch interception fails open. Does not block the build; must be folded in before C2, C3 and C7 are written.

- The worker pool loads `wrangler.toml` through the pool's bundled wrangler
  (`@cloudflare/vitest-pool-workers/dist/pool/index.mjs:335`). Its
  `unstable_getMiniflareWorkerOptions` builds `vars` from `getVarsForDev(...)`
  (`node_modules/@cloudflare/vitest-pool-workers/node_modules/wrangler/wrangler-dist/cli.js:198685-198688`),
  which reads `.dev.vars`.
- `.dev.vars` defines `RESEND_API_KEY` (I checked key names only, not values). `wrangler.toml:44`
  sets a real `EMAIL_FROM` domain.
- §7.1 tells the Coder to call `sendDue(db, env, …)` and `sendDailyDigest(db, env, …)` with the pool
  `env`. It then says: "**If the spy does not intercept under workerd**, fall back to
  `fetchMock`." The only way to learn that the spy did not intercept is to see zero spy calls,
  which happens **after** `sendEmail` has made a real `POST https://api.resend.com/emails`
  (`channels/email.ts:31`) with whatever key is in `.dev.vars`.
- Where this would fire:
  - C7 sends a digest on **both** unfixed and fixed code.
  - C2 sends on the fixed code.
  - Sabotage S7 makes C3 send.
- The recipient is `owner@example.com`. A reserved domain makes delivery unlikely, but the request
  still uses the owner's key and sender domain.

**Required change:**

1. In C2, C3 and C7, pass an explicit env:
   `{ ...env, RESEND_API_KEY: "test-not-a-real-key", EMAIL_FROM: "test@example.com" }`.
   With this, a missed interception yields a 401 and a permanent failure, not a delivery.
2. Install the interception in `beforeEach`, **before** any call that can send.
3. State the fail-closed fallback explicitly: `fetchMock.activate(); fetchMock.disableNetConnect();`
   from `cloudflare:test`, so an unmatched request throws instead of leaving the machine.
4. Add a one-line note in §7.1 explaining why.

### F2 — REQUIRED. Step 7 and AC-5's grep go red on a correct build, because the plan's own prescribed comments contain the banned string. Does not block the build; the Coder would otherwise have to choose between the comment and the gate.

- §9 step 7 says `grep -n "fromObject\|DateTime.local\|DateTime.now" src/worker/recurrence.ts`
  must "return nothing".
- The resolver doc comment the plan prescribes (§4.2, code block line 191: "Do NOT use
  DateTime.fromObject here") and the §4.5 replacement for `:9` ("`DateTime.fromObject` picks the
  offset in force at `Settings.now()`") both match that pattern.
- So the criterion is red on the build the plan asks for. If the Coder drops the comments to make
  it green, the "why" documentation the plan relies on as the regression barrier is lost (OQ-2's
  lint rule is deferred).

**Required change:**

- Match **calls** only: `grep -nE "DateTime\.(fromObject|local|now)\(" src/worker/recurrence.ts`.
  None of the prescribed comments contains `DateTime.fromObject(`. `Settings.now()` does not
  match.
- Word AC-5 to match ("no call to").

### F3 — REQUIRED. AC-6 ("the diff touches only the files in §5", checked with `git diff --stat main`) is red on every correct build. QA-facing; does not block the build.

- `git diff --stat main` on this branch will include at least:
  - `docs/plans/dst-fallback-ambiguous-time.md` (untracked now, committed on the branch);
  - this review;
  - the QA report and `.approved` marker;
  - if the Coder takes step 11's second option, `docs/process/dst-fallback-ambiguous-time-impl-notes.md`.
- None of these is in §5. A literal QA reading fails AC-6.
- §5's "No change" row names `db.ts`, which S7 edits temporarily. That is fine if reverted, but
  the AC should say "after reverting all sabotage".

**Required change:** scope the check to code:
`git diff --stat main -- src web e2e migrations wrangler.toml package.json package-lock.json tests`.
It must list exactly `src/worker/recurrence.ts` and the three test files.

### F4 — REQUIRED. The `Settings.now` pin location is unspecified, and the obvious wrong placement produces a misleading diagnosis. Does not block the build.

§7.1 says to save `REAL_LUXON_NOW` at module scope, restore it in `afterEach`, and use
`describe.each`. It does not say **where the pin is set**.

- **The wrong placement.** If the Coder writes
  `describe.each(...)("%s", (_, clock) => { Settings.now = () => clock; it(...) })`, the
  assignment runs at **collection** time. Every test then runs under the last clock (CLOCK_W),
  and after the first `afterEach`, under the real clock.
- **What §7.4 then shows.** U1 is red under both clocks, and §7.4 diagnoses that as "the luxon pin
  is not reaching `src/`" (a module-identity problem, K1). That sends the Coder after the wrong
  cause.
- **U3's extra assertion.** "Also assert the CLOCK_S and CLOCK_W arrays are equal" cannot be done
  inside a one-clock-per-test `describe.each` without switching the pin mid-test. The Coder has
  to invent the mechanism.

**Required change:**

1. Specify `beforeEach(() => { Settings.now = () => clock; })` inside each `describe.each` body.
2. Add "pin assigned outside `beforeEach`" as the first cause to check in §7.4's both-red or
   both-green diagnosis.
3. Either drop U3's cross-clock equality (it is implied by both clocks' exact `toEqual` against the
   same literal) or say it is computed inside one test by switching `Settings.now` explicitly, as
   C6 does.

### F5 — REQUIRED (operator-facing). The §4.8 decision table bounds the completion check by the 60-day lookahead and by a single LA hour (E5). Neither bound applies to completions. Does not block the build; must be fixed before DevOps uses the table.

Completion rows are not produced by materialize. They come from whatever the calendar route
returned when the user clicked, for **any** future month. So:

- **Row 2 ("No repair" if "no Q-B row lies in E5").** It checks only LA's 2027 later-instant
  hour. A Q-B row at LA's 2028 later-instant hour, or at another DST zone's later-instant hour,
  satisfies row 2 **and** row 4 at once, and the operator has no rule for that.
- **Row 3 ("another DST zone whose next fall-back is within L = 60 days").** The 60-day horizon is
  the correct gate for **Q-C** (dispatch rows), but it is wrong for **Q-B**. A Q-B completion in
  `Europe/London`'s Oct 2027 later-instant hour would never be examined.
- **R-1's placeholders.** R-1 is written with `?id`/`?late`. `wrangler d1 execute --command` has
  no bind parameters, so the operator must substitute literals. Say so.

**Required change:**

1. Split the table's horizon. Q-C is gated by the 60 days. Q-B is examined against the
   later-instant hour of **its row's own zone, any year**.
2. For LA, give the all-years predicate so the operator does not hand-derive dates. Add a Q-B'
   that is Q-B with this appended:
   ```sql
   AND i.timezone = 'America/Los_Angeles'
   AND strftime('%m', s.occurrence_at/1000, 'unixepoch') = '11'
   AND strftime('%w', s.occurrence_at/1000, 'unixepoch') = '0'
   AND CAST(strftime('%d', s.occurrence_at/1000, 'unixepoch') AS INTEGER) <= 7
   AND strftime('%H', s.occurrence_at/1000, 'unixepoch') = '09'
   ```
   This selects the 09:00–09:59Z hour of the first Sunday in November (the later-instant hour)
   under the current US rule. The "no repair" condition for LA becomes "Q-B' returns 0 rows".
3. Any non-LA DST zone with **any** future Q-B row escalates to the owner.

### F6 — REQUIRED. Required property (b) (`Info.normalizeZone`, not `IANAZone.create`) has no criterion, and fixed-offset strings are reachable from the UI. Does not block the build.

- §4.2(b) says `IANAZone.create` "would regress fixed-offset strings to `[]`". No test in §7
  goes red on that build, so the criteria cannot tell the chosen approach from the rejected one.
- This matters because the timezone input is **free text**
  (`web/src/components/ItemEditor.tsx:307-312`, `type="text"`), and `isValidTimezone` has no
  caller. A user can save `UTC+5` today and gets correct occurrences.

**Required change:**

1. Add **U14 (GUARD)**: `timezone: "UTC+5"`, `FREQ=DAILY`, start `Date.UTC(2026,5,1,4,0)`
   (09:00 local), window `[Date.UTC(2026,5,1,0,0), Date.UTC(2026,5,3,0,0)]`. Expected:
   `toEqual([Date.UTC(2026,5,1,4,0), Date.UTC(2026,5,2,4,0)])`. It is green on current code.
2. Add **S8**: "zone from `IANAZone.create(tz)`". Under S8, U14 returns `[]` and must go red.
3. Update the §7.4 counts accordingly.

---

## 4. NITs (none blocks; none changes a decision)

- **N1.** The U11 threshold is stated three ways.
  - §4.3 and §11 say "13 h 00 m 00.001 s". §7.2 says "13 h 00 m 01 s".
  - With `we = Date.UTC(2026,5,1,9,59,59)` (a `.000` ms value) the bound is **13 h 00 m 01 s**.
    The 00.001 figure would need `we` at `…:59.999`.
  - U10's bound is likewise 5 h 00 m 01 s, not 5 h.
  - S3b (12 h) is red either way.
- **N2.** The buffer tests prove B ≥ 13 h (east) and B ≥ 10.5 h (west). G2 needs 14 h and 12 h, so
  a 13.5 h buffer would pass every test. The 24 h choice is safe and the plan is honest about what
  U11 and U12 prove. Optional tightening: a Kiritimati occurrence at 23:59:59 local, with `we` at
  that same instant, needs the full 14 h.
- **N3.** Several citations drop the directory: `materialize.ts:…` and `send.ts:…` are under
  `src/worker/reminders/`.
- **N4.** For C1, C2 and C3, specify asserting the selected row set with `toEqual([...])` (for
  example `SELECT occurrence_at, fire_at, status … WHERE occurrence_at = ?`). If the Coder instead
  writes `row!.status`, the unfixed "row absent" case becomes a TypeError. §7.4 would correctly
  reject that, but it costs a loop.
- **N5.** `tsconfig.worker.json:6` includes `tests/unit/**`, so
  `JSON.parse(spy.mock.calls[i][1].body)` will not typecheck as written (`init` is optional and
  `body` is `BodyInit | null`). It needs a cast. This is trivial, but it is the Coder's step-8
  gate.
- **N6.** AC-8 depends on the browser's zone, because `CalendarView.tsx:57-58` uses the
  browser-local month. State that the browser must be on `America/Los_Angeles`.
- **N7.** §4.7 and K5 should mention **all-day** recurring items. They are stored at local
  midnight (`ItemEditor.tsx:276`), so day 1 of the month view has been missing every daily all-day
  item for west-of-UTC users. That is probably the most visible user-facing change in the PR and
  deploy note.
- **N8.** C3 says "separate item, same times". Say "separate test (fresh tables)" so the Coder
  does not put the C2 and C3 items in one DB and count both sends.
- **N9.** Observability: §10.2 step 4 could tell DevOps to read the `send={…}` summary that
  `index.ts:77` logs on the first ticks. That summary directly shows the bounded late-send class,
  which the `inserted=` counter cannot (OQ-5).

---

## 5. Things I checked and found sound (so the next round does not re-raise them)

- **Root cause, not symptom.** The fix removes the clock read from production code. It does not
  merely pin the clock in tests. The window fix is in the same function, and no consumer changes.
- **Scope.** The change touches one source file and three test files. The consumer tests are
  justified, because no recurring materialize, digest or occurrences-route test exists today.
- **Rejecting A2 and W2 on maintainability, and saying the tests cannot separate them,** is honest.
  A5 *is* separated by U2.
- **The OQs.** OQ-1 (UNTIL semantics) is a genuine product decision. Its analysis in §4.6 is
  correct (`web/src/lib/rrule.ts:39-43`), and leaving UNTIL alone is provably safe. OQ-2 to OQ-5
  do not block.
- **Reproduction.** §7.4 is a real red-proof on unfixed code, independent of the date the suite
  runs. Every RED is a value assertion.
- **The P2-N1 non-applicability claim for R-1 and R-2** is correct. They delete only dispatch and
  occurrence-state rows, never a parent.

---

## Required changes

1. **F1.** Pass an env with a dummy `RESEND_API_KEY` and `EMAIL_FROM` to `sendDue` and
   `sendDailyDigest` in C2, C3 and C7. Install the interception in `beforeEach`. Make the fallback
   fail-closed (`fetchMock.activate()` + `disableNetConnect()`).
2. **F2.** Change step 7 and AC-5's grep to match calls only:
   `grep -nE "DateTime\.(fromObject|local|now)\("`.
3. **F3.** Scope AC-6 to code paths (`src web e2e migrations wrangler.toml package*.json tests`),
   evaluated after reverting all sabotage.
4. **F4.** Specify that `Settings.now` is assigned in `beforeEach` inside each `describe.each`. Add
   mis-placement to §7.4's diagnosis. Resolve U3's cross-clock equality: drop it, or switch the pin
   within one test.
5. **F5.** Fix the §4.8 decision table: the 60-day horizon gates Q-C only. Q-B is judged against
   each row's own zone's later-instant hour in any year, with the LA all-years predicate. Non-LA
   DST zones with future Q-B rows escalate. Note that R-1's `?id`/`?late` are substituted as
   literals.
6. **F6.** Add GUARD U14 (`"UTC+5"`, exact instants) and sabotage S8 (`IANAZone.create`). Update
   the §7.4 counts.

APPROVE WITH CHANGES

---
---

# Re-review (v2)

**Reviewer:** Plan-Reviewer · **Date:** 2026-11-13 · **Round:** 2

## R2.0 Summary

v2 resolves all six round-1 findings and all nine NITs. I checked each one against the plan text
and, where it applies, against the code and library source, not against the §12 log.

The F1 departure (making the network guard permanent rather than a fallback) is sound. I traced
it through the pool's own source, and it fails closed for fetches made from `src/`, not only from
the test file (R2.2).

The revision introduced **one new REQUIRED finding**, confined to the DevOps decision table in
§4.8. The table now says "first matching row applies", and that rule can skip the LA repair checks
(N-R2-1). It does not touch anything the Coder builds or tests. It is a wording fix, and it reaches
a human operator, which is why it is REQUIRED rather than a NIT. Everything else new is NIT.

The trajectory is six REQUIRED findings in round 1, then one small, operator-only REQUIRED finding
in round 2. The design, the tests and the Coder's checklist are ready.

## R2.1 What I sampled, and what I took on trust

**Independently confirmed this round:**

- **The F1 runtime mechanism, in `@cloudflare/vitest-pool-workers` 0.6.0** (`package.json:3`):
  - `fetchMock` is exported from `cloudflare:test` (`types/cloudflare-test.d.ts:37`) as an undici
    `MockAgent`.
  - Its runtime **replaces `globalThis.fetch` in the runner isolate**
    (`dist/worker/lib/cloudflare/test-internal.mjs:913-916`, `:929-1036`), and the type comment
    says it mocks `fetch()` "for the current test runner worker".
- **Counts and new values:**
  - The §7.4 counts are correct.
  - U11, U12 and U14 have the right values and thresholds on both the unfixed and the fixed code.
  - Q-0b's expected outputs are right: E2 = 1793525400 s gives `11|0|01|09`, and
    E5.start = 1825578000 s gives `11|0|07|09`. Both are Sundays at 09:xxZ.
- **SQL validity** of Q-0b, Q-B', Q-C', R-1 (all three steps) and R-2 (R2.4).
- **OQ-6's claim:** no existing test calls a send path. I re-grepped `tests/`; the only hit is a
  comment at `digest-content.test.ts:2`.
- **§4.8.1's "client rules are DAILY/WEEKLY/MONTHLY":** confirmed. `web/src/lib/rrule.ts:14` is
  `"none" | "daily" | "weekly" | "monthly"`.

**Taken on trust:**

- The owner's nine production counts in §4.8.1, which I cannot query.
- The coordinator's report that the test log prints "Using vars defined in .dev.vars". It agrees
  with the `getVarsForDev` path I found in round 1.

## R2.2 F1 departure: does `disableNetConnect` really fail closed for `src/` code?

**Yes.** The mechanism, from the pool's own source:

1. `test-internal.mjs:929` assigns a new `globalThis.fetch`.
   - When `isMockActive(fetchMock)` is false, it calls the original fetch (`:930-933`). That is
     why `fetchMock.activate()` is required; the type comment says it is "Deactivated by default".
   - When active, it builds dispatch options and calls `fetchMock.dispatch(...)` (`:1034`).
2. `MockAgent.dispatch` → `get(origin)` creates a mock client **for any origin, including ones
   never registered** (`mock-agent.cjs:2068-2079`).
   - Its dispatch (`:1630-1647`) finds no interceptor and catches `MockNotMatchedError`.
   - With `netConnect === false` it re-throws
     `"…: subsequent request to origin … was not allowed (net.connect disabled)"` (`:1638`).
   - The throw happens inside the async patched `fetch`, so the caller gets a **rejected
     promise**. Nothing reaches the network.
3. **Code under test is covered.** `channels/email.ts:31` calls the free identifier `fetch`, which
   resolves to `globalThis.fetch` at call time. `src/` modules imported by the test run in the same
   runner isolate, so they hit the patched function. `sendEmail`'s `catch` (`:45-47`) turns the
   rejection into a transient failure, exactly as §7.1 layer 2 says.
4. **Defaults that make `disableNetConnect()` load-bearing.**
   - `resetMockAgent` (`mock-agent.cjs:2172-2179`) runs before each test file and calls
     `deactivate()` **and `enableNetConnect()`**. So without the explicit `disableNetConnect()`, an
     active mock passes unmatched requests to the real network.
   - That is exactly why **S9 is meaningful**. With the call removed, C0's request goes through
     `originalDispatch` → `setDispatcher` → `originalFetch` (`test-internal.mjs:917-920`) and fails
     on DNS for `.invalid`. That error is not the `net.connect disabled` one, so C0 goes red while
     still sending nothing.
5. **Interaction with the layer-3 spy.**
   - `vi.spyOn(globalThis, "fetch")` installed **after** layer 2 wraps the already-patched
     function. With `mockImplementation` it never calls through.
   - `vi.restoreAllMocks()` puts back the fetchMock-patched function, not the raw one.
   - C0 must run with the spy restored, so that its `fetch` reaches the patched function. §7.3
     says this ("spy **not** installed for this test (or restored first)").
6. **C0 assertion.** Asserting on the stable substring `net.connect disabled` (or on the
   `MockNotMatchedError` name) is correct. The Coder's "record the observed name and message" is
   sensible.

F1 is resolved, with a guard that can actually fail (C0/S9) and a capture fallback that keeps the
guard on.

## R2.3 Per-finding status

| Finding | Status | Evidence in v2 |
|---|---|---|
| **F1** | **Resolved** | §7.1 layers 1–3. `TEST_ENV` on every send call (§7.3 preamble, C2/C3/C7). C0 and S9. AC-9. Step 3 ordering. Mechanism verified in R2.2 |
| **F2** | **Resolved** | Step 7 and AC-5 use `grep -nE "DateTime\.(fromObject|local|now)\("`. The prescribed comments (§4.2 lines 196-198, §4.5 `:9`) contain no `(` after the method name, and `Settings.now()` does not match |
| **F3** | **Resolved** | AC-6 is path-filtered and evaluated after the sabotage revert. Step 9 confirms there is no residual `db.ts` or `beforeEach` diff. See NIT N-R2-3 on untracked files |
| **F4** | **Resolved** | §7.1 sets the pin in `beforeEach` inside each `describe.each`, with mid-test switching only in C6. §7.4 diagnosis order: placement, then hook order, then module identity. U3's cross-clock equality is dropped (correctly: implied by both exact `toEqual`s) |
| **F5** | **Resolved as specified**; **new defect introduced in the table's evaluation rule** (N-R2-1) | Horizons are split (§4.8 lines 349-355). Q-B' and Q-C' cover all years, with Q-0b as a self-check. Non-LA zones escalate. R-1 and R-2 have no placeholders |
| **F6** | **Resolved** | U14 (`"UTC+5"`) and S8 (`IANAZone.create`). §7.4 counts updated. See NIT N-R2-5 on S8's dependence on `Intl` |
| N1 | Resolved | Thresholds stated once in §7.2. U10 is 5 h 00 m 01 s |
| N2 | Resolved, beyond the ask | U11 needs the full 14 h and U12 needs 11 h. S3b = 13.5 h and S3c = 10.5 h are both red as listed (traced) |
| N3 | Resolved (header convention) | Acceptable partial, stated as such |
| N4 | Resolved | Row-set `toEqual` with an example; `row!.status` banned |
| N5 | Resolved | `(spy.mock.calls[i][1] as RequestInit).body as string` typechecks |
| N6 | Resolved | AC-8 requires an `America/Los_Angeles` browser |
| N7 | Resolved | §4.7 calendar row and K5 |
| N8 | Resolved | C3 is a separate test with fresh tables |
| N9 | Resolved | §10.2 step 4 |

## R2.4 Did the revision introduce new problems?

**§7.4 counts.**
- RED (16): U1[W], U2[S], U3[W], U7, U8, U10, U11, U12, C1, C2, C3, C5[W], C6×2, C7, H1.
- GREEN new (15): U1[S], U2[W], U3[S], U4×2, U5×2, U6×2, U9, U13, U14, C0, C4, C5[S].
- GREEN existing (4).

All correct, and the new rows trace out as follows:
- **U11 (unfixed `[]`).** The occurrence at Jun 1 09:59:59Z equals `we`, so the inclusive bound
  keeps it. W = `we` + 14 h, so the threshold is exactly 14 h.
- **U12 (unfixed `[]`).** The occurrence at Jun 1 11:00Z equals `ws`, and W = `ws` − 11 h. Jun 2
  00:00 local is a candidate but maps outside `we`.
- **U14 (green on both).** Under the old code, W(Jun 2 09:00) ≤ `we` + 2 h and Jun 3 is excluded.
  The fixed fast path gives the same instants.

**Test IDs across sections.**
- Step 3 (U1–U14, C0–C7, H1), step 9 and AC-4 (S1–S9), and AC-9 are consistent with §7.2, §7.3
  and §7.5.
- One miss: §5's row for `tests/unit/recurrence.test.ts` still says "Add U2, U3, U5–U13", without
  U14 (N-R2-2).

**SQL** (D1/SQLite; no compound SELECT anywhere):
- **Q-0b.** `strftime(fmt, <int>, 'unixepoch')` is valid. Two statements in one `--command` are
  allowed. Read-only.
- **Q-B' and Q-C'.**
  - `occurrence_at/1000` is integer division on INTEGER columns, which is correct for
    `'unixepoch'`.
  - The predicate (November, Sunday, day ≤ 7, hour `09` UTC) selects exactly LA's later-instant
    hour under the post-2007 US rule. The earlier-instant hour is `08`Z, so it is correctly
    excluded.
  - Both are read-only aggregates.
- **R-1 step 1.**
  - SQLite allows the correlated `item_occurrence_state.item_id` reference inside an `UPDATE`'s
    subquery.
  - The `occurrence_at` in `WHERE` is the pre-update value.
  - The `NOT EXISTS` guard prevents a primary-key collision.
  - Sub-daily items are handled correctly: the fixed code never emits a later-instant key, so every
    later-instant row is stale.
- **R-1 step 2** deletes only the leftovers, because step 1 moved the others out of the predicate.
- **R-1 step 3** is valid. It is broader than its comment says; see N-R2-6.
- **R-2** is valid.
- R-1 and R-2 are labelled conditional writes, and the rest is read-only, as the plan states.
  P2-N1 does not apply, because no parent rows are deleted.

**§4.8.1 reasoning.**
- The "1/1 pair is in the past, nothing to repair or resend" conclusion follows from C4 and the
  window starting at `now`.
- The argument that "Q-B' must be 0 for that data" is valid given the stated assumption: the
  single item is not sub-daily, and the counts do not show its FREQ.
- Re-running Q-B' and Q-C' at deploy time covers the residue.

### N-R2-1 — REQUIRED (operator-facing). The decision table's "first matching row applies" rule contradicts the next sentence and can skip LA's repair checks. Does not block the Coder; must be fixed before DevOps uses §4.8.

§4.8 (around lines 460-471) says: "Rows are evaluated **in order; the first matching row
applies**." The text then says: "Rows 4 and 5 can both apply; run R-1 before R-2." Those two
statements contradict each other, and the first-match rule also causes a real gap:

- **Row 3 can stop evaluation early.** Row 3 matches whenever Q-A lists a non-LA DST zone with a
  fall-back within 60 days. Its action ("if > 0, escalate") completes even when the count is 0.
  Under first-match semantics, evaluation then stops, and **rows 4 and 5 (LA's Q-B' and Q-C') are
  never evaluated**. A needed R-1 would be silently skipped.
- **Likelihood is low.** `items_tz_not_LA = 0` today, and the northern fall-backs are past. But
  this is a deploy gate, and the error was introduced by v2.
- **Formatting.** There is also a stray empty table header (`| Result | Action |` / `|---|---|`)
  directly above the sentence, so the table renders broken.

**Required change:**
- Row 1 (Q-0 or Q-0b mismatch) is a **stop**.
- Rows 2–5 are each evaluated **independently**. Any escalation is reported alongside any LA
  repair, and R-1 runs before R-2.
- Row 6 applies only when none of rows 2–5 fired.
- Remove the stray header.

### NITs (none blocks; none changes a decision)

- **N-R2-2.** §5's `recurrence.test.ts` row omits U14 ("Add U2, U3, U5–U13"). Step 3 and §7.2 are
  correct.
- **N-R2-3.** `git diff --stat main -- …` (AC-6) does not show **untracked** files. If QA runs it
  before the new test files are committed, it lists two files, not four. Say "on the committed
  branch" or use `git diff --stat main...HEAD -- …`.
- **N-R2-4.** AC-9's `grep -n "sendDue\|sendDailyDigest"` also matches the import line. It is a
  human read, so this is harmless, but "shows only `TEST_ENV` arguments" is slightly loose. AC-9
  is also numbered between AC-6 and AC-7.
- **N-R2-5.** S8 turns U14 red only because the runtime's `Intl.DateTimeFormat` rejects
  `timeZone: "UTC+5"`. Current V8 rejects it, since only IANA names and `±HH:MM` offsets are
  valid. If a future runtime accepted it, `IANAZone` would compute +5 and S8 would stay green. The
  Coder should record S8's observed result rather than assume it. No change is needed now.
- **N-R2-6.** R-1 step 3's comment ("only removes rows that step 1 made inconsistent")
  over-claims. The statement is table-wide, so it also removes any pending row for a completed
  future occurrence left by a complete-during-materialize race. That is still the desired outcome,
  so only the comment is wrong.

## R2.5 Required changes (v2)

1. **N-R2-1.** In §4.8's decision table:
   - Replace "first matching row applies" with: row 1 is a stop, rows 2–5 are evaluated
     independently (R-1 before R-2; escalations reported alongside), and row 6 applies only if
     none of rows 2–5 fired.
   - Remove the stray empty table header above the sentence.

This is a DevOps-only text change in §4.8. The Coder's work (§4.2–§4.5, §7, §9) is approved as
written and does not depend on it.

APPROVE WITH CHANGES

---
---

# Re-review (v3)

**Reviewer:** Plan-Reviewer · **Date:** 2026-11-13 · **Round:** 3 (orchestrator edits for round 2)

I checked each change against the plan text itself, not against the v3 log entry (§12, plan
lines 976-985). I also re-read the surrounding text to look for anything the edits might have
broken.

## R3.1 Status of the round-2 findings

| Finding | Status | Evidence |
|---|---|---|
| **N-R2-1** (REQUIRED) | **Resolved** | See the detail below the table |
| N-R2-2 | Resolved | §5 (line 534) now reads "Add U2, U3, U5–U14" |
| N-R2-3 | Resolved | AC-6 (line 857) now says to run on the committed branch, because `git diff` does not show untracked files. The path-filtered command is unchanged and correct for a clean, committed tree |
| N-R2-4 | Resolved; renumbering declined | AC-9 (line 858) greps `(sendDue|sendDailyDigest)\(`, so the import line no longer matches. Keeping AC-9 where it is, to avoid breaking references by number, is reasonable: it is cosmetic and changes no decision |
| N-R2-5 | Resolved | S8 (line 710) states the expected mechanism (`IANAZone` rejects `"UTC+5"`) and requires the observed failure to be recorded |
| N-R2-6 | Resolved | The R-1 step 3 comment (lines 501-504) now says the DELETE is table-wide and why that is intended. One minor wording slip is noted below; it changes nothing |

**N-R2-1 detail** (§4.8, plan lines 456-473):

- **Evaluation rule.** Row 1 is checked first and stops everything. Rows 2–5 are each evaluated
  independently. Row 6 applies only if none of rows 2–5 fired.
- **Row 3 can no longer stop the LA checks.** It now fires only when its count is above 0, so a
  non-LA zone with zero affected rows does not skip rows 4–5. This was the gap in round 2.
- **Ordering and escalation.** "If rows 4 and 5 both fire, run R-1 before R-2" no longer
  contradicts the evaluation rule. The added "if row 2 or 3 escalates, wait for the owner before
  R-1/R-2" is conservative. It only delays post-deploy repairs and cannot cause a wrong write.
- **Formatting.** The stray empty table header is gone.

## R3.2 Did the edits introduce anything new?

Nothing material. I re-checked the following:

- **The decision table against §10.2.** Step 1 still expects row 6. Step 3 runs R-1/R-2 after
  deploy, and the new wait-for-escalation rule fits with that.
- **R-1 and R-2 SQL.** Unchanged from v2, which I already found valid; only the comments changed.
- **AC-6 and AC-9 commands.** Both are still syntactically correct.
- **Cross-references.** No test ID or AC number changed, so nothing that cites them broke.

Two cosmetic leftovers. Neither blocks anything, and neither needs another round:

- **Row 6's description is narrower than the rule.** Row 6's parenthetical reads "(LA only, or
  zones without DST; …)". Under the new rule, row 6 also applies when a non-LA DST zone exists but
  neither row 2 nor row 3 fired. The rule sentence above the table governs, so an operator
  following it acts correctly. Rewording the parenthetical as "none of rows 2–5 fired" would make
  the two agree.
- **R-1 step 3 comment.** Line 502 ends with a comma and line 503 starts a new sentence, so the
  comment reads as a fragment. It is a SQL comment only.

The plan is ready: design, tests, Coder checklist, QA criteria and DevOps gate. The findings
shrank from six REQUIRED in round 1, to one operator-text REQUIRED in round 2, to two cosmetic
nits now.

APPROVE

---
---

# Re-review (v4)

**Reviewer:** Plan-Reviewer · **Date:** 2026-11-13 · **Round:** 4 (post-implementation, documentation only)

**Scope.** This round checks the §7.5 S1 and S4 rows (plan lines 701 and 706) and the v4 log entry
(line 991). I traced each sabotage against the implemented `src/worker/recurrence.ts` and the
test files as committed.

**Limit on "nothing else changed".** I have no shell, so I could not diff v3 against v4. I checked
it by reading the v4 log, re-reading §7.5, and grepping the plan for C6, S1 and S4. That is how I
found the stale passages in F-R4-1.

## R4.1 The corrections are accurate

**S1 (`Math.max` in the overlap branch, `recurrence.ts:44`): 10 red, as observed.**

- U1, U2, U3 and C5 go red under both clocks, as already listed.
- **C6 goes red in both orders.**
  - The test asserts `expect(keys).toEqual([E1])` (`recurrence-consumers.test.ts:306`).
  - Under S1, `expandOccurrences` returns E2 for the Nov 1 01:30 overlap, so `keys` is `[E2]`.
  - That is an assertion failure on a value, in both the W→S and S→W orders.
- The count is U1×2 + U2×2 + U3×2 + C5×2 + C6×2 = **10**. The corrected row is right.

**S4 (remove the real-instant filter, now at `recurrence.ts:116`): 21 red, as observed.**

With the filter gone, every candidate in the widened `[ws − 24 h, we + 24 h]` query is returned.

`recurrence.test.ts`, 15 red:
- Under both clocks:
  - (i)/U4: the Mar 10 02:30 wall time leaks in.
  - (ii)/U1: Nov 3 leaks in.
  - U2: Apr 6 leaks in.
  - U6: Mar 30 leaks in.
  That makes 8.
- U7, U8, U9, U10, U11, U12 and U14 each gain neighbouring days. That makes 7 more.

`recurrence-consumers.test.ts`, 5 red:
- C1 gets 62 rows instead of 60, because Jan 12 and Jan 13 leak in.
- C4 gets the past Nov 13 16:00Z row.
- C6 (both orders): `keys` becomes `[Oct 31, E1, Nov 2]`.
- C7 gets four digest lines instead of two.

`occurrences-http.test.ts`, 1 red:
- H1 gains Jul 1 and Jul 2.

The total is 15 + 5 + 1 = **21**, which matches the observed figure.

**Correctly green under S4:**
- U3 and U5 (both clocks): COUNT=96 bounds them, and every value already lies inside the window.
- C2 and C3: they assert one occurrence's row and the sends, and no extra row falls inside the
  grace window.
- C5 (both clocks): it asserts only the Nov 1 band.
- U13 (still `[]`), C0, and the non-recurring and existing tests.

## R4.2 Findings

### F-R4-1 — REQUIRED (permanent-record text). The v4 edit left two passages that contradict the corrected S1 row. Documentation only; does not affect the shipped code or tests.

- **§7.5 sweep, plan lines 716-717.** It still says: "C6 stays green under S1, because both
  seasons are consistently wrong. That is acceptable: U1 catches S1, and C6's job is agreement,
  not choice." This is now false, and it sits a few lines below the S1 row that says the opposite.
- **§11 manifest, line 919.** It still lists "C6/S1" among "The known blind spots".

**My error in round 1.** I verified the S1 row's listed set and did not challenge this bullet. It
was wrong from v1: C6 asserts the key value, not only agreement. The next reader should not
inherit that claim.

**Required change:**
- Delete the C6/S1 bullet at lines 716-717, or replace it with: "C6 also catches S1, because it
  asserts `keys` equals `[E1]`, not only cross-season agreement."
- Drop "C6/S1" from the blind-spot list at line 919.

### N-R4-1 — NIT. S4's wording "every exact-`toEqual` window test" over-generalises. The number 21 is right.

U3, U5, C2, C3 and C5 are also exact-`toEqual` tests, and they stay green (R4.1). AC-4 checks that
"every listed test went red", so an explicit list is the better record. Suggested replacement for
the S4 red set:

> (i)/U4 ×2, (ii)/U1 ×2, U2 ×2, U6 ×2, U7, U8, U9, U10, U11, U12, U14, C1, C4, C6 ×2, C7, H1 (21)

Separately, S4 still cites the filter at `:102`. That was the pre-fix line; it is now
`recurrence.ts:116`. This is cosmetic.

## R4.3 Required changes (v4)

1. **F-R4-1.** Remove the stale "C6 stays green under S1" bullet (§7.5, lines 716-717) and the
   "C6/S1" blind-spot entry (§11, line 919), or replace both with the corrected statement.

This is a two-line documentation fix in a post-implementation record. No code, test, AC or
DevOps step depends on it.

APPROVE WITH CHANGES

---
---

# Re-review (v5)

**Reviewer:** Plan-Reviewer · **Date:** 2026-11-13 · **Round:** 5 (documentation only)

## How I checked that nothing else changed

The coordinator supplied the complete diff from the approved v3 (commit `0cce263`) to the current
file, saved in the session scratchpad as `plan-v3-to-v5.diff`. I read all of it and spot-checked
it against the plan by grep (lines 716, 920 and 994 match).

The diff has exactly four hunks:

1. **§7.5 table.** Only the S1 and S4 rows changed. S2, S3a–S3c and S5–S7 appear as unchanged
   context.
2. **§7.5 sweep.** Only the C6/S1 bullet changed.
3. **§11 manifest.** Only the blind-spot sentence changed.
4. **§12.** The v4 and v5 log entries were appended.

No design, test, AC, SQL or DevOps text changed.

## Status

| Finding | Status | Evidence |
|---|---|---|
| **F-R4-1** (REQUIRED) | **Resolved** | The §7.5 sweep bullet (line 716) now reads "C6 also catches S1: it asserts the completion key equals `[E1]` … in both orders". The §11 blind-spot list (line 920) is now "U5/S2, W2, A2, U13". No remaining text says C6 stays green under S1 |
| **N-R4-1** (NIT) | **Resolved** | The S4 row lists the 21-test red set exactly as traced in R4.1, names the tests that correctly stay green, and cites `recurrence.ts:116`. The red sets for S1 (10) and S4 (21) now agree with each other, with §7.3, and with the committed test files |

**One leftover, no action needed.** The v4 log entry still describes S4 as "all 21 exact-`toEqual`
window tests". That wording is a historical log line, the v5 entry directly below supersedes it,
and the authoritative S4 row is now precise.

No new findings.

APPROVE
