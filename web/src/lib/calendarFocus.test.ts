import { describe, it, expect } from "vitest";
import { nextFocusId, resolveRovingId, type DayFocusables } from "./calendarFocus";

// Synthetic 30-day month (plan §8.2). No dates, no Date — every day 1..30 is present, ascending,
// with `ids: []` for the days below that are not called out.
//   day 3:  ["c-3-0", "c-3-1"]   — column {3,10,17,24}, multi-element
//   day 6:  ["c-6-0"]            — horizontal neighbor; day 7 is EMPTY
//   day 8:  ["c-8-0"]            — horizontal target across a week-row boundary from day 6
//   day 10: ["c-10-0","c-10-1","c-10-2","t-10"] — the toggle day; same column as 3, 17, 24
//   day 17: []                   — EMPTY, same column as 3/10/24 — the skip case
//   day 24: ["c-24-0"]           — column bottom
// Day 24 deliberately keeps a single id (plan §8.2 note): it is simultaneously P4's column
// bottom, P5's ArrowUp target and P8's last non-empty day; End's "last ELEMENT" claim gets its
// own two-line fixture in P12b instead of perturbing this one.
function makeMonth(): DayFocusables[] {
  const days: DayFocusables[] = [];
  for (let day = 1; day <= 30; day++) {
    days.push({ day, ids: [] });
  }
  days[3 - 1].ids = ["c-3-0", "c-3-1"];
  days[6 - 1].ids = ["c-6-0"];
  days[8 - 1].ids = ["c-8-0"];
  days[10 - 1].ids = ["c-10-0", "c-10-1", "c-10-2", "t-10"];
  days[24 - 1].ids = ["c-24-0"];
  return days;
}

describe("nextFocusId", () => {
  it("P1: ArrowDown moves within a day before crossing columns", () => {
    const days = makeMonth();
    expect(nextFocusId(days, "c-10-0", "ArrowDown")).toBe("c-10-1");
  });

  it("P2: ArrowDown from a day's last element jumps to the next non-empty day in the same column", () => {
    const days = makeMonth();
    expect(nextFocusId(days, "t-10", "ArrowDown")).toBe("c-24-0");
  });

  it("P3: ArrowDown skips empty days in the same column, both from day 3 and from the toggle", () => {
    const days = makeMonth();
    expect(nextFocusId(days, "c-3-1", "ArrowDown")).toBe("c-10-0");
    expect(nextFocusId(days, "t-10", "ArrowDown")).toBe("c-24-0"); // skips empty day 17
  });

  it("P4: ArrowDown at the column bottom returns null, not undefined or a wrap-around", () => {
    const days = makeMonth();
    expect(nextFocusId(days, "c-24-0", "ArrowDown")).toBeNull();
  });

  it("P5: ArrowUp lands on the LAST element of the previous non-empty day in the column", () => {
    const days = makeMonth();
    expect(nextFocusId(days, "c-24-0", "ArrowUp")).toBe("t-10");
  });

  it("P5b: ArrowUp at the top of a column (day 3, 3-7<1) returns null, not a negative-index or wrap-around result", () => {
    const days = makeMonth();
    expect(nextFocusId(days, "c-3-0", "ArrowUp")).toBeNull();
  });

  it("P5c: ArrowUp at the top of a DIFFERENT column (day 6, 6-7<1) also returns null", () => {
    const days = makeMonth();
    expect(nextFocusId(days, "c-6-0", "ArrowUp")).toBeNull();
  });

  it("P6: ArrowUp moves within a day before crossing columns", () => {
    const days = makeMonth();
    expect(nextFocusId(days, "c-10-1", "ArrowUp")).toBe("c-10-0");
  });

  it("P7: ArrowRight moves to the next non-empty day, skipping an empty one", () => {
    const days = makeMonth();
    expect(nextFocusId(days, "c-6-0", "ArrowRight")).toBe("c-8-0");
  });

  it("P8: ArrowRight past the last non-empty day of the month returns null (no wrap-around)", () => {
    const days = makeMonth();
    expect(nextFocusId(days, "c-24-0", "ArrowRight")).toBeNull();
  });

  it("P9: ArrowLeft lands on the previous day's FIRST element — the deliberate asymmetry with ArrowUp", () => {
    const days = makeMonth();
    expect(nextFocusId(days, "c-10-0", "ArrowLeft")).toBe("c-8-0");
    // Discriminating case: day 3 has TWO ids. "Mirror ArrowUp" would return c-3-1 (the last);
    // Decision 2 requires the first.
    expect(nextFocusId(days, "c-6-0", "ArrowLeft")).toBe("c-3-0");
  });

  it("P10: ArrowLeft before the first non-empty day of the month returns null", () => {
    const days = makeMonth();
    expect(nextFocusId(days, "c-3-0", "ArrowLeft")).toBeNull();
  });

  it("P11: Home jumps to the first element of the first non-empty day of the month", () => {
    const days = makeMonth();
    expect(nextFocusId(days, "c-24-0", "Home")).toBe("c-3-0");
  });

  it("P12: End jumps to the last element of the last non-empty day of the month", () => {
    const days = makeMonth();
    expect(nextFocusId(days, "c-3-0", "End")).toBe("c-24-0");
  });

  it("P12b: End lands on the last day's LAST element, not just its first — a fixture where those differ", () => {
    // Declared locally (not in the shared fixture): day 24 above has only one id, so it cannot
    // tell "last day" apart from "last element of the last day". This can.
    const days: DayFocusables[] = [
      { day: 1, ids: ["c-1-0"] },
      { day: 2, ids: ["c-2-0", "c-2-1", "t-2"] },
    ];
    expect(nextFocusId(days, "c-1-0", "End")).toBe("t-2");
  });

  it("P13: every non-navigation key is unhandled — the handler must not hijack activation or the tab sequence", () => {
    const days = makeMonth();
    for (const key of ["Tab", "PageDown", "PageUp", "a", "Enter", " ", "Escape"]) {
      expect(nextFocusId(days, "c-10-0", key)).toBeNull();
    }
  });

  it("P14: an unknown currentId (post-refetch staleness) returns null for every navigation key, never throws", () => {
    const days = makeMonth();
    for (const key of ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"]) {
      expect(nextFocusId(days, "c-99-0", key)).toBeNull();
    }
  });

  it("P14b: an empty grid (no days, or days with no ids) returns null, never throws", () => {
    expect(nextFocusId([], "c-3-0", "ArrowDown")).toBeNull();
    expect(nextFocusId([{ day: 1, ids: [] }], "c-3-0", "ArrowDown")).toBeNull();
  });
});

describe("resolveRovingId", () => {
  it("P15: remembered id present -> itself; absent -> first id of the first non-empty day; null -> same fallback; all-empty days -> null", () => {
    const days = makeMonth();
    expect(resolveRovingId(days, "c-10-0")).toBe("c-10-0");
    expect(resolveRovingId(days, "c-99-0")).toBe("c-3-0");
    expect(resolveRovingId(days, null)).toBe("c-3-0");
    const empty: DayFocusables[] = [{ day: 1, ids: [] }, { day: 2, ids: [] }];
    expect(resolveRovingId(empty, "c-1-0")).toBeNull();
    expect(resolveRovingId(empty, null)).toBeNull();
  });
});
