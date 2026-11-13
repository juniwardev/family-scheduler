# Plan Review: `fix-dev-stale-dist`

Reviewer: Plan-Reviewer (adversarial pass)
Plan: `docs/plans/fix-dev-stale-dist.md`
Date: 2026-07-01
Scope of change per plan: `package.json` only (scripts + one devDependency).

## Summary

The plan fixes a real papercut: `dev` = bare `wrangler dev` (`package.json:6`) serves the
prebuilt `./dist` (`wrangler.toml:5-7`), so localhost QA silently tests stale assets.
Approach B (`vite build --watch` writing `./dist` + `wrangler dev` via `concurrently -k`)
is a reasonable, well-scoped, reversible choice that preserves the production serving path
(Worker Static Assets from `dist`) and therefore preserves SW/PWA parity — a genuine
advantage over the rejected Vite-dev-server approach C. The chosen design is correct in
spirit and the risky assumption is at least named. The problems are (a) the fallback is not
first-class specified and (b) two correctness claims about startup determinism and the
"degraded-but-acceptable" middle case are overstated. None rise to REJECT for a dev-only
tooling change, but they should be folded in before implementation.

## Correctness — does it solve the stated problem?

Yes, conditional on the one load-bearing assumption the plan itself flags. If
`wrangler dev` re-reads `./dist` after a watch rebuild, edits flow through and the papercut
is gone. If it snapshots at boot, B fails and the plan routes to a fallback. That routing
is workflow-correct (Coder escalates rather than redesigns), but the fallback is thin — see
Change 1.

## Findings

### Major

**M1 — The "serves fresh on next request without reload" middle case is largely illusory
because assets are content-hashed.** The plan's risk taxonomy (plan `:151-158`) posits three
outcomes: (1) reload works, (2) no reload but fresh bytes on refresh — "still acceptable",
(3) needs a wrangler restart. But `vite.config.ts:17-21` emits `assets/[name]-[hash].js`,
so every source change produces NEW asset filenames and a rewritten `index.html` that
references them. If `wrangler dev` snapshots its asset manifest at boot (the failure mode
worth worrying about), the newly-hashed files are simply absent from the manifest and will
**404**, not serve stale — a browser refresh does not resolve it. So outcome (2) as a
stable, acceptable state is unlikely: the real world is closer to binary (watches-the-dir →
works, or snapshots → hard 404 requiring restart). This makes the empirical BLOCKER-CHECK
(plan `:188`) more important than the plan implies, and means the fallback (Change 1) must
be genuinely ready, not hypothetical. Recommend the plan re-word `:151-158` to drop the
comforting middle case and treat the check as pass/fail.

### Minor

**m2 — Fallback (approach A) is under-specified.** Plan `:156` and `:190-191` say "fall back
to approach A + a CLAUDE.md note" and "STOP and flag to plan-review," but never give the
exact approach-A `dev` script (`"dev": "vite build && wrangler dev"`) or the exact CLAUDE.md
line. Because the fallback is trivial and self-contained, spelling it out inline lets the
empirical check resolve in one pass instead of a re-plan round trip for a one-line script.
See Change 1.

**m3 — The startup "determinism" guarantee is weaker than claimed.** Plan `:92`, `:125`,
`:165-166` assert the leading one-shot `vite build` guarantees `./dist` exists before
`wrangler dev` boots. It exists at the instant `concurrently` starts — but `dev:web` =
`vite build --watch` runs its FIRST build with `emptyOutDir: true` (`vite.config.ts:10`),
which **empties `./dist` again** and then repopulates it. `concurrently` launches `dev:web`
and `dev:worker` in parallel, so `wrangler dev` actually boots racing the watch's initial
empty+rebuild, not the safely-completed leading build. In practice wrangler's multi-second
workerd boot almost always loses this race (dist is repopulated first), so it usually works
— but the guarantee is empirical timing, not the deterministic ordering the plan claims. The
plan already notices `emptyOutDir` re-empties (`:159-161`) yet frames it only as
"brief 404 windows," never connecting it to the startup boot. Recommend either (a) re-word
the determinism claim to acknowledge the reliance on wrangler boot latency, or (b) note the
alternative of not depending on it. The leading `vite build` is still worth keeping (covers
fresh-clone / `rm -rf dist`), just not for the stated reason.

**m4 — `concurrently -k` + a watch build error could tear down the session — confirm
behavior.** With `-k` (kill-others-on-fail/exit), if `vite build --watch` were to EXIT on a
syntax error during editing, wrangler would be killed too. Rollup/Vite watch mode does NOT
exit on rebuild errors (it stays open and waits for the next change), so this is expected to
be fine, but it is exactly the kind of thing to verify during the BLOCKER-CHECK since it
directly affects the edit-while-running loop QA must trust.

### Nits

**n1 — No `deploy` script exists.** The plan's non-goals reference "deploy" (plan `:25`,
`:128`); `package.json` has no `deploy` script (deploy is presumably `wrangler deploy` via
CI/manual). Not a defect — just confirm the statement "deploy path untouched" means the
`build` script + `wrangler.toml` assets config, both of which are indeed unchanged.

**n2 — Done-condition 3 wording.** Plan `:180-181` says `dist` output is "byte-for-byte the
same." What is actually guaranteed is the `build` script *text* is unchanged; byte-identical
output run-to-run is not something the change controls. Reword to "the `build` script is
unchanged, so deploy output is produced the same way."

**n3 — `server.proxy` scaffolding left in `vite.config.ts:25-28`.** The plan correctly
leaves it (approach C not chosen), but since it is now confirmed dead for the `dev` flow,
an optional one-line follow-up to remove it would reduce future confusion. Out of scope for
this fix; noting only.

## Things the plan got right (kept for the record)

- Script sequencing uses `&&` before `concurrency` (plan `:110`), so the one-shot build is
  correctly serialized ahead of the parallel block — no race between an empty dist and the
  leading build itself. (The residual race is the watch's re-empty, m3, not this.)
- Prod/deploy untouched: `build` (`package.json:7`), `preview` (`:14`), and
  `wrangler.toml` assets/production semantics are all unchanged. Confirmed.
- Scope respected: no application/Worker/auth/reminder/push code, no `db.ts`, no timestamp/
  ID/`Result`/email-identity/pending-dispatch changes — none of the CLAUDE.md hard rules are
  in the blast radius.
- `concurrently ^9` correctly placed in `devDependencies`, dev-only, not bundled into the
  Worker/`dist`; `-k -n -c` flags and the `npm:` shorthand are used correctly.
- Done-condition 2 (edit-while-running reflects) is concrete and QA-verifiable: make a
  visible source change while `dev` runs, observe it after rebuild. Good.

## Required changes (fold in before implementation)

1. Make the fallback first-class: inline the exact approach-A script
   (`"dev": "vite build && wrangler dev"`) AND the exact one-line CLAUDE.md note it requires,
   so that if the BLOCKER-CHECK fails the Coder can apply a fully-specified fallback in the
   same pass (still surfacing the branch taken to plan-review, per workflow rules).
2. Fix the risk taxonomy (plan `:151-158`): drop the "no reload but fresh bytes on refresh is
   still acceptable" middle case, because content-hashed asset filenames
   (`vite.config.ts:17-21`) mean a boot-time manifest snapshot 404s rather than serves
   stale. Treat the wrangler-dev-picks-up-`dist` check as pass/fail, and require the Coder to
   verify it empirically before committing (already step 1 — just tighten the expected
   outcomes).
3. Correct the startup-determinism claim (plan `:92`, `:125`, `:165-166`): acknowledge that
   `dev:web`'s first watch build re-empties `dist` (`emptyOutDir: true`), so absence of a
   startup 404 relies on wrangler's boot latency, not on the leading build. Keep the leading
   build (it covers fresh-clone / missing dir), but state the real reason.
4. During the BLOCKER-CHECK, also confirm a transient source syntax error during watch does
   NOT exit `vite build --watch` and thus does not trip `-k` into killing `wrangler dev`
   (protects the edit-while-running loop).

APPROVE WITH CHANGES

## Re-review (Pass 2)

Reviewer: Plan-Reviewer (adversarial second pass)
Date: 2026-07-01
Amended plan reviewed at commit-of-record `docs/plans/fix-dev-stale-dist.md` (Amended
2026-07-01, §13 amendment log). This pass verifies only the changed material against Pass 1's
four required changes plus the five re-review checks, and independently verifies the one new
load-bearing technical claim (`--emptyOutDir false`) against the pinned Vite in
`node_modules`.

### Disposition of Pass 1 required changes

- **Change 1 (fallback first-class)** — RESOLVED. §7 now fully specifies Approach A: exact
  script `"dev": "vite build && wrangler dev"` (plan `:214`) and the verbatim REQUIRED
  CLAUDE.md note (`:225-229`), placed under `## Commands` → `### Dev server`. §7 explicitly
  states no `concurrently` devDep is added on the A branch (`:217-218`). No re-plan round trip
  is needed on a Step 0 FAIL.
- **Change 2 (pass/fail taxonomy)** — RESOLVED. The illusory "fresh bytes on refresh" middle
  case is gone. §4 Step 0 (`:59-92`) and M1 (`:239-245`) now frame the check as strictly
  binary PASS/FAIL, with M1 explicitly stating "There is no stable 'no reload but fresh bytes
  on refresh' middle state."
- **Change 3 (startup-determinism claim)** — RESOLVED. §6b (`:146-170`) now names the
  `emptyOutDir: true` watch re-empty race, applies the `--emptyOutDir false` mitigation, and
  explicitly disclaims deterministic ordering (`:169-170`: "Do NOT claim deterministic
  ordering..."). The leading build's real purpose (fresh-clone / missing-dir guard) is stated
  (`:168`).
- **Change 4 (`-k` teardown under watch error)** — RESOLVED. §6d (`:183-195`) adds an explicit
  bring-up confirmation: introduce a transient TS/JSX error, confirm the session stays up, and
  documents a resilient variant (drop `-k`) if the watch unexpectedly exits.

All four Pass 1 required changes are folded in.

### Re-review checks

1. **Step 0 is a genuine, unambiguous decision gate — PASS.** §4 (`:67-99`) specifies a
   concrete procedure: build once, start `wrangler dev`, edit a `web/src` file, `npm run
   build` again (regenerating `index.html` to a new hash and removing the old file), then
   reload WITHOUT restart. PASS requires the served `index.html` to reference the NEW hash AND
   that new bundle to return 200; FAIL is old-hash-served OR new-bundle-404. This precisely
   discriminates the boot-time manifest-snapshot failure mode (`:79-81`), because a snapshot
   means the new hashed file is absent → hard 404, exactly the observable the gate keys on.
   The A-vs-B decision rule (`:83-89`) is crisp and 1:1 with PASS/FAIL. The mermaid gate
   (`:94-99`) matches the prose.

2. **Both approaches executable as written — PASS.** B: §6a (`:130-144`) gives complete
   `dev` / `dev:web` / `dev:worker` scripts; `concurrently` `^9.1.0` is added as a devDep in
   §6c (`:176-177`) and wired via `npm:` shorthand with `-k -n -c` used correctly. A: §7a
   (`:213-215`) gives the exact one-line `dev`, and §7b (`:220-229`) gives the verbatim note
   marked REQUIRED (not optional), which is the load-bearing compensating control for A's
   remaining manual step. No half-specified path remains on either branch.

3. **`--emptyOutDir false` mitigation is sound — PASS (independently verified).** I traced the
   exact token through the bundled cac/mri parser in the pinned Vite (`vite@6.4.3`, satisfies
   the `^6.0.3` devDep):
   - `--emptyOutDir` is registered as a bare boolean option
     (`node_modules/vite/dist/node/cli.js:841-842`, no `<value>`/`[value]` placeholder → the
     `Option` constructor at `:299` sets `isBoolean`), so it is added to `opts.boolean`.
   - The `build` command is `build [root]` (`:825`), so a stray `false` could in principle be
     captured as the positional `root`. It is NOT: in `mri2`, for `--emptyOutDir` with no `=`,
     line `:140` (`val = arg.substring(++idx) || (... || args[++i])`) CONSUMES the following
     `false` token as the option's value (advancing `i`), so it never reaches `out._`
     (positionals). `root` stays undefined.
   - `toVal` (`:55-63`) then maps a boolean-keyed `'false'` string to boolean `false`
     (`:59`, `val === 'false' ? false`), so `build.emptyOutDir` is set to `false` and
     overrides `vite.config.ts:10`'s `emptyOutDir: true`.
   Conclusion: `vite build --watch --emptyOutDir false` is a real, honored flag on this pinned
   Vite, it does NOT mis-parse `false` as the build root, and it does prevent the watch from
   wiping `./dist`. The plan's belt-and-suspenders hedge (§6b `:162-170`: verify during
   bring-up; self-heal under B's Step 0 PASS precondition if a future Vite ever ignores it) is
   correct and honestly bounded — it is extra safety, not a crutch for a broken flag. The plan
   is also honest that this only matters on the B path (chosen only after Step 0 PASS). One
   observation, not a required change: `--no-emptyOutDir` is the more conventional cac negation
   form (handled at `:128-133`) and would be equally correct; the plan's chosen `--emptyOutDir
   false` is fine as verified. No change required.

4. **Scope / prod untouched — PASS.** §9 (`:258-263`) confines B to `package.json` (scripts +
   `concurrently` devDep) and A to `package.json` (one `dev` line) + `CLAUDE.md` note. `build`
   (`package.json:7`), `preview` (`:14`), and `wrangler.toml` `[assets]` (`:5-7`) are all
   unchanged; no app/Worker/auth/push/`db.ts` code is touched — none of the CLAUDE.md hard
   rules are in the blast radius. Nits n1 (no `deploy` script) and n2 (softened done-condition
   to "the `build` script is unchanged") are addressed in §2 (`:29-30`), §10 (`:271-274`), and
   the §13 log (`:343-346`). n3 (`server.proxy` dead scaffolding) is correctly parked as an
   explicit out-of-scope follow-up (§8 `:253-255`).

5. **Done-conditions QA-verifiable per branch — PASS.** §10 splits cleanly: B conditions 3–5
   (`:279-285`) cover start-freshness, the edit-while-running loop (the direct papercut
   disproof), and `-k` loop resilience; A conditions 3–5 (`:289-293`) cover start-freshness,
   restart-reflects, and presence of the verbatim CLAUDE.md note. Each is a concrete,
   observable check QA can run without reading the plan author's intent.

### Residual findings (Pass 2)

- **Nit (carryover, non-blocking):** n3's dead `server.proxy` (`vite.config.ts:25-28`) remains
  in the tree. The plan correctly leaves it out of scope; noting only for the eventual
  cleanup.
- **Nit:** §6a's `typecheck`/`lint` lines in the illustrative `scripts` block (`:136-137`)
  match the current `package.json:8-9` verbatim, and `migrate:local` (`:141`) matches
  `package.json:13` — good, the block is a faithful superset edit, not a silent rewrite of
  unrelated scripts. The Coder should still apply it as a targeted edit (replace `dev`, add
  `dev:web`/`dev:worker`) per the §11 checklist step 2b rather than pasting the whole block,
  to avoid churn; the plan already says exactly that (`:305-306`). No change required.

No new Major or Minor findings. All four Pass 1 required changes are resolved, both branches
are executable without a re-plan, and the single new load-bearing technical claim
(`--emptyOutDir false`) is verified sound against the pinned Vite. The plan is ready to
implement down whichever branch Step 0 selects.

APPROVE
