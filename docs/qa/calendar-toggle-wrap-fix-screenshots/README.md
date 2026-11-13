# `+N more` wrap fix — before/after at 390px

Captured 2026-09-19 for `docs/plans/calendar-toggle-wrap-fix.md`, to satisfy its §6 done condition
that the 390px result be **recorded rather than assumed** (the e2e case bounds box height; it says
nothing about legibility).

Viewport 390×844, Chromium, against the same route-mocked fixture the e2e suite uses
(`densityFixtureOccurrences` — day 12 carries 5 occurrences, so the toggle reads `+2 more`).

| File | State |
| --- | --- |
| `before-collapsed-cell.png` / `-page.png` | defect present, collapsed |
| `before-expanded-cell.png` / `-page.png` | defect present, expanded |
| `after-collapsed-cell.png` / `-page.png` | fixed, collapsed |
| `after-expanded-cell.png` / `-page.png` | fixed, expanded |

`*-cell.png` is a tight crop of the day-12 cell (the thing to look at); `*-page.png` is the whole
viewport for context.

## Measured

| State | Text | Box height | Lines | Text truncated |
| --- | --- | ---: | ---: | --- |
| before, collapsed | `+2 more` | 30px | 2 | no |
| before, expanded | `Show less` | 30px | 2 | no |
| after, collapsed | `+2 more` | 15px | **1** | **yes** |
| after, expanded | `Show less` | 15px | **1** | **yes** |

Two things these numbers show that the defect report did not:

1. **Both states wrapped**, not just the collapsed one. `Show less` is nine characters and also did
   not fit — so the row grew whether or not the day was expanded.
2. **The fix trades wrapping for truncation.** After the fix the box is one line, but the string is
   ellipsized: `+2 more` needs 48px of content in a 42px box and renders as `+2 m…`. This is the
   accepted outcome of the plan's R1 — LTR ellipsis clips the tail, so the `+2` count (the only
   information the control carries) survives, and CSS truncation leaves the accessibility tree
   untouched, so a screen reader still announces `+2 more items — <Month> 12`.

If the truncation ever grates on a real phone, the follow-up is the shortened mobile label recorded
in `docs/backlog.md` — **not** a revert to wrapping.

## Reproducing

These were captured by a throwaway spec that was deleted after use, rather than committed. To
regenerate, add a spec under `e2e/` that sets the 390×844 viewport, calls `installApiMocks` with
`densityFixtureOccurrences`, and screenshots the locator `[data-cal-id="t-12"]`'s parent.

Two traps worth knowing, both hit while producing these:

- `button[aria-expanded]` is **not** a safe selector — the Radix "Lists" sheet trigger matches it
  first. Use `[data-cal-id="t-12"]`.
- `aria-label*="more item"` is **not** stable across the flip: on expand the accessible name
  becomes `Show less — <Month> 12`. `data-cal-id` is stable in both states; the accessible name is
  deliberately not.
