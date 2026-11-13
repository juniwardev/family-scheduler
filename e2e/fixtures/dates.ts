// e2e/fixtures/dates.ts — pure current-month date helpers for mock payloads.
//
// CalendarView renders the current month from `new Date()` (web/src/components/CalendarView.tsx),
// so mock `occurrence_at`/`start_at` values MUST be computed from the current month at run time.
// Never hardcode a month name, a year, or any locale-dependent string anywhere in e2e/ —
// docs/plans/calendar-show-more.md §5.2 records this exact trap for jsdom, and it applies here
// unchanged (plan §3.4.3(d)).

export function currentMonthYear(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

/**
 * Epoch ms for `day` (1-28 — days 29-31 do not exist in every month, plan §3.4.3(d)) of the
 * CURRENT month, at the given local hour:minute. Uses local time deliberately, matching how
 * CalendarView groups occurrences by day (`new Date(occ.occurrence_at).getDate()` etc., also
 * local time) — the two must agree or a fixture item renders on the wrong day.
 */
export function epochMsOnCurrentMonthDay(day: number, hour = 9, minute = 0): number {
  if (day < 1 || day > 28) {
    throw new Error(`epochMsOnCurrentMonthDay: day must be 1-28 (got ${day}) — days 29-31 do not exist in every month`);
  }
  const { year, month } = currentMonthYear();
  return new Date(year, month, day, hour, minute, 0, 0).getTime();
}
