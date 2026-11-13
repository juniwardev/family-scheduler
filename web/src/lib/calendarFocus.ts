// Pure geometry for the calendar month grid's roving tabindex (plan:
// docs/plans/calendar-roving-tabindex.md). No React, no DOM, no `document` — every function here
// takes a plain description of "what is focusable, and where" and returns an id or null. Keeping
// this pure is what lets CalendarView call it synchronously inside a keydown handler with no
// effect and no ref map (Decision 8).

/** One day of the rendered month, with the ids of its focusable elements in VISUAL order
 *  (chips top to bottom, then the `+N more` toggle if the day has one). `ids` is `[]` for a day
 *  with no occurrences — those days are not skipped from this array, only from navigation. */
export interface DayFocusables {
  day: number; // 1-based day of month
  ids: string[];
}

function findDayContaining(days: DayFocusables[], id: string): DayFocusables | undefined {
  return days.find((d) => d.ids.includes(id));
}

// Day lookup is by VALUE (`d.day === day`), never by array index (`days[day - 1]`). The month
// grid always supplies every day 1..numDays in order, so the two would agree today — but a
// lookup by value degrades a caller that passes a sparse or misordered array to "not found"
// instead of silently reading the wrong day's ids (plan §5.1).
function findDay(days: DayFocusables[], day: number): DayFocusables | undefined {
  return days.find((d) => d.day === day);
}

// Shared by ArrowDown (step +7), ArrowRight (step +1) and ArrowLeft (step -1): walk the day
// numbers by `step`, skipping days with no ids, and land on the FIRST id of the first non-empty
// one found. Stops (returns null) the moment `day + step*n` is not in `days` at all — that is
// the edge of the grid, not a hole to skip past.
function scanFirstId(days: DayFocusables[], fromDay: number, step: number): string | null {
  let day = fromDay + step;
  let cell = findDay(days, day);
  while (cell) {
    if (cell.ids.length > 0) return cell.ids[0];
    day += step;
    cell = findDay(days, day);
  }
  return null;
}

// Used only by ArrowUp (step -7): same walk as scanFirstId, but lands on the LAST id of the
// found day rather than the first. This is what makes ArrowUp/ArrowDown reversible — Down always
// lands on an element whose ArrowUp brings you back (Decision 2's "landing on the last element
// is what makes Up/Down reversible").
function scanLastId(days: DayFocusables[], fromDay: number, step: number): string | null {
  let day = fromDay + step;
  let cell = findDay(days, day);
  while (cell) {
    if (cell.ids.length > 0) return cell.ids[cell.ids.length - 1];
    day += step;
    cell = findDay(days, day);
  }
  return null;
}

function firstIdOverall(days: DayFocusables[]): string | null {
  for (const d of days) {
    if (d.ids.length > 0) return d.ids[0];
  }
  return null;
}

function lastIdOverall(days: DayFocusables[]): string | null {
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].ids.length > 0) return days[i].ids[days[i].ids.length - 1];
  }
  return null;
}

/** Which element a navigation key moves to, or null if the key is unhandled, `currentId` is not
 *  present in `days`, or there is nowhere to go (an edge of the grid). Pure and never throws. */
export function nextFocusId(
  days: DayFocusables[], // EVERY day 1..numDays, ascending, empty days included
  currentId: string,
  key: string
): string | null {
  const day = findDayContaining(days, currentId);
  if (!day) return null; // stale/unknown id (post-refetch, or a caller bug) — degrade to null
  const idIndex = day.ids.indexOf(currentId);

  switch (key) {
    case "ArrowDown":
      // Within the day first; only cross to the next non-empty day in the SAME COLUMN
      // (day + 7) once every element of this day has been visited.
      return idIndex < day.ids.length - 1 ? day.ids[idIndex + 1] : scanFirstId(days, day.day, 7);
    case "ArrowUp":
      return idIndex > 0 ? day.ids[idIndex - 1] : scanLastId(days, day.day, -7);
    case "ArrowRight":
      // Day-level move: always lands on the found day's FIRST element, crossing week-row
      // boundaries in reading order (day + 1, +2, ...). No column arithmetic — see the note
      // below on why day ± 7 needs none and day ± 1 needs even less.
      return scanFirstId(days, day.day, 1);
    case "ArrowLeft":
      // Deliberately asymmetric with ArrowUp: Left/Right are day-level moves and both land on
      // index 0 (the day's canonical entry point); Up/Down are element-level moves and land on
      // the adjacent element. Not a bug — plan Decision 2, pinned by pure test P9.
      return scanFirstId(days, day.day, -1);
    case "Home":
      return firstIdOverall(days);
    case "End":
      return lastIdOverall(days);
    default:
      // Enter/Space/Tab/Escape/anything else: not this module's concern. Native <button>
      // activation and the native tab sequence must survive untouched (Decision 2's last row).
      return null;
  }
}

/** Which element should carry tabIndex={0}. Returns `rememberedId` if it still names a real
 *  element; otherwise falls back to the grid's first element; otherwise null when the month has
 *  no focusable elements at all (E1). No clamping to "the nearest surviving index" — a stale id
 *  becoming "the top of the month instead of mid-month" is the accepted behavior (plan §7 step 2),
 *  not a defect to paper over with extra machinery. */
export function resolveRovingId(days: DayFocusables[], rememberedId: string | null): string | null {
  if (rememberedId !== null && days.some((d) => d.ids.includes(rememberedId))) {
    return rememberedId;
  }
  return firstIdOverall(days);
}

// Why `day ± 7` needs no column arithmetic at all: the grid renders exactly 7 weekday header
// cells, then `firstDayOfWeek` blanks, then days 1..numDays with no gaps, all inside a
// `grid-cols-7` container (CalendarView.tsx:136-152). So column(d) = (firstDayOfWeek + d - 1) mod
// 7, and column(d ± 7) = column(d) unconditionally — day ± 7 is always the same weekday,
// regardless of firstDayOfWeek. That identity holds ONLY as long as every cell in that flow is a
// day cell or a leading blank of the same width; inserting anything else into it (a week-number
// column is the realistic example) would silently break this arithmetic while every test above
// still passes, because none of them has any notion of rows. If a row-based cell is ever added to
// the grid, this module's day ± 7 scan needs to be revisited alongside it.
