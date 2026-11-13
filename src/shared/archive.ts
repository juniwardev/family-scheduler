// src/shared/archive.ts — the manual-archive gate (feat/item-archive).
// Pure, framework-agnostic (no DOM/Worker deps, no timezone library). Single source of truth
// consumed by both the Worker (src/worker/db.ts's setItemArchived) and the browser
// (web/src/components/ItemDetails.tsx's Archive button gate).
//
// Plan reference: docs/plans/item-archive.md Decision 1 / D1.1 / D1.2.
//
// ARCHIVE_GATE compares two already-UTC epoch-ms instants. It reads no timezone at all, so it
// cannot throw and cannot disagree between the Worker and the browser (D1.2). Do not "improve"
// this by reading item.timezone — see D1.2 for why that form was rejected (it throws on an
// invalid zone, and it is wrong-by-a-day for any device east of the zone the item was created
// in). If a future version of this rule ever needs a zone, reuse
// src/shared/itemLabels.ts's documented three-step fallback chain rather than inventing one.

/**
 * How long after an all-day item's stored start-of-day instant the gate opens.
 *
 * 25 h, not 24 h. The longest possible local day is 25 hours (a DST fall-back day; the
 * shortest is 23). With 24 h the gate would open one hour EARLY on a fall-back day — the same
 * failure direction as the naive `ANCHOR_AT < now` gate this branch exists to fix. With 25 h the
 * error is uniformly conservative: never early, at most 2 h late, in every zone and under every
 * transition. Do not reduce this constant because a test looks red near the boundary — T5b is
 * the criterion that pins this value, and 24 h is a regression, not a fix.
 */
export const ALL_DAY_GRACE_MS = 25 * 60 * 60 * 1000; // 90_000_000

/**
 * Structural subset of Item that the gate needs. Both the worker's Item and web's Item satisfy
 * this without a cast (src/shared/location.ts already uses this pattern).
 */
export interface ArchivableItem {
  start_at: number;
  end_at: number | null;
  all_day: boolean;
  rrule: string | null;
}

/**
 * ANCHOR_AT — the last instant the item's OWN STORED FIELDS describe. A raw instant, not a gate.
 * Never compare this directly against `now` — use isArchivable(). Deliberately NOT exported:
 * exporting it invites a call site to write `itemAnchorAt(item) < now` and silently reintroduce
 * the all-day blocker (an all-day item's start_at is local midnight AT THE START of its day, so
 * comparing the raw anchor against now offers Archive on the morning of the event itself).
 *
 * MAX, not just COALESCE: a PATCH that moves start_at later without end_at in the same body can
 * leave a stale end_at < start_at row (routes/items.ts only validates end_at >= start_at when
 * both are present in the same PATCH body). Without the outer MAX such a row could be archived
 * while its start_at is still in the future, breaking G6.
 */
function itemAnchorAt(item: ArchivableItem): number {
  const end = item.end_at ?? item.start_at;
  return Math.max(item.start_at, end);
}

/**
 * Whether `item` may be archived at instant `now`. The only exported gate — every "may this be
 * archived" question in this codebase must go through this function, never through ANCHOR_AT
 * directly.
 *
 * Recurring items are never archivable (owner decision, 2026-09-19). No completed_at term and no
 * delay: manual archive asks only "has this item's time passed?" — a human decides whether an
 * incomplete task gets archived, not this predicate (Decision 1.3).
 */
export function isArchivable(item: ArchivableItem, now: number): boolean {
  if (item.rrule !== null) return false;
  const anchor = itemAnchorAt(item);
  if (item.all_day) {
    return anchor + ALL_DAY_GRACE_MS < now;
  }
  return anchor < now;
}

/**
 * The server's VALIDATION message when isArchivable() is false. Not itself part of the gate —
 * callers must still check isArchivable() (or rrule) directly; this only explains a false result.
 */
export function archiveBlockedReason(item: ArchivableItem, now: number): string | null {
  if (item.rrule !== null) return "Recurring items cannot be archived";
  if (!isArchivable(item, now)) return "Item cannot be archived until its date has passed";
  return null;
}
