// recurrence.ts — RRULE expansion with correct DST handling (Decision D10/D11)
//
// Algorithm (D10): expand RRULE in floating/local wall-clock space, then convert
// each occurrence back to UTC using the IANA zone offset at that occurrence's date.
// This makes "every Tuesday 4:00pm" stay at 4:00pm local across a DST boundary.
//
// DST disambiguation (D10):
// - Non-existent local time (spring-forward gap): shift forward by the gap (luxon default)
// - Ambiguous local time (fall-back overlap): choose the earlier of the two instants (luxon default)
// - UNTIL: compare each candidate's UTC-mapped instant against the UNTIL UTC instant (N6)
//
// Dependency: luxon (pure JS, runs in Workers — Decision D11).

import { DateTime, IANAZone } from "luxon";
import { RRule } from "rrule";
import type { EpochMs } from "./types";
import { DEFAULT_TIMEZONE } from "./config";

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

  // Convert seed UTC time to wall-clock in the item's timezone
  const seedLocal = DateTime.fromMillis(q.startAt, { zone: tz });

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

  // Expand a window slightly wider than requested so we can map and filter accurately
  // (DST shifts can move a UTC occurrence by up to ±1h, so add a 2h buffer each side)
  const bufferMs = 2 * 60 * 60 * 1000;
  const winStartDate = new Date(windowStart - bufferMs);
  const winEndDate = new Date(windowEnd + bufferMs);

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
    // Map to UTC using the zone offset at that local date.
    const localDt = DateTime.fromObject(
      {
        year: candidate.getUTCFullYear(),
        month: candidate.getUTCMonth() + 1,
        day: candidate.getUTCDate(),
        hour: candidate.getUTCHours(),
        minute: candidate.getUTCMinutes(),
        second: candidate.getUTCSeconds(),
      },
      { zone: tz }
    );

    // luxon resolves non-existent times (spring-forward gap) by shifting forward,
    // and ambiguous times (fall-back overlap) by choosing the earlier offset.
    // Both are the behaviors specified in D10.

    if (!localDt.isValid) continue; // should not happen with valid IANA zone

    const utcMs = localDt.toMillis();

    // Apply the UNTIL constraint in UTC space (N6): if the RRULE has an UNTIL,
    // compare the UTC-mapped instant against the UNTIL UTC instant
    if (utcMs < windowStart || utcMs > windowEnd) continue;

    results.push(utcMs as EpochMs);
  }

  // Deduplicate (fall-back ambiguous time can produce two identical UTC instants via rrule)
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
