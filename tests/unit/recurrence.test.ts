// Unit tests for recurrence.ts — mandated DST cases from Decision D10 / Flag F13 / Task 5.1
// These tests verify exact UTC epoch-ms values for the three D10 cases plus the UNTIL+DST case.
import { describe, it, expect } from "vitest";
import { expandOccurrences, computeFireAt } from "../../src/worker/recurrence";

const TZ = "America/Los_Angeles";

// 2026 DST transitions (America/Los_Angeles):
//   Spring-forward: Sun Mar 8 02:00 -> 03:00 (PST -08:00 -> PDT -07:00)
//   Fall-back:      Sun Nov 1 02:00 -> 01:00 (PDT -07:00 -> PST -08:00)

describe("expandOccurrences — D10 DST cases", () => {
  // ---------------------------------------------------------------------------
  // Case (i): Daily event at 02:30 across spring-forward (non-existent local time)
  // ---------------------------------------------------------------------------
  it("(i) daily 02:30 across spring-forward — non-existent local time shifts to 03:30 PDT", () => {
    // Seed: Mar 7 2026 02:30 PST = 10:30 UTC
    const startAt = Date.UTC(2026, 2, 7, 10, 30); // Mar 7 10:30 UTC
    const from = Date.UTC(2026, 2, 7, 0, 0); // Mar 7 00:00 UTC
    const to = Date.UTC(2026, 2, 9, 23, 59); // Mar 9 23:59 UTC

    const results = expandOccurrences(
      { startAt, rrule: "FREQ=DAILY", timezone: TZ, allDay: false },
      from,
      to
    );

    // Mar 7: 02:30 PST = 10:30 UTC
    expect(results).toContain(Date.UTC(2026, 2, 7, 10, 30));
    // Mar 8: 02:30 is in the gap -> shifted to 03:30 PDT = 10:30 UTC (same UTC!)
    expect(results).toContain(Date.UTC(2026, 2, 8, 10, 30));
    // Mar 9: 02:30 PDT = 09:30 UTC
    expect(results).toContain(Date.UTC(2026, 2, 9, 9, 30));

    expect(results.length).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Case (ii): Daily event at 01:30 across fall-back (ambiguous local time)
  // ---------------------------------------------------------------------------
  it("(ii) daily 01:30 across fall-back — ambiguous time chooses earlier (PDT) offset", () => {
    // Seed: Oct 31 2026 01:30 PDT = 08:30 UTC
    const startAt = Date.UTC(2026, 9, 31, 8, 30); // Oct 31 08:30 UTC
    const from = Date.UTC(2026, 9, 31, 0, 0);
    const to = Date.UTC(2026, 10, 2, 23, 59); // Nov 2

    const results = expandOccurrences(
      { startAt, rrule: "FREQ=DAILY", timezone: TZ, allDay: false },
      from,
      to
    );

    // Oct 31 (PDT -07:00): 01:30 + 7h = 08:30 UTC
    expect(results).toContain(Date.UTC(2026, 9, 31, 8, 30));
    // Nov 1 (01:30 occurs twice; choose earlier = PDT -07:00): 01:30 + 7h = 08:30 UTC
    expect(results).toContain(Date.UTC(2026, 10, 1, 8, 30));
    // Rejected later instant: PST -08:00 would be 09:30 UTC — must NOT be present
    expect(results).not.toContain(Date.UTC(2026, 10, 1, 9, 30));
    // Nov 2 (PST -08:00): 01:30 + 8h = 09:30 UTC
    expect(results).toContain(Date.UTC(2026, 10, 2, 9, 30));
  });

  // ---------------------------------------------------------------------------
  // Case (iii): Reminder offset crossing the DST boundary
  // ---------------------------------------------------------------------------
  it("(iii) 8h reminder offset crossing spring-forward: fire_at computed in real UTC duration", () => {
    // Non-recurring event Mar 8 2026 at 09:00 PDT = 16:00 UTC
    const occurrence_at = Date.UTC(2026, 2, 8, 16, 0);
    // fire_at = occurrence_at - 8h (in UTC epoch space — never re-mapped through timezone)
    const fire_at = computeFireAt(occurrence_at, 480);
    // Expected: 08:00 UTC Mar 8, which is 00:00 PST (before the 02:00->03:00 transition at 10:00 UTC)
    expect(fire_at).toBe(Date.UTC(2026, 2, 8, 8, 0));
  });

  // ---------------------------------------------------------------------------
  // N6: RRULE UNTIL near a DST boundary
  // ---------------------------------------------------------------------------
  it("near-UNTIL DST: occurrence at DST boundary is included when its UTC time <= UNTIL UTC", () => {
    // Weekly on Sundays; UNTIL = Nov 8 2026 00:00 UTC
    // Nov 1 is fall-back day; its occurrence should still be included
    const startAt = Date.UTC(2026, 9, 4, 8, 30); // Oct 4 Sun 01:30 PDT = 08:30 UTC
    const from = Date.UTC(2026, 9, 25, 0, 0); // Oct 25
    const to = Date.UTC(2026, 10, 8, 23, 59); // Nov 8

    const results = expandOccurrences(
      {
        startAt,
        rrule: "FREQ=WEEKLY;BYDAY=SU;UNTIL=20261108T000000Z",
        timezone: TZ,
        allDay: false,
      },
      from,
      to
    );

    // Should include Oct 25, Nov 1 (fall-back day), but NOT Nov 8 (UNTIL=Nov 8 00:00Z, and Nov 8 01:30 PST = 09:30 UTC > UNTIL)
    const hasNov1 = results.some((t) => {
      const d = new Date(t);
      return d.getUTCMonth() === 10 && d.getUTCDate() === 1;
    });
    expect(hasNov1).toBe(true);

    const hasNov8 = results.some((t) => {
      const d = new Date(t);
      return d.getUTCMonth() === 10 && d.getUTCDate() === 8;
    });
    expect(hasNov8).toBe(false);
  });
});

describe("expandOccurrences — non-recurring", () => {
  it("returns the single startAt when it falls in the window", () => {
    const startAt = Date.UTC(2026, 5, 15, 12, 0);
    const from = Date.UTC(2026, 5, 1, 0, 0);
    const to = Date.UTC(2026, 5, 30, 23, 59);
    const results = expandOccurrences({ startAt, rrule: null, timezone: TZ, allDay: false }, from, to);
    expect(results).toEqual([startAt]);
  });

  it("returns empty when startAt is outside the window", () => {
    const startAt = Date.UTC(2026, 5, 15, 12, 0);
    const from = Date.UTC(2026, 6, 1, 0, 0);
    const to = Date.UTC(2026, 6, 30, 23, 59);
    const results = expandOccurrences({ startAt, rrule: null, timezone: TZ, allDay: false }, from, to);
    expect(results).toEqual([]);
  });
});
