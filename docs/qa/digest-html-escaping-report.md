# QA Report — Daily-Digest HTML Escaping (`fix/digest-html-escaping`)

## Summary verdict: PASS

Narrow, worker-side fix. All done-conditions are satisfied with direct evidence; no defects found. No live browser smoke was performed (`docs/dev-fixtures.md` is absent from this repo and the change has no frontend surface) — this is explicitly acceptable per the task scope, and is called out as deferred below, not fabricated.

## Done-conditions table

| Condition | Result | Evidence |
|---|---|---|
| `npm test` green, expected count | PASS — 139/139 (18 test files) | See "Test run" below. `tests/unit/digest-content.test.ts` alone: 7/7 (5 baseline timezone-rendering cases + 2 new escaping cases). |
| `npm run typecheck` clean | PASS | `tsc --noEmit -p tsconfig.worker.json && tsc --noEmit -p tsconfig.web.json` — no output, exit clean. |
| Escaping wired into real send path (not just pure fn) | CONFIRMED | `sendDailyDigest` (src/worker/reminders/send.ts:214-290) builds `entries: DigestEntry[]` from live DB reads (`getVisibleLists`, `getItems`, `expandOccurrences`), then at line 277 calls `composeDigestBody(entries)` and passes the resulting `html`/`text` directly to `sendEmail({ to: user.email, subject, html, text }, env)` at line 279. No alternate/parallel body-construction path exists. The unit-tested `composeDigestBody` is the exact function used to build the emailed HTML. |
| HTML row uses `escapeHtml(e.title)` / `escapeHtml(e.listName)` | CONFIRMED | send.ts:189 — `` `<li><strong>${escapeHtml(e.title)}</strong> &mdash; ${escapeHtml(e.listName)} &mdash; ${dateStr}</li>` ``. `escapeHtml` imported from `./content` (send.ts:23). |
| `escapeHtml` escapes `& < > " '` | CONFIRMED | content.ts:41-48 — chained `.replace` for `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, `"`→`&quot;`, `'`→`&#39;` (order is correct: `&` first, avoiding double-escaping). |
| Plain-text body NOT escaped (raw title/listName) | CONFIRMED | send.ts:193-200 — text branch interpolates `e.title` / `e.listName` directly, no `escapeHtml` call. Test "does NOT HTML-escape the plain-text body" asserts `Tom & Jerry` and `A<B` survive literally and `&amp;`/`&lt;` are absent from text. Passes. |
| Diff scope — only intended files changed | CONFIRMED | `git diff --stat main...HEAD` → exactly `src/worker/reminders/send.ts` (+6/-6) and `tests/unit/digest-content.test.ts` (+24). `push.ts` diff is empty (untouched). |
| Build succeeds | PASS | `npm run build` (vite) — succeeded, 39 modules transformed, output written to `../dist`. |
| App-loads smoke | DEFERRED (see below) | No live browser navigation performed. |

## Test run (exact output)

```
✓ |worker| tests/unit/digest-content.test.ts  (7 tests) 82ms
...
 Test Files  18 passed (18)
      Tests  139 passed (139)
```

The 7 tests in `digest-content.test.ts`:
1. renders a timed occurrence in the item's stored timezone, not UTC
2. renders different timezones differently for the same instant
3. renders an all-day entry as a date without a time-of-day
4. still lists the title and list name
5. returns the empty-window fallback when there are no entries
6. **escapes HTML-special characters in title/listName in the HTML body** (new) — asserts `<script>` does not survive raw, `&lt;script&gt;`, `Tom &amp;`, `&quot;Jerry&quot;` all present
7. **does NOT HTML-escape the plain-text body** (new) — asserts `Tom & Jerry` and `A<B` survive literally in text, and `&amp;`/`&lt;` are absent from text

Both new cases pass. 137 baseline + 2 new = 139, matching the expected count exactly.

## Diff scope confirmation

```
git diff --stat main...HEAD
 src/worker/reminders/send.ts      | 12 ++++++------
 tests/unit/digest-content.test.ts | 24 ++++++++++++++++++++++++
 2 files changed, 30 insertions(+), 6 deletions(-)
```

`src/worker/reminders/push.ts` — empty diff, confirmed untouched.

The `send.ts` diff itself is minimal and surgical:
- one import added (`escapeHtml` from `./content`)
- doc-comment above `composeDigestBody` updated to describe escaping instead of flagging it as a known pre-existing gap
- the HTML row template literal wraps `e.title` / `e.listName` in `escapeHtml(...)`
- the plain-text row template literal is unchanged (still raw interpolation)

No changes to `sendDue`, `sendDailyDigest`'s DB-read/window logic, push-channel handling, or any other function.

## Issues found

None. No defects identified in the escaping logic, its wiring, or the plain-text non-escaping behavior.

## Console errors / warnings

Not applicable — no browser session was run (worker-only unit-test change; see "Deferred" below). Test-runner console output was limited to expected Miniflare compatibility-date warnings and dev-auth-shim debug logs unrelated to this change (pre-existing, seen on `tests/unit/dev-auth-shim.test.ts`).

## Network failures

Not applicable — no browser/network exercise performed for this pass. `sendEmail`'s external Resend call was not exercised live (correctly gated behind DevOps/creds per the module's own doc-comment: "External send (Resend) is the only boundary that is DevOps-gated").

## Accessibility observations

Not applicable — no UI change in this diff, no browser session run.

## Performance notes

None applicable. `escapeHtml` is a small, already-existing pure string-replace utility reused as-is (no new implementation); its cost is negligible for the small number of entries per daily digest.

## Deferred

- **Live-inbox / real HTML rendering of an injected title in an actual email client.** Not attempted — would require live `RESEND_API_KEY` + verified sending domain, which the module's own doc-comment marks as DevOps-gated, out of scope for this pass, and explicitly optional per the QA brief. Folds into the existing daily-digest cron watch already tracked in project memory (`prod-verification-todos.md` — "daily-digest cron" pending item).
- **Local `wrangler dev --test-scheduled` trigger of the digest cron with a seeded `<script>`-titled item.** Not attempted — would require local D1 seed data plus Resend credentials or a mock boundary; the unit test plus the direct code-read confirmation of `sendDailyDigest` → `composeDigestBody` → `sendEmail` wiring (see table above) is treated as sufficient evidence per the QA brief's explicit "if not quick, skip it and rely on the unit test + code-read wiring confirmation" guidance.
- **Browser smoke of the frontend PWA.** `docs/dev-fixtures.md` does not exist in this repo, and this change has zero frontend/web/src surface (confirmed via diff scope — only `src/worker/reminders/send.ts` and its test changed). Relying on: (a) successful `npm run build`, and (b) the pre-existing/passing `web/src/**` component test suite (unaffected, part of the 139 total) as the acceptable evidence explicitly sanctioned by the QA brief for this narrow worker-side change.
- **Repo-level `npm run lint` is currently broken** (ESLint 9.39.4 cannot find `eslint.config.js` — the repo still has an unmigrated legacy config setup). This is a pre-existing environment issue unrelated to this diff (confirmed the two changed files are not implicated), not introduced by this change, and outside the explicit done-conditions checklist for this pass (which specifies `npm test` + `npm run typecheck` only). Flagging for visibility, not blocking this verdict.
