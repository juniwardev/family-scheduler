// e2e/fixtures/assertions.ts — containment + focus-ring helpers with informative failures
// (plan §3.6). Geometry and computed-style assertions must never fail as bare numbers
// ("Expected: <= 412.5 / Received: 431" is unactionable) — every throw below carries full
// context: both boxes, the offending edge(s), the overflow in px, and (for the ring) the raw
// computed boxShadow plus an attached element screenshot.
import type { Locator, Page, TestInfo } from "@playwright/test";

const EDGE_TOLERANCE_PX = 1;

/**
 * Asserts `child`'s bounding box sits inside `parent`'s bounding box (1px tolerance on each
 * edge). Used both for "chip inside day cell" (E2 beat 1) and "day cell inside the calendar
 * Card" (E2 beat 4) — throws with both boxes, the offending edge(s), the overflow in px, and
 * the child's `data-cal-id`/text so a failure is actionable.
 */
export async function expectContainedIn(child: Locator, parent: Locator, label: string): Promise<void> {
  const childBox = await child.boundingBox();
  const parentBox = await parent.boundingBox();
  const calId = await child.getAttribute("data-cal-id");
  const text = await child.textContent();

  if (!childBox || !parentBox) {
    throw new Error(
      `expectContainedIn(${label}): could not read a bounding box — ` +
        `child=${JSON.stringify(childBox)} parent=${JSON.stringify(parentBox)} ` +
        `data-cal-id=${calId ?? "<none>"} text=${JSON.stringify(text)}`
    );
  }

  const overflows: string[] = [];
  if (childBox.y < parentBox.y - EDGE_TOLERANCE_PX) {
    overflows.push(`top overflow ${(parentBox.y - childBox.y).toFixed(1)}px`);
  }
  if (childBox.x < parentBox.x - EDGE_TOLERANCE_PX) {
    overflows.push(`left overflow ${(parentBox.x - childBox.x).toFixed(1)}px`);
  }
  const childRight = childBox.x + childBox.width;
  const parentRight = parentBox.x + parentBox.width;
  if (childRight > parentRight + EDGE_TOLERANCE_PX) {
    overflows.push(`right overflow ${(childRight - parentRight).toFixed(1)}px`);
  }
  const childBottom = childBox.y + childBox.height;
  const parentBottom = parentBox.y + parentBox.height;
  if (childBottom > parentBottom + EDGE_TOLERANCE_PX) {
    overflows.push(`bottom overflow ${(childBottom - parentBottom).toFixed(1)}px`);
  }

  if (overflows.length > 0) {
    throw new Error(
      `expectContainedIn(${label}) failed: ${overflows.join(", ")}. ` +
        `child=${JSON.stringify(childBox)} parent=${JSON.stringify(parentBox)} ` +
        `data-cal-id=${calId ?? "<none>"} text=${JSON.stringify(text)}`
    );
  }
}

/**
 * Splits a computed `box-shadow` string into its comma-separated LAYERS, respecting the commas
 * inside each layer's `rgb(...)`/`rgba(...)` colour function so a layer is never split in half.
 * Returns each layer's colour substring, in layer order — index 0 is the first-declared layer
 * (Tailwind's `--tw-ring-offset-shadow`, the OFFSET shadow), index 1 the second
 * (`--tw-ring-shadow`, the RING shadow), per plan §3.2 beat 4. Never assert an exact layer
 * count: Tailwind v3 always adds a third, fully-transparent preflight layer
 * (`--tw-shadow: 0 0 #0000`), and a `shadow-soft` Button contributes a fourth (plan §0.2(a)).
 */
function splitBoxShadowLayerColors(boxShadow: string): string[] {
  if (boxShadow === "none" || boxShadow.trim() === "") return [];

  const rawLayers: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of boxShadow) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      rawLayers.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) rawLayers.push(current.trim());

  return rawLayers.map((layer) => {
    const match = layer.match(/rgba?\([^)]*\)/);
    if (!match) {
      throw new Error(
        `splitBoxShadowLayerColors: could not find a color in layer "${layer}" (raw boxShadow="${boxShadow}")`
      );
    }
    return match[0];
  });
}

/**
 * Resolves the `--ring` CSS custom property THROUGH the browser's colour engine, via a hidden
 * probe element — NOT `getComputedStyle(documentElement).getPropertyValue("--ring")`, which
 * returns the shadcn HSL *channel triplet* (e.g. "172 36% 44%"), not a colour: every token in
 * this repo is wrapped in `hsl()` by tailwind.config.ts, so no token is ever directly
 * comparable to a computed `rgb(...)` value (plan §3.2 beat 5). The probe is attached to
 * `document.body` (not `documentElement`) in normal flow (`position: absolute;
 * visibility: hidden`) and removed in a `finally`, so a throwing assertion cannot leave a stray
 * node behind for a later `[data-cal-id]` cardinality count or geometry query to trip over
 * (plan §3.6). Resolving through `document.body` also makes this scheme-agnostic — the token
 * flips automatically under `colorScheme: "dark"`, with no second expected value to maintain.
 */
async function resolveRingColor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.color = "hsl(var(--ring))";
    document.body.appendChild(probe);
    try {
      return getComputedStyle(probe).color;
    } finally {
      probe.remove();
    }
  });
}

/**
 * Asserts the focused element carries a real, correctly-coloured focus-visible ring — plan
 * §3.2 beats 3-6, the single most important assertion in this suite:
 *
 *  - `el.matches(":focus-visible")` is true (the R2 assertion — no jsdom equivalent; this is
 *    what a `.focus()` substitution in the calling spec would silently defeat, which is why
 *    that is banned by ESLint rather than merely commented against — plan §4.2a);
 *  - the computed `boxShadow` parses into >= 2 layers (never an exact count — see
 *    splitBoxShadowLayerColors above);
 *  - the OFFSET layer (index 0) equals `getComputedStyle(document.body).backgroundColor` —
 *    `ring-offset-background` resolves to `--background`, which the day cell (`bg-card`) does
 *    NOT share in either colour scheme; comparing against the day cell (or against "not white")
 *    fails on a CORRECT app (plan §0.2(b)) — never do either;
 *  - the RING layer (index 1) equals the resolved `--ring` token via the hidden-probe technique
 *    above — a complete-value assertion, not merely "not the element's own background colour"
 *    (which a `ring-border` swap would still pass).
 *
 * Never hardcodes a ring or offset WIDTH: `button.tsx` uses `ring-offset-2`, the calendar chips
 * use `ring-offset-1` (plan §3.2 beat 7). On any failure, attaches an element screenshot via
 * `testInfo.attach` so the message is never a bare number.
 */
export async function expectFocusRing(locator: Locator, testInfo: TestInfo, label: string): Promise<void> {
  const page = locator.page();

  const matchesFocusVisible = await locator.evaluate((el) => el.matches(":focus-visible"));
  const boxShadow = await locator.evaluate((el) => getComputedStyle(el).boxShadow);
  const elementBackgroundColor = await locator.evaluate((el) => getComputedStyle(el).backgroundColor);
  const expectedOffsetColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const expectedRingColor = await resolveRingColor(page);

  const layers = splitBoxShadowLayerColors(boxShadow);
  const offsetColor = layers[0] ?? null;
  const ringColor = layers[1] ?? null;

  const failures: string[] = [];
  if (!matchesFocusVisible) {
    failures.push("element does not match :focus-visible");
  }
  if (layers.length < 2) {
    failures.push(`boxShadow parsed to ${layers.length} layer(s), expected >= 2`);
  }
  if (offsetColor !== expectedOffsetColor) {
    failures.push(`offset layer colour "${offsetColor}" !== document.body background "${expectedOffsetColor}"`);
  }
  if (ringColor !== expectedRingColor) {
    failures.push(`ring layer colour "${ringColor}" !== resolved --ring token "${expectedRingColor}"`);
  }

  if (failures.length > 0) {
    await testInfo.attach(`focus-ring-failure-${label}`, {
      body: await locator.screenshot(),
      contentType: "image/png",
    });
    throw new Error(
      `expectFocusRing(${label}) failed: ${failures.join("; ")}. ` +
        `raw boxShadow="${boxShadow}" element backgroundColor="${elementBackgroundColor}"`
    );
  }
}
