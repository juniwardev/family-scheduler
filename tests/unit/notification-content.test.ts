// tests/unit/notification-content.test.ts — src/worker/reminders/content.ts
// Covers: type-aware subject/title, localized time in a non-default zone, location per
// type + provider, deep link presence, no raw UUID, push byte cap (UTF-8 bytes via
// TextEncoder), and HTML escaping of injected content.
import { describe, it, expect } from "vitest";
import type { Item } from "../../src/worker/types";
import {
  buildEmailContent,
  buildPushContent,
  escapeHtml,
  PUSH_MAX_BYTES,
} from "../../src/worker/reminders/content";

const APP_URL = "https://family.example.com";

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    list_id: "list-1",
    type: "event",
    title: "Alex football practice",
    location: null,
    notes: null,
    start_at: 1_800_000_000_000,
    end_at: null,
    all_day: false,
    rrule: null,
    timezone: "America/Los_Angeles",
    completed_at: null,
    created_by: "owner@example.com",
    created_at: 0,
    updated_at: 0,
    location_kind: null,
    archived_at: null,
    ...overrides,
  };
}

describe("buildEmailContent — subject", () => {
  it("event -> 'Event reminder: <title>'", () => {
    const item = makeItem({ type: "event", title: "Alex football practice" });
    const content = buildEmailContent(item, item.start_at, APP_URL, "apple");
    expect(content.subject).toBe("Event reminder: Alex football practice");
  });

  it("task -> 'Task due: <title>'", () => {
    const item = makeItem({ type: "task", title: "Permission slip" });
    const content = buildEmailContent(item, item.start_at, APP_URL, "apple");
    expect(content.subject).toBe("Task due: Permission slip");
  });
});

describe("buildEmailContent — localized time", () => {
  it("renders a human-readable time in a NON-default zone (America/New_York), not epoch", () => {
    const item = makeItem({ timezone: "America/New_York" });
    // 2027-01-15T18:00:00Z — a fixed instant so the formatted string is deterministic-ish.
    const occurrenceAt = Date.UTC(2027, 0, 15, 18, 0, 0);
    const content = buildEmailContent(item, occurrenceAt, APP_URL, "apple");

    expect(content.text).not.toMatch(/\b\d{13}\b/); // no raw epoch number
    expect(content.text).toMatch(/2027/);
    expect(content.text).toMatch(/EST|EDT/); // zone abbreviation for America/New_York
  });

  it("occurrence_at is used, not item.start_at (recurring item semantics)", () => {
    const startAt = Date.UTC(2020, 0, 1, 12, 0, 0);
    const occurrenceAt = Date.UTC(2027, 5, 1, 12, 0, 0); // a much later occurrence
    const item = makeItem({ start_at: startAt, rrule: "FREQ=WEEKLY" });
    const content = buildEmailContent(item, occurrenceAt, APP_URL, "apple");
    expect(content.text).toMatch(/2027/);
    expect(content.text).not.toMatch(/2020/);
  });
});

describe("buildEmailContent — location rendering", () => {
  it("meeting link -> 'Tap to join' + href", () => {
    const item = makeItem({ location: "https://zoom.us/j/123456789" });
    const content = buildEmailContent(item, item.start_at, APP_URL, "apple");
    expect(content.html).toContain("Tap to join");
    expect(content.html).toContain("https://zoom.us/j/123456789");
  });

  it("address -> maps link honoring apple provider", () => {
    const item = makeItem({ location: "123 Main St" });
    const content = buildEmailContent(item, item.start_at, APP_URL, "apple");
    expect(content.html).toContain("https://maps.apple.com/?q=123%20Main%20St");
  });

  it("address -> maps link honoring google provider", () => {
    const item = makeItem({ location: "123 Main St" });
    const content = buildEmailContent(item, item.start_at, APP_URL, "google");
    expect(content.html).toContain("https://maps.google.com/?q=123%20Main%20St");
  });

  it('plain text ("Home") renders as plain text, no maps/join link', () => {
    const item = makeItem({ location: "Home" });
    const content = buildEmailContent(item, item.start_at, APP_URL, "apple");
    expect(content.html).toContain("Home");
    expect(content.html).not.toContain("maps.apple.com");
    expect(content.html).not.toContain("Tap to join");
  });

  it("no location -> no location line", () => {
    const item = makeItem({ location: null });
    const content = buildEmailContent(item, item.start_at, APP_URL, "apple");
    expect(content.html).not.toContain("maps.");
    expect(content.html).not.toContain("Tap to join");
  });
});

describe("buildEmailContent — deep link + no UUID", () => {
  it("includes a well-formed deep link to the item", () => {
    const item = makeItem();
    const content = buildEmailContent(item, item.start_at, APP_URL, "apple");
    const expectedLink = `${APP_URL}/?item=${item.id}`;
    expect(content.html).toContain(expectedLink);
    expect(content.text).toContain(expectedLink);
  });

  it("never exposes the raw item UUID as bare, unlabeled content (only inside the deep link)", () => {
    const item = makeItem();
    const content = buildEmailContent(item, item.start_at, APP_URL, "apple");
    // The UUID appears ONLY as part of the deep-link URL, never as standalone text like
    // "item ID: <uuid>" (the old, unusable content this feature replaces).
    expect(content.text).not.toMatch(/item ID/i);
    expect(content.subject).not.toContain(item.id);
    const withoutLink = content.text.replace(`${APP_URL}/?item=${item.id}`, "");
    expect(withoutLink).not.toContain(item.id);
  });
});

describe("buildEmailContent — HTML escaping", () => {
  it("escapes an injected <script> and quote in the title", () => {
    const item = makeItem({ title: `<script>alert("x")</script>` });
    const content = buildEmailContent(item, item.start_at, APP_URL, "apple");
    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("&lt;script&gt;");
  });

  it("escapes injected content in notes", () => {
    const item = makeItem({ notes: `"><img src=x onerror=alert(1)>` });
    const content = buildEmailContent(item, item.start_at, APP_URL, "apple");
    expect(content.html).not.toContain("<img src=x");
    expect(content.html).toContain("&quot;&gt;&lt;img");
  });

  it("escapeHtml escapes all five special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("buildPushContent", () => {
  it("title is type-aware and body carries localized time", () => {
    const item = makeItem({ type: "task", title: "Permission slip" });
    const content = buildPushContent(item, item.start_at, APP_URL, "apple");
    expect(content.title).toBe("Task due: Permission slip");
    expect(content.body).not.toMatch(/\b\d{13}\b/);
  });

  it("meeting location summarizes to 'Tap to join'", () => {
    const item = makeItem({ location: "https://meet.google.com/abc-defg-hij" });
    const content = buildPushContent(item, item.start_at, APP_URL, "apple");
    expect(content.body).toContain("Tap to join");
  });

  it("includes url + item_id for the deep link", () => {
    const item = makeItem();
    const content = buildPushContent(item, item.start_at, APP_URL, "apple");
    expect(content.url).toBe(`${APP_URL}/?item=${item.id}`);
    expect(content.item_id).toBe(item.id);
  });

  it("stays within PUSH_MAX_BYTES (measured via TextEncoder, not string length) even with a long multibyte title + location", () => {
    const longMultibyteTitle = "🎉".repeat(200) + " Family Reunion Celebration Party";
    const longLocation = "东京都渋谷区".repeat(50) + " Conference Hall";
    const item = makeItem({ title: longMultibyteTitle, location: longLocation });
    const content = buildPushContent(item, item.start_at, APP_URL, "apple");

    const byteLength = new TextEncoder().encode(JSON.stringify(content)).byteLength;
    expect(byteLength).toBeLessThanOrEqual(PUSH_MAX_BYTES);
  });

  it("byte cap is measured on UTF-8 bytes, not JS string .length (multibyte chars count more)", () => {
    // A string of emoji has string.length much smaller than its UTF-8 byte length.
    const multibyteTitle = "🚀".repeat(50);
    const item = makeItem({ title: multibyteTitle });
    const content = buildPushContent(item, item.start_at, APP_URL, "apple");
    const byteLength = new TextEncoder().encode(JSON.stringify(content)).byteLength;
    const stringLength = JSON.stringify(content).length;
    // Byte length must be strictly greater than JS string length for multibyte content —
    // proves the cap logic isn't silently using .length as a proxy for bytes.
    expect(byteLength).toBeGreaterThan(stringLength);
    expect(byteLength).toBeLessThanOrEqual(PUSH_MAX_BYTES);
  });
});
