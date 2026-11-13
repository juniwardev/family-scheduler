/// <reference types="@testing-library/jest-dom/vitest" />
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemListView } from "./ItemListView";
import type { Item, List, User } from "../types";
import * as apiClient from "../apiClient";

vi.mock("../apiClient", async () => {
  const actual = await vi.importActual<typeof import("../apiClient")>("../apiClient");
  return {
    ...actual,
    getItems: vi.fn(),
    deleteItem: vi.fn(),
    completeItem: vi.fn(),
    setItemArchived: vi.fn(),
    listAttachments: vi.fn(),
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

const TIMED_ITEM: Item = {
  id: "item-1",
  list_id: "list-1",
  type: "event",
  title: "Team standup",
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
  reminders: [],
  location_kind: null,
  archived_at: null,
};

const ALL_DAY_ITEM: Item = {
  ...TIMED_ITEM,
  id: "item-2",
  title: "Field trip",
  all_day: true,
};

const COMPLETED_ITEM: Item = {
  ...TIMED_ITEM,
  id: "item-3",
  type: "task",
  title: "Buy milk",
  completed_at: Date.now(),
};

const ARCHIVED_ITEM: Item = {
  ...TIMED_ITEM,
  id: "item-4",
  title: "Old archived event",
  start_at: Date.now() - 30 * 24 * 60 * 60 * 1000,
  archived_at: Date.now() - 24 * 60 * 60 * 1000,
};

// §9 amendment fixture — a LIVE (not-yet-archived) item whose date has already passed, so
// ItemDetails offers Archive (canArchive = canWrite && !isArchived && isArchivable). TIMED_ITEM
// itself is future-dated (start_at ~2027) and never offers Archive.
const PAST_LIVE_ITEM: Item = {
  ...TIMED_ITEM,
  id: "item-5",
  title: "Past Live Event",
  start_at: Date.now() - 3 * 60 * 60 * 1000,
  archived_at: null,
};

function renderList(items: Item[]) {
  vi.mocked(apiClient.getItems).mockResolvedValue({ items });
  vi.mocked(apiClient.listAttachments).mockResolvedValue({ attachments: [] });
  return render(
    <ItemListView
      listId="list-1"
      lists={LISTS}
      user={USER}
      items={items}
      onItemsChange={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // §9.2.1: ItemModal now raises a native confirm() before Archive/Restore. Default to
  // "accept" so the pre-existing flows in this file (and T24(d)'s Restore click) keep working
  // without every test threading its own stub through; T33/T34 override this to `false` where
  // the cancel path itself is what is under test.
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("ItemListView — requirement 1: title click opens view mode", () => {
  it("clicking the item title button opens role=dialog with the item title, and no textboxes (view mode)", async () => {
    const user = userEvent.setup();
    renderList([TIMED_ITEM]);

    await user.click(await screen.findByRole("button", { name: "Team standup" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Team standup")).toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });
});

describe("ItemListView — requirement 3: row Edit opens edit mode", () => {
  it("clicking the row's Edit opens role=dialog with an input whose value is the item title", async () => {
    const user = userEvent.setup();
    renderList([TIMED_ITEM]);

    await screen.findByText("Team standup");
    const row = screen.getByText("Team standup").closest('[data-testid="item-row"]') as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /^edit$/i }));

    await screen.findByRole("dialog");
    expect(screen.getByDisplayValue("Team standup")).toBeInTheDocument();
  });
});

describe("ItemListView — View -> Edit in place", () => {
  it("clicking title then the modal's Edit keeps ONE dialog open, now showing the title input", async () => {
    const user = userEvent.setup();
    renderList([TIMED_ITEM]);

    await user.click(await screen.findByRole("button", { name: "Team standup" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: /^edit$/i }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByDisplayValue("Team standup")).toBeInTheDocument();
  });
});

describe("ItemListView — requirement 4: row action order View, Edit, Delete", () => {
  it("the row's action buttons appear in relative order View, Edit, Delete", async () => {
    renderList([TIMED_ITEM]);

    await screen.findByText("Team standup");
    const row = screen.getByText("Team standup").closest('[data-testid="item-row"]') as HTMLElement;
    const names = within(row)
      .getAllByRole("button")
      .map((btn) => btn.textContent?.trim() ?? "");

    const viewIdx = names.findIndex((n) => n === "View");
    const editIdx = names.findIndex((n) => n === "Edit");
    const deleteIdx = names.findIndex((n) => n === "Delete");

    expect(viewIdx).toBeGreaterThanOrEqual(0);
    expect(editIdx).toBeGreaterThan(viewIdx);
    expect(deleteIdx).toBeGreaterThan(editIdx);
  });
});

describe("ItemListView — R2 guard: completed title strike-through class, no hover-variant collision", () => {
  it("a static className assertion — completed title has line-through and no hover text-decoration-line variant", async () => {
    renderList([COMPLETED_ITEM]);

    const titleBtn = await screen.findByRole("button", { name: "Buy milk" });
    expect(titleBtn.className).toMatch(/(^|\s)line-through(\s|$)/);
    expect(titleBtn.className).not.toMatch(/hover:(underline|no-underline|line-through)/);
  });
});

describe("ItemListView — D-OQ5 guard: row date line uses formatOccurrenceTime", () => {
  it("renders a formatted date/time string for a timed item", async () => {
    renderList([TIMED_ITEM]);
    // formatOccurrenceTime always includes a comma-separated weekday/month/day/year token.
    await screen.findByText("Team standup");
    const row = screen.getByText("Team standup").closest('[data-testid="item-row"]') as HTMLElement;
    expect(within(row).getByText(/,\s+\w{3}\s+\d{1,2},\s+\d{4}/)).toBeInTheDocument();
  });

  it("renders date-only (no 12:00:00 AM) for an all_day item — the bug this change fixes", async () => {
    renderList([ALL_DAY_ITEM]);
    await screen.findByText("Field trip");
    const row = screen.getByText("Field trip").closest('[data-testid="item-row"]') as HTMLElement;
    expect(within(row).queryByText(/12:00:00 AM/)).not.toBeInTheDocument();
  });
});

describe("ItemListView — keyboard activation", () => {
  it("focusing the title button and pressing Enter opens the dialog", async () => {
    const user = userEvent.setup();
    renderList([TIMED_ITEM]);

    const titleBtn = await screen.findByRole("button", { name: "Team standup" });
    titleBtn.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("ItemListView — focus restore on modal close (QA nit 1)", () => {
  it("closing the modal (Esc) returns focus to the row title button that opened it", async () => {
    const user = userEvent.setup();
    renderList([TIMED_ITEM]);

    const titleBtn = await screen.findByRole("button", { name: "Team standup" });
    await user.click(titleBtn);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(titleBtn).toHaveFocus();
  });

  it("does not restore focus to a trigger element that was removed from the DOM while the modal was open", async () => {
    const user = userEvent.setup();
    const { rerender } = renderList([TIMED_ITEM]);

    const titleBtn = await screen.findByRole("button", { name: "Team standup" });
    await user.click(titleBtn);
    await screen.findByRole("dialog");

    // Simulate the row (and its title button) disappearing while the modal is still open —
    // e.g. the item was deleted elsewhere and the list refreshed. The modal keeps showing the
    // item it already has (Decision 7's lastStateRef), but the captured trigger element is no
    // longer attached to the document.
    rerender(
      <ItemListView listId="list-1" lists={LISTS} user={USER} items={[]} onItemsChange={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: "Team standup" })).not.toBeInTheDocument();
    expect(document.body.contains(titleBtn)).toBe(false);

    // Closing must not throw trying to focus a detached element, and must not leave focus on it.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(titleBtn).not.toHaveFocus();
  });
});

// T24 — the Active/Archived toggle (plan Decision 4b / §7.1 T24). Needs a stateful wrapper
// (mirroring how App.tsx really owns `items`) because switching scope must be observable in
// what renders, not just in what was fetched.
function renderWithLiveState(initialItems: Item[]) {
  function Harness() {
    const [items, setItems] = React.useState<Item[]>(initialItems);
    return (
      <ItemListView
        listId="list-1"
        lists={LISTS}
        user={USER}
        items={items}
        onItemsChange={setItems}
      />
    );
  }
  return render(<Harness />);
}

// §9 amendment (T31) — a stateful harness that also threads createRequestToken through as a
// controlled prop, so a test can drive door 2 (the mobile top-bar "+ New", App.tsx:144-147 ->
// ItemListView.tsx:90-93) by rerendering with a bumped token, WITHOUT clicking the "+ New Item"
// button (door 1). Defined once at module scope (not inside the test) so repeated `rerender()`
// calls reconcile against the SAME component identity and preserve `items` state across the
// token bump — an inline per-call component would remount and lose it.
function TokenHarness({ token }: { token: number }) {
  const [items, setItems] = React.useState<Item[]>([]);
  return (
    <ItemListView
      listId="list-1"
      lists={LISTS}
      user={USER}
      items={items}
      onItemsChange={setItems}
      createRequestToken={token}
    />
  );
}

describe("ItemListView — T24: Active/Archived toggle", () => {
  beforeEach(() => {
    vi.mocked(apiClient.listAttachments).mockResolvedValue({ attachments: [] });
  });

  it("(a) both toggle buttons carry the correct aria-pressed", async () => {
    vi.mocked(apiClient.getItems).mockResolvedValue({ items: [TIMED_ITEM] });
    renderWithLiveState([TIMED_ITEM]);

    const activeBtn = await screen.findByRole("button", { name: "Active" });
    const archivedBtn = screen.getByRole("button", { name: "Archived" });
    expect(activeBtn).toHaveAttribute("aria-pressed", "true");
    expect(archivedBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("(b) switching to Archived issues a getItems call with the archived scope", async () => {
    vi.mocked(apiClient.getItems).mockImplementation((_listId, opts) =>
      Promise.resolve({ items: opts?.archived ? [ARCHIVED_ITEM] : [TIMED_ITEM] })
    );
    const user = userEvent.setup();
    renderWithLiveState([TIMED_ITEM]);

    await screen.findByText("Team standup");
    await user.click(screen.getByRole("button", { name: "Archived" }));

    await waitFor(() => {
      const calls = vi.mocked(apiClient.getItems).mock.calls;
      const last = calls[calls.length - 1];
      // apiClient.getItems appends `?archived=1` to the request URL when opts.archived is true
      // (apiClient.ts) — asserted here at the mocked call-argument level, per this file's
      // existing idiom (see CalendarView.test.tsx's getOccurrences assertions); the real URL
      // construction is exercised at the HTTP layer by items-archive-http.test.ts's T18-T20.
      expect(last[1]).toEqual({ archived: true });
    });
  });

  it("(c) the archived fixture's titles render and the active fixture's do NOT, after switching", async () => {
    vi.mocked(apiClient.getItems).mockImplementation((_listId, opts) =>
      Promise.resolve({ items: opts?.archived ? [ARCHIVED_ITEM] : [TIMED_ITEM] })
    );
    const user = userEvent.setup();
    renderWithLiveState([TIMED_ITEM]);

    await screen.findByText("Team standup");
    await user.click(screen.getByRole("button", { name: "Archived" }));

    await screen.findByText("Old archived event");
    expect(screen.queryByText("Team standup")).not.toBeInTheDocument();
  });

  it("(d) after Restore (which calls refresh()), the NEXT fetch still carries the archived scope", async () => {
    vi.mocked(apiClient.getItems).mockImplementation((_listId, opts) =>
      Promise.resolve({ items: opts?.archived ? [ARCHIVED_ITEM] : [TIMED_ITEM] })
    );
    vi.mocked(apiClient.setItemArchived).mockResolvedValue({
      item: { ...ARCHIVED_ITEM, archived_at: null },
    });
    const user = userEvent.setup();
    renderWithLiveState([TIMED_ITEM]);

    await screen.findByText("Team standup");
    await user.click(screen.getByRole("button", { name: "Archived" }));
    await screen.findByText("Old archived event");

    // Archived-view rows are View-only (no Edit/Delete) — open the modal via View, then Restore.
    const row = screen.getByText("Old archived event").closest('[data-testid="item-row"]') as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog");

    // Captured AFTER the toggle's own fetch, so the assertion below proves a NEW fetch happened
    // post-restore — not merely that the toggle's earlier call (already {archived: true})
    // is still the most recent one. A build that dropped refresh() entirely (or called it with
    // onArchiveChanged={() => itemModal.close()} alone) would pass a last-call-only assertion.
    const callsBeforeRestore = vi.mocked(apiClient.getItems).mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: /^restore$/i }));

    await waitFor(() => {
      expect(vi.mocked(apiClient.setItemArchived)).toHaveBeenCalledWith(ARCHIVED_ITEM.id, false);
    });
    await waitFor(() => {
      const calls = vi.mocked(apiClient.getItems).mock.calls;
      expect(calls.length).toBeGreaterThan(callsBeforeRestore);
      const last = calls[calls.length - 1];
      // The bug this row guards against: threading scope into only the mount effect (not
      // refresh()) would make this last call carry {archived: false} (or no scope arg at all)
      // instead — silently repopulating the Archived view with active items post-mutation.
      expect(last[1]).toEqual({ archived: true });
    });
  });
});

// §9 amendment — plan §9.1 (T31/T32/T36) and §9.2 (T33/T34/T35). This is where ItemModal is
// rendered (ItemModal.tsx:187 is the only setItemArchived call site outside apiClient), which
// is why the confirm criteria live here and not in ItemDetails.test.tsx — ItemDetails' onArchive
// /onRestore are `() => void` intent-raisers with no API call to assert the absence of.
describe("ItemListView — §9 amendment: scope switch on create (T31/T32/T36) and confirm (T33/T34/T35)", () => {
  let activeItems: Item[];
  let archivedItems: Item[];

  beforeEach(() => {
    activeItems = [PAST_LIVE_ITEM];
    archivedItems = [ARCHIVED_ITEM];
    vi.mocked(apiClient.getItems).mockImplementation((_listId, opts) =>
      Promise.resolve({ items: opts?.archived ? archivedItems : activeItems })
    );
    vi.mocked(apiClient.listAttachments).mockResolvedValue({ attachments: [] });
    // window.confirm defaults to `true` via the file-level beforeEach above; T33/T34 override
    // it locally to `false`.
  });

  it("T31 — creating via door 2 (bumped createRequestToken, NOT the '+ New Item' button) from the Archived scope switches to Active and shows the new item", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TokenHarness token={0} />);

    await screen.findByText("Past Live Event");
    await user.click(screen.getByRole("button", { name: "Archived" }));
    await screen.findByText("Old archived event");

    // Door 2: bump the token by rerender. Deliberately not door 1 (the "+ New Item" button) —
    // door 1 is what a handler-by-handler patch fixes first; door 2 is the one a Coder patching
    // ItemListView.tsx:150 alone would leave broken, and the one that matters on an iPhone.
    rerender(<TokenHarness token={1} />);

    const dialog = await screen.findByRole("dialog");
    // Create mode: submit button reads "Create" (ItemEditor.tsx:330), title input starts empty.
    const titleInput = dialog.querySelector('input[type="text"]') as HTMLInputElement;
    expect(titleInput.value).toBe("");
    await user.type(titleInput, "Door 2 Item");

    const newItem: Item = { ...PAST_LIVE_ITEM, id: "item-door2", title: "Door 2 Item", archived_at: null };
    vi.mocked(apiClient.createItem).mockImplementation(async () => {
      activeItems = [...activeItems, newItem];
      return { item: newItem };
    });

    await user.click(within(dialog).getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Archived" })).toHaveAttribute("aria-pressed", "false");
    });
    expect(await screen.findByText("Door 2 Item")).toBeInTheDocument();
  });

  it("T32 — Restore from the Archived scope leaves the scope on Archived (guards against 'switch on every write')", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.setItemArchived).mockImplementation(async (id) => {
      const restored = { ...ARCHIVED_ITEM, id, archived_at: null };
      archivedItems = archivedItems.filter((i) => i.id !== id);
      activeItems = [...activeItems, restored];
      return { item: restored };
    });
    renderWithLiveState([]);

    await screen.findByText("Past Live Event"); // initial Active-scope load settles
    await user.click(screen.getByRole("button", { name: "Archived" }));
    await screen.findByText("Old archived event");
    const row = screen.getByText("Old archived event").closest('[data-testid="item-row"]') as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^restore$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // A build that switches scope on EVERY successful write (not just create) would fail here.
    expect(screen.getByRole("button", { name: "Archived" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "false");
  });

  it("T33 — Archive with confirm stubbed false: setItemArchived is NOT called and the item is still listed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderWithLiveState([]);

    await screen.findByText("Past Live Event");
    await user.click(screen.getByRole("button", { name: "Past Live Event" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^archive$/i }));

    expect(vi.mocked(apiClient.setItemArchived)).not.toHaveBeenCalled();
    // A9.2 — true no-op: the modal stays open and the item is still in the Active list.
    // Scoped to the row (not a bare screen.getByText) — the open dialog's own DialogTitle
    // ALSO renders the item's title text, so an unscoped query matches twice.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const activeRow = document.querySelector('[data-testid="item-row"]') as HTMLElement;
    expect(within(activeRow).getByText("Past Live Event")).toBeInTheDocument();
  });

  it("T34 — Restore with confirm stubbed false: setItemArchived is NOT called and the item is still listed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderWithLiveState([]);

    await screen.findByText("Past Live Event"); // initial Active-scope load settles
    await user.click(screen.getByRole("button", { name: "Archived" }));
    await screen.findByText("Old archived event");
    const row = screen.getByText("Old archived event").closest('[data-testid="item-row"]') as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^restore$/i }));

    expect(vi.mocked(apiClient.setItemArchived)).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Same DialogTitle-collision reasoning as T33 — scope to the archived row.
    expect(within(row).getByText("Old archived event")).toBeInTheDocument();
  });

  it("T35 — Archive with confirm stubbed true: the archive path still works end to end", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.setItemArchived).mockImplementation(async (id) => {
      activeItems = activeItems.filter((i) => i.id !== id);
      return { item: { ...PAST_LIVE_ITEM, archived_at: Date.now() } };
    });
    renderWithLiveState([]);

    await screen.findByText("Past Live Event");
    await user.click(screen.getByRole("button", { name: "Past Live Event" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^archive$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("Past Live Event")).not.toBeInTheDocument());
  });

  it("T36 — Duplicate-save from the Archived scope switches to Active and shows the new item (source stays archived)", async () => {
    const user = userEvent.setup();
    renderWithLiveState([]);

    await screen.findByText("Past Live Event"); // initial Active-scope load settles
    await user.click(screen.getByRole("button", { name: "Archived" }));
    await screen.findByText("Old archived event");
    await user.click(screen.getByRole("button", { name: "Old archived event" }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^duplicate$/i }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    dialog = screen.getByRole("dialog");
    await screen.findByDisplayValue("Old archived event");

    const newItem: Item = { ...ARCHIVED_ITEM, id: "item-dup", archived_at: null };
    vi.mocked(apiClient.createItem).mockImplementation(async () => {
      activeItems = [...activeItems, newItem];
      return { item: newItem };
    });

    await user.click(within(dialog).getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(await screen.findByText("Old archived event")).toBeInTheDocument();
    // The source is unaffected — it is still in `archivedItems`, findable by switching back.
    await user.click(screen.getByRole("button", { name: "Archived" }));
    expect(await screen.findByText("Old archived event")).toBeInTheDocument();
  });
});
