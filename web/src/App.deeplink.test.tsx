// App.deeplink.test.tsx — deep-link resolution + NEW-1 (round-2 review) remount-safe one-shot.
//
// Covers done-condition #3 (plan §10): "?item=<id>" deep link point-reads the item via
// GET /api/items/:id (mocked here as apiClient.getItem) and opens that item in VIEW mode
// (item-view-mode plan Decision 8, settled by the owner 2026-08-21).
//
// NEW-1 (load-bearing): App — not ItemListView — owns the one-shot guard. It clears
// initialOpenItem back to null the first time ItemListView reports consumption, so
// switching to Calendar and back (which unmounts/remounts ItemListView) does NOT reopen
// the modal a second time. A purely local useRef guard in ItemListView would NOT survive
// that remount — this test is the regression guard for that gap.
/// <reference types="@testing-library/jest-dom/vitest" />
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import type { User, List, Item, OccurrenceEntry } from "./types";
import * as apiClient from "./apiClient";

vi.mock("./apiClient", async () => {
  const actual = await vi.importActual<typeof import("./apiClient")>("./apiClient");
  return {
    ...actual,
    getMe: vi.fn(),
    getItem: vi.fn(),
    getItems: vi.fn(),
    getOccurrences: vi.fn(),
  };
});

const MEMBER_USER: User = {
  email: "member@example.com",
  display_name: "Member",
  role: "member",
  active: true,
  created_at: 0,
  maps_provider: null,
};

const LISTS: List[] = [
  {
    id: "list-1",
    name: "Groceries",
    color: null,
    owner_email: "owner@example.com",
    visibility: "shared",
    created_at: 0,
  },
];

const DEEP_LINKED_ITEM: Item = {
  id: "item-42",
  list_id: "list-1",
  type: "event",
  title: "Deep-linked birthday party",
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

const OCCURRENCES: OccurrenceEntry[] = [];

let originalSearch: string;

beforeEach(() => {
  vi.clearAllMocks();
  originalSearch = window.location.search;
  vi.mocked(apiClient.getItems).mockResolvedValue({ items: [DEEP_LINKED_ITEM] });
  vi.mocked(apiClient.getOccurrences).mockResolvedValue({ occurrences: OCCURRENCES });
});

afterEach(() => {
  // Restore the URL so deep-link state doesn't leak across tests.
  window.history.replaceState(null, "", `${window.location.pathname}${originalSearch}`);
});

function setDeepLinkSearch(itemId: string) {
  window.history.replaceState(null, "", `${window.location.pathname}?item=${itemId}`);
}

describe("App — deep link (?item=<id>) opens the item in view mode", () => {
  it("point-reads the item via GET /api/items/:id and opens it in view mode (no N-list fan-out)", async () => {
    setDeepLinkSearch(DEEP_LINKED_ITEM.id);
    vi.mocked(apiClient.getMe).mockResolvedValue({ user: MEMBER_USER, lists: LISTS });
    vi.mocked(apiClient.getItem).mockResolvedValue({ item: DEEP_LINKED_ITEM });

    render(<App />);

    const dialog = await screen.findByRole("dialog");
    // Scoped, not an unscoped getByText: the item title also appears in the list row's title
    // button (Decision 6) once the modal is open, so an unscoped query throws "Found multiple
    // elements". within(dialog) restricts the match to the modal subtree.
    expect(within(dialog).getByText("Deep-linked birthday party")).toBeInTheDocument();
    // The one explicit view-mode assertion: no form controls in the document. Safe unscoped
    // because Radix's hideOthers(content) marks everything outside the portal aria-hidden
    // while the modal is open, and *ByRole queries respect aria-hidden (*ByText does not).
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);

    // Point-read, not a fan-out: exactly one getItem call for the deep-linked id.
    expect(apiClient.getItem).toHaveBeenCalledTimes(1);
    expect(apiClient.getItem).toHaveBeenCalledWith(DEEP_LINKED_ITEM.id);
  });

  it("403/404 on the deep-linked item shows a notice and falls back to the normal view (no data leak)", async () => {
    setDeepLinkSearch("forbidden-item");
    vi.mocked(apiClient.getMe).mockResolvedValue({ user: MEMBER_USER, lists: LISTS });
    vi.mocked(apiClient.getItem).mockRejectedValue(
      new apiClient.ApiError("FORBIDDEN", "Forbidden", 403)
    );

    render(<App />);

    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
    // Falls back to the normal list view — no modal forced open.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("NEW-1: after the deep-linked modal is closed, switching to Calendar and back to List does NOT reopen it", async () => {
    setDeepLinkSearch(DEEP_LINKED_ITEM.id);
    vi.mocked(apiClient.getMe).mockResolvedValue({ user: MEMBER_USER, lists: LISTS });
    vi.mocked(apiClient.getItem).mockResolvedValue({ item: DEEP_LINKED_ITEM });

    const user = userEvent.setup();
    render(<App />);

    // Modal opens once on boot.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // Close it via Esc. (Not a button named /^close$/i: both the shell's built-in dismiss AND
    // ItemDetails' footer Close are named "Close" inside the dialog, so that query would throw
    // "Found multiple elements". Escape routes through the same close() path either way.)
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Switch to Calendar (unmounts ItemListView) ...
    await user.click(screen.getByRole("button", { name: "Calendar" }));
    expect(await screen.findByRole("button", { name: "‹" })).toBeInTheDocument();

    // ... and back to List (remounts ItemListView). Pre-NEW-1-fix, a component-local
    // useRef one-shot guard would reset on remount and reopen the modal here.
    await user.click(screen.getByRole("button", { name: "List" }));

    // Give any errant re-open effect a chance to run, then assert it did NOT reopen.
    await waitFor(() => expect(screen.getByRole("heading", { name: /Groceries/ })).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
