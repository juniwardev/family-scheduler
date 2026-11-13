// ItemModal.desktop.test.tsx — the R11 / D-OQ3 condition: covers the Dialog branch, which
// under the jsdom matchMedia stub every OTHER test skips (useMediaQuery returns false there,
// so every other test exercises only the Sheet path). Kept in its own file because
// vi.mock("../hooks/useMediaQuery") is module-scoped — mocking it here must not leak into the
// Sheet-path tests in other files.
/// <reference types="@testing-library/jest-dom/vitest" />
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemModal } from "./ItemModal";
import type { ItemModalState } from "./ItemModal";
import type { Item, List, User } from "../types";
import * as apiClient from "../apiClient";

vi.mock("../hooks/useMediaQuery", () => ({ useMediaQuery: () => true }));

// This file renders ItemModal in VIEW mode, which mounts ItemDetails -> AttachmentsView, which
// fetches on mount (AttachmentsView.tsx:20-37). Mock it, same as the other new specs.
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

const ITEM: Item = {
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.listAttachments).mockResolvedValue({ attachments: [] });
});

describe("ItemModal — desktop (Dialog) branch", () => {
  it("renders a role=dialog with the item title and body in view mode", async () => {
    const state: ItemModalState = { mode: "view", item: ITEM };
    render(
      <ItemModal
        state={state}
        lists={LISTS}
        user={USER}
        onClose={vi.fn()}
        onEditRequested={vi.fn()}
        onDuplicateRequested={vi.fn()}
        onArchiveChanged={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Team standup")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  it("closing through onOpenChange (Esc) calls onClose exactly once", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const state: ItemModalState = { mode: "view", item: ITEM };
    render(
      <ItemModal
        state={state}
        lists={LISTS}
        user={USER}
        onClose={onClose}
        onEditRequested={vi.fn()}
        onDuplicateRequested={vi.fn()}
        onArchiveChanged={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
