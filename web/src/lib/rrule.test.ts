import { describe, it, expect } from "vitest";
import { buildRRule, parseRRule, describeRecurrence } from "./rrule";

describe("parseRRule / buildRRule round-trip", () => {
  it("none", () => {
    expect(buildRRule(parseRRule(null))).toBeNull();
  });

  it("daily", () => {
    const rrule = "FREQ=DAILY";
    expect(buildRRule(parseRRule(rrule))).toBe(rrule);
  });

  it("daily + interval", () => {
    const rrule = "FREQ=DAILY;INTERVAL=3";
    expect(buildRRule(parseRRule(rrule))).toBe(rrule);
  });

  it("weekly + BYDAY", () => {
    const rrule = "FREQ=WEEKLY;BYDAY=MO,WE";
    expect(buildRRule(parseRRule(rrule))).toBe(rrule);
  });

  it("monthly + COUNT", () => {
    const rrule = "FREQ=MONTHLY;COUNT=5";
    expect(buildRRule(parseRRule(rrule))).toBe(rrule);
  });

  it("weekly + UNTIL", () => {
    const rrule = "FREQ=WEEKLY;UNTIL=20261231T000000Z";
    expect(buildRRule(parseRRule(rrule))).toBe(rrule);
  });
});

describe("describeRecurrence", () => {
  it("null -> null", () => {
    expect(describeRecurrence(null)).toBeNull();
  });

  it("garbage string -> null", () => {
    expect(describeRecurrence("not a valid rrule at all")).toBeNull();
  });

  it("FREQ=DAILY -> 'Every day'", () => {
    expect(describeRecurrence("FREQ=DAILY")).toBe("Every day");
  });

  it("FREQ=DAILY;INTERVAL=3 -> 'Every 3 days'", () => {
    expect(describeRecurrence("FREQ=DAILY;INTERVAL=3")).toBe("Every 3 days");
  });

  it("FREQ=WEEKLY;BYDAY=MO,WE -> 'Every week on Mon, Wed'", () => {
    expect(describeRecurrence("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("Every week on Mon, Wed");
  });

  it("FREQ=WEEKLY;BYDAY=WE,MO -> sorted to 'Every week on Mon, Wed'", () => {
    expect(describeRecurrence("FREQ=WEEKLY;BYDAY=WE,MO")).toBe("Every week on Mon, Wed");
  });

  it("FREQ=WEEKLY;INTERVAL=2 -> 'Every 2 weeks'", () => {
    expect(describeRecurrence("FREQ=WEEKLY;INTERVAL=2")).toBe("Every 2 weeks");
  });

  it("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO -> 'Every 2 weeks on Mon'", () => {
    expect(describeRecurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO")).toBe("Every 2 weeks on Mon");
  });

  it("FREQ=MONTHLY;COUNT=5 -> 'Every month · 5 occurrences'", () => {
    expect(describeRecurrence("FREQ=MONTHLY;COUNT=5")).toBe("Every month · 5 occurrences");
  });

  it("FREQ=WEEKLY;UNTIL=20261231T000000Z -> 'Every week · until Thu, Dec 31, 2026'", () => {
    expect(describeRecurrence("FREQ=WEEKLY;UNTIL=20261231T000000Z")).toBe(
      "Every week · until Thu, Dec 31, 2026"
    );
  });

  it("FREQ=DAILY;INTERVAL=abc -> interval coerced to 1: 'Every day'", () => {
    expect(describeRecurrence("FREQ=DAILY;INTERVAL=abc")).toBe("Every day");
  });

  it("FREQ=WEEKLY;BYDAY= -> no 'on' clause: 'Every week'", () => {
    expect(describeRecurrence("FREQ=WEEKLY;BYDAY=")).toBe("Every week");
  });

  it("FREQ=WEEKLY;BYDAY=XX -> unrecognised day dropped: 'Every week'", () => {
    expect(describeRecurrence("FREQ=WEEKLY;BYDAY=XX")).toBe("Every week");
  });

  it("FREQ=MONTHLY;COUNT=abc -> count clause omitted: 'Every month'", () => {
    expect(describeRecurrence("FREQ=MONTHLY;COUNT=abc")).toBe("Every month");
  });

  it("HC3 guard: hardening lives in describeRecurrence, not parseRRule", () => {
    // parseRRule stays verbatim — it does not coerce/validate INTERVAL at all.
    const parsed = parseRRule("FREQ=DAILY;INTERVAL=abc");
    expect(parsed.interval).toBeNaN();
    // describeRecurrence is where the coercion happens.
    expect(describeRecurrence("FREQ=DAILY;INTERVAL=abc")).toBe("Every day");
  });
});
