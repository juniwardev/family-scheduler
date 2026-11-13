// CalendarView — month grid; expands occurrences via ?from&to (one request per list, merged client-side)
// Non-recurring items use stored start_at; recurring items use server-side expansion (Task 5.4)
import React, { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { List, OccurrenceEntry, User } from "../types";
import { getOccurrences } from "../apiClient";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { ItemModal, useItemModal } from "./ItemModal";
import { cn } from "../lib/utils";
import { nextFocusId, resolveRovingId } from "../lib/calendarFocus";

interface Props {
  lists: List[];
  user: User;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function CalendarView({ lists, user }: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [occurrences, setOccurrences] = useState<OccurrenceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by onSaved below so an edit-save (e.g. a date change) refetches occurrences and the
  // grid reflects the new date (item-view-mode plan §8 step 8).
  const [reloadToken, setReloadToken] = useState(0);
  // Per-day "+N more" expansion state, keyed by `${year}-${month}-${day}` rather than the bare
  // day number: year/month are recomputed from currentMonth on every nav, but a Set<number> of
  // day numbers would not be, so expanding day 15 in August and paging to September would render
  // September 15 expanded too. Scoping the key to the month makes the state immune to navigation
  // by construction. Deliberately NOT reset on reloadToken refetches: a save that drops a day
  // below 4 items renders the same either way (the >3 button disappears), but the `true` stays in
  // the Set as a DORMANT flag rather than becoming inert — if that day later climbs back above 3
  // items via another save, it silently re-expands without the user asking. Accepted (rare,
  // self-explanatory on screen, one click to undo).
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());

  // Calendar owns its OWN, separate useItemModal() instance from ItemListView's (HC1 — see
  // ItemModal.tsx's doc comment). App.tsx renders CalendarView and ItemListView in mutually
  // exclusive branches, so there is no sync problem between the two instances, and switching
  // away from Calendar unmounts this state exactly like ItemListView's does.
  const itemModal = useItemModal();

  useEffect(() => {
    if (lists.length === 0) {
      setOccurrences([]);
      return;
    }

    const from = currentMonth.getTime();
    const to = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0, 23, 59, 59).getTime();

    setLoading(true);
    setError(null);

    // Fetch occurrences for each list in parallel and merge (N7 — no aggregate endpoint by design)
    Promise.all(lists.map((l) => getOccurrences(l.id, from, to).catch(() => ({ occurrences: [] }))))
      .then((results) => {
        const merged = results.flatMap((r) => r.occurrences);
        merged.sort((a, b) => a.occurrence_at - b.occurrence_at);
        setOccurrences(merged);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [currentMonth, lists, reloadToken]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=Sun
  const numDays = daysInMonth(currentMonth);

  // Group occurrences by day-of-month
  const byDay: Record<number, OccurrenceEntry[]> = {};
  for (const occ of occurrences) {
    const d = new Date(occ.occurrence_at);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(occ);
    }
  }

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));
  const today = new Date();

  // Month-only label for calendar-chip aria-labels (Decision 6) — the header's own label
  // (below) also includes the year, so this is a separate, narrower const rather than reusing
  // that expression (which would produce "Team standup — August 2026 26").
  const monthLabel = currentMonth.toLocaleString("default", { month: "long" });

  // Built ONCE and used for BOTH the render below and the roving-tabindex focus geometry
  // (web/src/lib/calendarFocus.ts), so the two can never disagree about which elements exist
  // (calendar-roving-tabindex plan, risk R4).
  const dayCells = Array.from({ length: numDays }, (_, i) => i + 1).map((day) => {
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
    const dayOccs = byDay[day] ?? [];
    const dayKey = `${year}-${month}-${day}`;
    const isExpanded = expandedDays.has(dayKey);
    const visibleOccs = isExpanded ? dayOccs : dayOccs.slice(0, 3);
    // Goes negative on quiet days; harmless, since it is only ever read inside the
    // `dayOccs.length > 3` branch below.
    const hiddenCount = dayOccs.length - 3;
    const hasToggle = dayOccs.length > 3;
    const toggleLabel = isExpanded
      ? `Show less — ${monthLabel} ${day}`
      : `+${hiddenCount} more item${hiddenCount === 1 ? "" : "s"} — ${monthLabel} ${day}`;
    // Two strings, deliberately: toggleLabel is the aria-label (carries day context for a
    // screen reader, since the day number is a sibling <div> above), toggleText is the
    // visible content. Collapsing them into one and rendering toggleLabel as the button's
    // text would print "— August 15" inside a day cell one-seventh of the grid wide at
    // text-[10px], where it wraps to about three lines.
    const toggleText = isExpanded ? "Show less" : `+${hiddenCount} more`;
    // Focus-geometry ids in VISUAL order — chips top to bottom, then the toggle if present
    // (web/src/lib/calendarFocus.ts's DayFocusables). Stable across expand/collapse: expanding
    // only appends to visibleOccs, so c-{day}-0..2 keep their ids and the toggle stays t-{day}
    // (plan §5.2).
    const ids = [
      ...visibleOccs.map((_, i) => `c-${day}-${i}`),
      ...(hasToggle ? [`t-${day}`] : []),
    ];
    return { day, isToday, dayOccs, dayKey, isExpanded, visibleOccs, hasToggle, hiddenCount, toggleLabel, toggleText, ids };
  });

  // Copy-on-write toggle: mutating the Set in place (`prev.add(k); return prev;`) returns the
  // same reference, so React bails out of the re-render and the button looks dead.
  const toggleDay = (key: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Roving tabindex (calendar-roving-tabindex plan, Decision 8): ONE state cell, remembering the
  // id of the last focused chip/toggle. tabIndex is always DERIVED from it below, never written
  // imperatively, and this file adds no useEffect — see the HARD INVARIANT in Decision 8 rule 4.
  const [rememberedId, setRememberedId] = useState<string | null>(null);
  const dayFocusables = dayCells.map(({ day, ids }) => ({ day, ids }));
  const rovingId = resolveRovingId(dayFocusables, rememberedId);

  // Delegated: focus events bubble in React, so one handler on the Card covers every chip and
  // toggle and catches focus arriving by ANY route — arrow keys, mouse, the ItemModal
  // triggerRef restore (ItemModal.tsx:121-127), or a screen reader.
  const handleGridFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cal-id]");
    if (el?.dataset.calId) setRememberedId(el.dataset.calId);
  };

  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Never hijack browser/OS shortcuts, and Shift+Arrow is a selection gesture.
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const from = (e.target as HTMLElement).closest<HTMLElement>("[data-cal-id]");
    const currentId = from?.dataset.calId;
    if (!currentId) return;
    const nextId = nextFocusId(dayFocusables, currentId, e.key);
    if (!nextId) return; // unhandled key or edge of the grid: leave native behavior alone
    const next = e.currentTarget.querySelector<HTMLElement>(`[data-cal-id="${nextId}"]`);
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-4">
        <Button type="button" size="sm" variant="outline" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span>‹</span>
        </Button>
        <h2 className="m-0 text-xl font-semibold">
          {currentMonth.toLocaleString("default", { month: "long", year: "numeric" })}
        </h2>
        <Button type="button" size="sm" variant="outline" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
          <span>›</span>
        </Button>
        {loading && <span className="text-sm text-muted-foreground">Loading…</span>}
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card
        className="grid grid-cols-7 gap-px overflow-hidden bg-border p-0"
        onFocus={handleGridFocus}
        onKeyDown={handleGridKeyDown}
      >
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="bg-muted p-1.5 text-center text-xs font-semibold text-muted-foreground"
          >
            {d}
          </div>
        ))}

        {/* Empty cells for the first week */}
        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} className="min-h-[80px] bg-card" />
        ))}

        {/* Day cells */}
        {dayCells.map(({ day, isToday, dayKey, isExpanded, visibleOccs, hasToggle, toggleLabel, toggleText }) => {
          return (
            // No day-cell onClick today (verified: this <div> has none) — if a future change
            // adds one (e.g. "create on this day"), the chip's onClick below will need
            // e.stopPropagation() to avoid double-firing both handlers.
            <div key={day} className="relative min-h-[80px] bg-card p-1">
              <div
                className={cn(
                  "mb-0.5 text-xs",
                  isToday ? "font-bold text-primary" : "font-normal text-foreground"
                )}
              >
                {day}
              </div>
              {visibleOccs.map((occ, i) => {
                const calId = `c-${day}-${i}`;
                return (
                  <button
                    type="button"
                    key={`${occ.item_id}-${i}`}
                    // The visible text is ellipsized by the day cell's width; `title` exists to
                    // reveal the FULL text on hover. It duplicates the accessible name in some
                    // AT, which is the accepted cost of keeping the existing reveal-on-hover
                    // behavior.
                    title={occ.item.title}
                    // Day context: the day number is a SIBLING <div> above, so a screen reader
                    // tabbing the grid would otherwise hear a flat list of titles with no date.
                    aria-label={`${occ.item.title} — ${monthLabel} ${day}`}
                    onClick={() => itemModal.openView(occ.item, occ.occurrence_at, occ.end_at ?? undefined)}
                    data-cal-id={calId}
                    tabIndex={calId === rovingId ? 0 : -1}
                    className="mb-0.5 block w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-sm bg-accent px-1 py-0.5 text-left text-[11px] hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                  >
                    {occ.item.title}
                  </button>
                );
              })}
              {hasToggle && (
                // Sits after the chips in DOM order, so expanding inserts chips 4..N above this
                // still-focused button and the next Tab moves to the following day (a keyboard
                // user must Shift+Tab back into the content they just revealed). Accepted cost —
                // roving tabindex (calendar-roving-tabindex plan, Decision 3) fixes the keyboard
                // path to the revealed content: ArrowUp from this toggle reaches the last
                // revealed chip in one keystroke, moving upward to where the new content is.
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={toggleLabel}
                  onClick={() => toggleDay(dayKey)}
                  data-cal-id={`t-${day}`}
                  tabIndex={`t-${day}` === rovingId ? 0 : -1}
                  className="mb-0.5 block w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-sm px-1 text-left text-[10px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                >
                  {toggleText}
                </button>
              )}
            </div>
          );
        })}
      </Card>

      <ItemModal
        state={itemModal.state}
        lists={lists}
        user={user}
        triggerRef={itemModal.triggerRef}
        onClose={itemModal.close}
        onEditRequested={(item) => itemModal.openEdit(item)}
        onDuplicateRequested={(item) => itemModal.openDuplicate(item)}
        onSaved={(saved) => {
          // Follow a rescheduled item so it does not vanish from the grid (see plan §1).
          // Guarded: for a recurring item `saved.start_at` is the SERIES SEED, not the
          // occurrence the user was looking at, so navigating there would jump to an
          // unrelated month.
          if (!saved.rrule) {
            setCurrentMonth(startOfMonth(new Date(saved.start_at)));
          }
          itemModal.close();
          setReloadToken((t) => t + 1);
        }}
        // Archive must NOT route through onSaved above (plan Decision 9) — onSaved means "an
        // edit was persisted, follow it", and reusing it for archive would couple a different
        // state transition to a callback whose contract is about editor saves. Deliberately
        // does NOT call setCurrentMonth — Decision 8.5 proves startOfMonth(saved.start_at)
        // already equals currentMonth whenever Archive fires from the grid, so a navigation
        // here would be a no-op; the refetch below is what makes the chip disappear.
        onArchiveChanged={() => {
          itemModal.close();
          setReloadToken((t) => t + 1);
        }}
      />
    </div>
  );
}
