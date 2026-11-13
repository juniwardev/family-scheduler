// e2e/calendar-density.spec.ts — E2, layout containment / wrapping.
// Covers defect class 2 (docs/plans/playwright-bootstrap.md §1.2): text rendered into a
// text-[10px] calendar cell one-seventh of the grid wide, wrapping to about three lines
// (CalendarView.tsx documents the defect in-source). jsdom has no layout — `toBeVisible()` is
// "near-useless against Tailwind" (calendar-show-more.md §5.2) — so this spec is the only place
// in the repo that can see this defect class.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { buildList, buildUser, densityFixtureOccurrences, installApiMocks } from "./fixtures/api-mocks";
import { expectContainedIn } from "./fixtures/assertions";

async function waitForCalendarSettled(page: Page): Promise<void> {
  await page.getByText("Loading…").waitFor({ state: "hidden" });
}

async function assertCardinality(dayCell: Locator, expectedChipCount: number, expectedToggleText: string): Promise<void> {
  // Beat 0 — exact cardinality FIRST. Without this, the "for every chip" loop below would
  // pass VACUOUSLY if zero chips rendered — which, under this mock-based harness, is also how
  // a getItems/getOccurrences path-collision defect (plan §3.4.3(a)) would manifest: a
  // silently empty grid.
  const chips = dayCell.locator('[data-cal-id^="c-12-"]');
  await expect(chips).toHaveCount(expectedChipCount);
  const toggle = dayCell.locator('[data-cal-id="t-12"]');
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveText(expectedToggleText);
}

async function assertNoUnintendedWrap(toggle: Locator): Promise<void> {
  // Height-only check, deliberately. As of the 2026-09-19 wrap fix the toggle DOES carry
  // `overflow-hidden text-ellipsis whitespace-nowrap` (CalendarView.tsx:270) — an earlier version
  // of this comment said it had none, which was true when this spec was written and is now false.
  //
  // Note what this therefore does NOT prove: it measures box height, so a `whitespace-nowrap`-only
  // implementation passes it while the text paints over the neighbouring day cell (`w-full` keeps
  // the *box* inside). The only guard for the other two classes is CalendarView.test.tsx test 9's
  // complete-class-string `toBe`. See docs/plans/calendar-toggle-wrap-fix.md §5.
  const box = await toggle.boundingBox();
  const lineHeightRaw = await toggle.evaluate((el) => getComputedStyle(el).lineHeight);
  const lineHeight = parseFloat(lineHeightRaw);

  if (!box) {
    throw new Error("assertNoUnintendedWrap: toggle has no bounding box");
  }
  if (Number.isNaN(lineHeight)) {
    throw new Error(`assertNoUnintendedWrap: computed line-height did not parse to a number ("${lineHeightRaw}")`);
  }

  const oneLineCeiling = lineHeight * 1.6;
  if (box.height >= oneLineCeiling) {
    throw new Error(
      `assertNoUnintendedWrap: toggle box.height=${box.height.toFixed(1)}px >= 1.6x line-height ` +
        `(${oneLineCeiling.toFixed(1)}px, line-height="${lineHeightRaw}") — the toggle wrapped to more than one line`
    );
  }
}

async function assertChipsEllipsized(chips: Locator, count: number): Promise<void> {
  // Chips ARE deliberately ellipsized (overflow-hidden text-ellipsis whitespace-nowrap,
  // CalendarView.tsx), so `scrollWidth > clientWidth` is EXPECTED here and must NOT be
  // asserted against. Instead assert the containment above is achieved by clipping, not by
  // silently spilling.
  for (let i = 0; i < count; i++) {
    const chip = chips.nth(i);
    const style = await chip.evaluate((el) => {
      const computed = getComputedStyle(el);
      return { overflow: computed.overflow, whiteSpace: computed.whiteSpace };
    });
    expect(style.overflow, `chip ${i} computed overflow`).toBe("hidden");
    expect(style.whiteSpace, `chip ${i} computed whiteSpace`).toBe("nowrap");
  }
}

async function runDensityBeats(page: Page, expectedChipCount: number, expectedToggleText: string): Promise<void> {
  // Day cell reached as the chip's parent (chip.locator("xpath="..")) — no app-code change:
  // chips already carry data-cal-id, and this spec always mocks occurrences onto the day it
  // inspects (plan §4.3). Breaks as a loud failure if the day cell's DOM ever nests further,
  // never as a false pass.
  const dayCell = page.locator('[data-cal-id="c-12-0"]').locator("xpath=..");

  await assertCardinality(dayCell, expectedChipCount, expectedToggleText);

  const chips = dayCell.locator('[data-cal-id^="c-12-"]');

  // Beat 1 — containment: every chip's box sits inside the day cell's box (1px tolerance).
  for (let i = 0; i < expectedChipCount; i++) {
    await expectContainedIn(chips.nth(i), dayCell, `day-12 chip ${i}`);
  }

  // Beat 2 — no unintended wrap (the toggle).
  const toggle = dayCell.locator('[data-cal-id="t-12"]');
  await assertNoUnintendedWrap(toggle);

  // Beat 3 — ellipsis contract for chips.
  await assertChipsEllipsized(chips, expectedChipCount);
}

async function runOneViewport(page: Page, navigateToCalendar: () => Promise<void>): Promise<void> {
  await navigateToCalendar();
  await waitForCalendarSettled(page);

  await test.step("collapsed: exactly 3 chips + '+2 more'", async () => {
    await runDensityBeats(page, 3, "+2 more");
  });

  await test.step("expand and re-check, plus: the expanded day cell does not spill out of the Card", async () => {
    await page.locator('[data-cal-id="t-12"]').click();
    await runDensityBeats(page, 5, "Show less");

    // Beat 4 — expansion does not spill: the day cell's own box stays inside the grid Card
    // (the day cell's parent).
    const dayCell = page.locator('[data-cal-id="c-12-0"]').locator("xpath=..");
    const card = dayCell.locator("xpath=..");
    await expectContainedIn(dayCell, card, "expanded day-12 cell inside the Card");
  });
}

test.describe("calendar density / wrapping (E2)", () => {
  test.describe("desktop (1280x800)", () => {
    test("collapsed and expanded day cell stay contained, un-wrapped, and ellipsized", async ({ page }) => {
      const list = buildList();
      await installApiMocks(page, { list, user: buildUser(), occurrences: densityFixtureOccurrences(list.id) });
      await page.goto("/");

      await runOneViewport(page, async () => {
        await page.getByRole("button", { name: "Calendar" }).click();
      });
    });
  });

  test.describe("mobile (390x844)", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    // ESCAPE HATCH (plan §3.2 E2) — read before "fixing" a failure here. The "+N more" toggle
    // at mobile width has roughly 34px of content box for the eight-character string
    // "+2 more" at text-[10px], and no QA pass has ever measured its line count at this
    // width. If beat 2 (assertNoUnintendedWrap) fails here on unmodified `main`: FILE IT AS A
    // DEFECT AND STOP. Do not weaken the assertion above, and do not edit
    // CalendarView.tsx — §2 of the plan forbids application-code changes on this branch, and
    // a real rendering defect found by the first run of a suite built to find rendering
    // defects is a success, not a blocker.
    test("collapsed and expanded day cell stay contained, un-wrapped, and ellipsized", async ({ page }) => {
      const list = buildList();
      await installApiMocks(page, { list, user: buildUser(), occurrences: densityFixtureOccurrences(list.id) });
      await page.goto("/");

      await runOneViewport(page, async () => {
        // Below 768px the desktop nav is hidden and the visible control is the bottom tab,
        // with a DELIBERATELY different accessible name (App.tsx:247-253) so there is no
        // ambiguous match against the desktop button used above.
        await page.getByRole("button", { name: "Calendar (bottom tab)" }).click();
      });
    });
  });
});
