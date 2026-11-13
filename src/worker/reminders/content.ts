// reminders/content.ts — notification content builders (email + push).
// Consumes the shared, framework-agnostic modules (src/shared/) so subject/title, localized
// time, and smart-location rendering stay a single source of truth. This is a content-only
// module: it has zero interaction with the reminder engine's dispatch ledger, selection, or
// the push crypto path (src/worker/channels/push.ts is untouched).
import type { Item } from "../types";
import type { MapsProvider } from "../../shared/location";
import { resolveLocationRender } from "../../shared/location";
import { typeLabel, formatOccurrenceTime } from "../../shared/itemLabels";
import { buildItemDeepLink } from "../../shared/deepLink";

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface PushContent {
  title: string;
  body: string;
  url: string;
  item_id: string;
}

// Push byte cap: measured on the UTF-8 SERIALIZED JSON bytes (NOT JS string .length, since
// titles/locations may contain multibyte characters) via TextEncoder. web-push aes128gcm
// records have a practical safe ceiling well under 4 KB (push.ts recordSize=4096, plus ~102
// bytes of framing overhead); 3000 bytes leaves ample headroom (Decision 5 / m5).
export const PUSH_MAX_BYTES = 3000;

const PUSH_TITLE_TRUNCATE = 80;
const PUSH_LOCATION_TRUNCATE = 60;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Escapes item-derived user text before interpolating into the email HTML body. Previously
// the only interpolated value was a UUID (escaping was moot); now titles/notes/location are
// user-supplied text, so this is a correctness AND light-security requirement.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the enriched email content for a due reminder.
 * `occurrenceAtMs` is the dispatch row's occurrence_at — NOT item.start_at — because
 * recurring items fire per-occurrence (see formatOccurrenceTime's WHY comment).
 */
export function buildEmailContent(
  item: Item,
  occurrenceAtMs: number,
  appUrl: string,
  mapsProvider: MapsProvider
): EmailContent {
  const subject = `${typeLabel(item.type)}: ${item.title}`;
  const timeStr = formatOccurrenceTime(occurrenceAtMs, item.timezone, item.all_day);
  const deepLink = buildItemDeepLink(appUrl, item.id);

  const locationRaw = item.location ?? "";
  const locationInfo = locationRaw.trim()
    ? resolveLocationRender(locationRaw, item.location_kind ?? null, mapsProvider)
    : null;

  const htmlParts: string[] = [];
  htmlParts.push(`<p><strong>${escapeHtml(item.title)}</strong></p>`);
  htmlParts.push(`<p>${escapeHtml(timeStr)}</p>`);

  const textParts: string[] = [];
  textParts.push(item.title);
  textParts.push(timeStr);

  if (locationInfo) {
    if (locationInfo.kind === "meeting" && locationInfo.href) {
      htmlParts.push(
        `<p><a href="${escapeHtml(locationInfo.href)}">Tap to join</a></p>`
      );
      textParts.push(`Join: ${locationInfo.href}`);
    } else if (locationInfo.kind === "address" && locationInfo.href) {
      htmlParts.push(
        `<p><a href="${escapeHtml(locationInfo.href)}">${escapeHtml(locationInfo.text)}</a></p>`
      );
      textParts.push(`Location: ${locationInfo.text} (${locationInfo.href})`);
    } else if (locationInfo.href) {
      // Generic plain link (non-meeting URL) — still tappable, not a "Tap to join".
      htmlParts.push(
        `<p><a href="${escapeHtml(locationInfo.href)}">${escapeHtml(locationInfo.text)}</a></p>`
      );
      textParts.push(`Location: ${locationInfo.text}`);
    } else {
      htmlParts.push(`<p>${escapeHtml(locationInfo.text)}</p>`);
      textParts.push(`Location: ${locationInfo.text}`);
    }
  }

  if (item.notes && item.notes.trim()) {
    htmlParts.push(`<p>${escapeHtml(item.notes)}</p>`);
    textParts.push(item.notes);
  }

  htmlParts.push(`<p><a href="${escapeHtml(deepLink)}">Open in Family Scheduler</a></p>`);
  textParts.push(`Open in Family Scheduler: ${deepLink}`);

  return {
    subject,
    html: htmlParts.join("\n"),
    text: textParts.join("\n\n"),
  };
}

/**
 * Build the compressed push payload for a due reminder. Push is a glanceable nudge; the
 * deep link is the affordance for everything else (notes + the full item live in the
 * editor once opened). Enforces a hard byte cap (Decision 5 / m5): if the composed payload
 * exceeds PUSH_MAX_BYTES, drop the location summary first, then truncate the title further —
 * guaranteeing a deliverable payload.
 */
export function buildPushContent(
  item: Item,
  occurrenceAtMs: number,
  appUrl: string,
  mapsProvider: MapsProvider
): PushContent {
  const deepLink = buildItemDeepLink(appUrl, item.id);
  const timeStr = formatOccurrenceTime(occurrenceAtMs, item.timezone, item.all_day);

  const title = truncate(`${typeLabel(item.type)}: ${item.title}`, PUSH_TITLE_TRUNCATE);

  const locationRaw = item.location ?? "";
  const locationInfo = locationRaw.trim()
    ? resolveLocationRender(locationRaw, item.location_kind ?? null, mapsProvider)
    : null;

  let locationSummary: string | null = null;
  if (locationInfo) {
    if (locationInfo.kind === "meeting" && locationInfo.href) {
      locationSummary = "Tap to join";
    } else {
      locationSummary = truncate(locationInfo.text, PUSH_LOCATION_TRUNCATE);
    }
  }

  const bodyWithLocation = locationSummary ? `${timeStr} · ${locationSummary}` : timeStr;

  let payload: PushContent = {
    title,
    body: bodyWithLocation,
    url: deepLink,
    item_id: item.id,
  };

  if (payloadByteLength(payload) <= PUSH_MAX_BYTES) return payload;

  // Degradation step 1: drop the location summary.
  payload = { ...payload, body: timeStr };
  if (payloadByteLength(payload) <= PUSH_MAX_BYTES) return payload;

  // Degradation step 2: truncate the title further (halve, floor at a small minimum).
  let titleLen = Math.max(10, Math.floor(PUSH_TITLE_TRUNCATE / 2));
  while (payloadByteLength(payload) > PUSH_MAX_BYTES && titleLen > 0) {
    payload = { ...payload, title: truncate(title, titleLen) };
    titleLen = Math.floor(titleLen / 2);
  }

  return payload;
}

function payloadByteLength(payload: PushContent): number {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}
