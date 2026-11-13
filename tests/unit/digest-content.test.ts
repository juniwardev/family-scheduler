// Regression test for the daily-digest timezone-rendering fix.
// Before: sendDailyDigest rendered occurrence times with Date#toUTCString (always UTC),
// inconsistent with the per-item reminder content builders that render in the item's stored
// timezone. This asserts the digest now renders each entry in its own IANA timezone via the
// shared formatOccurrenceTime, and never falls back to the old UTC "GMT" form for a valid zone.

import { describe, it, expect } from "vitest";
import { composeDigestBody, type DigestEntry } from "../../src/worker/reminders/send";
import type { EpochMs } from "../../src/worker/types";

// 2026-07-15T18:30:00Z — in America/New_York (EDT, UTC-4) this is 2:30 PM EDT.
const INSTANT = Date.UTC(2026, 6, 15, 18, 30) as EpochMs;

function entry(overrides: Partial<DigestEntry> = {}): DigestEntry {
  return {
    listName: "Kids",
    title: "Alex football practice",
    start_at: INSTANT,
    timezone: "America/New_York",
    all_day: false,
    ...overrides,
  };
}

describe("composeDigestBody — timezone rendering", () => {
  it("renders a timed occurrence in the item's stored timezone, not UTC", () => {
    const { html, text } = composeDigestBody([entry()]);

    // NY-local wall time + zone abbreviation prove the item timezone was used.
    expect(html).toContain("2:30 PM");
    expect(html).toContain("EDT");
    expect(text).toContain("2:30 PM");
    expect(text).toContain("EDT");

    // The old UTC rendering must not survive.
    expect(html).not.toContain("18:30");
    expect(html).not.toContain("GMT");
    expect(html).not.toContain("UTC");
  });

  it("renders different timezones differently for the same instant", () => {
    const ny = composeDigestBody([entry({ timezone: "America/New_York" })]).html;
    const la = composeDigestBody([entry({ timezone: "America/Los_Angeles" })]).html;

    // Same epoch, different zones → different wall-clock strings.
    expect(ny).toContain("2:30 PM");
    expect(ny).toContain("EDT");
    expect(la).toContain("11:30 AM");
    expect(la).toContain("PDT");
    expect(ny).not.toEqual(la);
  });

  it("renders an all-day entry as a date without a time-of-day", () => {
    const { html } = composeDigestBody([entry({ all_day: true })]);
    expect(html).toContain("Jul 15, 2026");
    expect(html).not.toContain("2:30 PM");
    // No timeZoneName suffix on the all-day format.
    expect(html).not.toContain("EDT");
  });

  it("still lists the title and list name", () => {
    const { html, text } = composeDigestBody([entry()]);
    expect(html).toContain("Alex football practice");
    expect(html).toContain("Kids");
    expect(text).toContain("Alex football practice");
    expect(text).toContain("Kids");
  });

  it("returns the empty-window fallback when there are no entries", () => {
    const { html, text } = composeDigestBody([]);
    expect(html).toContain("No items scheduled for today or tomorrow.");
    expect(text).toContain("No items scheduled for today or tomorrow.");
  });

  it("escapes HTML-special characters in title/listName in the HTML body", () => {
    const { html } = composeDigestBody([
      entry({ title: `<script>alert(1)</script>`, listName: `Tom & "Jerry"` }),
    ]);
    // Raw markup must not survive into the HTML.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("</script>");
    // Escaped entities present instead.
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Tom &amp; ");
    expect(html).toContain("&quot;Jerry&quot;");
  });

  it("does NOT HTML-escape the plain-text body (it is not HTML)", () => {
    const { text } = composeDigestBody([
      entry({ title: `Tom & Jerry`, listName: `A<B` }),
    ]);
    // Plain text keeps the literal characters — escaping here would be wrong.
    expect(text).toContain("Tom & Jerry");
    expect(text).toContain("A<B");
    expect(text).not.toContain("&amp;");
    expect(text).not.toContain("&lt;");
  });
});
