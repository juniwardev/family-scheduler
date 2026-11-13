// web/src/lib/rrule.ts — RRULE build/parse (moved verbatim from RecurrenceEditor, item-view-mode
// plan Decision 4/HC3) plus a new describeRecurrence display helper.
//
// Freq / Weekday / DAYS / DAY_LABELS / RRuleState / buildRRule / parseRRule below are a
// VERBATIM move out of RecurrenceEditor.tsx — no logic change. RecurrenceEditor now imports
// them from here instead of defining them locally.
//
// HARD CONSTRAINT (HC3): all input hardening for display purposes lives in describeRecurrence
// below, NEVER in parseRRule. parseRRule is RecurrenceEditor's live parser and has no
// component test — adding validation inside it would change the editor's behavior, which is
// exactly the regression this verbatim-move discipline exists to prevent. parseRRule performs
// no validation, so describeRecurrence must guard the genuinely-reachable garbage itself (see
// the table in the function's doc comment below).
export type Freq = "none" | "daily" | "weekly" | "monthly";
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export const DAYS: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
export const DAY_LABELS: Record<Weekday, string> = {
  SU: "Sun", MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat",
};

export interface RRuleState {
  freq: Freq;
  byday: Weekday[];
  interval: number;
  endType: "never" | "until" | "count";
  until: string; // ISO date string e.g. "2026-12-31"
  count: number;
}

export function buildRRule(state: RRuleState): string | null {
  if (state.freq === "none") return null;

  let rule = `FREQ=${state.freq.toUpperCase()}`;
  if (state.interval > 1) rule += `;INTERVAL=${state.interval}`;
  if (state.freq === "weekly" && state.byday.length > 0) {
    rule += `;BYDAY=${state.byday.join(",")}`;
  }
  if (state.endType === "until" && state.until) {
    // UNTIL is UTC midnight of the selected date per RFC 5545
    const d = new Date(`${state.until}T00:00:00Z`);
    const iso = d.toISOString().replace(/[-:]/g, "").replace(".000", "");
    rule += `;UNTIL=${iso}`;
  } else if (state.endType === "count" && state.count > 0) {
    rule += `;COUNT=${state.count}`;
  }
  return rule;
}

export function parseRRule(rrule: string | null): RRuleState {
  const def: RRuleState = {
    freq: "none",
    byday: [],
    interval: 1,
    endType: "never",
    until: "",
    count: 5,
  };
  if (!rrule) return def;

  const parts = Object.fromEntries(
    rrule.split(";").map((p) => p.split("=") as [string, string])
  );

  const freq = (parts.FREQ ?? "").toLowerCase() as Freq;
  if (!["daily", "weekly", "monthly"].includes(freq)) return def;

  return {
    freq,
    byday: parts.BYDAY ? (parts.BYDAY.split(",") as Weekday[]) : [],
    interval: parts.INTERVAL ? Number(parts.INTERVAL) : 1,
    endType: parts.UNTIL ? "until" : parts.COUNT ? "count" : "never",
    until: parts.UNTIL
      ? `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}`
      : "",
    count: parts.COUNT ? Number(parts.COUNT) : 5,
  };
}

// --- describeRecurrence: read-only display wording (item-view-mode plan §3.7) --------------
//
// NOT a timezone-aware formatter — no timezone argument. UNTIL is encoded by buildRRule as UTC
// midnight ("new Date(`${until}T00:00:00Z`)" per RFC 5545), so it is a zone-independent
// calendar date; rendering it in the item's local timezone would show the previous day for
// every west-of-UTC user (including the schema default America/Los_Angeles). We format UNTIL
// in UTC explicitly instead.
//
// Reachable-garbage hardening (HC3 — all of this lives HERE, never in parseRRule above):
//   - INTERVAL=abc (NaN)         -> treat as 1 ("Every day", not "Every NaN days")
//   - BYDAY=XX (unrecognised)    -> drop unrecognised day tokens; omit "on ..." if none survive
//   - BYDAY= (empty)             -> parseRRule already yields byday: [] (falsy check), so this
//                                    needs no extra guard — "on ..." is omitted because the
//                                    array is empty.
//   - COUNT=abc (NaN)            -> omit the "N occurrences" clause
//   - UNTIL unparseable          -> omit the "until ..." clause
//
// BYDAY tokens are sorted into DAYS order before labelling (parseRRule preserves the string's
// original order, so "BYDAY=WE,MO" would otherwise render "on Wed, Mon").
import { formatOccurrenceTime } from "../../../src/shared/itemLabels";

export function describeRecurrence(rrule: string | null): string | null {
  if (!rrule) return null;
  const state = parseRRule(rrule);
  if (state.freq === "none") return null;

  const interval = Number.isFinite(state.interval) && state.interval >= 1
    ? Math.trunc(state.interval)
    : 1;

  const freqNoun = state.freq === "daily" ? "day" : state.freq === "weekly" ? "week" : "month";
  const freqNounPlural = state.freq === "daily" ? "days" : state.freq === "weekly" ? "weeks" : "months";

  let clause = interval === 1 ? `Every ${freqNoun}` : `Every ${interval} ${freqNounPlural}`;

  if (state.freq === "weekly" && state.byday.length > 0) {
    const known = new Set<Weekday>(DAYS);
    const survivors = DAYS.filter((d) => state.byday.includes(d) && known.has(d));
    if (survivors.length > 0) {
      clause += ` on ${survivors.map((d) => DAY_LABELS[d]).join(", ")}`;
    }
  }

  const suffixes: string[] = [];

  if (state.endType === "count") {
    const count = Number(state.count);
    if (Number.isFinite(count) && count >= 1) {
      suffixes.push(`${Math.trunc(count)} occurrence${Math.trunc(count) === 1 ? "" : "s"}`);
    }
  } else if (state.endType === "until" && state.until) {
    // state.until is already "YYYY-MM-DD" (parseRRule dashes it) — do NOT re-slice a
    // YYYYMMDD prefix here.
    const ms = Date.parse(`${state.until}T00:00:00Z`);
    if (Number.isFinite(ms)) {
      suffixes.push(`until ${formatOccurrenceTime(ms, "UTC", true)}`);
    }
  }

  if (suffixes.length > 0) {
    clause += ` · ${suffixes.join(" · ")}`;
  }

  return clause;
}
