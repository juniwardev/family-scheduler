// Unit tests for recurrence.ts — mandated DST cases from Decision D10 / Flag F13 / Task 5.1
// These tests verify exact UTC epoch-ms values for the three D10 cases plus the UNTIL+DST case.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Settings } from "luxon";
import { expandOccurrences, computeFireAt } from "../../src/worker/recurrence";

const TZ = "America/Los_Angeles";
const MIN = 60 * 1000;

// Pinned luxon clocks. The old implementation resolved the ambiguous fall-back hour by the offset
// in force at Settings.now(), i.e. by the date the code ran (docs/bugs/dst-fallback-ambiguous-time.md).
// CLOCK_S: northern summer (LA on PDT, Sydney on AEST). CLOCK_W: northern winter (LA on PST,
// Sydney on AEDT). Every DST case below runs under both, so no result may depend on the real date.
const CLOCK_S = Date.UTC(2026, 6, 15, 12, 0);
const CLOCK_W = Date.UTC(2026, 0, 15, 12, 0);
const CLOCKS: Array<[string, number]> = [
  ["CLOCK_S", CLOCK_S],
  ["CLOCK_W", CLOCK_W],
];

// Fall-back 2026 LA: Nov 1 01:30 PDT (earlier) and 01:30 PST (later).
const E1 = Date.UTC(2026, 10, 1, 8, 30);
const E3_START = Date.UTC(2026, 10, 1, 8, 0);
const E4_START = Date.UTC(2026, 10, 1, 9, 0);

const REAL_LUXON_NOW = Settings.now;
// Restore after every test so a pinned clock can never leak into another test or file.
afterEach(() => {
  Settings.now = REAL_LUXON_NOW;
});

function expand(
  timezone: string,
  startAt: number,
  rrule: string,
  from: number,
  to: number
): number[] {
  return expandOccurrences({ startAt, rrule, timezone, allDay: false }, from, to);
}

// 2026 DST transitions (America/Los_Angeles):
//   Spring-forward: Sun Mar 8 02:00 -> 03:00 (PST -08:00 -> PDT -07:00)
//   Fall-back:      Sun Nov 1 02:00 -> 01:00 (PDT -07:00 -> PST -08:00)

describe.each(CLOCKS)("expandOccurrences — D10 DST cases under %s", (_name, clock) => {
  // The pin is set in beforeEach (not in the describe body, which runs at collection time).
  beforeEach(() => {
    Settings.now = () => clock;
  });

  // U4 (GUARD) — case (i): daily 02:30 across spring-forward (non-existent local time)
  it("(i) daily 02:30 across spring-forward — non-existent local time shifts to 03:30 PDT", () => {
    const results = expand(
      TZ,
      Date.UTC(2026, 2, 7, 10, 30),
      "FREQ=DAILY",
      Date.UTC(2026, 2, 7, 0, 0),
      Date.UTC(2026, 2, 9, 23, 59)
    );
    expect(results).toEqual([
      Date.UTC(2026, 2, 7, 10, 30),
      Date.UTC(2026, 2, 8, 10, 30), // gap: 02:30 -> 03:30 PDT, same UTC instant
      Date.UTC(2026, 2, 9, 9, 30),
    ]);
  });

  // U1 — case (ii): daily 01:30 across fall-back (ambiguous local time) chooses the earlier instant
  it("(ii) daily 01:30 across fall-back — ambiguous time chooses earlier (PDT) offset", () => {
    const results = expand(
      TZ,
      Date.UTC(2026, 9, 31, 8, 30),
      "FREQ=DAILY",
      Date.UTC(2026, 9, 31, 0, 0),
      Date.UTC(2026, 10, 2, 23, 59)
    );
    expect(results).toEqual([Date.UTC(2026, 9, 31, 8, 30), E1, Date.UTC(2026, 10, 2, 9, 30)]);
  });

  // U2 — southern hemisphere: the old season mapping is reversed, so a fixed summer pin is wrong too
  it("U2 Sydney Apr 5 02:30 overlap resolves to the earlier (AEDT) instant", () => {
    const results = expand(
      "Australia/Sydney",
      Date.UTC(2026, 3, 2, 15, 30),
      "FREQ=DAILY",
      Date.UTC(2026, 3, 2, 0, 0),
      Date.UTC(2026, 3, 5, 12, 0)
    );
    expect(results).toEqual([
      Date.UTC(2026, 3, 2, 15, 30),
      Date.UTC(2026, 3, 3, 15, 30),
      Date.UTC(2026, 3, 4, 15, 30),
    ]);
  });

  // U3 — the whole fall-back day at 15-minute resolution: no value in E4, all of E3
  it("U3 quarter-hour sweep of Nov 1 never emits the later-instant hour", () => {
    const expected: number[] = [];
    for (let k = 0; k < 8; k++) expected.push(E3_START - 60 * MIN + k * 15 * MIN);
    for (let k = 0; k < 88; k++) expected.push(E4_START + 60 * MIN + k * 15 * MIN);
    // The fixture above starts at 07:00Z (00:00 PDT) and resumes at 10:00Z (02:00 PST)
    expect(expected).toHaveLength(96);
    const results = expand(
      TZ,
      Date.UTC(2026, 10, 1, 7, 0),
      "FREQ=MINUTELY;INTERVAL=15;COUNT=96",
      Date.UTC(2026, 9, 31, 12, 0),
      Date.UTC(2026, 10, 2, 12, 0)
    );
    expect(results).toEqual(expected);
  });

  // U5 (GUARD) — spring-forward sweep: 02:xx slots collide with 03:xx and are deduped
  it("U5 quarter-hour sweep of Mar 8 yields the 23 h day", () => {
    const expected: number[] = [];
    for (let k = 0; k < 92; k++) expected.push(Date.UTC(2026, 2, 8, 8, 0) + k * 15 * MIN);
    const results = expand(
      TZ,
      Date.UTC(2026, 2, 8, 8, 0),
      "FREQ=MINUTELY;INTERVAL=15;COUNT=96",
      Date.UTC(2026, 2, 7, 12, 0),
      Date.UTC(2026, 2, 9, 12, 0)
    );
    expect(results).toEqual(expected);
  });

  // U6 (GUARD) — east-of-UTC spring-forward gap
  it("U6 Berlin daily 02:30 across the Mar 29 gap shifts to 03:30 CEST", () => {
    const results = expand(
      "Europe/Berlin",
      Date.UTC(2026, 2, 27, 1, 30),
      "FREQ=DAILY",
      Date.UTC(2026, 2, 27, 0, 0),
      Date.UTC(2026, 2, 30, 0, 0)
    );
    expect(results).toEqual([
      Date.UTC(2026, 2, 27, 1, 30),
      Date.UTC(2026, 2, 28, 1, 30),
      Date.UTC(2026, 2, 29, 1, 30),
    ]);
  });
});

describe("expandOccurrences — window bounds are real instants (Defect 2)", () => {
  const LA_START = Date.UTC(2026, 4, 20, 10, 0); // 03:00 PDT

  it("U7 LA: an occurrence 3 h into the local day is returned for that day's window", () => {
    expect(
      expand(TZ, LA_START, "FREQ=DAILY", Date.UTC(2026, 5, 1, 7, 0), Date.UTC(2026, 5, 2, 6, 59, 59))
    ).toEqual([Date.UTC(2026, 5, 1, 10, 0)]);
  });

  it("U8 LA: window start is inclusive", () => {
    expect(
      expand(TZ, LA_START, "FREQ=DAILY", Date.UTC(2026, 5, 1, 10, 0), Date.UTC(2026, 5, 1, 11, 0))
    ).toEqual([Date.UTC(2026, 5, 1, 10, 0)]);
  });

  it("U9 LA: an occurrence 1 ms before the window start is excluded (real-instant filter)", () => {
    expect(
      expand(TZ, LA_START, "FREQ=DAILY", Date.UTC(2026, 5, 1, 10, 0) + 1, Date.UTC(2026, 5, 1, 11, 0))
    ).toEqual([]);
  });

  it("U10 Tokyo: a late-evening occurrence at the end of the local day is returned", () => {
    expect(
      expand(
        "Asia/Tokyo",
        Date.UTC(2026, 4, 20, 11, 0),
        "FREQ=DAILY",
        Date.UTC(2026, 4, 31, 15, 0),
        Date.UTC(2026, 5, 1, 14, 59, 59)
      )
    ).toEqual([Date.UTC(2026, 5, 1, 11, 0)]);
  });

  // Needs a buffer of at least 14 h (W = we + 14 h). Fails for any smaller buffer.
  it("U11 Kiritimati (+14): an occurrence exactly on the window end is returned", () => {
    expect(
      expand(
        "Pacific/Kiritimati",
        Date.UTC(2026, 4, 20, 9, 59, 59),
        "FREQ=DAILY",
        Date.UTC(2026, 4, 31, 10, 0),
        Date.UTC(2026, 5, 1, 9, 59, 59)
      )
    ).toEqual([Date.UTC(2026, 5, 1, 9, 59, 59)]);
  });

  // Needs a buffer of at least 11 h (W = ws - 11 h). Fails for any smaller buffer.
  it("U12 Pago Pago (-11): an occurrence exactly on the window start is returned", () => {
    expect(
      expand(
        "Pacific/Pago_Pago",
        Date.UTC(2026, 4, 20, 11, 0),
        "FREQ=DAILY",
        Date.UTC(2026, 5, 1, 11, 0),
        Date.UTC(2026, 5, 2, 10, 59, 59)
      )
    ).toEqual([Date.UTC(2026, 5, 1, 11, 0)]);
  });
});

describe("expandOccurrences — zone handling", () => {
  it("U13 an unknown timezone yields [] and does not throw", () => {
    const start = Date.UTC(2026, 5, 1, 4, 0);
    expect(
      expand("Not/AZone", start, "FREQ=DAILY", Date.UTC(2026, 5, 1, 0, 0), Date.UTC(2026, 5, 3, 0, 0))
    ).toEqual([]);
  });

  // The editor's timezone field is free text, so fixed-offset specifiers are reachable.
  // Guards using Info.normalizeZone rather than IANAZone.create (which rejects "UTC+5").
  it("U14 a luxon fixed-offset specifier (UTC+5) still expands", () => {
    expect(
      expand(
        "UTC+5",
        Date.UTC(2026, 5, 1, 4, 0),
        "FREQ=DAILY",
        Date.UTC(2026, 5, 1, 0, 0),
        Date.UTC(2026, 5, 3, 0, 0)
      )
    ).toEqual([Date.UTC(2026, 5, 1, 4, 0), Date.UTC(2026, 5, 2, 4, 0)]);
  });
});

describe("expandOccurrences — D10 other cases", () => {
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
