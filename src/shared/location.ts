// src/shared/location.ts — smart-location classification + maps URL builder.
// Pure, framework-agnostic (no DOM/Worker deps). Single source of truth consumed by both the
// notification content builders (src/worker/reminders/content.ts) and, per the plan's
// follow-up note, any future in-app read-only location render (feat/ui-redesign).

export type LocationKind = "plain" | "address" | "meeting";
export type MapsProvider = "apple" | "google";

export interface ClassifiedLocation {
  kind: LocationKind;
  // Present only for 'meeting' (a joinable URL) or a generic (non-meeting) URL rendered
  // as a plain link. Address hrefs are NOT built here — see the module doc below.
  url?: string;
}

// Known meeting-provider hosts (case-insensitive suffix match against the URL's hostname).
const MEETING_HOSTS = [
  "zoom.us",
  "zoom.com",
  "teams.microsoft.com",
  "teams.live.com",
  "meet.google.com",
  "webex.com",
  "whereby.com",
];

function hostMatchesMeetingProvider(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return MEETING_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

// Address-like heuristics (Decision 3, all conservative — false negatives are correctable
// via the override toggle; false positives are more annoying, so this requires a strong signal).
const STREET_NUMBER_RE = /^\s*\d+\s+\S/;
const POSTAL_CODE_RE = /\b\d{5}(-\d{4})?\b/;
const STREET_TYPE_RE =
  /\b(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|way|ct|court|hwy|highway|suite|ste|#)\b/i;

function tryParseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  try {
    return new URL(trimmed);
  } catch {
    // Not an absolute http(s) URL as-is; try prefixing https:// for a bare host/www string.
    if (/^www\.[^\s]+$/i.test(trimmed) || /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
      try {
        return new URL(`https://${trimmed}`);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Classify a free-text location string. Order matters (see plan Decision 3):
 *   1. Empty/whitespace -> plain (no url).
 *   2. Known meeting-provider URL -> meeting (url = the URL as-is).
 *   3. Other http(s) URL -> plain, but expose url so it can still render as a plain link.
 *      WHY: a random URL is not a "Tap to join" affordance — mislabeling it as a meeting
 *      link would be a false-positive "join" promise with nothing to join.
 *   4. Address-like text (street number, postal code, or street-type token) -> address
 *      (no url here; the CALLER builds a maps href via buildMapsUrl(raw, provider) — kept
 *      out of this pure classifier because the maps form depends on a per-user provider).
 *   5. Otherwise -> plain (e.g. "Home", "Alex's school").
 */
export function classifyLocation(raw: string): ClassifiedLocation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "plain" };

  const parsed = tryParseUrl(trimmed);
  if (parsed && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
    if (hostMatchesMeetingProvider(parsed.hostname)) {
      return { kind: "meeting", url: parsed.toString() };
    }
    // Generic URL — stays plain, but still tappable as a plain link.
    return { kind: "plain", url: parsed.toString() };
  }

  if (
    STREET_NUMBER_RE.test(trimmed) ||
    POSTAL_CODE_RE.test(trimmed) ||
    STREET_TYPE_RE.test(trimmed)
  ) {
    return { kind: "address" };
  }

  return { kind: "plain" };
}

/**
 * Effective kind = the user's stored override if present, else the auto-detected kind.
 * Override beats auto-detect (Decision 3). `override` is `items.location_kind`, which is
 * NULL for every existing row and every item the user never touches the toggle on.
 */
export function resolveLocationKind(
  raw: string,
  override: LocationKind | null | undefined
): LocationKind {
  return override ?? classifyLocation(raw).kind;
}

/**
 * Provider-aware maps search URL. Pure — query is the raw location text (search-query
 * semantics), provider is the per-user preference resolved by resolveMapsProvider.
 * Consumed by the notification content builders (server-side) and any future in-app render.
 */
export function buildMapsUrl(query: string, provider: MapsProvider): string {
  const q = encodeURIComponent(query);
  return provider === "google"
    ? `https://maps.google.com/?q=${q}`
    : `https://maps.apple.com/?q=${q}`; // default = apple
}

/**
 * Resolve a stored users.maps_provider value (NULL | 'apple' | 'google' | anything else
 * from a future/foreign write) to the effective MapsProvider. Unknown/null -> apple
 * (Decision 6: default is Apple Maps — owner's primary device is an iPhone with no Google
 * Maps app installed).
 */
export function resolveMapsProvider(stored: string | null | undefined): MapsProvider {
  return stored === "google" ? "google" : "apple";
}

export interface LocationRenderInfo {
  kind: LocationKind;
  // href to render as a tappable link; undefined means plain text, no link.
  href?: string;
  // Display text for the location line (always the raw text, callers decide truncation).
  text: string;
}

/**
 * Full render resolution used by the content builders: combines resolveLocationKind with
 * the override edge rules (Decision 3) for how `href` is derived per effective kind.
 *
 *   - address -> always a maps href built from the raw text (search-query semantics), even
 *     under an override that forces 'address' on a string that doesn't look like one.
 *   - meeting -> a href only if classifyLocation(raw) actually found a joinable URL;
 *     otherwise (e.g. an override forces 'meeting' on plain text with no URL) DEGRADE to
 *     plain rendering — no href, no "Tap to join" with nowhere to go.
 *   - plain -> the classifier's generic url (if any) is still tappable as a plain link;
 *     otherwise no href.
 */
export function resolveLocationRender(
  raw: string,
  override: LocationKind | null | undefined,
  provider: MapsProvider
): LocationRenderInfo {
  const trimmed = raw.trim();
  const classified = classifyLocation(raw);
  const kind = resolveLocationKind(raw, override);

  if (kind === "address") {
    return { kind, href: buildMapsUrl(trimmed, provider), text: trimmed };
  }

  if (kind === "meeting") {
    if (classified.kind === "meeting" && classified.url) {
      return { kind, href: classified.url, text: trimmed };
    }
    // Degrade to plain: no derivable URL to join.
    return { kind: "plain", href: classified.url, text: trimmed };
  }

  // plain
  return { kind: "plain", href: classified.url, text: trimmed };
}
