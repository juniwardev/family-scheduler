# Production smoke test — `item-archive` on `507ebcf1`

**Date:** 2026-09-21
**Target:** `https://family-scheduler.juniwar-dev.workers.dev`, version **`507ebcf1`**
**Database:** remote D1 `family-scheduler`, migration `0007_item_archived` applied
**Verdict: PASS.** Every leg of the feature works against real data. No defect found.

## Provenance — read this before treating it as a QA-agent report

**Run by the orchestrating Claude session, not the `qa` subagent.** This is a deviation from the
project's QA handoff, and the reason is a hard tooling constraint rather than convenience: the
`qa` agent's browser tools are Playwright and chrome-devtools, both of which drive a *freshly
launched* browser. Production sits behind Cloudflare Access, so a fresh browser gets the Access
login wall and never reaches the app. Only the `claude-in-chrome` tools attach to an already
authenticated Chrome, and those are not in the `qa` agent's toolset.

Junior had the app open and authenticated; the session drove that window and dismissed the native
`confirm()` dialogs by hand (see "Dialog constraint" below).

## Method and data safety

**No real family data was mutated.** One real archived item was opened
read-only to inspect the footer, never restored or duplicated. Everything else was done on a
purpose-made throwaway (`ZZ QA smoke test 507ebcf1 - safe to delete`) created with a **past**
start date (2026-09-15 08:00) so the `isArchivable` gate would offer Archive. Both the throwaway
and its duplicate were deleted at the end.

Evidence is the **network trace** (`read_network_requests`) rather than the rendered list alone.
That distinction mattered: the scope-switch requirements are claims about *which request fires*,
and a screenshot showing the right items cannot distinguish "switched scope" from "refetched the
old scope and got lucky".

## The deploy hazard is spent

The one thing this deploy could have broken catastrophically:

| Request | Status |
|---|---|
| `GET /api/lists/:id/items` | **200** |
| `GET /api/lists/:id/items?archived=1` | **200** |

Both run the `WHERE ... archived_at` clause at `src/worker/db.ts:602`. Against an unmigrated
remote these error with `no such column`, taking the list, calendar and digest down together, and
the error would have been visible **only** in `wrangler tail` (no `app.onError` is registered) —
presenting in the browser as an empty list with no banner. Both return 200 on real rows. The
hazard is closed for this column.

## §9.1 scope switch and T32 asymmetry — the headline result

Verified from the network, at **two** of the three create entry points plus the negative case:

| Action | Request that fired after | Scope result | Criterion |
|---|---|---|---|
| Create from **Archived** ("+ New Item") | `POST /api/items` 201 → `GET …/items` | → **Active** | T31 |
| **Duplicate** from Archived | `POST /api/items` 201 → `GET …/items` | → **Active** | T36 |
| **Restore** from Archived | `POST …/archive` 200 → `GET …?archived=1` | **stays Archived** | T32 |
| **Edit** while Active | `PATCH` 200, `PUT …/reminders` 200 → `GET …/items` | stays Active (`refresh()` branch) | — |

Two things worth stating precisely:

1. **The refetch after a scope switch carries no `?archived=1`.** That is the switch itself, not a
   proxy for it.
2. **There is exactly ONE list GET after each `POST /api/items`, not two.** The plan requires
   `refresh()` be *skipped* on the scope-switch branch so a stale request for the OLD (archived)
   scope cannot race the effect's request for the new one. Production shows one request. A second
   GET here would have been the defect the plan's "no extra refresh call" clause exists to prevent.

**Not covered:** entry point 2, the mobile top-bar `createRequestToken` door. It needs a narrow
viewport and was not exercised here. QA's pre-deploy browser pass did cover it.

## §10 footer button order — both shapes confirmed

| Item state | Production footer |
|---|---|
| Active | `Close` · **`Edit`** (filled) · `Archive` |
| Archived | `Close` · `Restore` · `Duplicate` (all outline) |

No Restore/Duplicate on an active item and no Edit on an archived one, so the mutual-exclusion
gates hold live. The list row is `View` · `Edit` · `Delete`, unchanged.

## Other confirmations

- **§5.7 archived rows are View-only** — no Edit, no Delete, no completion checkbox.
- **The separate-axis design is doing real work.** A real archived item carries **both** a
  `Completed` and an `Archived` badge. This is the case that justified `archived_at` being
  independent of `completed_at` rather than folded into it.
- **Duplicate's date rule works, including its awkward arm.** Source 09/15 08:00 produced a draft
  of **09/22** 08:00. `computeShiftedStart` keeps the source's local wall-clock H:M and builds
  *today's* instant, falling back to **tomorrow** when that instant has already passed — and the
  run was at 09:17, after 08:00. This reads like an off-by-a-week bug and is not one.
- **Duplicate created a one-off**, `Repeat: Does not repeat`, per Decision 7.

## Known nits — status after seeing them live

1. **"+ New Item" stays enabled in the Archived scope — CONFIRMED, and stronger than recorded.**
   It is not merely enabled; it opens a fully working create form. The throwaway item for this
   whole smoke test was created through it *from the Archived scope*. Harmless in effect (the §9.1
   switch means the new item is immediately visible where it lands), but the control is live.
2. **Attachment-copy-on-duplicate — structural half re-confirmed, DB half still untested.** The
   duplicate form shows `Save the item first, then add attachments` and offers no copy-from-source
   UI. As before, this says nothing about the DB-level exclusion.
3. **Restore's `confirm()`** — exercised; no opinion added beyond QA's existing judgement call.
4. **Archived footer has no primary emphasis** — visually confirmed. All three buttons render
   `outline`, so `Restore` carries no more weight than `Close`. The active shape still has `Edit`
   filled. Declined deliberately; recorded here because it is now observable in production.

## Dialog constraint — relevant to any future browser QA

`Archive`, `Restore` (`ItemModal.tsx:192`) and `Delete` (`ItemListView.tsx:109`) raise **native
`confirm()`**. A native dialog **freezes the renderer and blocks the Chrome extension** — a
`computer` click that opens one returns
`CDP sendCommand "Input.dispatchMouseEvent" timed out ... The renderer may be frozen`. That error
is the dialog working, not a failure. Each such action needs a human to click OK before automation
resumes. Budget for it, or stub `window.confirm` and accept that doing so no longer tests the
dialog.

This is the browser-driving counterpart to the e2e suite's own trap, where Playwright
**auto-dismisses** an unhandled dialog and the resulting silent cancel reads as the feature being
broken.

## Not verified here

- The `*/5` cron tick (reminder send loop) — no tick fell inside an observation window.
- The `0 14` daily digest.
- Entry point 2 (mobile top-bar create).
- Attachment exclusion on duplicate at the DB level.
- Anything on a real iPhone. **Owner device confirmation is still outstanding.**

## Incidental finding — two Chrome profiles are connected

`list_connected_browsers` reports **two** local Chrome instances. One is signed in as
the owner's account, the other as a different family member's account. After a tab closed mid-run, automation silently
reattached to the second profile and rendered that account's data. No action was taken there and
the session backed out.

**For any future browser work on this project: confirm the signed-in identity from the sidebar
before acting**, not just that the app loaded. The two profiles are indistinguishable from the
URL.
