// src/shared/itemLabels.ts — pure, framework-agnostic label + time formatting helpers.
// No DOM, no Worker (D1/crypto.subtle), no React deps — importable by both the Worker
// bundle (notification content builders) and the web bundle (future in-app use).
//
// Kept Intl-only (no luxon) so this module is trivially usable from the Workers runtime
// without pulling in the luxon dependency that src/worker/recurrence.ts already uses for
// RRULE expansion — the two are independent concerns (occurrence expansion vs. display
// formatting of an already-resolved occurrence timestamp).

import type { EpochMs } from "../worker/types";

// items.type enum is exactly 'event' | 'task' (types.ts, migrations/0001_init.sql).
// Map by intent: an event is *coming up*, a task is *due*.
export function typeLabel(type: string): string {
  if (type === "event") return "Event reminder";
  if (type === "task") return "Task due";
  // Defensive default for any unexpected value — never throws.
  return "Reminder";
}

// Schema default timezone (migrations/0001_init.sql: items.timezone DEFAULT 'America/Los_Angeles').
// Used as the first fallback when an item's stored timezone is missing/invalid.
const SCHEMA_DEFAULT_TIMEZONE = "America/Los_Angeles";

/**
 * Render occurrence_at (EpochMs, UTC) as a human-readable string in the item's stored
 * timezone. WHY occurrence_at and not item.start_at: recurring items fire per-occurrence,
 * so the notification must show the specific instance's time, not the item's first start_at.
 * For non-recurring items occurrence_at === start_at, so this is correct in both cases.
 *
 * All-day items render date only; timed items render date + time + zone abbreviation.
 *
 * Fallback chain (never emit a raw epoch number; always return a non-empty string):
 *   1. Try the supplied timezone.
 *   2. If falsy or Intl throws (unknown IANA zone) -> retry with the schema default
 *      'America/Los_Angeles' (matches items.timezone DEFAULT).
 *   3. If that also throws -> fall back to UTC with an explicit "UTC" suffix.
 */
export function formatOccurrenceTime(
  occurrenceAtMs: EpochMs,
  timezone: string,
  allDay: boolean
): string {
  const zoneCandidates = [timezone, SCHEMA_DEFAULT_TIMEZONE];
  for (const zone of zoneCandidates) {
    if (!zone) continue;
    try {
      return formatInZone(occurrenceAtMs, zone, allDay);
    } catch {
      // Try next candidate.
    }
  }
  // Final fallback: UTC, explicit suffix so the zone ambiguity is never silent.
  try {
    return `${formatInZone(occurrenceAtMs, "UTC", allDay)} UTC`;
  } catch {
    // Intl itself is unavailable/broken — degrade to an explicit ISO string rather than
    // a bare epoch number (never emit a raw epoch, per project convention).
    return new Date(occurrenceAtMs).toISOString();
  }
}

function formatInZone(ms: number, timeZone: string, allDay: boolean): string {
  if (allDay) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(ms);
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(ms);
}
