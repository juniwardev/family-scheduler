/// <reference types="@testing-library/jest-dom/vitest" />
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemDetails } from "./ItemDetails";
import type { Item, List, User } from "../types";
import * as apiClient from "../apiClient";
import { formatOccurrenceTime } from "../../../src/shared/itemLabels";

vi.mock("../apiClient", async () => {
  const actual = await vi.importActual<typeof import("../apiClient")>("../apiClient");
  return {
    ...actual,
    listAttachments: vi.fn(),
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

const BASE_ITEM: Item = {
  id: "item-1",
  list_id: "list-1",
  type: "event",
  title: "Team standup",
  location: null,
  notes: null,
  start_at: 1_800_000_000_000,
  end_at: 1_800_003_600_000,
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.listAttachments).mockResolvedValue({ attachments: [] });
});

describe("ItemDetails — read-only rendering", () => {
  it("renders no form controls", () => {
    render(
      <ItemDetails
        item={BASE_ITEM}
        lists={LISTS}
        user={USER}
        canWrite={true}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      onArchive={vi.fn()}
      onRestore={vi.fn()}
      onDuplicate={vi.fn()}
      />
    );
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /save|create/i })).not.toBeInTheDocument();
  });

  it("renders the formatted start time (not a raw epoch, not device toLocaleString form)", () => {
    render(
      <ItemDetails
        item={BASE_ITEM}
        lists={LISTS}
        user={USER}
        canWrite={true}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      onArchive={vi.fn()}
      onRestore={vi.fn()}
      onDuplicate={vi.fn()}
      />
    );
    expect(screen.queryByText(String(BASE_ITEM.start_at))).not.toBeInTheDocument();
    expect(screen.queryByText(new Date(BASE_ITEM.start_at).toLocaleString())).not.toBeInTheDocument();
    // formatOccurrenceTime always includes a short weekday token; the "When" row's dd is the
    // one containing the en-dash range.
    expect(screen.getByText(/–/).textContent).toMatch(/,\s+\w{3}\s+\d{1,2},\s+\d{4}/);
  });

  it("occurrence range (R9 guard): a non-first occurrence renders THAT occurrence's end, not item.end_at", () => {
    const recurringItem: Item = {
      ...BASE_ITEM,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      start_at: 1_800_000_000_000,
      end_at: 1_800_003_600_000, // 1 hour after start_at (first occurrence's end)
    };
    const threeWeeksMs = 3 * 7 * 24 * 60 * 60 * 1000;
    const occurrenceAt = recurringItem.start_at + threeWeeksMs;
    const occurrenceEndAt = recurringItem.end_at! + threeWeeksMs;

    render(
      <ItemDetails
        item={recurringItem}
        occurrenceAt={occurrenceAt}
        occurrenceEndAt={occurrenceEndAt}
        lists={LISTS}
        user={USER}
        canWrite={true}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      onArchive={vi.fn()}
      onRestore={vi.fn()}
      onDuplicate={vi.fn()}
      />
    );

    const expectedStart = formatOccurrenceTime(occurrenceAt, recurringItem.timezone, false);
    const expectedEnd = formatOccurrenceTime(occurrenceEndAt, recurringItem.timezone, false);
    const buggyEnd = formatOccurrenceTime(recurringItem.end_at!, recurringItem.timezone, false);

    const rangeText = screen.getByText(/–/).textContent!;
    expect(rangeText).toContain(expectedStart);
    expect(rangeText).toContain(expectedEnd);
    // The round-1 bug: rendering item.end_at directly instead of occurrenceEndAt produces an
    // end THREE WEEKS BEFORE the occurrence's start. Guard that it is not present.
    expect(rangeText).not.toContain(buggyEnd);
    expect(occurrenceEndAt).toBeGreaterThan(occurrenceAt);
  });

  it("occurrence fields absent: falls back to item.start_at / item.end_at", () => {
    render(
      <ItemDetails
        item={BASE_ITEM}
        lists={LISTS}
        user={USER}
        canWrite={true}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      onArchive={vi.fn()}
      onRestore={vi.fn()}
      onDuplicate={vi.fn()}
      />
    );
    expect(screen.getByText(/–/)).toBeInTheDocument();
  });

  it("renders a maps link for an address-like location", () => {
    const item: Item = { ...BASE_ITEM, location: "123 Main St, Springfield" };
    render(
      <ItemDetails item={item} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    const link = screen.getByRole("link", { name: /open in maps/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("maps.apple.com"));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders 'Tap to join' for a Zoom URL", () => {
    const item: Item = { ...BASE_ITEM, location: "https://zoom.us/j/1234567890" };
    render(
      <ItemDetails item={item} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    const link = screen.getByRole("link", { name: /tap to join/i });
    expect(link).toHaveAttribute("href", "https://zoom.us/j/1234567890");
  });

  it("renders plain text for a non-address, non-meeting location", () => {
    const item: Item = { ...BASE_ITEM, location: "Home" };
    render(
      <ItemDetails item={item} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders no Location row for location: null", () => {
    render(
      <ItemDetails item={BASE_ITEM} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    expect(screen.queryByText("Location")).not.toBeInTheDocument();
  });

  it("renders no Location row for whitespace-only location", () => {
    const item: Item = { ...BASE_ITEM, location: "   " };
    render(
      <ItemDetails item={item} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    expect(screen.queryByText("Location")).not.toBeInTheDocument();
  });

  it("renders describeRecurrence output and the series hint when occurrenceAt is passed", () => {
    const item: Item = { ...BASE_ITEM, rrule: "FREQ=WEEKLY;BYDAY=MO,WE" };
    render(
      <ItemDetails
        item={item}
        occurrenceAt={item.start_at}
        lists={LISTS}
        user={USER}
        canWrite={true}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      onArchive={vi.fn()}
      onRestore={vi.fn()}
      onDuplicate={vi.fn()}
      />
    );
    expect(screen.getByText("Every week on Mon, Wed")).toBeInTheDocument();
    expect(screen.getByText(/one occurrence of a repeating item/i)).toBeInTheDocument();
  });

  it("renders reminder lines; renders 'None' with an empty reminders array", () => {
    const item: Item = {
      ...BASE_ITEM,
      reminders: [{ id: "r1", item_id: BASE_ITEM.id, offset_minutes: 30, channel_email: true, channel_push: true }],
    };
    const { rerender } = render(
      <ItemDetails item={item} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    expect(screen.getByText("30 minutes before · Email, Push")).toBeInTheDocument();

    rerender(
      <ItemDetails item={BASE_ITEM} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("shows the Completed badge for a non-recurring completed task, not for a recurring one", () => {
    const completedTask: Item = { ...BASE_ITEM, type: "task", completed_at: Date.now(), rrule: null };
    const { rerender } = render(
      <ItemDetails item={completedTask} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    expect(screen.getByText("Completed")).toBeInTheDocument();

    const recurringCompleted: Item = { ...completedTask, rrule: "FREQ=DAILY" };
    rerender(
      <ItemDetails item={recurringCompleted} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  it("Edit calls onEdit; footer Close calls onClose", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onClose = vi.fn();
    render(
      <ItemDetails item={BASE_ITEM} lists={LISTS} user={USER} canWrite={true} onEdit={onEdit} onClose={onClose} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Edit is absent when canWrite is false", () => {
    render(
      <ItemDetails item={BASE_ITEM} lists={LISTS} user={USER} canWrite={false} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });
});

// T25/T26/T26b — Archive/Restore/Duplicate button gates (plan §7.1). Clock pinned with
// vi.setSystemTime, at 03:00 off a non-DST-transition date (2026-07-15, a Wednesday) — per the
// plan's T25 falsification note: `isArchivable(item, Date.now())` is called inline in render,
// so an unpinned "yesterday, all-day" fixture evaluated between 00:00-01:00 local would be
// legitimately (not buggily) still inside ALL_DAY_GRACE_MS and read as not-yet-archivable.
describe("ItemDetails — T25: Archive button gate", () => {
  const NOW = new Date(2026, 6, 15, 3, 0, 0).getTime(); // Wed 2026-07-15 03:00 local

  beforeEach(() => {
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function expectArchivePresent(item: Item, canWrite: boolean) {
    render(
      <ItemDetails item={item} lists={LISTS} user={USER} canWrite={canWrite} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    const btn = screen.getByRole("button", { name: /^archive$/i });
    expect(btn.tagName).toBe("BUTTON");
  }

  function expectArchiveAbsent(item: Item, canWrite: boolean) {
    render(
      <ItemDetails item={item} lists={LISTS} user={USER} canWrite={canWrite} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: /^archive$/i })).not.toBeInTheDocument();
  }

  it("timed, past anchor, canWrite: true -> present", () => {
    const item: Item = { ...BASE_ITEM, start_at: NOW - 60 * 60 * 1000, end_at: null };
    expectArchivePresent(item, true);
  });

  it("timed, future anchor, canWrite: true -> absent", () => {
    const item: Item = { ...BASE_ITEM, start_at: NOW + 24 * 60 * 60 * 1000, end_at: null };
    expectArchiveAbsent(item, true);
  });

  it("timed, past anchor, canWrite: false -> absent", () => {
    const item: Item = { ...BASE_ITEM, start_at: NOW - 60 * 60 * 1000, end_at: null };
    expectArchiveAbsent(item, false);
  });

  it("recurring, past anchor, canWrite: true -> absent (never archivable)", () => {
    const item: Item = { ...BASE_ITEM, start_at: NOW - 60 * 60 * 1000, end_at: null, rrule: "FREQ=DAILY" };
    expectArchiveAbsent(item, true);
  });

  it("already archived -> absent (Restore is offered instead)", () => {
    const item: Item = { ...BASE_ITEM, start_at: NOW - 60 * 60 * 1000, end_at: null, archived_at: NOW - 1000 };
    expectArchiveAbsent(item, true);
  });

  it("all-day, on its own day -> absent (the v1 blocker's regression guard)", () => {
    const ownDayMidnight = new Date(2026, 6, 15, 0, 0, 0).getTime(); // today, local midnight
    const item: Item = { ...BASE_ITEM, start_at: ownDayMidnight, end_at: null, all_day: true };
    expectArchiveAbsent(item, true);
  });

  it("all-day, well past ALL_DAY_GRACE_MS -> present", () => {
    const twoDaysAgoMidnight = new Date(2026, 6, 13, 0, 0, 0).getTime();
    const item: Item = { ...BASE_ITEM, start_at: twoDaysAgoMidnight, end_at: null, all_day: true };
    expectArchivePresent(item, true);
  });
});

describe("ItemDetails — T26: Restore/Duplicate on an archived item; T26 anti-vacuity on a live one", () => {
  const ARCHIVED_ITEM: Item = { ...BASE_ITEM, archived_at: Date.now() - 1000 };

  it("archived item: Edit is null, Restore and Duplicate are present BUTTONs", () => {
    render(
      <ItemDetails item={ARCHIVED_ITEM} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    const restoreBtn = screen.getByRole("button", { name: /^restore$/i });
    expect(restoreBtn.tagName).toBe("BUTTON");
    const duplicateBtn = screen.getByRole("button", { name: /^duplicate$/i });
    expect(duplicateBtn.tagName).toBe("BUTTON");
  });

  it("live item (anti-vacuity control): Edit present, Restore absent", () => {
    render(
      <ItemDetails item={BASE_ITEM} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^restore$/i })).not.toBeInTheDocument();
  });

  it("shows the Archived badge for an archived item, not for a live one", () => {
    const { rerender } = render(
      <ItemDetails item={ARCHIVED_ITEM} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    expect(screen.getByText("Archived")).toBeInTheDocument();

    rerender(
      <ItemDetails item={BASE_ITEM} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();
  });

  it("T26b — clicking Restore calls onRestore; clicking Duplicate calls onDuplicate (intent only)", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    const onDuplicate = vi.fn();
    render(
      <ItemDetails item={ARCHIVED_ITEM} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={onRestore} onDuplicate={onDuplicate} />
    );

    await user.click(screen.getByRole("button", { name: /^restore$/i }));
    expect(onRestore).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /^duplicate$/i }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });
});

// Footer button order, owner-specified 2026-09-21: Close, then the primary action
// (Edit / Restore), then Archive / Duplicate.
//
// These assert the COMPLETE footer contents with toEqual, not relative indices. A
// relative-index check (the pattern the row-order test uses) would still pass if a
// button were added or dropped, and nothing else in the repo pins this footer at all —
// the order is a bare JSX sequence with no other guard. Scoped to the actions container
// so AttachmentsView's buttons cannot drift into the list.
describe("ItemDetails — footer button order", () => {
  function footerNames(item: Item): string[] {
    render(
      <ItemDetails item={item} lists={LISTS} user={USER} canWrite={true} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    return within(screen.getByTestId("item-details-actions"))
      .getAllByRole("button")
      .map((btn) => btn.textContent?.trim() ?? "");
  }

  it("active, archivable item: Close, Edit, Archive", () => {
    // Two days past, non-recurring, so isArchivable holds without touching system time.
    const item: Item = { ...BASE_ITEM, start_at: Date.now() - 48 * 60 * 60 * 1000, end_at: null };
    expect(footerNames(item)).toEqual(["Close", "Edit", "Archive"]);
  });

  it("active, not-yet-archivable item: Close, Edit (no Archive)", () => {
    const item: Item = { ...BASE_ITEM, start_at: Date.now() + 48 * 60 * 60 * 1000, end_at: null };
    expect(footerNames(item)).toEqual(["Close", "Edit"]);
  });

  it("archived item: Close, Restore, Duplicate", () => {
    const item: Item = { ...BASE_ITEM, archived_at: Date.now() - 1000 };
    expect(footerNames(item)).toEqual(["Close", "Restore", "Duplicate"]);
  });

  it("read-only viewer: Close alone", () => {
    render(
      <ItemDetails item={BASE_ITEM} lists={LISTS} user={USER} canWrite={false} onEdit={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onDuplicate={vi.fn()} />
    );
    const names = within(screen.getByTestId("item-details-actions"))
      .getAllByRole("button")
      .map((btn) => btn.textContent?.trim() ?? "");
    expect(names).toEqual(["Close"]);
  });
});
