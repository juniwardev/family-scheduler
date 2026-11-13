// App.test.tsx — regression guard for fix-list-selection-view-state (jsdom project, §8/§8.1).
//
// DC1 (load-bearing): while Admin is showing, selecting a list from the sidebar must switch
// the main panel to that list's ItemListView AND hide AdminPanel. Pre-fix, the sidebar
// `onSelect` handler only updated `selectedListId` and never touched `showAdmin`, so AdminPanel
// stayed rendered on top of the waterfall (`App.tsx:103`) and the "gone" assertion below FAILS.
// Post-fix, `onSelect` also sets `activeView="list"`, so the assertion PASSES. This test MUST
// fail on pre-fix code and pass post-fix — see the DC1 genuine-guard sanity check in the impl
// notes.
//
// Async-mount note: App renders "Loading Family Scheduler…" until getMe() resolves, so every
// test below awaits a post-load element (the "Admin" tab or an ItemListView heading) before
// interacting — modeled on ItemEditor.test.tsx's waitFor/await usage.
/// <reference types="@testing-library/jest-dom/vitest" />
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import type { User, List, Item, OccurrenceEntry } from "./types";
import * as apiClient from "./apiClient";

vi.mock("./apiClient", async () => {
  const actual = await vi.importActual<typeof import("./apiClient")>("./apiClient");
  return {
    ...actual,
    getMe: vi.fn(),
    adminGetUsers: vi.fn(),
    getItems: vi.fn(),
    getOccurrences: vi.fn(),
  };
});

const ADMIN_USER: User = {
  email: "owner@example.com",
  display_name: "Owner",
  role: "admin",
  active: true,
  created_at: 0,
  maps_provider: null,
};

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
  {
    id: "list-2",
    name: "Chores",
    color: null,
    owner_email: "owner@example.com",
    visibility: "shared",
    created_at: 0,
  },
];

const ITEMS: Item[] = [];
const OCCURRENCES: OccurrenceEntry[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.adminGetUsers).mockResolvedValue({ users: [ADMIN_USER] });
  vi.mocked(apiClient.getItems).mockResolvedValue({ items: ITEMS });
  vi.mocked(apiClient.getOccurrences).mockResolvedValue({ occurrences: OCCURRENCES });
});

// Renders App as the admin user and awaits the post-load UI (the Admin tab), so subsequent
// clicks run against the loaded tree, not the "Loading Family Scheduler…" placeholder.
async function renderAsAdmin() {
  vi.mocked(apiClient.getMe).mockResolvedValue({ user: ADMIN_USER, lists: LISTS });
  render(<App />);
  return screen.findByRole("button", { name: "Admin" });
}

describe("App — DC1 core regression: sidebar list selection must escape Admin view", () => {
  it("selecting a different list from the sidebar while Admin is showing switches to that list's view and hides AdminPanel", async () => {
    const user = userEvent.setup();
    await renderAsAdmin();

    await user.click(screen.getByRole("button", { name: "Admin" }));
    expect(await screen.findByText("Admin — User Roster")).toBeInTheDocument();

    // Default landing already selected "Groceries" (first list); pick the OTHER list so the
    // assertion below proves a real view switch, not a no-op re-render.
    await user.click(screen.getByText("Chores"));

    expect(await screen.findByRole("heading", { name: /Chores/ })).toBeInTheDocument();
    expect(screen.queryByText("Admin — User Roster")).not.toBeInTheDocument();
  });
});

describe("App — DC2: List tab escapes Admin view", () => {
  it("clicking the List tab from Admin shows ItemListView, hides AdminPanel, and marks List active", async () => {
    const user = userEvent.setup();
    await renderAsAdmin();

    await user.click(screen.getByRole("button", { name: "Admin" }));
    expect(await screen.findByText("Admin — User Roster")).toBeInTheDocument();

    const listTab = screen.getByRole("button", { name: "List" });
    await user.click(listTab);

    expect(await screen.findByRole("heading", { name: /Groceries/ })).toBeInTheDocument();
    expect(screen.queryByText("Admin — User Roster")).not.toBeInTheDocument();
    expect(listTab).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Calendar" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Admin" })).not.toHaveAttribute("aria-current");
  });
});

describe("App — DC3: Calendar tab escapes Admin view", () => {
  it("clicking the Calendar tab from Admin shows CalendarView and hides AdminPanel", async () => {
    const user = userEvent.setup();
    await renderAsAdmin();

    await user.click(screen.getByRole("button", { name: "Admin" }));
    expect(await screen.findByText("Admin — User Roster")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Calendar" }));

    // CalendarView renders month-navigation controls unique to it.
    expect(await screen.findByRole("button", { name: "‹" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "›" })).toBeInTheDocument();
    expect(screen.queryByText("Admin — User Roster")).not.toBeInTheDocument();
  });
});

describe("App — DC4: role-gating preserved for non-admin users", () => {
  it("a member never sees the Admin control or AdminPanel", async () => {
    vi.mocked(apiClient.getMe).mockResolvedValue({ user: MEMBER_USER, lists: LISTS });
    render(<App />);

    expect(await screen.findByRole("heading", { name: /Groceries/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByText("Admin — User Roster")).not.toBeInTheDocument();
  });
});
