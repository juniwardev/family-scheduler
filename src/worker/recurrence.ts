// recurrence.ts — RRULE expansion with correct DST handling (Decision D10/D11)
//
// Algorithm (D10): expand RRULE in floating/local wall-clock space, then convert
// each occurrence back to UTC using the IANA zone offset at that occurrence's date.
// This makes "every Tuesday 4:00pm" stay at 4:00pm local across a DST boundary.
//
// DST disambiguation (D10), done explicitly by wallClockToInstant:
// - Non-existent local time (spring-forward gap): shift forward by the gap
// - Ambiguous local time (fall-back overlap): the earlier of the two instants. This is NOT luxon's
//   default: DateTime.fromObject picks the offset in force at Settings.now(), so it depends on the
//   date the code runs (docs/plans/dst-fallback-ambiguous-time.md).
// - UNTIL is applied by rrule in wall-clock space. That differs from D10/N6 (compare the
//   UTC-mapped instant), which is not implemented; see the plan's OQ-1.
//
// Dependency: luxon (pure JS, runs in Workers — Decision D11). Only its clock-free parts are used.

import { DateTime, IANAZone, Info, type Zone } from "luxon";
import { RRule } from "rrule";
import type { EpochMs } from "./types";
import { DEFAULT_TIMEZONE } from "./config";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// W (rrule's wall-clock-as-UTC candidate) and the real instant differ by the zone's full UTC
// offset (up to +14 h / -12 h), so the rrule query is widened by 24 h each side. The real-instant
// filter in expandOccurrences stays authoritative.
const WINDOW_BUFFER_MS = DAY_MS;

// D10, made explicit and clock-independent. Do NOT use DateTime.fromObject here: its offset guess
// comes from Settings.now(), so an ambiguous time resolves by the date the code runs
// (docs/bugs/dst-fallback-ambiguous-time.md).
function wallClockToInstant(wallMs: number, zone: Zone): EpochMs {
  // Offsets in force well before and well after wallMs. A transition near wallMs lies between them.
  const offBefore = zone.offset(wallMs - DAY_MS); // minutes
  const offAfter = zone.offset(wallMs + DAY_MS);
  if (offBefore === offAfter) {
    return (wallMs - offBefore * MINUTE_MS) as EpochMs; // no transition nearby (the common case)
  }
  const valid = [offBefore, offAfter]
    .map((off) => ({ off, t: wallMs - off * MINUTE_MS }))
    .filter(({ off, t }) => zone.offset(t) === off)
    .map(({ t }) => t);
  if (valid.length > 0) return Math.min(...valid) as EpochMs; // overlap -> earlier instant (D10)
  return (wallMs - offBefore * MINUTE_MS) as EpochMs; // gap -> shift forward by the gap (D10)
}

export interface OccurrenceQuery {
  startAt: EpochMs; // item.start_at (UTC epoch ms)
  rrule: string | null; // RFC 5545 RRULE string, or null for non-recurring
  timezone: string; // IANA timezone, e.g. "America/Los_Angeles"
  allDay: boolean;
}

/**
 * Expand item occurrences within [windowStart, windowEnd] (inclusive).
 * Returns UTC epoch-ms start instants.
 */
export function expandOccurrences(
  q: OccurrenceQuery,
  windowStart: EpochMs,
  windowEnd: EpochMs
): EpochMs[] {
  const tz = q.timezone || DEFAULT_TIMEZONE;

  if (!q.rrule) {
    // Non-recurring: return the single occurrence if it falls in the window
    return q.startAt >= windowStart && q.startAt <= windowEnd ? [q.startAt] : [];
  }

  // Same zone parsing as before (IANA names, "utc", fixed offsets like "UTC+5"). An invalid zone
  // yields [] exactly as it did when the invalid seed made toISOString() throw below.
  const zone = Info.normalizeZone(tz);
  if (!zone.isValid) return [];

  // Convert seed UTC time to wall-clock in the item's timezone
  const seedLocal = DateTime.fromMillis(q.startAt, { zone });

  // Build an rrule instance using floating (local) dtstart.
  // We use UTC dtstart in rrule but treat the output as floating wall-clock times,
  // then convert each back to UTC via the zone at that date.
  const dtstart = new Date(
    Date.UTC(
      seedLocal.year,
      seedLocal.month - 1,
      seedLocal.day,
      seedLocal.hour,
      seedLocal.minute,
      seedLocal.second
    )
  );

  // rrule filters wall-clock candidates, but the window bounds are real instants; the two differ
  // by the zone's UTC offset, so query a wider wall-clock window and let the real-instant filter
  // below decide.
  const winStartDate = new Date(windowStart - WINDOW_BUFFER_MS);
  const winEndDate = new Date(windowEnd + WINDOW_BUFFER_MS);

  let rule: RRule;
  try {
    rule = RRule.fromString(`DTSTART:${dtstart.toISOString().replace(/[-:]/g, "").replace(".000", "")}\n${q.rrule}`);
  } catch {
    // Unparseable RRULE — return empty (should have been rejected at creation)
    return [];
  }

  const candidates = rule.between(winStartDate, winEndDate, true /* inclusive */);

  const results: EpochMs[] = [];

  for (const candidate of candidates) {
    // candidate is a Date whose UTC fields are the wall-clock date/time in the item's tz.
    const utcMs = wallClockToInstant(candidate.getTime(), zone);

    // Authoritative window filter in real-instant space (not UNTIL, which rrule applied above).
    if (utcMs < windowStart || utcMs > windowEnd) continue;

    results.push(utcMs as EpochMs);
  }

  // Deduplicate: sub-daily rules can map two wall times to one instant at a spring-forward gap
  // (02:30 -> 03:30 collides with the real 03:30). Fall-back cannot produce duplicates, because the
  // earlier instant is always chosen.
  return Array.from(new Set(results)).sort((a, b) => a - b);
}

/**
 * Compute fire_at in UTC epoch ms from an occurrence time and a reminder offset.
 * fire_at = occurrence_at - offset_minutes * 60000
 * This is computed in absolute UTC space — never re-mapped through the timezone (D10 case iii).
 */
export function computeFireAt(occurrence_at: EpochMs, offset_minutes: number): EpochMs {
  return (occurrence_at - offset_minutes * 60 * 1000) as EpochMs;
}

// Verify the zone is a valid IANA zone string (used in validation)
export function isValidTimezone(tz: string): boolean {
  return IANAZone.isValidZone(tz);
}
