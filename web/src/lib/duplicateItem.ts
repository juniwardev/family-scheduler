// web/src/lib/duplicateItem.ts — buildDuplicateDraft (plan Decision 7 / §5.7.1).
// Pure: no fetch, no DOM. Takes the source item and an injected `now` (never Date.now()
// ambiently — see T23) and returns a client-side ItemDraft ready for ItemEditor's create mode.
// Reuses the existing create path (POST /api/items) — Decision 7's hard constraint is that
// Duplicate adds no new server surface.
import type { Item, ItemDraft } from "../types";

/**
 * The date shift: one uniform rule for timed AND all-day items (deliberately NOT parallel to
 * ARCHIVE_GATE's two-arm shape — see §5.7.1). Copying the source's date verbatim risks a
 * silently-dead copy (reminders whose fire_at has already passed); shifting always prefills a
 * date the user still has to confirm, so the risk is asymmetric and shifting wins.
 *
 * Read the source's LOCAL wall-clock H:M, build today's instant (today relative to `now`, never
 * the ambient clock), and fall back to tomorrow if that instant is <= now. For an all-day source
 * the wall-clock time is midnight, which has always already passed by the time Duplicate is
 * pressed — so it falls into the "already passed" branch and lands on tomorrow, which is
 * correct: the earliest date at which the copy's reminders can actually fire.
 *
 * Built with `new Date(y, m, d, H, M)` (local wall-time construction), not `+ 24h` in ms — the
 * constructor form is DST-correct by construction; adding milliseconds shifts the displayed
 * hour across a DST boundary. Matches ItemEditor's own epochToDatetimeLocal round-trip
 * (local getters).
 *
 * Known limitation, not fixed here: the source's stored IANA `timezone` is not consulted, so
 * duplicating an item stored in a non-local zone prefills the LOCAL clock time (R10's residual —
 * every item today is created in America/Los_Angeles via the client's hardcoded default,
 * ItemEditor.tsx's DEFAULT_TIMEZONE, and the family is in one zone). The value is visible in the
 * form before saving.
 */
function computeShiftedStart(sourceStartAt: number, now: number): number {
  const source = new Date(sourceStartAt);
  const hours = source.getHours();
  const minutes = source.getMinutes();

  const today = new Date(now);
  const candidate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    hours,
    minutes
  ).getTime();

  if (candidate <= now) {
    const tomorrow = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1,
      hours,
      minutes
    );
    return tomorrow.getTime();
  }

  return candidate;
}

/**
 * Build a create-mode ItemDraft from an existing item (Decision 7). Every one of ItemDraft's
 * twelve fields is set explicitly (§5.7.1) — do not spread `item` into the result, it is the
 * wrong shape (`Item.location: string | null` vs `ItemDraft.location: string`) and it would
 * silently carry over `rrule`/completed-adjacent state that must NOT be copied.
 */
export function buildDuplicateDraft(item: Item, now: number): ItemDraft {
  const shiftedStart = computeShiftedStart(item.start_at, now);
  const end_at = item.end_at === null ? null : shiftedStart + (item.end_at - item.start_at);

  return {
    list_id: item.list_id,
    type: item.type,
    title: item.title,
    // ItemDraft.location/notes are `string`, not `string | null` — the null->"" convention
    // ItemEditor's own initialiser uses (ItemEditor.tsx:62-63).
    location: item.location ?? "",
    notes: item.notes ?? "",
    start_at: shiftedStart,
    end_at,
    all_day: item.all_day,
    // Always null — a duplicate is always a one-off (Decision 7). The branch where item.rrule
    // is non-null is unreachable today (archived items are never recurring), but this stays
    // total rather than carrying a dead conditional.
    rrule: null,
    timezone: item.timezone,
    reminders: item.reminders,
    // Neither completed_at nor archived_at is copied — createItem hardcodes both to NULL
    // server-side regardless of what a draft would even carry (ItemDraft has no such fields).
    location_kind: item.location_kind,
  };
}
