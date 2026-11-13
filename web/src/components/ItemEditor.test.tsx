// ItemEditor.test.tsx — regression guard for fix-item-save (jsdom project, §8.1/§8.2).
//
// DC1 (load-bearing): while creating an item, clicking "+ Add reminder" must NOT trigger a
// premature form submit / create call. This test MUST fail on pre-fix code (ReminderEditor's
// buttons default to type="submit" inside the <form>) and MUST pass once type="button" is set.
//
// DC3: the edit flow holds reminder changes in local state until the user presses Save, then
// persists metadata via updateItem, persists reminders via replaceReminders, and merges the
// FRESH replaceReminders result into onSave (updateItem's own `reminders` are stale).
/// <reference types="@testing-library/jest-dom/vitest" />
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemEditor } from "./ItemEditor";
import type { List, Item, ItemReminder } from "../types";
import * as apiClient from "../apiClient";

// Note: ItemEditor's <label> elements are not programmatically associated with their inputs
// (no htmlFor/id, no nesting), so getByLabelText cannot resolve Title/Start. Query by DOM
// structure instead: Title is the first type="text" input, Start is the first
// type="datetime-local" input (all_day defaults to false).
function getTitleInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="text"]') as HTMLInputElement;
}
function getStartInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
}
function getStartDateInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="date"]') as HTMLInputElement;
}

vi.mock("../apiClient", async () => {
  const actual = await vi.importActual<typeof import("../apiClient")>("../apiClient");
  return {
    ...actual,
    createItem: vi.fn(),
    updateItem: vi.fn(),
    replaceReminders: vi.fn(),
  };
});

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

const EXISTING_ITEM: Item = {
  id: "item-1",
  list_id: "list-1",
  type: "event",
  title: "Existing item",
  location: null,
  notes: null,
  start_at: 1_800_000_000_000,
  end_at: null,
  all_day: false,
  rrule: null,
  timezone: "America/Los_Angeles",
  completed_at: null,
  created_by: "owner@example.com",
  created_at: 0,
  updated_at: 0,
  reminders: [
    { id: "rem-1", item_id: "item-1", offset_minutes: 30, channel_email: true, channel_push: true },
  ],
  location_kind: null,
  archived_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ItemEditor — DC1 create-mode premature-submit regression", () => {
  it('clicking "+ Add reminder" during CREATE does not persist anything', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onCancel = vi.fn();

    const { container } = render(<ItemEditor lists={LISTS} onSave={onSave} onCancel={onCancel} />);

    await user.type(getTitleInput(container), "Trip to the park");
    fireEvent.change(getStartInput(container), { target: { value: "2026-07-01T10:00" } });

    const addReminderButton = screen.getByRole("button", { name: /\+ add reminder/i });

    // Backstop (cheap static guard, not the load-bearing proof — see below).
    expect(addReminderButton).toHaveAttribute("type", "button");

    await user.click(addReminderButton);

    // Load-bearing behavioral assertion: this MUST fail on pre-fix code (missing type="button"
    // causes the button to submit the form) and MUST pass post-fix.
    expect(apiClient.createItem).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("ItemEditor — DC3 edit-mode reminder persistence + merge", () => {
  it("holds reminder changes until Save, then persists and merges the fresh reminder set", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onCancel = vi.fn();

    const updatedItem: Item = { ...EXISTING_ITEM, title: "Existing item" };
    const freshReminders: ItemReminder[] = [
      { id: "rem-1", item_id: "item-1", offset_minutes: 30, channel_email: true, channel_push: true },
      { id: "rem-2", item_id: "item-1", offset_minutes: 15, channel_email: true, channel_push: true },
    ];

    vi.mocked(apiClient.updateItem).mockResolvedValue({ item: updatedItem });
    vi.mocked(apiClient.replaceReminders).mockResolvedValue({ reminders: freshReminders });

    render(<ItemEditor lists={LISTS} item={EXISTING_ITEM} onSave={onSave} onCancel={onCancel} />);

    // Mid-form: adding a reminder must not fire any API call yet.
    await user.click(screen.getByRole("button", { name: /\+ add reminder/i }));
    expect(apiClient.updateItem).not.toHaveBeenCalled();
    expect(apiClient.replaceReminders).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    // Final submit: persists metadata then the reminder set, merging the fresh reminders.
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(apiClient.updateItem).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(apiClient.replaceReminders).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    expect(onSave).toHaveBeenCalledWith({ ...updatedItem, reminders: freshReminders });
  });

  it("Cancel mid-edit persists nothing", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onCancel = vi.fn();

    render(<ItemEditor lists={LISTS} item={EXISTING_ITEM} onSave={onSave} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: /\+ add reminder/i }));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(apiClient.updateItem).not.toHaveBeenCalled();
    expect(apiClient.replaceReminders).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// T29 — the all-day storage convention, tested at the WRITER (plan §7.1). T5a/T6a (archive-db
// tests) exercise the READER of this convention with their own fixtures; only THIS test would
// go red if ItemEditor changed to emit UTC midnight instead of local midnight — a change that
// would shift every real all-day archive gate by the local UTC offset (7-8h here, enough to
// flip a day). TZ is pinned to America/Los_Angeles repo-wide for this project
// (vitest.workspace.ts, plan §7 step 12).
describe("ItemEditor — T29: all-day date is stored as LOCAL midnight, not UTC midnight", () => {
  it("ticking All day and entering a date posts start_at = local midnight, not Date.UTC", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    vi.mocked(apiClient.createItem).mockResolvedValue({
      item: { ...EXISTING_ITEM, id: "new-item" },
    });

    const { container } = render(<ItemEditor lists={LISTS} onSave={onSave} onCancel={onCancel} />);

    await user.type(getTitleInput(container), "Field trip");
    await user.click(screen.getByRole("checkbox", { name: /all day/i }));

    const dateInput = getStartDateInput(container);
    fireEvent.change(dateInput, { target: { value: "2026-07-20" } });

    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(apiClient.createItem).toHaveBeenCalledTimes(1));
    const draftArg = vi.mocked(apiClient.createItem).mock.calls[0][0];

    const localMidnight = new Date(2026, 6, 20).getTime();
    const utcMidnight = Date.UTC(2026, 6, 20);
    expect(draftArg.start_at).toBe(localMidnight);
    // Only a meaningful guard where local time is not already UTC (TZ is pinned to
    // America/Los_Angeles above, so this is never trivially true here).
    expect(localMidnight).not.toBe(utcMidnight);
    expect(draftArg.start_at).not.toBe(utcMidnight);
  });
});
