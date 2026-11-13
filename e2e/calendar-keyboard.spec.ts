// e2e/calendar-keyboard.spec.ts — E1, the flagship spec; carries most of this suite's value.
// Covers defect classes 1 and 3 (docs/plans/playwright-bootstrap.md §1.2): roving-tabindex
// focus, `:focus-visible` matching under a PROGRAMMATIC focus() call, ring rendering in light
// AND dark, real Enter/Space activation, and focus restore after modal close.
//
// HARD INVARIANT — read before touching this file, and before "simplifying" anything in it.
// Focus in every beat below is established ONLY by real key presses
// (page.keyboard.press("Tab" | "ArrowDown" | ...)). It must NEVER be established by
// `locator.focus()` or `element.focus()` from this file. A JS-triggered focus does not
// reliably set `:focus-visible` in Chromium — an early attempt at testing this exact behavior
// used `element.focus()`, "showed no ring at all," and had to be redone with genuine `Tab` key
// presses to be a valid test (docs/qa/calendar-show-more-report.md:46-52). Chromium's
// focus-visible heuristic keys on "was the most recent user interaction a keyboard
// interaction" — NOT "was this focus() call programmatic" — so a `.focus()` substitution here
// can still pass beat 3 if a real Tab occurred earlier in the same test (beat 2's Tab does),
// silently turning this entire spec into a tautology that passes on a completely unstyled app.
// This is enforced mechanically by the `no-restricted-syntax` ESLint rule scoped to
// `e2e/**/*.spec.ts` (see eslint.config.js) — do not weaken, disable, or route around it.
import { test, expect, type Page } from "@playwright/test";
import { buildList, buildUser, installApiMocks, keyboardFixtureOccurrences } from "./fixtures/api-mocks";
import { expectFocusRing } from "./fixtures/assertions";

const MAX_TAB_PRESSES = 40;

async function waitForCalendarSettled(page: Page): Promise<void> {
  await page.getByText("Loading…").waitFor({ state: "hidden" });
}

async function focusedCalId(page: Page): Promise<string | null> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.calId ?? null);
}

async function isFocusVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el !== null && el.matches(":focus-visible");
  });
}

test.describe("calendar keyboard navigation, focus rings, and activation (E1)", () => {
  test("roving tabindex, :focus-visible under programmatic focus, ring rendering, and real Enter/Space activation", async ({
    page,
  }, testInfo) => {
    const list = buildList();
    const occurrences = keyboardFixtureOccurrences(list.id);
    await installApiMocks(page, { list, user: buildUser(), occurrences });

    await page.goto("/");

    await test.step("beat 1: reach the Calendar view and let it settle", async () => {
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
      // Reaching the Calendar view — there is no route for it (activeView is React state,
      // App.tsx). At the pinned 1280x800 viewport this is the desktop sidebar Button, whose
      // accessible name is "Calendar"; below 768px it would be the bottom tab's
      // "Calendar (bottom tab)" button instead (App.tsx:247-253's deliberately different
      // accessible names) — this spec only runs at the default desktop viewport.
      await page.getByRole("button", { name: "Calendar" }).click();
      await waitForCalendarSettled(page);
      await expect(page.locator('[data-cal-id="c-5-0"]')).toBeVisible();

      // Reset focus to a neutral "page start" via a REAL mouse click on non-interactive
      // content (never via .focus() — see the HARD INVARIANT above) so beat 2's Tab walk
      // starts from a deterministic point rather than wherever the navigation click left
      // focus.
      await page.getByRole("heading", { level: 2 }).click();
    });

    await test.step("beat 2: exactly one tab stop enters the grid", async () => {
      let foundMonthNext = false;
      for (let i = 0; i < MAX_TAB_PRESSES; i++) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return {
            tag: el?.tagName ?? null,
            text: el?.textContent?.trim() ?? null,
            isMonthNext: el?.tagName === "BUTTON" && el.textContent?.trim() === "›",
          };
        });
        if (info.isMonthNext) {
          foundMonthNext = true;
          break;
        }
        if (i === MAX_TAB_PRESSES - 1) {
          throw new Error(
            `beat 2: did not reach the month "›" control within ${MAX_TAB_PRESSES} Tab presses. ` +
              `Last focused element: <${info.tag}> "${info.text}"`
          );
        }
      }
      expect(foundMonthNext).toBe(true);

      // One more Tab: the roving tabindex's single entry point into the grid.
      await page.keyboard.press("Tab");
      const tabStops = page.locator('[data-cal-id][tabindex="0"]');
      await expect(tabStops).toHaveCount(1);
      const stopId = await tabStops.first().getAttribute("data-cal-id");
      expect(await focusedCalId(page)).toBe(stopId);
      // Deterministic given this spec's fixture (day 5 is the first populated day, and no
      // roving id has been remembered yet — calendarFocus.ts's resolveRovingId falls back to
      // firstIdOverall).
      expect(stopId).toBe("c-5-0");
    });

    await test.step("beat 3: ArrowDown moves focus, and the R2 assertion holds", async () => {
      await page.keyboard.press("ArrowDown");
      // c-5-0 (day 5, one element) -> day 5 + 7 = day 12, first element there.
      expect(await focusedCalId(page)).toBe("c-12-0");
      expect(await isFocusVisible(page)).toBe(true);
    });

    await test.step("beats 4-6: the ring actually renders, with the correct offset and ring colours", async () => {
      await expectFocusRing(page.locator('[data-cal-id="c-12-0"]'), testInfo, "chip-c-12-0");
    });

    await test.step("beat 7: Shift+Tab to the month '›' Button — the one real regression guard in this spec", async () => {
      // Focus on "›" is established by the Shift+Tab itself, not by ArrowDown:
      // handleGridKeyDown is bound to the Card, and "›" sits outside it, so arrow keys do
      // nothing there. This guards button.tsx's shared focus-ring base class through this ONE
      // call site — ui/sheet.tsx, ui/dialog.tsx, ui/select.tsx, and ui/tabs.tsx (also
      // retrofitted alongside it, docs/backlog.md:167) remain unguarded by this spec.
      await page.keyboard.press("Shift+Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return { tag: el?.tagName ?? null, text: el?.textContent?.trim() ?? null };
      });
      expect(info.tag).toBe("BUTTON");
      expect(info.text).toBe("›");
      expect(await isFocusVisible(page)).toBe(true);

      const monthNextButton = page.getByRole("button", { name: "›" });
      await expectFocusRing(monthNextButton, testInfo, "month-next-button");

      // Back into the grid for the remaining beats — the roving tabindex still remembers
      // c-12-0 (Shift+Tab away does not fire the Card's onFocus handler), so Tab returns
      // there.
      await page.keyboard.press("Tab");
      expect(await focusedCalId(page)).toBe("c-12-0");
    });

    await test.step("beat 8: real Enter and real Space activate chips (a role-mimicking div cannot fake this)", async () => {
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "E1" })).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      expect(await focusedCalId(page)).toBe("c-12-0");

      // Arrow to the sibling chip (day 12, index 1 — "E2").
      await page.keyboard.press("ArrowDown");
      expect(await focusedCalId(page)).toBe("c-12-1");

      await page.keyboard.press(" ");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "E2" })).toBeVisible();
    });

    await test.step("beat 9: focus restore + ring after restore", async () => {
      const dialog = page.getByRole("dialog");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      // ItemModal.tsx's handleCloseAutoFocus restores focus to the triggering chip by hand
      // (Radix does not auto-restore for a programmatically-opened Dialog with no
      // DialogTrigger — project memory radix-focus-restore-needs-explicit-handling).
      expect(await focusedCalId(page)).toBe("c-12-1");
      expect(await isFocusVisible(page)).toBe(true);
    });
  });
});
