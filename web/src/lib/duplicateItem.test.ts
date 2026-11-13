// web/src/lib/duplicateItem.test.ts — buildDuplicateDraft (plan §5.7.1 / §7.1 T23).
import { describe, it, expect } from "vitest";
import { buildDuplicateDraft } from "./duplicateItem";
import type { Item } from "../types";

const HOUR = 60 * 60 * 1000;

// A fixed "now" for every test — never the ambient clock. Tue 2026-07-14 12:00 local.
const NOW = new Date(2026, 6, 14, 12, 0, 0).getTime();

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    list_id: "list-1",
    type: "event",
    title: "Soccer practice",
    location: "123 Main St",
    notes: "Bring cleats",
    start_at: NOW, // caller overrides for each scenario
    end_at: null,
    all_day: false,
    rrule: null,
    timezone: "America/Los_Angeles",
    completed_at: null,
    created_by: "owner@example.com",
    created_at: 0,
    updated_at: 0,
    reminders: [{ id: "rem-1", item_id: "item-1", offset_minutes: 10, channel_email: true, channel_push: false }],
    location_kind: "address",
    archived_at: NOW - 24 * HOUR,
    ...overrides,
  };
}

describe("buildDuplicateDraft", () => {
  it("copies all twelve ItemDraft fields explicitly", () => {
    const item = makeItem({
      start_at: new Date(2026, 6, 14, 20, 0, 0).getTime(), // 20:00 today, not yet passed
      end_at: new Date(2026, 6, 14, 21, 0, 0).getTime(), // 1h duration
    });
    const draft = buildDuplicateDraft(item, NOW);

    expect(draft.list_id).toBe(item.list_id);
    expect(draft.type).toBe(item.type);
    expect(draft.title).toBe(item.title);
    expect(draft.location).toBe(item.location);
    expect(draft.notes).toBe(item.notes);
    expect(draft.all_day).toBe(item.all_day);
    expect(draft.rrule).toBeNull();
    expect(draft.timezone).toBe(item.timezone);
    expect(draft.reminders).toEqual(item.reminders);
    expect(draft.location_kind).toBe(item.location_kind);
  });

  it("timed, not-yet-passed today -> today, same H:M, duration preserved", () => {
    const start = new Date(2026, 6, 14, 20, 0, 0).getTime(); // 20:00, NOW is 12:00 same day
    const end = start + 90 * 60 * 1000;
    const item = makeItem({ start_at: start, end_at: end });
    const draft = buildDuplicateDraft(item, NOW);

    const d = new Date(draft.start_at);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(14); // today
    expect(d.getHours()).toBe(20);
    expect(d.getMinutes()).toBe(0);
    expect(draft.end_at! - draft.start_at).toBe(90 * 60 * 1000); // duration preserved
  });

  it("timed, already-passed today -> tomorrow, same H:M", () => {
    const start = new Date(2026, 6, 14, 8, 0, 0).getTime(); // 08:00, NOW is 12:00 same day
    const item = makeItem({ start_at: start, end_at: null });
    const draft = buildDuplicateDraft(item, NOW);

    const d = new Date(draft.start_at);
    expect(d.getDate()).toBe(15); // tomorrow, full local calendar date
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(0);
    expect(draft.end_at).toBeNull(); // null stays null
  });

  it("all-day -> tomorrow (midnight has always already passed) — NOT today", () => {
    // All-day source: local midnight of some past day.
    const start = new Date(2026, 6, 10, 0, 0, 0).getTime();
    const item = makeItem({ start_at: start, end_at: null, all_day: true });
    const draft = buildDuplicateDraft(item, NOW);

    const d = new Date(draft.start_at);
    expect(d.getDate()).toBe(15); // tomorrow relative to NOW (2026-07-14), never today
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(draft.all_day).toBe(true);
  });

  it("null location/notes on the source become empty strings, not the literal null", () => {
    const item = makeItem({ location: null, notes: null });
    const draft = buildDuplicateDraft(item, NOW);
    expect(draft.location).toBe("");
    expect(draft.notes).toBe("");
  });

  it("rrule is always null, even when the source has one", () => {
    const item = makeItem({ rrule: "FREQ=DAILY" });
    const draft = buildDuplicateDraft(item, NOW);
    expect(draft.rrule).toBeNull();
  });
});
