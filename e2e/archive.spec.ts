// e2e/archive.spec.ts — E1, the full archive round trip (plan §7.1).
//
// Full round trip against the real built bundle with /api/* route-mocked per the STATEFUL
// harness (installArchiveApiMocks, e2e/fixtures/api-mocks.ts) — a mutable working set is
// required here, unlike every other spec in this suite, because archive/restore/duplicate must
// be visible in the NEXT fetch.
//
// Two anti-vacuity controls throughout: a LIVE sibling item's chip/row must stay visible the
// whole time (so "the list/grid is empty" cannot pass a disappearance step), and the
// duplicate's assertion names the NEW item's title while the source is still findable under
// Archived.
//
// What this does NOT prove: anything about the Worker or D1, because nothing reaches them
// (CLAUDE.md:33-36 / plan §7.1). See docs/plans/item-archive-impl-notes.md for the manual-QA
// path (M1b etc.) that does.
import { test, expect, type Page } from "@playwright/test";
import { buildList, buildUser, installArchiveApiMocks } from "./fixtures/api-mocks";
import type { Item } from "../web/src/types";

async function waitForCalendarSettled(page: Page): Promise<void> {
  await page.getByText("Loading…").waitFor({ state: "hidden" });
}

test.describe("archive / restore / duplicate round trip (E1)", () => {
  test("archive -> gone from Active + calendar -> Archived -> Restore -> back -> archive -> Duplicate", async ({
    page,
  }) => {
    const list = buildList();
    const now = Date.now();

    const sourceItem: Item = {
      id: "source-item",
      list_id: list.id,
      type: "event",
      title: "Old Team Meeting",
      location: null,
      notes: null,
      start_at: now - 3 * 60 * 60 * 1000, // 3h ago — safely archivable and within this month
      end_at: null,
      all_day: false,
      rrule: null,
      timezone: "UTC",
      completed_at: null,
      created_by: "e2e-owner@example.test",
      created_at: now,
      updated_at: now,
      reminders: [],
      location_kind: null,
      archived_at: null,
    };
    const liveSibling: Item = {
      ...sourceItem,
      id: "live-sibling",
      title: "Live Sibling Event",
      start_at: now - 1 * 60 * 60 * 1000,
    };

    const items: Item[] = [sourceItem, liveSibling];
    await installArchiveApiMocks(page, { list, user: buildUser(), items });

    // §9.2/§9.2.1: Archive and Restore now raise a native confirm() before acting. Playwright
    // AUTO-DISMISSES an unhandled dialog rather than blocking on it, so without this handler
    // every Archive/Restore click below would silently no-op — a misdiagnosis, not a hang (the
    // failure reads as "the item is still in Active", not as a timeout). Registered once,
    // before any action that could trigger a dialog; this spec raises no other native dialogs.
    page.on("dialog", (dialog) => void dialog.accept());

    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    await test.step("beat 1: both items start in the Active list", async () => {
      await expect(page.getByRole("button", { name: "Old Team Meeting" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Live Sibling Event" })).toBeVisible();
    });

    await test.step("beat 2: Archive from the view modal", async () => {
      await page.getByRole("button", { name: "Old Team Meeting" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Archive" }).click();
      await expect(dialog).not.toBeVisible();
    });

    await test.step("beat 3: gone from Active; the live sibling stays", async () => {
      await expect(page.getByRole("button", { name: "Old Team Meeting" })).not.toBeVisible();
      await expect(page.getByRole("button", { name: "Live Sibling Event" })).toBeVisible();
    });

    await test.step("beat 4: present under the Archived toggle", async () => {
      await page.getByRole("button", { name: "Archived", exact: true }).click();
      await expect(page.getByRole("button", { name: "Old Team Meeting" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Live Sibling Event" })).not.toBeVisible();
    });

    await test.step("beat 5: gone from the calendar grid; a live sibling chip remains", async () => {
      await page.getByRole("button", { name: "Calendar" }).click();
      await waitForCalendarSettled(page);
      await expect(page.getByRole("button", { name: /Old Team Meeting/ })).not.toBeVisible();
      await expect(page.getByRole("button", { name: /Live Sibling Event/ })).toBeVisible();
    });

    await test.step("beat 6: Restore -> back in Active and back on the grid", async () => {
      await page.getByRole("button", { name: "List", exact: true }).click();
      await page.getByRole("button", { name: "Archived", exact: true }).click();
      await page.getByRole("button", { name: "Old Team Meeting" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Restore" }).click();
      await expect(dialog).not.toBeVisible();

      await page.getByRole("button", { name: "Active", exact: true }).click();
      await expect(page.getByRole("button", { name: "Old Team Meeting" })).toBeVisible();

      await page.getByRole("button", { name: "Calendar" }).click();
      await waitForCalendarSettled(page);
      await expect(page.getByRole("button", { name: /Old Team Meeting/ })).toBeVisible();
    });

    await test.step("beat 7: archive again, then Duplicate", async () => {
      await page.getByRole("button", { name: "List", exact: true }).click();
      await page.getByRole("button", { name: "Old Team Meeting" }).click();
      let dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Archive" }).click();
      await expect(dialog).not.toBeVisible();

      await page.getByRole("button", { name: "Archived", exact: true }).click();
      await page.getByRole("button", { name: "Old Team Meeting" }).click();
      dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Duplicate" }).click();

      // Still one dialog, now the create-mode editor, prefilled with the source's title.
      await expect(page.getByRole("dialog")).toHaveCount(1);
      // Playwright's Page has no getByDisplayValue (a testing-library-only query) — locate the
      // title input by type and assert its value instead. Scoped to the dialog: an
      // unscoped `input[type="text"]` also matches the sidebar's "New list name" input.
      await expect(page.getByRole("dialog").locator('input[type="text"]').first()).toHaveValue("Old Team Meeting");

      await page.getByRole("button", { name: "Create" }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
    });

    await test.step("beat 8: the new item is in Active; the source is still findable under Archived", async () => {
      // The discriminating check is the COMBINATION of these two halves, not either alone.
      // Duplicate's copy shares the source's title, so "exactly one 'Old Team Meeting' in
      // Active" alone would also pass on a build that PATCHed the source (restoring it)
      // instead of creating a new item. Only the second half — the SAME title still present
      // under Archived at the same time — proves the source was left alone and a genuinely
      // new item was created (Decision 7: "the source stays archived").
      await page.getByRole("button", { name: "Active", exact: true }).click();
      await expect(page.getByRole("button", { name: "Old Team Meeting" })).toHaveCount(1);

      await page.getByRole("button", { name: "Archived", exact: true }).click();
      await expect(page.getByRole("button", { name: "Old Team Meeting" })).toBeVisible();
    });
  });
});
