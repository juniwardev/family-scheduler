# Impl notes: `server-can-write` (v4, APPROVE)

Plan: `docs/plans/server-can-write.md`
Review: `docs/reviews/server-can-write-review.md` (4 rounds, verdict `APPROVE`)
Base commit: `134ad63` (main, clean tree at start — "docs(plan): can_write WONTFIX + parity test,
APPROVE after 4 rounds")

This branch is unusual: it **closes** a backlog item without building it, and adds one test.
There is no production code change. Followed plan §7 steps 1-9.

## Files changed

### Modified

- `docs/backlog.md` — the `can_write` entry at `:167` rewritten to a `❌ WONTFIX` record, using
  the verbatim replacement text from plan §7 step 2. Pasted as **one continuous line** (the
  file's own convention — every bullet in `docs/backlog.md` is a single physical line, however
  long; confirmed by `awk 'NR==167{print length($0)}'` returning 803 on the pre-edit line), not
  as the multi-line blockquote the plan's Markdown source shows for readability. Verified: `grep
  -n "Server-supplied" docs/backlog.md` returns exactly one line starting `- **❌ WONTFIX` (D1);
  0 stray `>` characters in the pasted body (`grep -c '>'` → 0); 10 balanced `**...**` bold pairs
  (20 `**` tokens, all paired); no orphaned or duplicated clause (D11, manual re-read of the
  whole entry as a unit, not as a diff — the failure mode round 3's review caught).

### New

- `tests/unit/authz-rule-parity.test.ts` — the approved parity test (Appendix B, plan §7 steps
  5-7). Lives in the **worker** vitest project (`vitest.workspace.ts:27`'s
  `tests/**/*.test.ts` glob). Imports the real server rule from `src/worker/db.ts`
  (`canWriteList`, aliased `serverCanWriteList`) and the client mirror from
  `web/src/lib/permissions.ts` (`canWriteList`, aliased `clientCanWriteList`) — both exports
  share a name, aliased per plan §7 step 5. 7 `it()` blocks:
  1. reachable: shared list, owner → both `true`
  2. reachable: shared list, non-owner → both `true`
  3. reachable: private list, owner → both `true`
  4. **both `false`**: private list owned by someone else, queried through `canWriteList`
     directly (unreachable via `getVisibleLists`)
  5. **both `false`**: missing list id — server `canWriteList(db, email, "no-such-id")` vs
     client `canWriteList(undefined, user)`
  6. **known, intended divergence**: mixed-case `owner_email` (raw `INSERT`, since `createList`
     always lowercases) — server `false`, client `true`, with a comment citing
     `permissions.ts:8-13`
  7. invariant: `createList` always stores `owner_email` lowercased (the fact that justifies
     restricting rows 1-3/4-5's parity claim to the reachable, lowercase domain)

  Schema: hand-copied `CREATE TABLE IF NOT EXISTS lists (...)` DDL only (no `users`/`items`
  tables — this file touches neither), following the precedent named in the plan,
  `tests/unit/list-isolation-http.test.ts:70-87`. No `REFERENCES users(email)` on `owner_email`,
  matching that precedent (SQLite FK enforcement is off by default; `db.test.ts`'s
  `applyMigrations` comment says so explicitly).

### New

- `docs/plans/server-can-write-impl-notes.md` — this file.

**Not touched, as the plan requires:** anything under `src/`, `web/src/`, `e2e/`, or
`migrations/`. In particular `web/src/lib/permissions.ts` is byte-identical to `main`
(`git diff --exit-code -- web/src/lib/permissions.ts` exits 0) — the two tempting adjacent
refactors §6.4 dangles (de-duplicating `canReadList`/`canWriteList` in `db.ts`; the
`permissions.ts:10` comment's off-by-one citation nit) were **not** taken.

## Commands to run the feature locally

There is no runtime feature — this is test-only. To run the new test:

```
npm test -- tests/unit/authz-rule-parity.test.ts
```

Or as part of the full suite:

```
npm test
```

## Verification output

### `npm run typecheck` — clean (three projects: worker, web, e2e)

```
> tsc --noEmit -p tsconfig.worker.json && tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.e2e.json
```
No output, exit 0. This is also the first file under `tests/` to import from `web/` — verified
per plan §7 step 5's instruction *before* writing the matrix, with a standalone scratch file
(`tests/unit/zzz-scratch-import-check.test.ts`, removed after confirming). The cross-project
import compiled and ran cleanly on the first attempt; **the named fallback (copying the client
rule inline with a source-of-truth comment) was not needed.**

### `npm run lint` — 0 errors, 2 warnings (unchanged baseline)

```
src/worker/channels/push.ts
  150:3  warning  Unused eslint-disable directive (no problems were reported from '@typescript-eslint/no-explicit-any')
web/src/components/ItemListView.tsx
  74:6  warning  React Hook useEffect has a missing dependency: 'onItemsChange' (...)

✖ 2 problems (0 errors, 2 warnings)
```
Same two pre-existing warnings named in `docs/backlog.md`'s "Lint follow-ups" entry; nothing new.
Note: `npm run lint`'s script (`eslint src web/src e2e playwright.config.ts`) does not include
`tests/`, so the new file has no lint coverage — consistent with every other file under
`tests/unit/`.

### `npm test` — baseline measured first, then after

**Baseline, measured on the base commit before any edit** (per plan §7 step 8's "measure, don't
quote"):
```
 Test Files  34 passed (34)
      Tests  300 passed (300)
```
Matches the plan's dated datum (300/34 as of 2026-09-19) exactly.

**After this branch:**
```
 Test Files  35 passed (35)
      Tests  307 passed (307)
```
34 → 35 files (+1, the new file). 300 → 307 tests (+7, exactly the 7 `it()` blocks written).
Every pre-existing test file still passes unmodified — no existing test was touched.

### `npm run build` — succeeds

```
../dist/assets/manifest-CiWbszge.webmanifest    0.60 kB
../dist/index.html                              0.92 kB │ gzip:   0.43 kB
../dist/assets/main-DKOuuaMu.css               28.43 kB │ gzip:   6.31 kB
../dist/sw.js                                   0.91 kB │ gzip:   0.51 kB
../dist/assets/main-BWqqjhAR.js               321.58 kB │ gzip: 101.88 kB
✓ built in 855ms
```

### `npm run test:e2e` — **not run**

No `web/src/**` file changed on this branch (`git diff --stat -- web/src` / `git status --short
-- web/src` both empty), so per `CLAUDE.md:54-59` and plan §7 step 9, `test:e2e` is not part of
this gate. Stating so explicitly, as the plan requires.

### Falsification (the sabotage proof, plan-required)

Temporarily hardcoded the `client` side of the two both-`false` rows (row 4: private list owned
by someone else; row 5: missing list) to `const client = true;` — simulating an over-permissive
client implementation both sides would otherwise agree on. Ran just the new file:

```
 ❯ |worker| tests/unit/authz-rule-parity.test.ts  (7 tests | 2 failed) 30ms
   × ... unreachable-through-the-API, both false: private list owned by someone else, queried directly via canWriteList
     → expected true to be false // Object.is equality
   × ... unreachable-through-the-API, both false: missing list — the one branch where the two signatures genuinely differ
     → expected true to be false // Object.is equality

 Test Files  1 failed (1)
      Tests  2 failed | 5 passed (7)
```

Both both-`false` rows went red, confirming the matrix is not vacuous (it would NOT pass on an
implementation that hardcodes `true`). Restored the file exactly afterward — confirmed via
`diff` against a pre-sabotage backup copy (`diff` exit 0, "no diff"). Re-ran the full suite after
restoring: back to 35 files / 307 tests passed, matching the "after" numbers above.

## Deviations from the plan / points requiring interpretation

1. **Diff-scope check used the working tree, not `git diff --stat main...HEAD`.** Plan D2 was
   written assuming the Coder would commit onto a branch. Per this task's explicit instruction
   ("Do not commit. Leave the working tree dirty for review."), there is no new commit — HEAD
   *is* `main`. I instead confirmed scope via `git status --short` (modified: `docs/backlog.md`;
   untracked: `tests/unit/authz-rule-parity.test.ts`) plus `git diff --exit-code -- web/src
   src migrations` returning clean. Same property D2 checks (exactly the expected paths, nothing
   under `src/`/`web/src/`), different mechanism because there is no commit to diff against.
   `docs/plans/server-can-write.md` itself does not appear in my diff because it was already
   committed on `main` at the base commit (by a prior session) — so my working-tree diff is two
   paths, not three, and that is the correct set for an uncommitted change on top of that base.
2. **No other deviations.** The test matrix, schema, seeding strategy, and backlog replacement
   text all follow the plan's step 5-7 instructions and the verbatim §7 step 2 template as
   written; nothing needed reinterpretation beyond the diff-base point above.

## What the plan got wrong, or where it needed a call

- Nothing. The plan (v4, post 4 review rounds) was internally consistent and the one
  `[provisional]` premise it flagged (the cross-project `tests/` → `web/` import) verified
  cleanly on the first attempt, so the named fallback was not exercised. Flagging that the
  fallback path itself is therefore **untested** by this branch — if a future edit to
  `tsconfig.worker.json` or to `web/src/types.ts` ever breaks that import, the fallback's shape
  (copy the rule inline with a source-of-truth comment) is documented in the plan but not
  rehearsed here.

## Out-of-scope observations

- `docs/backlog.md:122` (per round-1 review's NIT, not re-verified by me) is reported to list
  `can_write` among "the remaining four" parked items in a paragraph outside the entry this
  branch touches, and that paragraph is already stale on `main` independent of this branch. Not
  fixed here — out of scope, not part of the plan's step 2 instruction, and the plan itself
  logged this as a pre-existing NIT rather than a required change.
- `web/src/lib/permissions.ts:10`'s citation ("db.ts:341 binds `norm`") is slightly off —
  `:341` *computes* `norm`, `:351` *binds* it (noted in the plan's §6.4, not scheduled there
  either). Left untouched per the explicit "do not take either bait" instruction for this branch.

## State of the working tree

Left dirty, as instructed. `git status --short`:

```
 M docs/backlog.md
?? docs/plans/server-can-write-impl-notes.md
?? tests/unit/authz-rule-parity.test.ts
```

`git diff --stat -- src web/src e2e migrations` is empty — no production code, no e2e file, no
migration touched, as required. No commit was made.
