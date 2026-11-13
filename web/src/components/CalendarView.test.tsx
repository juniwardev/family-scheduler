/// <reference types="@testing-library/jest-dom/vitest" />
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarView } from "./CalendarView";
import type { Item, List, OccurrenceEntry, User } from "../types";
import * as apiClient from "../apiClient";
import { formatOccurrenceTime } from "../../../src/shared/itemLabels";

// Clicking a chip mounts ItemDetails -> AttachmentsView, which fetches on mount
// (AttachmentsView.tsx:20-37); unmocked that is a real fetch in jsdom resolving after the
// assertion window, i.e. act warnings at best and a flaky test at worst.
//
// updateItem/replaceReminders are ALSO mocked here (as bare vi.fn(), unconfigured) so the
// "follows a saved item" describe below can configure them per-test via vi.mocked(...).
// Left unconfigured, they are real functions in every OTHER describe in this file, which is
// fine: none of those tests reach a save (calendar-follow-saved-item plan §5.1(a) — see the
// note there on why an unmocked save path makes a save-adjacent test pass vacuously).
vi.mock("../apiClient", async () => {
  const actual = await vi.importActual<typeof import("../apiClient")>("../apiClient");
  return {
    ...actual,
    getOccurrences: vi.fn(),
    listAttachments: vi.fn(),
    updateItem: vi.fn(),
    replaceReminders: vi.fn(),
    setItemArchived: vi.fn(),
    createItem: vi.fn(),
  };
});

const USER: User = {
  email: "owner@example.com",
  display_name: "Owner",
  role: "member",
  active: true,
  created_at: 0,
  maps_provider: null,
};

const LISTS: List[] = [
  {
    id: "list-1",
    name: "Family",
    color: null,
    owner_email: "owner@example.com",
    visibility: "shared",
    created_at: 0,
  },
];

// Fixed "today" so the month grid's day cells are deterministic across test runs.
const TODAY = new Date();
const DAY = 15;
const OCCURRENCE_AT = new Date(TODAY.getFullYear(), TODAY.getMonth(), DAY, 10, 0, 0).getTime();
const OCCURRENCE_END_AT = new Date(TODAY.getFullYear(), TODAY.getMonth(), DAY, 11, 0, 0).getTime();

// A recurring item whose FIRST occurrence (item.start_at/end_at) differs from the occurrence
// this test clicks — the R9 guard (Decision 9).
const RECURRING_ITEM: Item = {
  id: "item-1",
  list_id: "list-1",
  type: "event",
  title: "Team standup",
  location: null,
  notes: null,
  start_at: OCCURRENCE_AT - 21 * 24 * 60 * 60 * 1000, // 3 weeks before the clicked occurrence
  end_at: OCCURRENCE_END_AT - 21 * 24 * 60 * 60 * 1000,
  all_day: false,
  rrule: "FREQ=WEEKLY;BYDAY=MO",
  timezone: "America/Los_Angeles",
  completed_at: null,
  created_by: "owner@example.com",
  created_at: 0,
  updated_at: 0,
  reminders: [],
  location_kind: null,
  archived_at: null,
};

const OCCURRENCE: OccurrenceEntry = {
  item_id: RECURRING_ITEM.id,
  occurrence_at: OCCURRENCE_AT,
  end_at: OCCURRENCE_END_AT,
  item: RECURRING_ITEM,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.getOccurrences).mockResolvedValue({ occurrences: [OCCURRENCE] });
  vi.mocked(apiClient.listAttachments).mockResolvedValue({ attachments: [] });
});

describe("CalendarView — chip rendering and click", () => {
  it("renders the chip as a button whose accessible name includes the day context", async () => {
    render(<CalendarView lists={LISTS} user={USER} />);
    const chip = await screen.findByRole("button", { name: /Team standup/ });
    expect(chip.tagName).toBe("BUTTON");
    expect(chip).toHaveAccessibleName(new RegExp(`Team standup.*${DAY}`));
  });

  it("requirement 2: clicking it opens role=dialog in view mode (no textboxes) with that item's details", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);
    const chip = await screen.findByRole("button", { name: /Team standup/ });

    await user.click(chip);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Team standup")).toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("R9 guard: a recurring occurrence whose occurrence_at/end_at differ from item.start_at/end_at shows THAT occurrence's range, plus the series hint", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);
    const chip = await screen.findByRole("button", { name: /Team standup/ });

    await user.click(chip);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/one occurrence of a repeating item/i)).toBeInTheDocument();

    const expectedStart = formatOccurrenceTime(OCCURRENCE_AT, RECURRING_ITEM.timezone, false);
    const expectedEnd = formatOccurrenceTime(OCCURRENCE_END_AT, RECURRING_ITEM.timezone, false);
    const buggyEnd = formatOccurrenceTime(RECURRING_ITEM.end_at!, RECURRING_ITEM.timezone, false);

    const rangeText = within(dialog).getByText(/–/).textContent!;
    expect(rangeText).toContain(expectedStart);
    expect(rangeText).toContain(expectedEnd);
    // NOT the first occurrence's (item.start_at/end_at) formatted end — the round-1 bug this
    // guards against (a range ending three weeks before it starts).
    expect(rangeText).not.toContain(buggyEnd);
    expect(OCCURRENCE_END_AT).toBeGreaterThan(OCCURRENCE_AT);
  });
});

describe("CalendarView — HC1 / calendar-side NEW-1 analogue", () => {
  it("opening a chip's modal then unmounting/remounting CalendarView shows NO dialog", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<CalendarView lists={LISTS} user={USER} />);
    const chip = await screen.findByRole("button", { name: /Team standup/ });

    await user.click(chip);
    await screen.findByRole("dialog");

    unmount();
    render(<CalendarView lists={LISTS} user={USER} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("CalendarView — month nav", () => {
  it("still works after the change", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    const initialHeading = await screen.findByRole("heading");
    const initialText = initialHeading.textContent;

    await user.click(screen.getByRole("button", { name: "›" }));

    const nextHeading = screen.getByRole("heading");
    expect(nextHeading.textContent).not.toBe(initialText);
  });
});

describe("CalendarView — +N more expand/collapse", () => {
  // Own beforeEach, runs AFTER the file-level one at :78-82 and overrides getOccurrences only.
  // Never touch the shared beforeEach — that would change the fixture for the four
  // pre-existing tests above.
  const now = new Date();
  const YEAR = now.getFullYear();
  const MONTH = now.getMonth();
  // December -> January rollover handled the same way CalendarView.tsx's own nextMonth does.
  const nextMonthDate = new Date(YEAR, MONTH + 1, 1);
  const NEXT_YEAR = nextMonthDate.getFullYear();
  const NEXT_MONTH = nextMonthDate.getMonth();

  function makeItem(id: string, title: string): Item {
    return {
      id,
      list_id: "list-1",
      type: "event",
      title,
      location: null,
      notes: null,
      start_at: 0,
      end_at: null,
      all_day: false,
      rrule: null,
      timezone: "America/Los_Angeles",
      completed_at: null,
      created_by: "owner@example.com",
      created_at: 0,
      updated_at: 0,
      reminders: [],
      location_kind: null,
      archived_at: null,
    };
  }

  // Distinct item_id, distinct title, distinct occurrence_at per occurrence (§5.1) — the
  // component sorts merged results (CalendarView.tsx:56), so identical timestamps would leave
  // visible-vs-hidden membership resting on V8's stable sort as an implicit contract. Hours are
  // ascending so "Item 1..3" are always the visible three.
  function makeOccurrence(
    id: string,
    title: string,
    year: number,
    month: number,
    day: number,
    hour: number
  ): OccurrenceEntry {
    const occurrence_at = new Date(year, month, day, hour, 0, 0).getTime();
    return {
      item_id: id,
      occurrence_at,
      end_at: occurrence_at + 60 * 60 * 1000,
      item: makeItem(id, title),
    };
  }

  // getOccurrences ignores from/to and returns this SAME union from every call — the component
  // filters to the rendered month itself (CalendarView.tsx:73), and because `occurrences` state
  // is never cleared on nav, the union lets the next month render from already-held state with
  // no empty intermediate frame. This arithmetic is only correct because LISTS has exactly one
  // entry (:32-41 above) — getOccurrences is called once per list (CalendarView.tsx:53) and
  // flatMap does not dedupe (:55), so a second list would silently double every row here.
  const ALL_OCCURRENCES: OccurrenceEntry[] = [
    makeOccurrence("d15-1", "D15 Item 1", YEAR, MONTH, 15, 1),
    makeOccurrence("d15-2", "D15 Item 2", YEAR, MONTH, 15, 2),
    makeOccurrence("d15-3", "D15 Item 3", YEAR, MONTH, 15, 3),
    makeOccurrence("d15-4", "D15 Item 4", YEAR, MONTH, 15, 4),
    makeOccurrence("d15-5", "D15 Item 5", YEAR, MONTH, 15, 5),
    makeOccurrence("d5-1", "D5 Item 1", YEAR, MONTH, 5, 1),
    makeOccurrence("d5-2", "D5 Item 2", YEAR, MONTH, 5, 2),
    makeOccurrence("d5-3", "D5 Item 3", YEAR, MONTH, 5, 3),
    makeOccurrence("d5-4", "D5 Item 4", YEAR, MONTH, 5, 4),
    makeOccurrence("d20-1", "D20 Item 1", YEAR, MONTH, 20, 1),
    makeOccurrence("d20-2", "D20 Item 2", YEAR, MONTH, 20, 2),
    makeOccurrence("d20-3", "D20 Item 3", YEAR, MONTH, 20, 3),
    makeOccurrence("n15-1", "N15 Item 1", NEXT_YEAR, NEXT_MONTH, 15, 1),
    makeOccurrence("n15-2", "N15 Item 2", NEXT_YEAR, NEXT_MONTH, 15, 2),
    makeOccurrence("n15-3", "N15 Item 3", NEXT_YEAR, NEXT_MONTH, 15, 3),
    makeOccurrence("n15-4", "N15 Item 4", NEXT_YEAR, NEXT_MONTH, 15, 4),
    makeOccurrence("n15-5", "N15 Item 5", NEXT_YEAR, NEXT_MONTH, 15, 5),
  ];

  beforeEach(() => {
    vi.mocked(apiClient.getOccurrences).mockResolvedValue({ occurrences: ALL_OCCURRENCES });
  });

  it("1. collapsed by default: shows the first 3, not the 4th or 5th", async () => {
    render(<CalendarView lists={LISTS} user={USER} />);

    await screen.findByRole("button", { name: /D15 Item 1/ });
    expect(screen.getByRole("button", { name: /D15 Item 2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /D15 Item 3/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /D15 Item 4/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /D15 Item 5/ })).not.toBeInTheDocument();
  });

  it("2. the control is a real <button> (not a role-mimicking div), with day context and aria-expanded=false initially", async () => {
    render(<CalendarView lists={LISTS} user={USER} />);

    const toggle = await screen.findByRole("button", {
      name: /\+\d+ more items? — .+ 15$/,
    });

    // getByRole matches COMPUTED role, so it alone would pass identically against
    // <div role="button" tabIndex={0}>. Such a div looks identical, passes
    // userEvent.click() (a mouse event a div handles fine), and is completely dead to the
    // keyboard (fires on neither Enter nor Space). tagName + the type attribute are what
    // actually prove this is a real, keyboard-operable <button> — mirroring the existing
    // chip guard at :88 (`expect(chip.tagName).toBe("BUTTON")`), which exists for the same
    // reason.
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("3. expanding reveals the rest and flips aria-expanded to true", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    // Grab the handle once, while collapsed, and reuse it across the flip: the toggle is a
    // positionally-stable conditional child (slot 2 of the day cell), so React updates it in
    // place rather than remounting — re-querying by the (now-changed) accessible name would
    // throw instead.
    const toggle = await screen.findByRole("button", {
      name: /\+\d+ more items? — .+ 15$/,
    });

    await user.click(toggle);

    expect(screen.getByRole("button", { name: /D15 Item 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /D15 Item 4/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /D15 Item 5/ })).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("4. collapsing again restores the cap of 3", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    const toggle = await screen.findByRole("button", {
      name: /\+\d+ more items? — .+ 15$/,
    });

    await user.click(toggle); // expand
    await user.click(toggle); // collapse

    expect(screen.getByRole("button", { name: /D15 Item 1/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /D15 Item 4/ })).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("5. a day with exactly 3 occurrences renders no toggle at all", async () => {
    render(<CalendarView lists={LISTS} user={USER} />);

    await screen.findByRole("button", { name: /D20 Item 1/ });
    expect(
      screen.queryByRole("button", { name: /more items? — .+ 20$/ })
    ).not.toBeInTheDocument();
  });

  it("6. per-day isolation: expanding day 15 does not expand day 5", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    const day15Toggle = await screen.findByRole("button", {
      name: /\+\d+ more items? — .+ 15$/,
    });
    await user.click(day15Toggle);

    const day5Toggle = screen.getByRole("button", {
      name: /\+\d+ more items? — .+ 5$/,
    });
    expect(day5Toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /D5 Item 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /D5 Item 2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /D5 Item 3/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /D5 Item 4/ })).not.toBeInTheDocument();
  });

  it("7. a revealed chip opens the right item, not merely some dialog", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    const toggle = await screen.findByRole("button", {
      name: /\+\d+ more items? — .+ 15$/,
    });
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: /D15 Item 5/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("D15 Item 5")).toBeInTheDocument();
  });

  it("8. month-nav isolation: expanding this month's day 15 does not expand next month's day 15", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    const toggle = await screen.findByRole("button", {
      name: /\+\d+ more items? — .+ 15$/,
    });
    await user.click(toggle);

    await user.click(screen.getByRole("button", { name: "›" }));

    // Await the settle signal, not a chip: with the union fixture, a findBy* on a next-month
    // chip resolves on its FIRST attempt from the stale-but-sufficient `occurrences` state,
    // before the refetch actually settles, which would make this assertion run against a
    // mid-flight component. waitFor + queryBy is idempotent (unlike
    // waitForElementToBeRemoved, which throws if the element is already gone).
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    // This test was vacuous in an earlier draft of the plan it implements: asserting only that
    // next month "is not expanded" passes on every implementation, including a naive
    // Set<number>, if next month's day 15 has no occurrences at all. The union fixture's
    // next-month row plus this POSITIVE assertion are what make it bite.
    expect(screen.getByRole("button", { name: /N15 Item 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /N15 Item 2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /N15 Item 3/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /N15 Item 4/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /N15 Item 5/ })).not.toBeInTheDocument();

    const nextToggle = screen.getByRole("button", {
      name: /\+\d+ more items? — .+ 15$/,
    });
    expect(nextToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("9. the toggle carries Decision 4's complete class string, not just the focus classes", async () => {
    render(<CalendarView lists={LISTS} user={USER} />);

    const toggle = await screen.findByRole("button", {
      name: /\+\d+ more items? — .+ 15$/,
    });

    // Assert the WHOLE literal, not a subset via toContain. Asserting only the two focus
    // classes leaves twelve others unpinned, and one of them is load-bearing in a way jsdom
    // will never show you: without text-[10px], Tailwind preflight's font-size: 100% on
    // <button> renders "+2 more" at the inherited base size (16px), beside chips at 11px and a
    // day number at text-xs — a worse visual defect than the accessible-name/text-content one
    // test 10 catches, and one that would pass every OTHER test in this file.
    expect(toggle.className).toBe(
      "mb-0.5 block w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-sm px-1 text-left text-[10px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
    );
  });

  it("10. visible text is NOT the accessible name — both halves asserted on the same element", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    const toggle = await screen.findByRole("button", {
      name: /\+\d+ more items? — .+ 15$/,
    });

    // Load-bearing: an element's accessible name falls back to its text content when there is
    // no aria-label, so every other test in this file — including test 2's
    // getByRole("button", { name: ... }) — passes identically whether the button renders the
    // terse text with an aria-label, or renders toggleLabel directly as its text and drops the
    // label. Only a text-content assertion separates the two, and without it the version that
    // prints "— <Month> 15" inside the day cell ships green.
    expect(toggle).toHaveTextContent(/^\+2 more$/);
    expect(toggle).toHaveAccessibleName(/^\+2 more items — .+ 15$/);

    await user.click(toggle);

    expect(toggle).toHaveTextContent(/^Show less$/);
    expect(toggle).toHaveAccessibleName(/^Show less — .+ 15$/);
  });
});

describe("CalendarView — roving tabindex (calendar-roving-tabindex plan)", () => {
  // Own beforeEach, runs AFTER the file-level one at :78-82 and overrides getOccurrences only.
  // Never touch the shared beforeEach — that would change the fixture for the tests above.
  const now = new Date();
  const YEAR = now.getFullYear();
  const MONTH = now.getMonth();
  const nextMonthDate = new Date(YEAR, MONTH + 1, 1);
  const NEXT_YEAR = nextMonthDate.getFullYear();
  const NEXT_MONTH = nextMonthDate.getMonth();

  function makeItem(id: string, title: string): Item {
    return {
      id,
      list_id: "list-1",
      type: "event",
      title,
      location: null,
      notes: null,
      start_at: 0,
      end_at: null,
      all_day: false,
      rrule: null,
      timezone: "America/Los_Angeles",
      completed_at: null,
      created_by: "owner@example.com",
      created_at: 0,
      updated_at: 0,
      reminders: [],
      location_kind: null,
      archived_at: null,
    };
  }

  // Ascending occurrence_at within each day (§8.3) — the component sorts merged results
  // (CalendarView.tsx:67), so without ascending hours the identity of "index 0" would rest on
  // V8's stable sort as an implicit contract, and here that identity decides which element is
  // the tab stop, not just which chips are visible.
  function makeOccurrence(
    id: string,
    title: string,
    year: number,
    month: number,
    day: number,
    hour: number
  ): OccurrenceEntry {
    const occurrence_at = new Date(year, month, day, hour, 0, 0).getTime();
    return {
      item_id: id,
      occurrence_at,
      end_at: occurrence_at + 60 * 60 * 1000,
      item: makeItem(id, title),
    };
  }

  // Fixture (§8.3):
  //   day 8  — A1                      first grid element; same column as 15 and 22
  //   day 9  — B1                      the DOM-order neighbor ArrowDown must NOT land on
  //   day 15 — E1..E5                  the toggle day (3 visible + toggle, collapsed)
  //   day 22 — F1                      column bottom / last grid element
  //   next month day 15 — N1, N2       post-nav fallback (C11); NO occurrence on day 8 next
  //                                    month, so c-8-0 cannot survive positionally (E2 branch a)
  //                                    and the fallback branch is the only thing that can
  //                                    produce a tab stop.
  const ALL_OCCURRENCES: OccurrenceEntry[] = [
    makeOccurrence("a1", "A1", YEAR, MONTH, 8, 1),
    makeOccurrence("b1", "B1", YEAR, MONTH, 9, 1),
    makeOccurrence("e1", "E1", YEAR, MONTH, 15, 1),
    makeOccurrence("e2", "E2", YEAR, MONTH, 15, 2),
    makeOccurrence("e3", "E3", YEAR, MONTH, 15, 3),
    makeOccurrence("e4", "E4", YEAR, MONTH, 15, 4),
    makeOccurrence("e5", "E5", YEAR, MONTH, 15, 5),
    makeOccurrence("f1", "F1", YEAR, MONTH, 22, 1),
    makeOccurrence("n1", "N1", NEXT_YEAR, NEXT_MONTH, 15, 1),
    makeOccurrence("n2", "N2", NEXT_YEAR, NEXT_MONTH, 15, 2),
  ];

  beforeEach(() => {
    vi.mocked(apiClient.getOccurrences).mockResolvedValue({ occurrences: ALL_OCCURRENCES });
  });

  // The roving element is the first tab stop after ›. Focusing › directly is safe: it lives
  // outside the Card (CalendarView.tsx:123 vs :136 in the pre-refactor file), so it updates no
  // roving state.
  //
  // Settle step — NOT optional. Chips arrive from an async fetch (CalendarView.tsx:50-71), so
  // without this a caller using enterGrid as its first statement after render() Tabs into an
  // empty grid. This findBy genuinely waits: `occurrences` starts [], so nothing matches until
  // the fetch resolves (contrast calendar-show-more.md's post-nav case, where the same shape is
  // hollow because stale state already satisfies it).
  //
  // Mechanical rule 1: never call .focus() directly on a grid element in these tests — it fires
  // the container's onFocus, which calls setRememberedId OUTSIDE RTL's act wrapper (a reliable
  // "not wrapped in act(...)" warning). Enter the grid the way a user does instead.
  async function enterGrid(user: ReturnType<typeof userEvent.setup>) {
    const first = await screen.findByRole("button", { name: /A1/ });
    screen.getByRole("button", { name: "›" }).focus();
    await user.tab();
    expect(first).toHaveFocus();
    return first;
  }

  it("C1: one tab stop for the whole grid", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    const a1 = await enterGrid(user);
    const b1 = screen.getByRole("button", { name: /B1/ });
    const e1 = screen.getByRole("button", { name: /E1/ });
    const e2 = screen.getByRole("button", { name: /E2/ });
    const e3 = screen.getByRole("button", { name: /E3/ });
    const toggle = screen.getByRole("button", { name: /\+\d+ more items? — .+ 15$/ });
    const f1 = screen.getByRole("button", { name: /F1/ });

    expect(a1).toHaveAttribute("tabindex", "0");
    expect(b1).toHaveAttribute("tabindex", "-1");

    await user.tab();
    for (const el of [a1, b1, e1, e2, e3, toggle, f1]) {
      expect(el).not.toHaveFocus();
    }
    // Waypoint, not the claim (mirrors the same hedge C15 carries): nothing focusable follows
    // the Card in a standalone render (ItemModal renders null when closed, ItemModal.tsx:109),
    // so document.body is the expected landing spot. If that proves environment-dependent, the
    // seven negatives above are the load-bearing part.
    expect(document.body).toHaveFocus();
  });

  it("C2: escaping the grid backwards from the LAST grid element costs one keystroke (§1.3 goal 1)", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    await enterGrid(user);
    const nextMonthBtn = screen.getByRole("button", { name: "›" });
    const f1 = screen.getByRole("button", { name: /F1/ });

    await user.keyboard("{End}");
    expect(f1).toHaveFocus();

    await user.tab({ shift: true });
    expect(nextMonthBtn).toHaveFocus();
  });

  it("C3: THE ROVING TEST — the tab stop follows focus, and re-entry lands where you left", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    const a1 = await enterGrid(user);
    const e1 = screen.getByRole("button", { name: /E1/ });

    await user.keyboard("{ArrowDown}");
    expect(e1).toHaveFocus();

    expect(a1).toHaveAttribute("tabindex", "-1");
    expect(e1).toHaveAttribute("tabindex", "0");

    // Re-entry — deliberately NOT enterGrid, which expects A1: this leaves and re-enters the
    // grid expecting E1 (the roving element) instead.
    screen.getByRole("button", { name: "›" }).focus();
    await user.tab();
    expect(e1).toHaveFocus();
    expect(a1).not.toHaveFocus();
  });

  it("C4: ArrowDown jumps a week (same column), not to the next day in DOM order", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    await enterGrid(user);
    const b1 = screen.getByRole("button", { name: /B1/ });
    const e1 = screen.getByRole("button", { name: /E1/ });

    await user.keyboard("{ArrowDown}");
    expect(e1).toHaveFocus();
    expect(b1).not.toHaveFocus();
  });

  it("C5: ArrowDown moves within a day before crossing columns", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    await enterGrid(user);
    const e1 = screen.getByRole("button", { name: /E1/ });
    const e2 = screen.getByRole("button", { name: /E2/ });

    await user.keyboard("{ArrowDown}");
    expect(e1).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(e2).toHaveFocus();
  });

  it("C6: ArrowRight moves to the next day", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    await enterGrid(user);
    const b1 = screen.getByRole("button", { name: /B1/ });

    await user.keyboard("{ArrowRight}");
    expect(b1).toHaveFocus();
  });

  it("C7: ArrowUp from the toggle day lands on the previous cell's LAST element", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    await enterGrid(user);
    const f1 = screen.getByRole("button", { name: /F1/ });
    const toggle = screen.getByRole("button", { name: /\+\d+ more items? — .+ 15$/ });

    await user.keyboard("{End}");
    expect(f1).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(toggle).toHaveFocus();
  });

  it("C8: Decision 5's quirk is fixed — ArrowUp from the toggle reaches the revealed chips", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    await enterGrid(user);
    const toggle = screen.getByRole("button", {
      name: /\+\d+ more items? — .+ 15$/,
    });

    await user.keyboard("{End}");
    expect(screen.getByRole("button", { name: /F1/ })).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(toggle).toHaveFocus();

    await user.keyboard("{Enter}");
    const e4 = screen.getByRole("button", { name: /E4/ });
    const e5 = screen.getByRole("button", { name: /E5/ });
    expect(e4).toBeInTheDocument();
    expect(e5).toBeInTheDocument();
    // Focus did NOT move on expand (Decision 3) — a ref+.focus() implementation would fail this.
    expect(toggle).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(e5).toHaveFocus();
  });

  it("C9: Enter still opens the right item after arrowing", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    await enterGrid(user);
    const b1 = screen.getByRole("button", { name: /B1/ });

    await user.keyboard("{ArrowRight}");
    expect(b1).toHaveFocus();

    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("B1")).toBeInTheDocument();
  });

  it("C10: Shift+ArrowDown is not hijacked", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    const a1 = await enterGrid(user);

    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(a1).toHaveFocus();
  });

  it("C11: month nav does not steal focus (R1), and a stale remembered id falls back to the new month's first element", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    // Establishes rememberedId = "c-8-0".
    await enterGrid(user);

    const nextMonthBtn = screen.getByRole("button", { name: "›" });
    await user.click(nextMonthBtn);

    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    expect(nextMonthBtn).toHaveFocus();

    await user.tab();
    const n1 = screen.getByRole("button", { name: /N1/ });
    expect(n1).toHaveFocus();
  });

  it("C12: an empty month contributes no tab stops and does not crash", async () => {
    vi.mocked(apiClient.getOccurrences).mockResolvedValue({ occurrences: [] });
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.getAllByRole("button")).toHaveLength(2); // only ‹ and ›

    screen.getByRole("button", { name: "›" }).focus();
    await user.tab();
    expect(document.body).toHaveFocus();
  });

  it("C13: focus restores to the chip after the item modal closes", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    await enterGrid(user);
    const e1 = screen.getByRole("button", { name: /E1/ });

    await user.keyboard("{ArrowDown}");
    expect(e1).toHaveFocus();

    await user.keyboard("{Enter}");
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Load-bearing half: ItemModal.tsx:121-127's restore survives this change (precedent:
    // ItemListView.test.tsx:196-209).
    expect(e1).toHaveFocus();
    // Confirmatory, not falsifiable: rememberedId was already "c-15-0" from arrowing to E1
    // before the modal opened, and nothing clears it while the modal is open, so this passes
    // even if the restore path never fed the roving state. Kept as a regression tripwire.
    expect(e1).toHaveAttribute("tabindex", "0");
  });

  it("C14: the chip's complete className is verbatim, unpinned by any other test", async () => {
    render(<CalendarView lists={LISTS} user={USER} />);

    const a1 = await screen.findByRole("button", { name: /A1/ });

    expect(a1.className).toBe(
      "mb-0.5 block w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-sm bg-accent px-1 py-0.5 text-left text-[11px] hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
    );
  });

  it("C15: focus arriving by mouse also updates the roving state", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    await enterGrid(user);
    const toggle = screen.getByRole("button", { name: /\+\d+ more items? — .+ 15$/ });

    await user.click(toggle);

    await user.tab();
    // Waypoint, not the claim: on the correct implementation Tab lands on document.body (the
    // toggle is now the last tabbable, after A1 dropped to tabindex="-1"). If user-event's
    // handling of "the active element itself is tabindex=-1" proves environment-dependent here,
    // relax this assertion rather than the next one — see plan R5/N7.
    expect(document.body).toHaveFocus();

    await user.tab({ shift: true });
    // Load-bearing: fails on an implementation that only updates rememberedId from the keydown
    // handler rather than the delegated onFocus (Decision 8 rule 3's mouse route).
    expect(toggle).toHaveFocus();
  });
});

describe("CalendarView — follows a saved item onto its new month (calendar-follow-saved-item plan)", () => {
  // Own beforeEach, runs AFTER the file-level one at :78-87 and overrides getOccurrences,
  // updateItem and replaceReminders. Never touch the shared beforeEach — that would change the
  // fixture for the four pre-existing tests at the top of this file.
  const now = new Date();
  const YEAR = now.getFullYear();
  const MONTH = now.getMonth();
  const nextMonthDate = new Date(YEAR, MONTH + 1, 1);
  const NEXT_YEAR = nextMonthDate.getFullYear();
  const NEXT_MONTH = nextMonthDate.getMonth();

  // Non-recurring seed, opened from the current month — the item N1/N2/N3 move or edit.
  const MOVEABLE_START = new Date(YEAR, MONTH, 10, 9, 0, 0).getTime();
  const MOVEABLE_END = MOVEABLE_START + 60 * 60 * 1000;
  const MOVEABLE_ITEM: Item = {
    id: "moveable-item",
    list_id: "list-1",
    type: "event",
    title: "Moveable Item",
    location: null,
    notes: null,
    start_at: MOVEABLE_START,
    end_at: MOVEABLE_END,
    all_day: false,
    rrule: null,
    timezone: "America/Los_Angeles",
    completed_at: null,
    created_by: "owner@example.com",
    created_at: 0,
    updated_at: 0,
    reminders: [],
    location_kind: null,
    archived_at: null,
  };
  const MOVEABLE_OCCURRENCE: OccurrenceEntry = {
    item_id: MOVEABLE_ITEM.id,
    occurrence_at: MOVEABLE_START,
    end_at: MOVEABLE_END,
    item: MOVEABLE_ITEM,
  };

  // rows is MUTABLE and reseeded fresh in beforeEach. getOccurrences below is window-aware
  // against whatever `rows` currently holds (§5.1(b)) — this is what lets N2 assert the
  // pre-save state and N1 assert the post-save state against the SAME mock.
  let rows: OccurrenceEntry[];

  beforeEach(() => {
    // OCCURRENCE (module scope, :71-76) is RECURRING_ITEM's clicked occurrence, already in the
    // current month — reused here rather than re-declared so N4/N5 exercise the same R9 fixture
    // the file's first describe block does.
    rows = [MOVEABLE_OCCURRENCE, OCCURRENCE];
    vi.mocked(apiClient.getOccurrences).mockImplementation((_listId, from, to) =>
      Promise.resolve({
        occurrences: rows.filter((r) => r.occurrence_at >= from && r.occurrence_at <= to),
      })
    );
    vi.mocked(apiClient.replaceReminders).mockResolvedValue({ reminders: [] });
  });

  // Opens a chip's view dialog, then clicks through to the edit form. Returns the dialog so
  // callers can scope their Save click to it.
  async function openEditor(user: ReturnType<typeof userEvent.setup>, title: string) {
    const chip = await screen.findByRole("button", { name: new RegExp(title) });
    await user.click(chip);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^edit$/i }));
    return dialog;
  }

  async function save(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));
  }

  it("N1: a moved non-recurring item is followed onto its new month", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    const initialHeading = await screen.findByRole("heading");
    const initialText = initialHeading.textContent;

    const dialog = await openEditor(user, "Moveable Item");

    const movedStart = new Date(NEXT_YEAR, NEXT_MONTH, 20, 9, 0, 0).getTime();
    const movedEnd = movedStart + 60 * 60 * 1000;
    const movedItem: Item = { ...MOVEABLE_ITEM, start_at: movedStart, end_at: movedEnd };

    // Build a NEW entry object at the new occurrence_at — never mutate MOVEABLE_OCCURRENCE in
    // place. Mutating in place would let the stale `occurrences` state (still holding the OLD
    // occurrence_at) satisfy the chip query with no refetch at all, per plan §5.1.
    vi.mocked(apiClient.updateItem).mockImplementation(async () => {
      rows = [{ item_id: movedItem.id, occurrence_at: movedStart, end_at: movedEnd, item: movedItem }];
      return { item: movedItem };
    });

    await save(user, dialog);

    // Settle signal, not a chip findBy*: `occurrences` is never cleared on nav, so a findBy*
    // on the moved chip could resolve off stale state before the refetch actually lands
    // (plan §5.2).
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    const nextHeading = screen.getByRole("heading");
    // No literal month name (plan §5.2) — capture-and-compare idiom already used at :145-156,
    // plus the expected label built from the SAME expression the component uses
    // (CalendarView.tsx:184), so this is a precise "moved to the CORRECT month" check rather
    // than merely "moved to A different month".
    expect(nextHeading.textContent).not.toBe(initialText);
    const expectedLabel = new Date(NEXT_YEAR, NEXT_MONTH, 1).toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
    expect(nextHeading.textContent).toBe(expectedLabel);

    expect(screen.getByRole("button", { name: /Moveable Item/ })).toBeInTheDocument();
  });

  it("N2: the occurrences fixture is genuinely window-aware — anti-vacuity control for N1", async () => {
    render(<CalendarView lists={LISTS} user={USER} />);
    await screen.findByRole("button", { name: /Moveable Item/ });

    // Pre-save: a next-month window returns no rows. Without this, N1's chip-presence half
    // would be green under a mock that ignores its from/to window entirely (plan §5.1(b)).
    const nextFrom = new Date(NEXT_YEAR, NEXT_MONTH, 1).getTime();
    const nextTo = new Date(NEXT_YEAR, NEXT_MONTH + 1, 0, 23, 59, 59).getTime();
    const result = await apiClient.getOccurrences("list-1", nextFrom, nextTo);
    expect(result.occurrences).toEqual([]);
  });

  it("N3: a same-month edit does not navigate (regression tripwire, not a discriminating test on its own)", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    const initialHeading = await screen.findByRole("heading");
    const initialText = initialHeading.textContent;

    const dialog = await openEditor(user, "Moveable Item");

    const renamedItem: Item = { ...MOVEABLE_ITEM, title: "Moveable Item (renamed)" };
    vi.mocked(apiClient.updateItem).mockImplementation(async () => {
      rows = [
        {
          item_id: renamedItem.id,
          occurrence_at: renamedItem.start_at,
          end_at: renamedItem.end_at,
          item: renamedItem,
        },
      ];
      return { item: renamedItem };
    });

    await save(user, dialog);

    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    expect(screen.getByRole("heading").textContent).toBe(initialText);
  });

  it("N4: a recurring item's save does not navigate — the rrule guard", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    const initialHeading = await screen.findByRole("heading");
    const initialText = initialHeading.textContent;

    const dialog = await openEditor(user, "Team standup");

    // RECURRING_ITEM.start_at is 21 days before OCCURRENCE_AT (module scope, :58) — the
    // previous month for every month of the year (plan §5.3 N4). rrule stays set, so an
    // unguarded implementation would navigate the grid to that previous month on a save that
    // changed nothing but the title.
    const savedRecurring: Item = { ...RECURRING_ITEM, title: "Team standup (edited)" };
    vi.mocked(apiClient.updateItem).mockImplementation(async () => {
      rows = [
        { item_id: savedRecurring.id, occurrence_at: OCCURRENCE_AT, end_at: OCCURRENCE_END_AT, item: savedRecurring },
      ];
      return { item: savedRecurring };
    });

    await save(user, dialog);

    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    expect(screen.getByRole("heading").textContent).toBe(initialText);
  });

  it("N5: reloadToken still triggers a refetch on a recurring save, where the guard skips setCurrentMonth", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    await screen.findByRole("button", { name: /Team standup/ });
    const callsBeforeSave = vi.mocked(apiClient.getOccurrences).mock.calls.length;

    const dialog = await openEditor(user, "Team standup");

    const savedRecurring: Item = { ...RECURRING_ITEM, title: "Team standup (edited again)" };
    vi.mocked(apiClient.updateItem).mockImplementation(async () => {
      rows = [
        { item_id: savedRecurring.id, occurrence_at: OCCURRENCE_AT, end_at: OCCURRENCE_END_AT, item: savedRecurring },
      ];
      return { item: savedRecurring };
    });

    await save(user, dialog);

    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    // On the recurring path the guard skips setCurrentMonth, so reloadToken is the ONLY thing
    // that can trigger this second call (plan §5.3 N5 / §3's corrected reloadToken rationale).
    expect(vi.mocked(apiClient.getOccurrences).mock.calls.length).toBeGreaterThan(callsBeforeSave);
  });
});

describe("CalendarView — archive (item-archive plan §7.1 T27/T28/T30)", () => {
  // Own beforeEach, runs AFTER the file-level one and overrides getOccurrences only — never
  // touches the shared beforeEach (would change the fixture for the four pre-existing tests).
  // Offsets from the real Date.now() (not a fixed day-of-month) so PAST_ITEM is guaranteed
  // archivable (isArchivable reads Date.now(), plan §5.7) regardless of which day of the
  // month the suite runs on. Both land within the CURRENT calendar month (needed for the
  // grid's initial fetch window) except in the rare case the suite runs within 3 hours of
  // local midnight — the same class of assumption the file's other fixed-"today" fixtures
  // already make.
  const NOW_MS = Date.now();
  const PAST_START = NOW_MS - 3 * 60 * 60 * 1000;
  const PAST_ITEM: Item = {
    id: "past-item",
    list_id: "list-1",
    type: "event",
    title: "Past Meeting",
    location: null,
    notes: null,
    start_at: PAST_START,
    end_at: null,
    all_day: false,
    rrule: null,
    timezone: "America/Los_Angeles",
    completed_at: null,
    created_by: "owner@example.com",
    created_at: 0,
    updated_at: 0,
    reminders: [],
    location_kind: null,
    archived_at: null,
  };
  const PAST_OCCURRENCE: OccurrenceEntry = {
    item_id: PAST_ITEM.id,
    occurrence_at: PAST_START,
    end_at: null,
    item: PAST_ITEM,
  };

  // Live sibling on the SAME day — the anti-vacuity control for T30 (a build that broke the
  // whole grid must not pass "the archived chip is gone").
  const SIBLING_START = NOW_MS - 1 * 60 * 60 * 1000;
  const SIBLING_ITEM: Item = { ...PAST_ITEM, id: "sibling-item", title: "Sibling Event", start_at: SIBLING_START };
  const SIBLING_OCCURRENCE: OccurrenceEntry = {
    item_id: SIBLING_ITEM.id,
    occurrence_at: SIBLING_START,
    end_at: null,
    item: SIBLING_ITEM,
  };

  // T27's fixture: production never sends this (Decision 4 puts the exclusion in SQL), but the
  // component itself must not ALSO filter — see T27's framing note below.
  const ARCHIVED_ITEM: Item = { ...PAST_ITEM, id: "archived-item", title: "Archived Chip", archived_at: PAST_START };
  const ARCHIVED_OCCURRENCE: OccurrenceEntry = {
    item_id: ARCHIVED_ITEM.id,
    occurrence_at: PAST_START,
    end_at: null,
    item: ARCHIVED_ITEM,
  };

  let rows: OccurrenceEntry[];

  beforeEach(() => {
    rows = [PAST_OCCURRENCE, SIBLING_OCCURRENCE];
    // §9.2.1: ItemModal now raises a native confirm() before Archive/Restore (T30 clicks
    // Archive below). Default to "accept" — T30 exercises the happy path, not the cancel path.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(apiClient.getOccurrences).mockImplementation((_listId, from, to) =>
      Promise.resolve({
        occurrences: rows.filter((r) => r.occurrence_at >= from && r.occurrence_at <= to),
      })
    );
  });

  it("T27 — CalendarView does NOT filter on archived_at: a mocked archived occurrence still renders its chip, alongside a live one", async () => {
    rows = [ARCHIVED_OCCURRENCE, SIBLING_OCCURRENCE];
    render(<CalendarView lists={LISTS} user={USER} />);

    // This asserts the ABSENCE of a second, render-side filter — Decision 4's mechanism (SQL
    // exclusion) is what production relies on; T27 goes red exactly when someone adds
    // belt-and-braces filtering here, which would desynchronise dayOccs' four consumers. It is
    // NOT a claim that real users see archived items — the items-archive-http.test.ts T20 suite
    // proves the server never sends this in the first place.
    expect(await screen.findByRole("button", { name: /Archived Chip/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sibling Event/ })).toBeInTheDocument();
  });

  it("T30 — archiving from the calendar refreshes the grid: the chip is gone, a live sibling chip on the same day remains", async () => {
    const user = userEvent.setup();
    render(<CalendarView lists={LISTS} user={USER} />);

    const chip = await screen.findByRole("button", { name: /Past Meeting/ });
    await user.click(chip);
    const dialog = await screen.findByRole("dialog");

    vi.mocked(apiClient.setItemArchived).mockImplementation(async () => {
      rows = [SIBLING_OCCURRENCE]; // the archived item no longer comes back from the server
      return { item: { ...PAST_ITEM, archived_at: Date.now() } };
    });

    await user.click(within(dialog).getByRole("button", { name: /^archive$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole("button", { name: /Past Meeting/ })).not.toBeInTheDocument());
    // Anti-vacuity: a build that broke the whole grid would also pass the disappearance check.
    expect(screen.getByRole("button", { name: /Sibling Event/ })).toBeInTheDocument();
  });

  it("T28 — Duplicate: switches to create mode prefilled, POSTs a new item via createItem, and does not write the source", async () => {
    const user = userEvent.setup();
    // ARCHIVED_ITEM (defined above) has canWrite/canRestore/canDuplicate all true, being
    // archived — but it is not part of `rows` in the default beforeEach, so add it here.
    rows = [PAST_OCCURRENCE, SIBLING_OCCURRENCE, ARCHIVED_OCCURRENCE];
    render(<CalendarView lists={LISTS} user={USER} />);

    const chip = await screen.findByRole("button", { name: /Archived Chip/ });
    await user.click(chip);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^duplicate$/i }));

    // Still one dialog, now the create-mode editor, prefilled with the source's title.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const titleInput = await screen.findByDisplayValue("Archived Chip");
    expect(titleInput).toBeInTheDocument();

    const beforeSave = Date.now();
    vi.mocked(apiClient.createItem).mockImplementation(async (draft) => ({
      item: { ...ARCHIVED_ITEM, id: "new-dup-item", archived_at: null, start_at: draft.start_at, title: draft.title },
    }));

    // Create mode's submit button reads "Create", not "Save" (ItemEditor.tsx:330).
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(vi.mocked(apiClient.createItem)).toHaveBeenCalledTimes(1));
    const draftArg = vi.mocked(apiClient.createItem).mock.calls[0][0];
    expect(draftArg.title).toBe("Archived Chip");
    expect(draftArg.start_at).toBeGreaterThanOrEqual(beforeSave);
    // The source item is not re-requested for write — updateItem is never called with its id
    // (createItem is the ONLY item-mutating call this flow makes).
    expect(vi.mocked(apiClient.updateItem)).not.toHaveBeenCalled();
  });
});
