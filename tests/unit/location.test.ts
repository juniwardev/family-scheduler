// tests/unit/location.test.ts — src/shared/location.ts (Decision 3 + Decision 4/6).
import { describe, it, expect } from "vitest";
import {
  classifyLocation,
  resolveLocationKind,
  resolveLocationRender,
  buildMapsUrl,
  resolveMapsProvider,
} from "../../src/shared/location";

describe("classifyLocation", () => {
  it('plain text ("Home") stays plain with no url', () => {
    const result = classifyLocation("Home");
    expect(result.kind).toBe("plain");
    expect(result.url).toBeUndefined();
  });

  it("empty/whitespace-only -> plain, no url", () => {
    expect(classifyLocation("").kind).toBe("plain");
    expect(classifyLocation("   ").kind).toBe("plain");
    expect(classifyLocation("").url).toBeUndefined();
  });

  it("Zoom URL -> meeting with url", () => {
    const result = classifyLocation("https://zoom.us/j/123456789");
    expect(result.kind).toBe("meeting");
    expect(result.url).toBe("https://zoom.us/j/123456789");
  });

  it("Microsoft Teams URL -> meeting with url", () => {
    const result = classifyLocation("https://teams.microsoft.com/l/meetup-join/abc");
    expect(result.kind).toBe("meeting");
    expect(result.url).toContain("teams.microsoft.com");
  });

  it("Google Meet URL -> meeting with url", () => {
    const result = classifyLocation("https://meet.google.com/abc-defg-hij");
    expect(result.kind).toBe("meeting");
    expect(result.url).toContain("meet.google.com");
  });

  it("address-like text (street number) -> address, no url from classifier", () => {
    const result = classifyLocation("123 Main St");
    expect(result.kind).toBe("address");
    expect(result.url).toBeUndefined();
  });

  it("address-like text (postal code) -> address", () => {
    expect(classifyLocation("Somewhere, CA 90210").kind).toBe("address");
  });

  it("address-like text (street-type token) -> address", () => {
    expect(classifyLocation("Grandma's House, Elm Avenue").kind).toBe("address");
  });

  it("generic (non-meeting) URL -> plain with url (not mislabeled as meeting)", () => {
    const result = classifyLocation("https://example.com/party-invite");
    expect(result.kind).toBe("plain");
    expect(result.url).toBe("https://example.com/party-invite");
  });

  it("free-text non-address, non-URL -> plain", () => {
    expect(classifyLocation("Alex's school").kind).toBe("plain");
    expect(classifyLocation("Grandma's").kind).toBe("plain");
  });
});

describe("resolveLocationKind — override precedence", () => {
  it("no override -> auto-detected kind", () => {
    expect(resolveLocationKind("Home", null)).toBe("plain");
    expect(resolveLocationKind("123 Main St", null)).toBe("address");
    expect(resolveLocationKind("https://zoom.us/j/1", undefined)).toBe("meeting");
  });

  it("override beats auto-detect", () => {
    expect(resolveLocationKind("Home", "address")).toBe("address");
    expect(resolveLocationKind("123 Main St", "plain")).toBe("plain");
  });
});

describe("resolveLocationRender — override edge rules (m2/m3)", () => {
  it("override=address on a non-address string still builds a maps href (search semantics on raw text)", () => {
    const result = resolveLocationRender("Home", "address", "apple");
    expect(result.kind).toBe("address");
    expect(result.href).toBe("https://maps.apple.com/?q=Home");
  });

  it("override=meeting with no parseable URL degrades to plain (no href, no 'Tap to join')", () => {
    const result = resolveLocationRender("Home", "meeting", "apple");
    expect(result.kind).toBe("plain");
    expect(result.href).toBeUndefined();
  });

  it("override=meeting WITH a real meeting URL keeps the meeting href", () => {
    const result = resolveLocationRender("https://zoom.us/j/1", "meeting", "apple");
    expect(result.kind).toBe("meeting");
    expect(result.href).toBe("https://zoom.us/j/1");
  });

  it("override=plain forces plain text regardless of what the string looks like", () => {
    const result = resolveLocationRender("https://zoom.us/j/1", "plain", "apple");
    expect(result.kind).toBe("plain");
  });

  it("no override, plain generic URL still exposes href as a plain link", () => {
    const result = resolveLocationRender("https://example.com/x", null, "apple");
    expect(result.kind).toBe("plain");
    expect(result.href).toBe("https://example.com/x");
  });

  it("no override, address auto-detected builds maps href with the given provider", () => {
    const result = resolveLocationRender("123 Main St", null, "google");
    expect(result.kind).toBe("address");
    expect(result.href).toBe("https://maps.google.com/?q=123%20Main%20St");
  });
});

describe("buildMapsUrl", () => {
  it("apple provider", () => {
    expect(buildMapsUrl("123 Main St", "apple")).toBe(
      "https://maps.apple.com/?q=123%20Main%20St"
    );
  });

  it("google provider", () => {
    expect(buildMapsUrl("123 Main St", "google")).toBe(
      "https://maps.google.com/?q=123%20Main%20St"
    );
  });
});

describe("resolveMapsProvider", () => {
  it("null -> apple", () => {
    expect(resolveMapsProvider(null)).toBe("apple");
  });
  it("undefined -> apple", () => {
    expect(resolveMapsProvider(undefined)).toBe("apple");
  });
  it("'apple' -> apple", () => {
    expect(resolveMapsProvider("apple")).toBe("apple");
  });
  it("'google' -> google", () => {
    expect(resolveMapsProvider("google")).toBe("google");
  });
  it("unknown junk -> apple (safe default)", () => {
    expect(resolveMapsProvider("waze")).toBe("apple");
  });
});
