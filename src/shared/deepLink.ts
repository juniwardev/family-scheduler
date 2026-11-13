// src/shared/deepLink.ts — deep-link scheme for "open this item" (query-param form).
// Pure (uses the URL/URLSearchParams APIs available in both Workers and browsers).
// Single producer/parser consumed by: email content, push payload, the frontend boot
// handler (App.tsx), and (informally, via a tiny inline fallback) the service worker.

/**
 * Build the absolute deep-link URL for an item: `${appUrl}/?item=<id>`.
 * Uses the URL API (not string concatenation) so encoding is correct and a trailing
 * slash / existing query string on appUrl is handled safely.
 */
export function buildItemDeepLink(appUrl: string, itemId: string): string {
  const url = new URL(appUrl);
  url.searchParams.set("item", itemId);
  return url.toString();
}

/**
 * Parse an `item` id out of a location.search-style string (e.g. "?item=abc123").
 * Returns null if absent. Accepts either a leading "?" or a bare query string.
 */
export function parseItemDeepLink(search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const id = params.get("item");
  return id && id.length > 0 ? id : null;
}
