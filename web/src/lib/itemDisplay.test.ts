import { describe, it, expect } from "vitest";
import { splitOffsetMinutes, describeReminder } from "./itemDisplay";

describe("splitOffsetMinutes", () => {
  it("30 -> {30, minutes}", () => {
    expect(splitOffsetMinutes(30)).toEqual({ value: 30, unit: "minutes" });
  });

  it("60 -> {1, hours}", () => {
    expect(splitOffsetMinutes(60)).toEqual({ value: 1, unit: "hours" });
  });

  it("90 -> {90, minutes} (not evenly divisible by 60)", () => {
    expect(splitOffsetMinutes(90)).toEqual({ value: 90, unit: "minutes" });
  });

  it("1440 -> {1, days}", () => {
    expect(splitOffsetMinutes(1440)).toEqual({ value: 1, unit: "days" });
  });
});

describe("describeReminder", () => {
  it("singular value", () => {
    expect(describeReminder({ offset_minutes: 60, channel_email: true, channel_push: false })).toBe(
      "1 hour before · Email"
    );
  });

  it("plural value", () => {
    expect(describeReminder({ offset_minutes: 30, channel_email: true, channel_push: false })).toBe(
      "30 minutes before · Email"
    );
  });

  it("email-only", () => {
    expect(describeReminder({ offset_minutes: 30, channel_email: true, channel_push: false })).toBe(
      "30 minutes before · Email"
    );
  });

  it("push-only", () => {
    expect(describeReminder({ offset_minutes: 30, channel_email: false, channel_push: true })).toBe(
      "30 minutes before · Push"
    );
  });

  it("both channels", () => {
    expect(describeReminder({ offset_minutes: 30, channel_email: true, channel_push: true })).toBe(
      "30 minutes before · Email, Push"
    );
  });

  it("no channels", () => {
    expect(describeReminder({ offset_minutes: 30, channel_email: false, channel_push: false })).toBe(
      "30 minutes before · no channels"
    );
  });

  it("offset_minutes === 0 -> 'At the time of the event ...' not '0 minutes before'", () => {
    expect(describeReminder({ offset_minutes: 0, channel_email: true, channel_push: true })).toBe(
      "At the time of the event · Email, Push"
    );
  });
});
