# Build-Phase Checklist: Family Scheduler

Shared definition of done for the Coder and QA. The approved design is `docs/plans/family-scheduler-design.md` (APPROVE, Pass 3). This checklist does not introduce new design; it pins the gate points and the behavioral tests that must actually pass at each phase, because several of this plan's correctness guarantees compile clean while being silently wrong.

## Rules of the loop

- "It builds" (lint + typecheck green) is necessary, not sufficient. A phase is done only when its behavioral tests below pass on real data.
- Commit at every phase boundary. The approved plan is a frozen git ref; any design change discovered mid-build is a diff against it, routed back through review, never a silent edit.
- Hard gates stop for an explicit go from the owner (or QA) before the next phase starts. Checkpoints commit and continue.
- Authorization and idempotency are enforced server-side, never only in the UI. QA tests them by calling the API directly, not by clicking.

## Gate map

| Phase | Type | Why |
|---|---|---|
| 0 Scaffold + schema | checkpoint | foundation |
| 1 API Worker + auth | HARD GATE | highest-risk security code |
| 2-3 Frontend (React + Vite) | checkpoint | |
| 4 Web Push | checkpoint | per-device behavior, iOS install |
| 5 Email + reminder engine | HARD GATE | correctness heart |
| 6 Digest, sharing, completion, admin, E2E | checkpoint | |
| 7 Deploy enablement | HARD GATE | touches D1, secrets, Access policy |

---

## Phase 0 — Scaffold + schema (checkpoint)
- [ ] `wrangler d1 migrations apply --local` applies `0001_init`, `0002_occurrence_state`, `0003_user_active` cleanly; all tables and the `users.active` column exist.
- [ ] `tsc --noEmit` passes; `wrangler dev` serves a placeholder.
- [ ] Commit.

## Phase 1 — API Worker + auth (HARD GATE)
Auth is the security boundary. Do not let anything build on it until these pass.
- [ ] `verifyAccessJwt` accepts a correctly signed token and rejects forged, expired, and wrong-`aud` tokens (RS256; checks `iss`, `aud`, `exp`).
- [ ] Identity comes from the verified JWT, not the `Cf-Access-Authenticated-User-Email` header.
- [ ] `upsertUser` seeds `role='admin'` when the email equals `OWNER_EMAIL` and `'member'` otherwise; the owner-promotion `ON CONFLICT DO UPDATE` never resets `active` or `display_name`.
- [ ] `requireAdmin` runs only after `requireAuth` (verified by mount order) and returns 403 for a member.
- [ ] Authorization: a member gets 403 reading or writing another user's private list; shared lists are readable and writable by any active user.
- [ ] Editing an item's timing (`start_at`/`end_at`/`rrule`/`timezone`/`all_day`) or its reminder set deletes that item's PENDING dispatch rows (D7), leaving `sent`/`failed` untouched. Behavioral test: edit time, confirm the old reminder does not fire.
- [ ] **GATE: owner/QA sign-off before Phase 2.**
- [ ] Commit.

## Phases 2-3 — Frontend (checkpoint)
- [ ] List and item CRUD, the reminder-offset control (days/hours/minutes), and both list and month-calendar views work against the real API.
- [ ] Calendar range query (`?from&to`) returns expanded occurrences correctly for a recurring item.
- [ ] Commit.

## Phase 4 — Web Push (checkpoint)
- [ ] A manual push is received on: an installed iPhone PWA, an Android browser, and a desktop browser.
- [ ] iOS: install-state detection works; the Add-to-Home-Screen nudge shows only when on iOS and not standalone; permission is requested only after the PWA is opened standalone.
- [ ] A `404`/`410` from a push endpoint deletes that subscription row.
- [ ] Commit.

## Phase 5 — Email + reminder engine (HARD GATE)
The correctness heart. Every item below is a behavioral test on real data, not a type check.
- [ ] Idempotency: re-running materialize is a no-op (UNIQUE / INSERT OR IGNORE); no duplicate dispatch rows.
- [ ] DST (D10), verified against the exact `Date.UTC(...)` values stated in the plan:
  - [ ] Spring-forward (Mar 8, 2026): a daily local time that does not exist shifts forward per the stated rule.
  - [ ] Fall-back (Nov 1, 2026): an ambiguous local time resolves to the earlier instant.
  - [ ] A reminder offset that crosses the boundary produces the correct real-duration `fire_at`.
  - [ ] `UNTIL` is compared in UTC space.
- [ ] Deactivation purge (M1): deactivate a user who already has PENDING materialized reminders, then confirm those reminders do not fire. Reactivation re-creates rows on the next materialize within the lookahead window; a `fire_at` that already passed while deactivated is NOT resurrected.
- [ ] Deletion ordering: deleting a list or item runs dispatch cleanup BEFORE the FK cascade (`reminder_dispatch` is intentionally not FK-bound), so no rows orphan.
- [ ] Retry semantics (D13): a transient send failure stays `pending` and retries; only a permanent 4xx becomes `failed`. No double-send across multi-device push fan-out.
- [ ] Aged-out rows: a `pending` row whose `fire_at` slipped past the grace window stays inert (skipped by `fire_at > now - GRACE`), not resent.
- [ ] **GATE: owner/QA sign-off before Phase 6.**
- [ ] Commit.

## Phase 6 — Digest, sharing, completion, admin, E2E (checkpoint)
- [ ] Daily digest (second cron) lists each active user's today+tomorrow items, once per active user; inactive users are excluded.
- [ ] Per-occurrence completion: completing one occurrence of a recurring task does not complete the series and persists across reload; completion cancels/skips that occurrence's reminders.
- [ ] Admin self-deactivation guard is enforced in `db.setUserActive` (server-side), with `callerEmail` from the verified JWT; a member sees no admin UI and gets 403 on `/api/admin/*`.
- [ ] `listAllUsers` is used only for the admin roster; audience and digest use `listActiveUsers`.
- [ ] `PATCH /api/admin/users` takes `target_email` in the body (not the URL path).
- [ ] Playwright E2E green for auth + reminder + completion + admin flows.
- [ ] Commit.

## Phase 7 — Deploy enablement (HARD GATE, DevOps)
- [ ] **GATE: owner go required before any of this runs.**
- [ ] `d1 create`, apply migrations, set secrets/vars, `wrangler deploy`, create the Access app + allowlist policy, copy the AUD into config, redeploy.
- [ ] On each phone: sign in through Access, Add to Home Screen (iPhone), enable notifications, confirm a real reminder arrives.
- [ ] Confirm the Cloudflare Access free seat cap comfortably covers the family.
- [ ] Commit + tag the release.
