// tests/unit/archive-rule.test.ts — src/shared/archive.ts (plan Decision 1 / D1.1 / D1.2).
//
// isArchivable() reads no timezone at all (D1.2): it is pure epoch-ms arithmetic. So the fixture
// instants below are built with Date.UTC and are NOT standing in for a real device's local
// clock — the "as if local midnight" comments describe what a real all-day item's stored
// start_at/end_at would mean (ItemEditor.tsx's local-midnight convention), not a timezone the
// predicate itself consults. Fixture dates are still chosen off a non-DST-transition date
// (Wed 2026-07-15 / Sun 2026-07-19) per plan N1, so the "pure-level" versions of T5a/T5b/T6a
// below read the same as their archive-db.test.ts counterparts (step 9), which DO run through
// real local-midnight-constructed fixtures.
import { describe, it, expect } from "vitest";
import { isArchivable, archiveBlockedReason, ALL_DAY_GRACE_MS, type ArchivableItem } from "../../src/shared/archive";

const HOUR = 60 * 60 * 1000;

// A fixed "day" anchor: Wed 2026-07-15 00:00 (stands in for an all-day item's local-midnight
// start_at). Not a DST transition date in America/Los_Angeles (next transition is Sun Nov 1).
const WED_MIDNIGHT = Date.UTC(2026, 6, 15, 0, 0, 0);
// A fixed Sunday anchor for the multi-day fixture: Sun 2026-07-19 00:00 (also not a transition
// date — US transitions always fall on a Sunday, but not this one).
const SUN_MIDNIGHT = Date.UTC(2026, 6, 19, 0, 0, 0);

function item(overrides: Partial<ArchivableItem & { completed_at: number | null }>): ArchivableItem & {
  completed_at: number | null;
} {
  return {
    start_at: WED_MIDNIGHT,
    end_at: null,
    all_day: false,
    rrule: null,
    completed_at: null,
    ...overrides,
  };
}

describe("isArchivable — §6.2 edge-case table (T22)", () => {
  // ⚠ Sampling caveat (R4.4): the gate is strict (`<`), so exactly `ANCHOR_AT + 25h` is FALSE.
  // All-day rows below sample success at +27h (03:00 the following day for a non-transition
  // date), never at exactly +25h — that boundary belongs to T5b alone.

  it("timed event, end_at IS NULL: archivable from start_at + ε", () => {
    const it1 = item({ start_at: WED_MIDNIGHT, end_at: null, all_day: false });
    expect(isArchivable(it1, WED_MIDNIGHT - 1)).toBe(false);
    expect(isArchivable(it1, WED_MIDNIGHT + 1)).toBe(true);
  });

  it("timed event, end_at < start_at (reachable via a start_at-only PATCH): the outer MAX wins", () => {
    const it1 = item({ start_at: WED_MIDNIGHT, end_at: WED_MIDNIGHT - HOUR, all_day: false });
    // COALESCE(end_at, start_at) alone would anchor on end_at (in the past already) and wrongly
    // archive a future-dated row; the outer MAX must anchor on start_at instead.
    expect(isArchivable(it1, WED_MIDNIGHT - 1)).toBe(false);
    expect(isArchivable(it1, WED_MIDNIGHT + 1)).toBe(true);
  });

  it("timed multi-day event still running: not archivable — ANCHOR_AT is its end_at", () => {
    const it1 = item({ start_at: WED_MIDNIGHT, end_at: WED_MIDNIGHT + 3 * 24 * HOUR, all_day: false });
    expect(isArchivable(it1, WED_MIDNIGHT + 24 * HOUR)).toBe(false); // mid-event, before end_at
  });

  it("all-day single-day event, on the day itself: NOT archivable (the v1 blocker)", () => {
    const it1 = item({ start_at: WED_MIDNIGHT, end_at: null, all_day: true });
    expect(isArchivable(it1, WED_MIDNIGHT + 9 * HOUR)).toBe(false); // 09:00 same day
  });

  it("all-day single-day event, next day ~01:00-03:00: archivable", () => {
    const it1 = item({ start_at: WED_MIDNIGHT, end_at: null, all_day: true });
    expect(isArchivable(it1, WED_MIDNIGHT + 27 * HOUR)).toBe(true); // 03:00 next day
  });

  it("all-day Fri->Sun, on Sunday: NOT archivable — end_at is the START of the last day", () => {
    const it1 = item({ start_at: SUN_MIDNIGHT - 2 * 24 * HOUR, end_at: SUN_MIDNIGHT, all_day: true });
    expect(isArchivable(it1, SUN_MIDNIGHT + 12 * HOUR)).toBe(false); // noon Sunday
  });

  it("all-day Fri->Sun, on Monday: archivable", () => {
    const it1 = item({ start_at: SUN_MIDNIGHT - 2 * 24 * HOUR, end_at: SUN_MIDNIGHT, all_day: true });
    expect(isArchivable(it1, SUN_MIDNIGHT + 27 * HOUR)).toBe(true); // 03:00 Monday
  });

  it("task, incomplete, due last year: archivable — completion is not required (Decision 1.3)", () => {
    const it1 = item({ start_at: WED_MIDNIGHT, end_at: null, all_day: false, completed_at: null });
    expect(isArchivable(it1, WED_MIDNIGHT + 365 * 24 * HOUR)).toBe(true);
  });

  it("task, completed early, due next week: NOT archivable — completed_at is not an input", () => {
    const it1 = item({
      start_at: WED_MIDNIGHT + 7 * 24 * HOUR,
      end_at: null,
      all_day: false,
      completed_at: WED_MIDNIGHT, // completed today, due date still next week
    });
    expect(isArchivable(it1, WED_MIDNIGHT + HOUR)).toBe(false);
  });

  it("recurring item, any age: never archivable", () => {
    const it1 = item({ start_at: WED_MIDNIGHT - 365 * 24 * HOUR, end_at: null, all_day: false, rrule: "FREQ=DAILY" });
    expect(isArchivable(it1, WED_MIDNIGHT + 365 * 24 * HOUR)).toBe(false);
  });

  it("a table of all-true rows would pass on () => true — this row must be false", () => {
    const it1 = item({ start_at: WED_MIDNIGHT + 24 * HOUR, end_at: null, all_day: false }); // future-dated
    expect(isArchivable(it1, WED_MIDNIGHT)).toBe(false);
  });
});

describe("isArchivable — pure-level mechanism tests (T5a/T5b/T6a)", () => {
  it("T5a — all-day single-day: own day -> false; +27h (next day ~03:00) -> true", () => {
    const it1 = item({ start_at: WED_MIDNIGHT, end_at: null, all_day: true });
    expect(isArchivable(it1, WED_MIDNIGHT + 9 * HOUR)).toBe(false);
    expect(isArchivable(it1, WED_MIDNIGHT + 27 * HOUR)).toBe(true);
  });

  it("T6a — all-day Fri->Sun: Sunday noon -> false; Monday ~03:00 -> true", () => {
    const it1 = item({ start_at: SUN_MIDNIGHT - 2 * 24 * HOUR, end_at: SUN_MIDNIGHT, all_day: true });
    expect(isArchivable(it1, SUN_MIDNIGHT + 12 * HOUR)).toBe(false);
    expect(isArchivable(it1, SUN_MIDNIGHT + 27 * HOUR)).toBe(true);
  });

  it("T5b — ALL_DAY_GRACE_MS is 25h, not 24h: at exactly +24.5h the gate is still false", () => {
    // This is the ONLY row in the suite that separates 25h from 24h. T5a/T6a sample well clear
    // of the boundary (+9h and +27h) and cannot distinguish the two constants; a 24h
    // implementation would pass both of them and fail only here. Do not "fix" this by reducing
    // ALL_DAY_GRACE_MS — that is the regression D1.2 exists to prevent.
    const it1 = item({ start_at: WED_MIDNIGHT, end_at: null, all_day: true });
    expect(ALL_DAY_GRACE_MS).toBe(25 * 60 * 60 * 1000);
    expect(isArchivable(it1, WED_MIDNIGHT + 24.5 * HOUR)).toBe(false);
    // And confirm it does open once the full 25h + ε has elapsed.
    expect(isArchivable(it1, WED_MIDNIGHT + ALL_DAY_GRACE_MS + 1)).toBe(true);
  });
});

describe("archiveBlockedReason", () => {
  it("returns null when isArchivable is true", () => {
    const it1 = item({ start_at: WED_MIDNIGHT, end_at: null, all_day: false });
    expect(archiveBlockedReason(it1, WED_MIDNIGHT + 1)).toBeNull();
  });

  it("names the recurring-item reason distinctly from the not-yet-passed reason", () => {
    const recurring = item({ start_at: WED_MIDNIGHT - HOUR, end_at: null, all_day: false, rrule: "FREQ=DAILY" });
    const future = item({ start_at: WED_MIDNIGHT + HOUR, end_at: null, all_day: false });
    expect(archiveBlockedReason(recurring, WED_MIDNIGHT)).toMatch(/recurring/i);
    expect(archiveBlockedReason(future, WED_MIDNIGHT)).not.toMatch(/recurring/i);
  });
});
