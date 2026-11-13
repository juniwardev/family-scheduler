# Plan Review: Family Scheduler Implementation Design

**Reviewer:** Plan-Reviewer (adversarial, read-only)
**Plan under review:** `docs/plans/family-scheduler-design.md` (amended 2026-06-28)
**Locked spec:** `docs/family-scheduler-build-spec.md`
**Requirements:** `docs/original-requirements.md`

---

# PASS 4 (D14 focused review — app-level enforcement of the `active` flag)

**Date:** 2026-06-28
**Scope:** Narrow, adversarial review of the ONE new amendment added after the clean Pass-3 APPROVE: **Decision D14** (deactivated users get `403 DEACTIVATED` from `requireAuth`) and everything it touches — amended D6 + its SUPERSEDED block, Flag F5, §1.2 `requireAuth`/`index.ts` ordering, §2 global conventions + code→status table, §2.1/§2.2/§2.6 route auth notes, §1.3 frontend handling, Appendix 6.1 (`Result<T>` union + `User.active`), and Tasks 1.1/6.4/7.1. The already-approved D1–D13 / M1–M5 / N1–N9 / P2-N1..N3 material was NOT re-litigated; I only checked that the D14 amendment did not regress it.

## Headline

D14 is sound. The gate ordering (verify JWT → upsert → check `active` → `403 DEACTIVATED` → else proceed) is correct, lives in the single shared `app.use('/api/*', requireAuth)` middleware so it is unbypassable and uniform, and the self-lockout risk is genuinely handled: the server-side self-deactivation guard in `setUserActive` plus the single-admin (owner-only) model means there is no in-app path for the sole admin to `403`-lock themselves out. `DEACTIVATED`→403 is consistent across the conventions table, the `Result<T>` union, `requireAuth`, the frontend contract, and the route notes, and is correctly kept DISTINCT from `requireAdmin`'s `403 FORBIDDEN`. Traceability to the owner decision (§6.4) holds and the locked architecture is untouched (the spec already mandates a verify-JWT-then-upsert middleware; D14 inserts one `active` check into it). No Blocking or Major issues. Three Minor-Nits below are optional polish, not required changes. Verdict: APPROVE.

## D14 — what's correct (do NOT churn these)

- **Gate ordering & unbypassability.** §1.2 (lines 117–124, and D14 lines 585–589) place the `active` check AFTER the upsert and BEFORE `c.set('user')`/route dispatch, inside the one global middleware. Because `upsertUser` is documented to NEVER reset `active` (lines 144–147), a deactivated row stays `active=0` through the upsert and is caught every request. No persistent bypass exists; the only "window" is a single in-flight request that already passed `requireAuth` before deactivation committed — unavoidable, single-tick, harmless.
- **Self-lockout handling.** The guard is enforced in `db.setUserActive` (lines 156–158, 485), with `callerEmail` derived from the verified JWT (not the body), so it cannot be spoofed. v1 is explicitly single-admin (owner only; no promote/demote — §2.6 line 471, O1 line 843), so no *other* admin exists to deactivate the owner. Net: no in-app route drives `owner.active → 0`. The plan correctly identifies this guard as now load-bearing (D14 line 591, §2.6 line 485).
- **Owner exemption.** Owner is seeded `active=1` on first insert and `role` is re-promoted on every login via `ON CONFLICT` (lines 144–147, 587); combined with the guard, the owner is never gated.
- **Consistency of `DEACTIVATED`→403.** Conventions table (line 322), global "Deactivated account" note (line 320), `Result<T>` union (line 709), `requireAuth` (lines 120, 588), frontend (lines 288–289, 303), and §2.1 errors (lines 339, 345) all agree on `403 DEACTIVATED`, and all explicitly distinguish it from `FORBIDDEN`. The SUPERSEDED D6 block (line 521) correctly retires the old "does not block sign-in / reminders-only" wording; no surviving section still claims `active` is reminders-only.
- **`GET /api/me` claim holds.** Because the gate is in shared middleware, a deactivated user truly "can no longer reach `/api/me`" (lines 329, 338) — the claim is consistent with the architecture.
- **Frontend contract.** §1.3 (line 303) + `apiClient`/`App` rows (lines 288–289) specify the exact trigger (HTTP 403 + code `DEACTIVATED`), require it be distinguished from `401`/generic `FORBIDDEN`/error, and scope it as a UX affordance over server-side enforcement. Precise enough for the Coder.
- **Traceability & scope.** Owner-approved in §6.4 (line 841); the app-level vs Access-allowlist relationship is stated as complementary, not a substitute (D14 lines 595–598, D6 line 519, §1.2 line 133, Task 7.1 line 656). No stack change. No over-reach.
- **Task coverage proves D14.** Task 1.1 (line 617) tests 403 on `/api/me` AND another `/api/*` route, reactivation→200 with no re-login, owner never gated, and `DEACTIVATED ≠ FORBIDDEN`. Task 6.4 (line 651) tests deactivation blocks app access (`/api/me` + `POST /api/items`), purged reminders don't fire, reactivation restores access, and self-deactivation is rejected server-side (400). Coverage is complete against the six review criteria.
- **No new internal inconsistency.** Decision count updated 13→14 (line 494, revision note line 9) and is self-consistent. Every `D14` reference resolves to a defined decision. No dangling IDs introduced.

## Findings (Pass 4)

### Blocking
None.

### Major
None.

### Minor-Nit

**P4-N1 — §1.2 over-attributes the owner exemption to the upsert; the actual guarantee is the self-deactivation guard.**
Location: §1.2 `requireAuth` comment (lines 122–124) and `db.ts upsertUser` note (lines 146–147): "the owner is seeded active=1 here, so the owner is never gated out." This reads as if the upsert *re-seeds* `active=1` for the owner on every login. It does not — `upsertUser` is explicitly documented to NEVER reset `active` on conflict (line 144), so it only seeds `active=1` on the FIRST insert; thereafter it preserves whatever is in the row. The real, correctly-stated-elsewhere guarantee that the owner is never gated is the self-deactivation guard + single-admin model (D14 line 591, §2.6 line 485), NOT upsert re-seeding. The conclusion is sound; only the stated reason in §1.2 is imprecise. Concrete fix (one clause): change "the owner is always seeded active+admin and can never be locked out by this gate" to "the owner is seeded active on first login and, because the self-deactivation guard + single-admin model prevent the owner's row from ever becoming `active=0`, is never gated by this check." This also forecloses a Coder mis-reading where they force `active=1` for the owner on conflict (which would contradict the "never reset active" rule).

**P4-N2 — The gate's correctness depends on `upsertUser` RETURNing the persisted `active`, not a constructed default; state it as an explicit contract.**
Location: `db.ts upsertUser` signature/notes (lines 148, 146–147) and §1.2 step 2→3. The `active` check reads `user.active` off the object returned by `upsertUser`. If an implementation builds that return object optimistically (e.g., assumes `active=1` for a freshly-upserted row instead of `RETURNING active` / re-selecting), a deactivated user would slip through on the upsert path. The plan implies but never states that the returned `User` must reflect the persisted row. Concrete fix (one sentence in the `upsertUser` note or Task 1.1 done-criteria): "`upsertUser` MUST return the persisted row's `active` value (via `RETURNING`/re-select), since `requireAuth`'s D14 gate reads it." Task 1.1 already tests the deactivated-user 403, which would catch a regression — so this is a clarity nit, not a hole.

**P4-N3 — No documented recovery path / forward-looking guard caveat for an owner that somehow becomes `active=0`.**
Location: D14 (lines 591, 600) and §2.6 (line 485). v1 is safe: the guard + single-admin model make `owner.active=0` unreachable through the app, so the gate can never lock the owner out via any in-app action. But the plan never states (a) that the ONLY way out of an `owner.active=0` state — reachable solely via direct DB edit / data corruption — is a DB edit back (no in-app recovery, by design), and (b) that IF multi-admin is ever added in a future version, the self-deactivation guard is insufficient (admin A could deactivate admin B / the last admin) and must be generalized to "cannot deactivate the last active admin." Concrete fix: add one caveat sentence to D14 noting the DB-edit recovery path is the documented escape hatch for the (DB-surgery-only) owner-inactive state, and a forward-looking note that a future multi-admin model must extend the guard to protect the last admin, not just self. Purely documentation; no v1 code impact.

## Regression scan (D14's blast radius on already-approved material)

- Reminder audience (migration `0003`, `listActiveUsers`, materialize/digest) is unchanged by D14 — D6 line 517 and F5 line 672 both confirm only the *access* consequence was added. No regression to M1/M3 audience logic.
- D7's deactivation purge (`deletePendingDispatchForRecipient`) and the P2-N2 bounded-reactivation claim are untouched and now correctly cross-referenced from D14 ("app access restored immediately; reminder back-fill separate and bounded" — lines 486, 534, 600). No drift.
- Per-route error lists that don't repeat "(DEACTIVATED)" (e.g. `DELETE /api/lists/:id` line 373) are NOT a contradiction: the §2 global convention (line 320) states the gate applies uniformly to every `/api/*` route with no per-route handling, so omission in a route's local error list is consistent. No action needed.

## Required changes

None are required to begin implementation. P4-N1, P4-N2, and P4-N3 are Minor-Nit clarifications the Architect may fold in opportunistically; none change the design or block the Coder.

D14 is correct, consistent, and traceable; the self-lockout hole is genuinely closed by a server-side guard within a single-admin model; nothing in D1–D13 regressed. Closeout for the D14 amendment: APPROVE.

---

# PASS 3 (final closeout review)

**Date:** 2026-06-28
**Scope:** Narrow confirmation that the three remaining Pass-2 Minors (P2-N1, P2-N2, P2-N3) were folded in correctly and introduced no new problems. No re-litigation of M1–M5 / N1–N9, all of which were confirmed resolved in Pass 2.

## Headline

All three Pass-2 Minors are genuinely resolved in the plan text and are internally consistent across every location they touch. No new blocking or major issue introduced. Final verdict: APPROVE.

## The three fixes — verified

**P2-N1 (deletion ordering before FK cascade) — RESOLVED, consistent everywhere.**
The cleanup-before-cascade ordering is now stated as a HARD REQUIREMENT in all claimed locations and they agree:
- §1.2 `deleteList` (lines 153–158) and `deleteItem` (lines 167–171): explicit "Order: cleanup → then cascade," with the no-FK rationale.
- §1.2 helper comments: `deletePendingDispatchForItem` (line 189, "MUST run BEFORE the items FK cascade") and `deletePendingDispatchForList` (line 190, "MUST run BEFORE the lists FK cascade").
- §2 `DELETE /api/lists/:id` (line 357) and `DELETE /api/items/:id` (line 411): "FIRST purge … THEN issue DELETE …," labeled HARD REQUIREMENT.
- D7 trigger 3 (line 507): "pending-dispatch cleanup MUST run BEFORE the FK cascade (HARD REQUIREMENT — P2-N1)."
- §6.1 `ReminderDispatch` type comment (lines 722–723): "deletion cleanup must precede any items/lists FK cascade (P2-N1)."
- F6 QA list (line 631) and Tasks 1.4 (line 577) / 6.2 (line 606): ordering + "no orphaned dispatch rows" assertions present in done-criteria.
No contradiction: the plan consistently states `reminder_dispatch` has NO FK to items/lists, while the FK cascade descriptions it does keep (items→reminders, lists→items→reminders via `ON DELETE CASCADE`, e.g. D5 schema line 493) are about other tables and coexist cleanly with the requirement.

**P2-N2 (softened reactivation claim) — RESOLVED, no overstatement remains.**
The bounded truth is now stated everywhere and the old "correct by construction" assertion is gone (grep confirms zero occurrences):
- D7 reactivation paragraph (line 512): "NOT unconditional back-fill," re-creates via INSERT OR IGNORE for still-future occurrences in the lookahead window, and explicitly does NOT resurrect a reminder whose `fire_at` already passed or fell outside lookahead/grace, with the worked "1 hour before" example tied to the `fire_at > now − GRACE_MINUTES` selection.
- §2.6 PATCH side-effect note (line 472): same bounded statement, "does NOT back-fill the muted window (P2-N2)."
- Task 6.4 (line 608): re-creates reminders "for occurrences whose `fire_at` is still in the future … already elapsed … intentionally NOT back-filled."
- Flag F5 (line 629): "bounded to still-future `fire_at` — see D7/P2-N2."
The surviving phrase "needs no special code path" is accurate (materialize self-heals; no new code is required) and is now immediately qualified by the bounded back-fill statement in both places it appears, so it no longer contradicts the bounded reality.

**P2-N3 (aged-out `pending` rows) — RESOLVED, consistent with the grace predicate.**
The "leave inert as `pending`, no sweep" decision is stated and internally consistent with the `fire_at > now − GRACE_MINUTES` selection predicate (defined in §1.2 send.ts, line 243):
- §1.2 send.ts bullet (line 245): "Chosen behavior: leave it inert as `pending`; there is NO sweep to a terminal state," with the backlog-signal consequence noted.
- D13 (line 555): "deliberately NO sweep," same predicate, downtime-signal framing.
- §6.1 `ReminderDispatch.status` comment (lines 720–722): "never re-selected by sendDue … left inert as `pending` (no sweep to `failed`)."
- F15 (line 649): "left inert with no sweep — bounded, harmless debris."
- Task 5.3 done-criteria (line 600): explicitly tests that an aged-out `pending` row is NOT re-selected and is left inert (no sweep).

## Focused consistency check (touched areas only)

- The grace-window predicate `fire_at > now − GRACE_MINUTES` is identical across send.ts selection (243), aged-out handling (245), reactivation (472, 512), and D13 (555). No drift.
- No new decision/flag/task IDs were dangled; P2-N1/N2/N3 are review-finding IDs referenced consistently. D-count line (480) still reads "13 decisions" and remains correct.
- Signatures untouched by these edits: `deleteList`/`deleteItem` remain `Result<void>`; the four `deletePendingDispatchFor*` helpers are unchanged; §1.2 and §2 still agree.
- The deletion-ordering requirement does not contradict any cascade description elsewhere — the only cascades the plan relies on are the FK-bound ones (items, reminders, `item_occurrence_state`), and `reminder_dispatch` is uniformly described as non-FK-bound and engine-owned.

## New issues introduced by the fixes

None. The three edits are text clarifications that tighten existing semantics; they add no new code path, signature, or dependency.

All three Pass-2 Minors are resolved and clean. This is a closeout APPROVE.

---

# PASS 2 (second-pass adversarial review of the amended plan)

**Date:** 2026-06-28
**Scope:** Verify Pass-1 findings (M1–M5, N1–N9) are actually resolved in the plan text, and adversarially review the new/changed material (D7 6-trigger purge + four `deletePendingDispatchFor*` helpers, reactivation path, D10 DST cases, D13/F15 retry semantics, admin surface + F14 body-email + owner ON CONFLICT promotion, M3 completion↔materialize) for problems the amendments introduced.

## Headline

The amendments land. All five Pass-1 Majors (M1–M5) and all nine Minors (N1–N9) are genuinely resolved in the plan text — not merely claimed. I independently recomputed the three D10 DST cases (and the spring-forward/fall-back dates for 2026) and the arithmetic is correct end to end, including the subtle real-duration `fire_at` in case (iii). The D13/F15 retry semantics are safe against double-send across push fan-out and across channels. The self-deactivation guard is genuinely server-side and unbypassable. I found no Blocking and no Major regressions introduced by the amendments. Three Minor items remain — the only one with teeth is an unstated ordering requirement for dispatch cleanup on list/item deletion (`reminder_dispatch` has no FK, so cleanup must run *before* the cascade). Fold the three in and proceed to implementation; no further architect round is required.

## Resolved since Pass 1 (confirmed — do not churn these)

- **M1 (audience-leak / stale dispatch).** D7 is now a 6-trigger purge list (lines 493–500) that explicitly covers the visibility flip (trigger 4 → `deletePendingDispatchForList`) and user deactivation (trigger 5 → `deletePendingDispatchForRecipient`). Wired into `PATCH /api/lists/:id` side effect (line 340), `PATCH /api/admin/users` side effect (line 462), the four new db helpers (lines 180–183), and Phase 6.2 / 6.4 done-criteria (lines 596, 598). The visibility-flip leak and deactivation leak are both closed.
- **M2 (un-complete unrepresentable).** `completeItem` now takes `completed: boolean` (line 166) with set/clear semantics enumerated for both recurring and non-recurring (lines 185–189). Route `/complete` body `{ occurrence_at?, completed? }` (line 407) maps cleanly.
- **M3 (completion does not stop reminders).** materialize is now completion-aware (line 223), backed by `getActiveItemsWithReminders` excluding completed non-recurring items (line 175), `getCompletedOccurrences` (line 176), and `/complete` purging via `deletePendingDispatchForOccurrence` / `deletePendingDispatchForItem` (line 410). Un-complete correctly relies on the deleted (not status-flipped) pending row so `INSERT OR IGNORE` re-creates it; an already-`sent` row correctly survives and is not re-sent.
- **M4 / N9 (Task 2.3 unmeetable + duplicate Deps).** Task 2.3 now verifies non-recurring render only (line 573, single `Deps:`); recurring calendar render moved to new Task 5.4 (line 591, `Deps: 5.1, 2.3`).
- **M5 (terminal `failed` drops reminders).** New Decision D13 (lines 543–549) + Flag F15 (line 639): transient stays `pending`, permanent 4xx → `failed`, zero-subscription push → `sent` no-op. Reflected in `ReminderDispatch` type comment (lines 709–711) and Task 5.3 done-criteria (line 590).
- **N1.** Stale O1/F3/F5 narrative reconciled: F3 (line 615) and F5 (line 619) now say RESOLVED and "middleware is real, not a stub"; §3 intro (line 470) and 6.4 (line 784) mark O1 resolved. The "one follow-on product question remains" wording is gone.
- **N2.** F13 now cites Tasks 5.1 and 6.5 (line 635).
- **N3.** D2 now says "Phase 3 (Task 3.4)" (line 474).
- **N4.** `GET /api/me` example includes `"active": true` (line 310); `User` type carries `active` (line 660).
- **N5.** `upsertUser` documented as `ON CONFLICT(email) DO UPDATE` promoting a pre-existing owner row to admin while never downgrading others and never resetting `active`/`display_name` (lines 132–136); covered in Task 1.1 test (line 564).
- **N6.** D10 normalizes `UNTIL` by comparing each candidate's UTC-mapped instant against the UTC `UNTIL` (line 517); near-`UNTIL`+DST test mandated in Task 5.1 (line 588).
- **N7.** CalendarView parallel per-list fetch documented (lines 282, 573).
- **N8.** Edit-vs-cron race acknowledged (line 504) and `markDispatch` is `UPDATE … WHERE id=? AND status='pending'` (line 179).

## Verification of new/changed material

- **D10 DST arithmetic — independently recomputed, correct.** 2026 transitions are right (spring-forward Sun Mar 8, fall-back Sun Nov 1). Case (i) 02:30 across spring-forward: 10:30Z / 10:30Z (gap→03:30 PDT) / 09:30Z — correct. Case (ii) 01:30 across fall-back: 08:30Z / 08:30Z (earlier=PDT) / 09:30Z — correct, and the rejected later instant (09:30Z) is correctly labeled. Case (iii) offset crossing: occurrence 16:00Z, `fire_at` = 16:00Z − 8h = 08:00Z, with the 9h wall-clock-vs-8h-real-duration explanation correct. Disambiguation (gap→shift forward, overlap→earlier) is applied in the same local→UTC mapping used for the `UNTIL` comparison, so expansion and `UNTIL` are internally consistent.
- **D13/F15 retry — no double-send, no infinite retry.** Bounded to ~6 ticks by `GRACE_MINUTES=30`. Push fan-out marks the row `sent` when ≥1 endpoint succeeds, so a transient failure on a second endpoint does not cause a re-select and therefore cannot double-send the endpoint that already succeeded (it under-sends the failed endpoint instead — acceptable best-effort). Email and push are separate dispatch rows, so no cross-channel double-send. `markDispatch` is only called for terminal `sent`/`failed`; transient simply skips it. Consistent.
- **Admin self-deactivation guard — unbypassable.** Enforced inside `db.setUserActive(callerEmail, targetEmail, active)` (lines 147, 461). `callerEmail` derives from the verified JWT (`c.get('user')`), not the body, so it cannot be spoofed. Correct.
- **F14 email-in-body.** `PATCH /api/admin/users` carries `target_email` in the body (line 459) via `AdminUpdateUserInput` (line 745). Removes the PII-in-path leak. Minor REST-purity deviation (collection-level PATCH) but justified and self-consistent within the admin surface.
- **Owner ON CONFLICT promotion — no clobber.** Promotes role→admin only for `OWNER_EMAIL`, never downgrades others, never touches `active`/`display_name` (lines 132–136). Safe.
- **ID / signature / dependency consistency.** D1–D13 and F1–F15 all defined and referenced consistently; "Count: 13 decisions" (line 470) matches. Task deps after the renumber are correct (5.4→5.1,2.3; 6.4→1.1,6.2; 5.3→5.2,3.4,4.1). `completeItem`, `setUserActive`, `markDispatch`, and `AdminUpdateUserInput` signatures agree between §1.2 and §2.

## Findings (Pass 2)

### Blocking
None.

### Major
None. (All Pass-1 Majors resolved; no new Major introduced.)

### Minor

**P2-N1 — Dispatch cleanup on list/item deletion must run BEFORE the FK cascade.**
Location: D7 trigger 3 (line 497) and `DELETE /api/lists/:id` (line 347). `reminder_dispatch` has no FK to `items` or `lists` (the plan states this), so it is NOT cascade-deleted. `deletePendingDispatchForList(listId)` and per-item cleanup must resolve their target rows by looking up the list's items — but if the `DELETE FROM lists` cascade fires first, the items are already gone and the lookup matches nothing, orphaning the pending dispatch rows (which then fire at the old time). The plan never states the ordering. Fix: in D7 trigger 3 and the `DELETE /api/lists/:id` and `DELETE /api/items/:id` behavior notes, state explicitly that pending-dispatch cleanup runs *before* the cascade delete (or capture item IDs first). One sentence.

**P2-N2 — Over-stated "reactivation is correct by construction" — a reminder whose `fire_at` elapses during deactivation is lost, not restored.**
Location: D7 line 502 ("re-creates their dispatch rows … for every still-future occurrence") and Task 6.4 done-criteria (line 598, "reactivating … re-creates their reminders"). Materialize re-creates a dispatch row only if the *occurrence* is still in the window, but `send.ts` selects on `fire_at > now − GRACE_MINUTES`. If a reminder's `fire_at` fell inside the deactivation window (e.g., a "1 hour before" reminder for an event still days away, where the user was muted across that hour), the re-created row ages out unselected and the reminder never fires even though the occurrence is future. This is defensible behavior (you don't get reminders for the window you were muted), but the blanket "correct by construction" claim is inaccurate. Fix: qualify the claim — reactivation restores reminders for occurrences whose `fire_at` is still in the future (or within grace); reminders whose `fire_at` already elapsed during deactivation are intentionally not back-filled.

**P2-N3 — Aged-out `pending` rows are never reclassified (ledger hygiene / observability).**
Location: D13 (line 545, "ages out unselected"). Transient-failure rows that exhaust the grace window remain `status='pending'` forever. They are harmless to the hot send query (bounded by `fire_at > now − GRACE`), but they pollute any "pending backlog" signal and make a genuinely-stuck row indistinguishable from an aged-out one. Fix (optional polish): either add a note that aged-out `pending` rows are acceptable debris at family scale, or have a sweep mark `fire_at < now − GRACE AND status='pending'` rows as `failed`. Decide and document; do not leave it implicit.

Two trivia, no action required: (a) `getCompletedOccurrences(itemId)` returns all completed occurrences unbounded — fine at family scale, but materialize only needs those within the window if a daily task accrues years of rows; (b) a completed non-recurring item later edited to add an `rrule` keeps `completed_at` set and would be excluded by `getActiveItemsWithReminders` — a real but vanishingly unlikely edge.

## Required changes (fold in before/while implementing; no further architect round needed)

1. **P2-N1:** State that pending-dispatch cleanup runs before the FK cascade on list/item deletion (D7 trigger 3, `DELETE` route behavior notes).
2. **P2-N2:** Qualify the "reactivation is correct by construction" claim (D7, Task 6.4) to exclude reminders whose `fire_at` elapsed during the deactivation window.
3. **P2-N3:** Document the intended fate of aged-out `pending` rows (accept as debris, or sweep to `failed`).

These are small text clarifications; none require architectural rework and none block starting implementation.

> **Pass-3 update:** All three Pass-2 required changes above were folded in and verified in the Pass 3 section at the top of this file.

---

# PASS 1 (original review — retained for history; superseded above)

> All Pass-1 findings below were folded into the amended plan and are confirmed resolved in the Pass-2 "Resolved since Pass 1" section. Kept verbatim for the audit trail.

**Reviewer:** Plan-Reviewer (adversarial, read-only)
**Date:** 2026-06-28

## What I reviewed

I read the full design plan, the locked build spec, and the original requirements. I checked completeness against the spec's API list and data model, correctness of the resolved decisions (especially the high-risk areas the plan itself flags: recurrence/DST D10/D11, stale-dispatch D7, push fan-out D8, per-occurrence completion D5, the admin/active-flag additions), internal consistency between route contracts / type definitions / db interfaces / migrations / phase dependencies, adherence to the locked stack, traceability, and whether the phases are executable in order.

Overall this is a strong, careful plan that stays inside the locked architecture and resolves the spec's genuine ambiguities with sound reasoning. The findings below are correctness gaps and internal inconsistencies that should be folded in before coding, not a call for a rewrite.

### Blocking
None.

### Major

**M1 — Dispatch cleanup (D7) ignores audience-changing events, causing a reminder privacy leak.** D7 did not fire on a `shared → private` visibility flip or on admin `active = 0`; up to 60 days of pending rows addressed to the former audience keep firing. Fix: purge pending dispatch on visibility flip (per list) and on deactivation (per recipient); add to Phase 6.2 / 6.4 done-conditions.

**M2 — `completeItem` interface cannot express "un-complete"; route and db contract disagree.** Route accepts `completed?: boolean` but the db function takes no `completed` argument. Fix: add `completed: boolean` and define set/clear for recurring and non-recurring.

**M3 — Completion does not stop reminders, and materialize has no completion awareness.** Completing a task does not purge dispatch and materialize re-creates rows for completed occurrences. Fix: materialize skips completed occurrences; `/complete` purges dispatch.

**M4 — Task 2.3 done-condition is unmeetable in Phase 2 (depends on Phase 5).** Recurring render requires `recurrence.ts` (Phase 5). Fix: split so each done-condition is checkable at its own phase.

**M5 — `failed` dispatch rows are terminal; a transient send error permanently drops a reminder.** Fix: keep transient failures `pending` (retry within grace); only permanent 4xx → `failed`; define the zero-subscription push outcome.

### Minor / Nits
N1 stale O1/admin narrative; N2 F13 wrong task numbers; N3 D2 wrong phase ref; N4 `/me` omits `active`; N5 owner promotion on existing row unspecified; N6 `UNTIL` UTC vs floating expansion; N7 CalendarView per-list fan-out; N8 edit-vs-cron race; N9 duplicated `Deps:` on Task 2.3.

## Pass-1 required changes (all now folded in)

1. Extend D7 to cover visibility flips and deactivation (M1).
2. Add `completed: boolean` to `completeItem` (M2).
3. Define completion↔reminder interaction (M3).
4. Split Task 2.3 (M4).
5. Resolve terminal-`failed` retry behavior + zero-subscription outcome (M5).
6. Reconcile O1/admin narrative; fix F13/D2 task numbers (N1–N3).
7. `/me` consistency re `active`; owner promotion via ON CONFLICT (N4, N5).

Pass-1 verdict was: APPROVE WITH CHANGES.

---

APPROVE
