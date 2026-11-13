# Review — `docs/plans/server-can-write.md`

Round 1 — 2026-09-19. Reviewer: Plan-Reviewer (adversarial pass).

This plan is unusual: it recommends **not** building a backlog item, and the owner accepted. So this
review has two jobs, and the first matters more. A wrong "don't build this" is more costly than a
wrong "build this", because nobody revisits it.

**Bottom line up front.** The WONTFIX disposition is **correct and well-argued**, and I endorse it
plainly. Claim 1 (`can_write` is a provable constant) and claim 3 (the awkwardness is conserved)
both survive independent re-derivation, and the service-worker correction is right. Claim 2 (the
client mirror survives regardless) is **overstated** — the plan's own §1.2 proof contradicts the
argument §3.2 uses to rule out the fail-open branch — but the disposition does not depend on it.

The blocking defects are all in the **promoted Appendix B half**: §7 contradicts itself about
whether a test is added at all, and the two steps that specify the test's seeding contradict each
other about a function that provably cannot do what step 6 asks.

---

## 0. What I sampled from the self-check manifest, and what I took on trust

The manifest (`server-can-write.md:627-693`) is unusually honest, and its "what I did NOT check"
list pointed me straight at the highest-value work. Recording what is now independently confirmed:

**Re-derived in full** (not sampled), because the manifest admitted a gap or because a later number
depends on it:

- `N_endpoints` = 4. The manifest says (`:686-691`) it did not audit `src/worker/index.ts`. I did.
  Routers mounted are `me`, `lists`, `items`, `reminders`, `subscriptions`, `admin`
  (`index.ts:33-53`). `routes/admin.ts` emits only `{users}` / `{user}` — no list surface, and no
  impersonation path, which was the most plausible counterexample shape. A grep for
  `c.json({...list...})` across `src/worker/routes/` returns exactly four sites: `me.ts:14`,
  `lists.ts:15`, `lists.ts:50`, `lists.ts:82`. **Confirmed = 4.** The manifest's gap is closed.
- `reachable_false` = 0. Counterexample hunt in §1 below. **Confirmed = 0.**
- The BINARY-collation claim, **extended beyond what the plan checked**. The plan grepped
  `COLLATE`/`NOCASE` across `migrations/`. I also grepped for `lists`: migrations `0002`–`0006`
  never mention the `lists` table at all, so no later migration re-creates it with a different
  collation. That is a stronger fact than the one the plan states and it is worth having.
- The service-worker correction (§3 below). Verified against three artifacts.

**Sampled:**

- `N_client_callsites` = 2 — grepped `canWriteList` across `web/src`: production hits are exactly
  `ItemListView.tsx:202` and `ItemModal.tsx:137`. ✔
- `N_permissions_tests` = 5 — `it(` at `permissions.test.ts:27,32,37,42,46`. ✔ exact.
- `N_isolation_tests` = 10 — counted. ✔
- `N_interfaces` = 2 — read both (`src/worker/types.ts:32-39`, `web/src/types.ts:16-23`). ✔
  Structurally identical, which is also what makes the parity test's cross-type argument passing
  work without a cast.
- Citations — I re-read roughly twenty of the listed `file:line` pairs, including the fiddly ones
  (`db.ts:341` computes vs `:351` binds; `migrations/0001_init.sql:13`; `vitest.workspace.ts:27`;
  `CLAUDE.md:54-59` and `:82`; `permissions.ts:8-13`). **Every one I checked was accurate.**
  Citation quality in this document is high. The defects below are in the *promotion edit*, not in
  v1's research.

**Taken on trust:**

- `N_construct` = 10 / `N_construct_files` = 9. I sampled two rows (`App.test.tsx:52` is a `List[]`
  with object literals ✔; `permissions.test.ts:14` is the `makeList` factory ✔) and accepted the
  rest. It is a cost figure for a build that is not happening, so an error there changes no
  decision.

**What the manifest omits and I therefore reviewed in full:** the §7.1 criteria sweep covers
"all 6 done conditions" (`:665-669`) — there are now ten. D7–D10 were never swept by the author. My
sweep of them is C4 below, and it found a real problem.

---

## 1. Job 1, claim 1 — `can_write` would be a provable constant

**Verdict: SOUND.** Re-derived rather than accepted. Every piece checks out:

- `getVisibleLists`' predicate at `db.ts:326` is `WHERE visibility = 'shared' OR owner_email = ?`
  with `?` bound to `norm = email.toLowerCase()` (`db.ts:322`, `:329`). ✔
- `canWriteList`' predicate at `db.ts:549-550` is `if (list.visibility === "shared") return true;
  return list.owner_email === norm;` with `norm` from `db.ts:543`. ✔
- `migrations/0001_init.sql:13` is `owner_email TEXT NOT NULL REFERENCES users(email)` — no
  `COLLATE`. ✔ And per §0, no later migration touches the table.
- `POST`: `db.ts:351` binds `norm`. ✔ `PATCH`: `db.ts:400-404` sets `name`, `color`, `visibility`
  only; `owner_email` is never in the `SET` list. ✔ Authz branches at `db.ts:388-393`. ✔

Counterexample hunt — I tried to find a row, code path, or D1 state where a list is emitted but not
writable. All negative:

- **Byte-identity vs `===`.** SQLite `=` under BINARY collation is byte equality. Identical bytes
  decode to identical JS strings, so SQL-true implies JS-true. The reverse (JS `===` true, SQL `=`
  false) is only possible through lossy UTF-8 decoding of invalid bytes — and that is the **safe**
  direction, since the row was excluded from the response. No emitted-but-unwritable row exists.
- **`visibility` has no `CHECK` constraint** (`0001_init.sql:14` is `TEXT NOT NULL DEFAULT
  'private'`). A hand-written `INSERT` can store `'Shared'`, `'public'`, or `''`. Both predicates
  compare against the same literal `'shared'`, so such a row is excluded by the SQL *and* denied by
  `canWriteList`. Safe, and consistent. The plan does not mention this; it is the **second** degree
  of freedom a hand-written `INSERT` has, and it belongs alongside the mixed-case one in §6.2.
  Changes nothing — **NIT**.
- **Admin / impersonation.** None exists (§0). This was the shape most likely to break the claim.
- **Caller-email mismatch.** `getVisibleLists` and `canWriteList` would both be fed
  `c.get("user").email`, and both lowercase it. Consistent.
- **Deactivated users.** Gated upstream in `requireAuth`; and as §6.2 notes, a `can_write` derived
  from `canWriteList` inherits the same gap either way, so it does not distinguish the options. ✔

**One adjacent inaccuracy worth logging.** `src/worker/reminders/send.ts:229` calls
`getVisibleLists(db, user.email)` from the daily-digest cron. It is not an HTTP body, so
`N_endpoints` = 4 is unaffected — but it is a **third** `getVisibleLists` consumer, and Appendix
A.1's least-bad design (`:516-518`) describes the post-refactor state as "one function body, two
callers in one file". That caller count is wrong, and a re-opener would inherit it. **NIT** for a
WONTFIX document; it only bites if Appendix A is ever built.

---

## 2. Job 1, claim 2 — "the client mirror survives regardless"

**Verdict: OVERSTATED. This is my principal Job-1 finding.**

The half that holds: `apiClient.ts:54` is `return resp.json() as Promise<T>`, an unchecked cast
with no runtime validation anywhere in the file. ✔ So "a required `can_write: boolean` on the client
`List` is a type that lies during the window" is correct, and `can_write?: boolean` really is the
only honest client declaration. That forces an `undefined` branch. ✔

The half that does not hold: the flowchart at `:213-225` presents C1/C2/C3 as the exhaustive set and
rejects C2 as "fail open (`?? true`): the hardcoded constant the field exists to avoid". **That
rejection is contradicted by the plan's own §1.2.**

Since `reachable_false = 0`, the C3 fallback — `list.can_write ?? canWriteList(list, user)` —
returns `true` for **every list the client can ever receive**. The plan proved that. So C2
(`?? true`) and C3 (`?? canWriteList(...)`) are **observationally identical over the entire
reachable domain**. To call one correct and the other self-defeating you need a distinguishing
input, and §1.2 is a proof that none exists. The argument as written treats "the fallback value is a
constant" and "the rule is a constant" as different things, when §1.2 says they are the same thing.

And C2 is not a security regression here. `canWriteList` at `ItemListView.tsx:202` and
`ItemModal.tsx:137` gates only UI affordances — `ItemModal.tsx:148` passes the result down as a
`canWrite` prop that shows or hides Edit/Delete. Authorization is enforced server-side in `db.ts`
per `CLAUDE.md:82`. The worst case of `?? true` is an Edit button that returns 403 on click, in a
quadrant that Appendix A.5's deploy-Worker-first ordering (`:548-552`) already makes rollback-only.

So, answering the question directly: **yes, there is a framing in which the mirror genuinely goes
away.** `can_write?: boolean` on the wire, `?? true` on the client, server-side enforcement as the
real guard — and `web/src/lib/permissions.ts` plus its five tests get deleted.

**This does not rescue the backlog item, and the disposition survives.** Under that framing the
change still costs `N_interfaces` = 2 interface edits plus `N_construct` = 10 fixture edits across
four endpoints, to ship a field §1.2 proves constant — and §1.4's conserved-awkwardness finding is
completely untouched. Claims 1 and 3 carry the WONTFIX on their own.

But claim 2 is one of three load-bearing legs of a decision nobody will revisit, and it rests on an
argument its own proof undermines. The plan should either rebut C2 on defense-in-depth grounds
(a legitimate preference, but stated as a preference, not as a correctness argument) or concede the
point and lean on claims 1 and 3. **REQUIRED — does not block a build, since no production code
depends on it, but it must be fixed before this becomes the permanent record.**

---

## 3. Job 1, claim 3, and the service-worker correction

**Claim 3 (awkwardness conserved) — SOUND.** Re-derived: with `reachable_false = 0`, every emitted
`can_write` is `true`, so `can_write: true` hardcoded passes any HTTP-level assertion. An
under-permissive rule such as `can_write: list.visibility === 'shared'` goes red on a caller's own
private list, so that family *is* caught. The over-permissive family is reachable only by calling a
pure predicate with a synthetic row no D1 state can produce. The finding is exactly right and is the
strongest thing in the document. Endorsed.

**The service-worker correction — CORRECT.** Verified independently, since the operator's original
framing made the rollout argument different:

- `web/sw.ts` is exactly 77 lines. Listeners: `push` (`:9`), `notificationclick` (`:33`),
  `install` → `skipWaiting()` (`:70-73`), `activate` → `clients.claim()` (`:75-77`). **No `fetch`
  handler. No precache.** ✔
- `package.json` (read in full, deps at `:18-63`) contains no `workbox*`, no `vite-plugin-pwa`. ✔
- `vite.config.ts:13-29` is plain Rollup output with `assets/[name]-[hash].js` (`:25`) and the SW
  pinned to `sw.js` (`:24`). No PWA plugin. ✔

So the correction is right, the operator's premise was wrong, and the stale window is an in-memory
backgrounded session rather than an SW cache.

**NIT:** one sub-claim rides along unverified — "A reload after a deploy therefore gets fresh JS"
(`:205-206`). Hashed assets are only fresh if `index.html` is re-fetched, which depends on
Cloudflare Static Assets' HTML cache headers and on iOS's HTTP cache for a standalone PWA. Neither
is checked. It is conservative (it could only *widen* the window the plan already grants), so it
changes no decision — but it is a production-behaviour assertion with no citation, in a document
that cites everything else.

---

## 4. Job 2 — consistency of the Appendix B promotion

Stale "documentation-only" claims did survive the edit. In rough order of severity:

**S1 — BLOCKER. §7 has two steps numbered 6, and the first one contradicts the second.**
`:449-450` is "6. **Gates.** … **No new test is added by this branch.**" and `:452` is
"6. **Create `tests/unit/authz-rule-parity.test.ts`**". A Coder working the list in order reads "no
new test is added" and then, immediately, "create this test". This is the implementation checklist
and it contradicts itself in adjacent lines. Also renumber 7 and 8 accordingly.

**S2 — REQUIRED.** §2 Non-goals `:161-162`: "This branch touches `docs/` only." False as of §3.3.

**S3 — REQUIRED.** §4.1's table `:256-259` is titled "What this branch touches" and lists two files.
D2 at `:481` names three paths. (The e2e-skip conclusion at `:261-264` is still *correct* — I
verified `CLAUDE.md:54-59`, and `tests/**` is not `web/src/**` — but the table it reasons from is
now incomplete.)

**S4 — REQUIRED.** §7.1's closing sweep `:492-496` still argues "such a build cannot produce a
**two-path** diff" after D2 was changed to three. That sentence is the sweep's own answer to "can
the criteria distinguish the chosen approach from the rejected one", so a stale premise there is
worse than a stale premise in prose.

**S5 — REQUIRED.** Three places still describe Appendix B as unscheduled: the header `:3-7` ("§7 is
a checklist for closing the item, not for implementing it… Appendix B is a cheaper alternative that
needs its own go-ahead"), §6.3 Q2 `:361-365` ("**Default if unanswered: do not build it.** Noting it
here rather than folding it into §7 deliberately"), and §6.1 R1 `:324-325` ("it is not part of this
recommendation"). The header is the first thing any reader sees.

**S6 — REQUIRED. The self-check manifest is stale in the one place that matters.** `:665-669`:
"All **6** done conditions swept together" — there are ten, and D7–D10 were never swept. And
`:682-685`: "nothing in §1–§7 is built on it; only Appendix B is, and **Appendix B is explicitly
gated on the operator answering Q2**." Q2 is now answered, so §7 steps 6-8 rest on an explicitly
`[provisional]`, unverified premise — while §0 `:15` still promises "Nothing below is built on a
`[provisional]` value." That promise is now false. Either verify the premise (see C6) or
de-provisionalize it with a stated fallback.

**S7 — REQUIRED. No revision-history entry for the promotion.** `:9` still reads "v1 (2026-09-19) —
first draft", but §3.3, §7 steps 6-8, D2, D7–D10 and Appendix B's status note were all added
afterwards. Every other plan here logs its revisions (`calendar-show-more.md:11-40` keeps seven). A
future reader cannot tell v1 reasoning from post-decision edits — which is precisely the confusion
S1–S6 create.

**S8 — REQUIRED. The backlog replacement text never mentions the parity test.** §7 step 2
(`:410-432`) is the permanent register entry and the only artifact most future readers will ever
see. It ends "`web/src/lib/permissions.ts` stays exactly as it is, comment included", and describes
the awkwardness being "relocated to `tests/`" as a **hypothetical cost of the rejected build** —
while this same branch creates a real `tests/unit/authz-rule-parity.test.ts` that the entry does not
name. Someone arriving later via re-open criterion 1 will not know a drift guard already exists.
Text that reaches a human is at least REQUIRED even when small.

**NIT (pre-existing, not introduced here):** `docs/backlog.md:122` lists `can_write` among "the
remaining four" parked items. That line is already stale on `main` — two of the four (Playwright
bootstrap `:162`, roving `tabindex` `:169`) are marked RESOLVED. Closing `can_write` makes it
staler. Not this branch's defect; worth a sentence if the Coder is in the file anyway.

**NIT:** §7 step 6's gate command is `typecheck && lint && test`. `CLAUDE.md:54-56` names the pre-PR
gate as `typecheck && lint && test && build`. `build` is irrelevant to this diff, but the plan
should say it is deliberately omitted rather than silently drop it.

---

## 5. Job 2 — the parity test itself, against `calendar-show-more.md` §5.2's falsification rule

### Does the matrix reach a row where both rules return `false`?

**Yes.** Re-derived, not accepted. D7's row: `createList(db, "other@example.com", {visibility:
"private"})`, then server `canWriteList(db, "caller@example.com", id)` → row found, not shared,
`"other@example.com" !== "caller@example.com"` → `false` (`db.ts:548-550`); client
`canWriteList({visibility: "private", owner_email: "other@example.com"}, {email:
"caller@example.com"})` → `false` (`permissions.ts:23-24`). Both `false`. ✔ And `getVisibleLists`
cannot emit that row, which is exactly why D7 insists on calling `canWriteList` directly rather than
driving the API. **The falsification requirement is genuinely met.**

### Is the mixed-case divergence real on `main`?

**Yes, and the trap is worth its wording.** Re-derived: a row with `owner_email =
'Owner@Example.com'`, caller `owner@example.com`. Server `db.ts:543` lowercases **only the caller**
and `:550` compares `'Owner@Example.com' === 'owner@example.com'` → **`false`**. Client
`permissions.ts:24` lowercases **both sides** → **`true`**. Genuine divergence, deliberate and
documented at `permissions.ts:8-13`, and already asserted from the client side at
`permissions.test.ts:46-50`. A naive "assert agreement everywhere" parity test **would fail on
`main`** — subject to C1 below.

### Findings on the test spec

**C1 — BLOCKER. Steps 6 and 8 contradict each other about how the mixed-case row is seeded, and
step 6's instruction is provably impossible.** Step 6 (`:455`) says "Seed rows with the real
`createList`." Step 8 (`:463-469`) requires asserting the mixed-case `owner_email` divergence.
**`createList` cannot produce a mixed-case row** — `db.ts:341` computes `norm =
email.toLowerCase()` and `:351` binds it — and the plan says so itself, twice (`:87-88`, `:337-338`).
That row requires a raw `INSERT INTO lists`. The plan never says so, and the step that specifies
seeding says the opposite. The likely outcome of following the checklist as written is a test with
**no mixed-case row at all**, at which point D8's "a naive parity assertion **fails on `main`**"
becomes false — nothing exercises the divergence — and D8 goes green on a test that documents
nothing. This is blocking: it is the single load-bearing instruction of the build half.

**C2 — REQUIRED. The matrix omits the `!list` branch — the only branch where the two functions'
signatures actually diverge.** Server `canWriteList(db, email, listId)` resolves the row itself and
returns `false` on a missing row (`db.ts:548`); client `canWriteList(list, user)` returns `false` on
`undefined` (`permissions.ts:22`). `ItemModal.tsx:137` reaches that branch for real, via
`lists.find(...)`. It is covered on the client by `permissions.test.ts:42` and on the server by
nothing. It is also a **second** both-`false` row, so it strengthens D7 rather than competing with
it. Neither §7 step 7 nor D7 mentions it.

**C3 — REQUIRED. Step 6 omits the schema step, and "that project has real D1" is misleading.**
Appendix B `:589-590` says the worker project "has real D1". It has a real but **empty** D1: every
worker test that touches a table declares its own `applyMigrations` with hand-copied DDL —
`db.test.ts:35`, `list-isolation-http.test.ts:70`, `items-get-by-id.test.ts:47`,
`dev-auth-shim.test.ts:37`, `routing.test.ts:53`, and eight more. `createList` against an
unmigrated DB throws. The Coder must copy the `lists` DDL. (Helpfully, those copies drop
`REFERENCES users(email)` — see `list-isolation-http.test.ts:84` — which is what makes C1's raw
mixed-case `INSERT` safe without seeding a `users` row.)

Sub-point that belongs in the plan: because the test's `lists` DDL is a **hand-copy**, the parity
test does not guard §1.2's SQL half **at all**. It compares server JS to client JS. The SQL-vs-JS
equivalence and the absence of `COLLATE NOCASE` — the two facts §6.1 R3 (`:329-333`) names as
"nothing in the repo asserts either" — remain unasserted after this branch. **R3 is unchanged by
Appendix B**, and the plan must say so, because any reader will assume a file called
`authz-rule-parity.test.ts` closed it.

**C4 — REQUIRED. D7 and D9's stated failure conditions are unreachable by any automated run, and
the plan's own honesty convention demands they say so.** §7.1's preamble (`:473-476`) goes out of
its way to label D5 and D6 "**guards, not tests**" because their failure mode is unreachable. D7
("the matrix contains at least one row where both rules return `false`") and D9 ("a companion
assertion that `createList` stores `owner_email` lowercased") are **file-content criteria**: the
failure each describes — the row or the assertion simply being absent — produces a **green**
`npm test`. Only a human reading the test source can turn them red. The table presents all four of
D7–D10 uniformly, which implies a mechanism two of them do not have. Given that this plan
explicitly set that honesty precedent three paragraphs earlier, the inconsistency is a real defect,
not a style point.

Two-sided check on the ones that **are** automatic:

- **D8** — red on the build it names (a naive parity assertion fails on `main`), green on a correct
  one. ✔ Passes, once C1 is fixed.
- **D10** — `vitest.workspace.ts:27` is indeed `include: ["tests/**/*.test.ts",
  "src/worker/**/*.test.ts"]` ✔ and `:46` is the web glob ✔. A file misplaced under `web/` is
  collected by the jsdom project and dies on the `cloudflare:test` import. Red on the named build,
  green on a correct one. ✔ Passes.

**C5 — REQUIRED. D2 does not name its diff base, and under the most likely base a correct build
goes red.** `git diff --stat` with no argument compares the working tree to `HEAD`.
`docs/plans/server-can-write.md` already exists on disk with a clean `git status`, i.e. it is
already committed. If the Coder branches from that commit, a correct build produces **two** paths
(`docs/backlog.md`, `tests/unit/authz-rule-parity.test.ts`) and D2 — which demands exactly three —
**goes red on correct code**. D3 names its base explicitly ("byte-identical to `main`"); D2 should
too, and should state whether the plan file is expected to appear in the diff at all.

**C6 — REQUIRED. Resolve the `[provisional]` import premise, with a stated fallback.** My
assessment is that the import **will** work, but the plan was right to flag it and wrong to
schedule it while still labelled unverified (S6):

- `permissions.ts:19` is `import type { List, User } from "../types"` — type-only, erased at
  compile. The emitted module has **zero** runtime imports, so nothing DOM-shaped reaches workerd. ✔
- `web/src/types.ts` is pure `interface`/`type` throughout (96 lines, read in full). ✔
- `tsconfig.worker.json:6` includes `tests/unit/**/*`, so `npm run typecheck` will pull
  `permissions.ts` and `web/src/types.ts` into the **worker** program under `lib: ["ES2022"]` with
  no DOM (`tsconfig.json:6`). Both use only `String.prototype.toLowerCase`, so it should pass — but
  this is the first time either file is compiled without `lib.dom` (`tsconfig.web.json:6` supplies
  it today), and the plan does not mention that this happens.
- `npm run lint` is `eslint src web/src e2e playwright.config.ts` (`package.json:11`) — `tests/` is
  **not** linted, so the new file gets no lint coverage. Worth knowing; not a defect.
- Both modules export a symbol named `canWriteList`. The test must alias one. Not stated.
- **No file under `tests/` currently imports anything from `web/`** — I grepped; zero matches. This
  import is unprecedented in the repo, which is exactly why the `[provisional]` tag mattered.

Step 6 should therefore begin with "verify the import resolves before writing the matrix", and name
the fallback if it does not: re-implementing the three-line client predicate inline in the test
loses the entire drift-detection property and should be escalated, never silently adopted.

---

## 6. §6.4 — `canReadList` / `canWriteList` left identical but separate

Confirmed byte-identical: `db.ts:523-536` vs `db.ts:538-551` differ only in the function name.

**Leaving them separate is the right call, and the plan's stated reason is the right reason** —
they are only incidentally equal today, and collapsing them makes that equality load-bearing at
precisely the moment a read-only visibility model (re-open criterion 1) would want them to diverge.
No change needed to that decision.

**But Appendix B changes the shape of the duplication, and the plan does not say so — REQUIRED,
one sentence.** Before this branch, both copies were unguarded and equal. After it, `canWriteList`
is pinned to the client mirror by an automated test and `canReadList` is pinned to nothing. A future
edit that fixes the rule in `canReadList` only, or that changes `canWriteList` and updates the
mirror to match while leaving `canReadList` behind, produces a silent read/write divergence with a
fully green suite. §6.4 should note the asymmetry, and note that if the dedup is ever done, the
parity test's import target must be revisited.

---

## 7. Scaling, security, observability

Nothing to raise. The branch adds no schema change, no endpoint, no runtime code path; the only new
artifact is one worker-project test. Security posture is unchanged — and per §2, authorization stays
where `CLAUDE.md:82` puts it. The one observability gap worth naming is C3's sub-point: after this
branch, §1.2's SQL half still has no automated guard, and §6.1 R3 stands unmitigated.

---

## Required changes

1. **(S1, blocking)** Fix §7's duplicate step 6 and delete "No new test is added by this branch" —
   it contradicts the step immediately below it. Renumber 7 and 8.
2. **(C1, blocking)** Reconcile §7 steps 6 and 8: state that the mixed-case row **cannot** come from
   `createList` (`db.ts:341`/`:351`) and requires a raw `INSERT INTO lists`. Without this, D8's
   "fails on `main`" claim is unreachable.
3. **(C2)** Add the missing-list / `undefined`-list row to the matrix — server
   `canWriteList(db, email, "no-such-id")` vs client `canWriteList(undefined, user)`, both `false`
   (`db.ts:548`, `permissions.ts:22`). Second both-`false` row; the only branch where the two
   signatures genuinely differ.
4. **(C3)** Add the schema step: the worker project's D1 is real but **empty**, and every existing
   worker test hand-copies its DDL (`list-isolation-http.test.ts:70` et al.). Also state explicitly
   that the parity test does **not** guard §1.2's SQL half, so §6.1 R3 is unchanged by it.
5. **(C4)** Label D7 and D9 as manual source-inspection criteria, not automated gates — their stated
   failure mode leaves `npm test` green. D8 and D10 are genuinely automatic and pass the two-sided
   test; the table should distinguish them, per the precedent §7.1 set with D5/D6.
6. **(C5)** Give D2 an explicit diff base and state whether `docs/plans/server-can-write.md` is
   expected in the diff. As written, a correct build plausibly yields two paths and D2 goes red.
7. **(C6, S6)** Resolve the `[provisional]` cross-project import premise: instruct the Coder to
   verify it first, note that `tsconfig.worker.json:6` pulls `web/src/*` into the no-DOM worker
   program, note the `canWriteList` name collision, and name the fallback. Then fix §0's
   "Nothing below is built on a `[provisional]` value."
8. **(§2, claim 2)** Correct §3.2's rejection of the C2 branch. Per §1.2, `?? true` and
   `?? canWriteList(...)` are observationally identical over the whole reachable domain, and
   `canWriteList` gates only UI affordances (`ItemListView.tsx:202`, `ItemModal.tsx:137`) with the
   server enforcing per `CLAUDE.md:82`. Either rebut C2 as a defense-in-depth *preference* or
   concede that the mirror could go away, and rest the disposition on claims 1 and 3.
9. **(S8)** Add the parity test to the backlog replacement text in §7 step 2 — it is the permanent
   register entry, and it currently describes `tests/`-relocated awkwardness as hypothetical while
   the branch ships it for real.
10. **(S2, S3, S4, S5)** Clear the remaining docs-only claims: §2 `:161-162`; §4.1's table
    `:256-259`; §7.1's "two-path diff" at `:492-496`; and the header `:3-7`, §6.3 Q2 `:361-365`,
    §6.1 R1 `:324-325`.
11. **(S7)** Add a v2 revision-history entry recording the Appendix B promotion and who made it.
12. **(§6.4)** Add one sentence noting that Appendix B pins `canWriteList` to the client mirror
    while leaving `canReadList` pinned to nothing, and that a future dedup must revisit the parity
    test's target.
13. **(NITs, optional)** `visibility` has no `CHECK` constraint (`0001_init.sql:14`) — the second
    hand-`INSERT` degree of freedom, belongs in §6.2 beside the mixed-case one. Appendix A.1's
    "two callers in one file" is wrong — `send.ts:229` is a third. "A reload gets fresh JS"
    (`:205-206`) is uncited. §7 step 6's gate drops `build` versus `CLAUDE.md:54-56`.

APPROVE WITH CHANGES

---

# Round 2 — 2026-09-19 (v3 of the plan)

Reviewed the delta only; round 1's findings on the WONTFIX substance stand unless noted. Line
numbers below are v3's.

**Summary.** The substantive work is good. The §3.2 concession is well made, and the test spec is
materially better — C1 through C4 and C6 are all properly discharged, and step 5's "verify the
import first, and if you fall back to a copied rule **say so in the impl notes**" is a better
instruction than the one I asked for. But **the same failure mode recurred twice**: a correction
landed in the section that was edited and did not propagate to the adjacent section that quotes it.
Two of those reach the Coder as instructions that **go red on a correct build**.

The coordinator asked me to re-derive the §7 numbering rather than trust the summary. I did, and
that is where both blockers are.

## Re-derivation of §7's numbering and cross-references

Steps present, by line: 1 (`:430`), 2 (`:433`), 3 (`:463`), 4 (`:468`), 5 (`:474`), 6 (`:493`),
7 (`:504`), 8 (`:518`), 9 (`:522`). **Contiguous 1-9, no duplicate, no gap.** ✔ And a grep confirms
"No new test is added by this branch" now survives only inside the v3 revision-history entry
(`:760`), where it belongs. **S1's numbering half is discharged.**

Cross-references, checked one at a time:

- §3.3 `:260` — "§7 gains steps 5-7 (plus the gate steps 8-9)". ✔ Correct.
- Appendix B `:640-641` — "Implementation steps are §7 steps 5-7". ✔ Correct.
- D5 `:538` — "§7's scope line forbids touching `migrations/`". ✔ Correct; the phantom "step 7.2"
  is gone.
- §7 preamble `:425-426` — "Steps 1-5 are the documentation close; steps 5-7 add the approved
  parity test". ✗ **Overlapping and wrong.** Step 5 creates the test file, so the documentation
  close is steps 1-4. Step 5 is currently claimed by both halves of the sentence.
- Step 7 `:506-507` — "Step 6's 'seed with `createList`' applies to the reachable rows only".
  ✗ **Off by one.** The `createList` seeding instruction is now in **step 5** (`:491`); step 6 is
  the matrix. Renumber residue — exactly the class that produced S1.

## Discharged, verified rather than accepted

- **C1** ✔ `:504-508`. Step 7 now states `createList` cannot produce the mixed-case row and a raw
  `INSERT INTO lists` is required, and spells out the consequence of missing it. D8's "fails on
  `main`" is now reachable, so D8 passes the two-sided test.
- **C2** ✔ `:493-497`. The missing-list row is in, correctly cited (`db.ts:548`,
  `permissions.ts:22`) and correctly characterised as the only branch where the signatures differ.
- **C3** ✔ `:487-489` (hand-copied DDL, `list-isolation-http.test.ts:70` cited as precedent) and
  ✔ `:546-549` ("What the parity test does NOT cover"). The second is better than what I asked for
  — it names the SQL predicate, says R3 is unchanged, and says plainly that a future edit to the
  `WHERE` clause would not go red.
- **C4** ✔ `:541`, `:543`. D7 and D9 relabelled manual source inspection, citing the D5/D6
  precedent.
- **C6** ✔ `:478-485`. Verify-first, the `tsconfig.worker.json:6` consequence, the name collision,
  and a fallback whose weakening must be *visible*. Correct.
- **S2** ✔ `:161-163`. **S4** ✔ `:553` (three-path). **S7** ✔ `:753-763`, and it attributes the
  promotion honestly. **§6.4** ✔ `:405-408`. **§6.2 `CHECK`** ✔ `:352-356`. **`build` restored**
  ✔ `:518`.
- **§2 / claim 2** ✔ `:200-212`. The concession is well made and — importantly — rejects the C2
  branch as a *preference* rather than an impossibility, and says outright that the disposition
  rests on claims 1 and 3. That is the right shape. See R2-6 for where it failed to propagate.

## Findings

**R2-1 — BLOCKER. Step 4 contradicts itself and instructs the Coder to halt on a correct build.**
`:468-470`:

> **Confirm the diff scope.** `git diff --stat main...HEAD` must list exactly three paths:
> `docs/backlog.md` and `docs/plans/server-can-write.md`. Any third path is a defect — stop and
> report rather than reverting blind.

Three defects in two sentences. It says **three** and lists **two**. And it retains "Any third path
is a defect — stop and report" from the documentation-only era, when the third path is now
`tests/unit/authz-rule-parity.test.ts`, which **step 5 instructs the Coder to create** and which D2
(`:535`) requires. A Coder working §7 in order creates the file in step 5, then reaches step 4's
successor gates and is told the file is a defect.

C5's fix landed in D2 — where it is complete and correct, base and all — and not in the step that
D2 audits. Same species as the v2 blockers.

**R2-2 — BLOCKER. Step 8's test-count gate fails on a correct build.** `:519`: "`npm test` must go
from 300 to 301 (the new parity test)". Two problems; the second is fatal.

*Provenance.* The figure is real, not invented — `docs/backlog.md:133` records "suite went
266 → 300" for PR #21 (2026-08-22, prod `72f7c698`). But it was **quoted, not re-measured**, and
the manifest at `:740` still promises: "I deliberately quote **no** repo-wide test total anywhere in
this document, since I could not measure one." The document now quotes one, from a month-old
narrative entry, as a hard gate value. That is a measurement of one artifact at one time reattached
to a different one.

*Arithmetic.* "+1" is wrong for a correct implementation. Steps 6-7 specify two both-`false` rows,
the reachable rows, the mixed-case divergence assertion, and D9's `createList`-lowercases
invariant. Written naturally that is several `it()` blocks, not one — and nothing in §7 mandates a
single `it`. A correct build lands somewhere above 301 and fails a gate demanding exactly 301.

Replace with a directional criterion the Coder can actually satisfy: `npm test` passes; the delta
equals the number of `it()` blocks in the new file; **no pre-existing test count changes**. That
last clause is the property worth gating and the one "301" was reaching for.

**R2-3 — REQUIRED. §4.1's table was not updated.** `:271-274` still lists two files under the
heading "What this branch touches", omitting `tests/unit/authz-rule-parity.test.ts`. §4.1 and D2
(`:535`) now disagree about the branch's own file set. (The e2e conclusion at `:276-279` remains
correct — `tests/**` is not `web/src/**` per `CLAUDE.md:54-59` — but it is reasoned from a table
that is wrong.) Item 10 of the round-2 response covers "§2 and the two-path language"; S3 was a
separate item and is outstanding.

**R2-4 — REQUIRED. S5 is one-third discharged.** §2 was cleared. Three stale claims remain:

- Header `:3-7`: "§7 is a checklist for closing the item, **not for implementing it** … Appendix B
  is a cheaper alternative that **needs its own go-ahead**." This is the first thing any reader
  sees and it is flatly false as of §3.3.
- §6.3 Q2 `:382-386`: "**Default if unanswered: do not build it.** Noting it here rather than
  folding it into §7 deliberately — it would be scope expansion to absorb it unilaterally."
- §6.1 R1 `:339-340`: "it is not part of this recommendation."

**R2-5 — REQUIRED. S6 not discharged; the manifest still describes a document that no longer
exists.** `:724`: "All **6** done conditions swept together" — there are ten, and D7-D10 have still
never been swept by the author (I swept them in round 1 and re-checked D8 and D10 here; both remain
two-sided and correct). `:741-744` still says the import premise is `[provisional]` and that
"nothing in §1–§7 is built on it; only Appendix B is, and Appendix B is explicitly gated on the
operator answering Q2" — Q2 is answered and §7 step 5 is built on it. `:15` still promises "Nothing
below is built on a `[provisional]` value." Step 5's verify-first instruction is the correct
mitigation; the manifest simply has not been told it exists.

**R2-6 — REQUIRED. The §3.2 concession did not propagate, including into the permanent register.**
This is the plan's own subject matter reproduced in the plan.

- §1.3(a) `:108-112` still asserts the local rule is "the only fallback that is neither
  user-hostile … nor self-defeating" and concludes "**The item's stated benefit is not achieved by
  the item's proposed change.**" No pointer to the correction two pages later. §1.3 is the argument
  summary — the section a skimmer reads instead of §3.2.
- §7 step 2's backlog replacement text `:447-449` carries the retracted claim into the **permanent
  register**: "the only non-hostile, non-self-defeating fallback is the local rule, so
  `web/src/lib/permissions.ts` survives the change rather than being replaced by it." The plan is
  read by whoever opens the plan; the backlog entry is read by everyone else, forever. This is the
  highest-consequence instance and the one I would fix first.

**R2-7 — REQUIRED. Two cross-reference defects from the renumber** — §7's preamble `:425-426`
("Steps 1-5 are the documentation close" should be 1-4; step 5 is currently in both halves of the
sentence) and step 7's `:506-507` ("Step 6's 'seed with `createList`'" should be step 5, `:491`).
Neither is blocking — a Coder can resolve both from context, and step 5's own text already scopes
the seeding to reachable rows — but this is the exact residue class that produced S1.

**R2-8 — REQUIRED, and narrower than round 1 implied. S8: you are right on the substance and I
withdraw the part of my finding that implied a rewrite.** You are not rationalising. The
"awkwardness" the WONTFIX argument names is the *field's* over-permissiveness guard; the parity
test's unreachable input serves drift detection; they are different things with different purposes,
and merging them in the register entry would indeed be worse than leaving it. Your instinct was
correct.

What remains is smaller. The entry's phrase "relocated to `tests/`" (`:455`) now collides with a
real file this same branch creates in `tests/`, and the entry never names it. A future re-opener
arriving via criterion 1 will read that sentence, look in `tests/`, find
`authz-rule-parity.test.ts`, and reasonably conclude it is the thing described — the conflation you
wanted to avoid, arrived at by omission instead of by assertion. One clause, kept explicitly
distinct, prevents it and makes the drift guard discoverable from the only permanent record. For
example: *"(Separately, this branch adds `tests/unit/authz-rule-parity.test.ts`, a client/server
drift detector — not the guard described above, and not a reason to re-open.)"* Do not merge the
concepts; just make the file findable.

## NITs — none of these block

- Step 6 `:498-500` carries a scripted-replacement splice: "Row (a) details: It must include a
  **private list owned by someone else**" restates what (a) already said two lines up. Its trailing
  "Without it, every row is `true` on both sides" is now false — row (b) also yields `false`.
  Conservative direction; changes no decision.
- Blank lines `:471-473` left behind by the renumber.
- §1.5 goal 5 `:154-155` still reads "marked as needing separate approval". Defensible as a record
  of v1's goals; flag only if you want §1.5 to describe the document as it now stands.
- Manifest `:745-750` still discloses "I did not audit `src/worker/index.ts` for additional
  routers". Stale in the safe direction — I audited it in round 1 and confirmed `N_endpoints` = 4
  (four `c.json` sites; `routes/admin.ts` emits only users). Honest as-is; optionally cite the
  review rather than deleting the disclosure.

## Trajectory

Round 1: 13 findings, 2 blocking. Round 2: 8 findings, 2 blocking. The count fell and the *nature*
improved sharply — round 1's blockers were in the core test spec, round 2's are two sentences in
the gate steps. Everything substantive about the disposition, the test design and the falsification
work is now right, and I would not ask for a further round on any of it.

I cannot approve as-is only because R2-1 and R2-2 both go red on a correct build: one tells the
Coder to stop and report on the file they were just told to create, the other demands an exact test
total that a correct implementation will not hit. Both are single-sentence fixes. If the next
revision lands R2-1 through R2-8 I expect a clean `APPROVE` with no new findings.

## Required changes

1. **(R2-1, blocking)** Fix step 4 `:468-470`: name all three paths, and delete "Any third path is
   a defect" — the third path is required by D2 and created by step 5.
2. **(R2-2, blocking)** Replace step 8's "must go from 300 to 301" `:519` with a criterion a
   correct build satisfies: `npm test` passes, the delta equals the `it()` count of the new file,
   and no pre-existing test count changes. Do not quote a repo-wide total the plan did not measure
   — the manifest at `:740` promises it quotes none.
3. **(R2-3)** Add `tests/unit/authz-rule-parity.test.ts` to §4.1's table `:271-274`.
4. **(R2-4)** Clear the three remaining unscheduled-Appendix-B claims: header `:3-7`, §6.3 Q2
   `:382-386`, §6.1 R1 `:339-340`.
5. **(R2-5)** Update the manifest: "6 done conditions" → 10 at `:724` (and note D7-D10 were swept
   by review, not by the author); and reconcile `:741-744` with §0 `:15` now that §7 step 5 rests
   on the import premise and mitigates it in place.
6. **(R2-6)** Propagate the §3.2 concession to §1.3(a) `:108-112` (at minimum a pointer) and to the
   backlog replacement text `:447-449`. The register entry must not carry a claim the plan retracts.
7. **(R2-7)** Fix §7's preamble `:425-426` (documentation close is steps 1-4) and step 7's
   reference `:506-507` (step 5, not step 6).
8. **(R2-8)** Add one clause to the backlog entry naming `tests/unit/authz-rule-parity.test.ts` as
   a separate drift detector — keeping it explicitly distinct from the §1.4 awkwardness, per your
   own reasoning, which I accept.
9. **(NITs, optional)** Step 6's spliced "Row (a) details" sentence and its now-false "Without it,
   every row is `true`"; blank lines `:471-473`; §1.5 goal 5; the `index.ts` disclosure at
   `:745-750`.

APPROVE WITH CHANGES

---

# Round 3 — 2026-09-19 (v4 of the plan)

Line numbers below are v4's. I did the two re-derivations you asked for before reading anything
else, because you were right that absence-of-evidence is how the last two escapes happened.

**Both of your instincts were correct, and one of them found something.** The numbering is clean.
The unscheduled-Appendix-B sweep was **not** complete — `grep` missed two, for exactly the reason
you feared. And there is one new blocker, in the one artifact that no done condition inspects.

## Re-derivation 1 — the unscheduled-Appendix-B sweep

**Incomplete. Two survivors, neither of which your grep terms could have matched.**

- **`:350`, §6.1 R1** — "Appendix B offers a cheap mechanism if the operator wants the risk retired
  properly; **it is not part of this recommendation.**" This is the third consecutive round this
  exact line has survived (round 1 S5, round 2 R2-4). It matches none of "unscheduled",
  "go-ahead", or "separate approval" — the phrasing is "not part of this recommendation", which is
  why a term-based sweep cannot see it.
- **`:6`, the header** — "§7 is a checklist for closing the item, **not for implementing it.**"
  You fixed `:7`, the Appendix B sentence. The sentence immediately before it, in the same
  paragraph, makes the same stale claim about §7 — which now contains build steps 5-7.

Everything else the sweep turns up is legitimately historical and correctly framed, and I checked
each: `:160` (annotated "since approved"), `:174` and `:413` (§6.4, a different subject),
`:262-264` (the decision record itself), `:435` (struck through), `:662-664` and `:704`
(explicitly marked superseded), `:780` (v1 history). §6.3 Q2 `:392-396` is well handled — the
**ANSWERED YES** header plus "*Original question retained for the record*" makes the stale body
unambiguously historical rather than live. That is the right pattern, and it is the pattern `:350`
and `:6` need.

## Re-derivation 2 — step numbering and cross-references

**Clean. No findings.** Re-derived rather than accepted:

Steps at `:440, :443, :478, :483, :491, :510, :521, :535, :547` — contiguous **1-9**, no duplicate,
no gap. Every cross-reference resolves correctly:

| Reference | At | Resolves to | |
|---|---|---|---|
| "Steps 1-4 are the documentation close; steps 5-7 … 8-9 are the gates" | `:435-436` | steps 1-4 / 5-7 / 8-9 | ✔ fixed |
| "Step 5's 'seed with `createList`'" | `:523` | `:508`, which is where that instruction now lives | ✔ fixed |
| "§7 gains steps 5-7 (plus the gate steps 8-9)" | `:265` | ✔ |
| "see §3.3 and §7 steps 5-7" | `:392` | ✔ |
| "Implementation steps are §7 steps 5-7" | `:665-666` | ✔ |
| "(created in step 5)" | `:485` | ✔ |
| "Exact replacement text in §7 step 2" / "Mitigated by §7 step 2" | `:284`, `:352` | ✔ |
| "step 3 keys off `grep -n \"Server-supplied\"`" | `:726` | `:478`, the grep step | ✔ |
| "§7's scope line forbids touching `migrations/`" (D5) | `:563` | `:436-437` | ✔ |
| "§7 step 5 now instructs the Coder to verify it" | `:15` | ✔ |

Both cross-references the v3 renumber missed are correctly repaired.

## Discharged

- **R2-1** ✔ `:483-487`. Three paths named, tripwire correctly moved to "a **fourth** path is a
  defect", plus the explicit `src/` / `web/src/` note tying it to §6.4's two tempting refactors.
- **R2-2** ✔ `:535-545`, and **better than what I asked for.** You did not just correct the number
  — you removed the class of criterion. "Measure the baseline, do not quote one", 300 across 34
  files recorded as *a datum with a date, not a constant*, and then three criteria that a correct
  build satisfies: pre-existing tests pass unmodified, file count 34 → 35, total up by the `it()`
  blocks actually written. All three are two-sided (red on a broken build, green on a correct one),
  and the note that an exact-number gate "would invite 'fixing' it by deleting cases" is the right
  reason stated out loud. I could not independently verify 300/34 — no shell in this role — but
  that is now correctly framed as a dated measurement rather than a gate value, so it does not need
  to be.
- **R2-7** ✔ both cross-references, as above.
- **R2-6, first half** ✔ `:104-107`. The §1.3 blockquote is well placed and correctly says the
  disposition rests on §1.2 and §1.4. Second half not discharged — see R3-5.
- **R2-8, content** ✔. The substance of the new clause is exactly right: the parity test "also uses
  an unreachable input, but for a different purpose", and "its presence in `tests/` is not evidence
  that the field's awkwardness was accepted". Distinct, not merged — what you argued for in round 2
  and what I agreed to. The *mechanics* of the insertion failed; see R3-1.

## Findings

**R3-1 — BLOCKER. The backlog replacement template in step 2 is structurally broken, and nothing
in §7.1 can catch it.** `:464-473`. Two defects in the same insertion:

*An orphaned sentence fragment.* The original read "…the exact 'unreachable but keep it anyway'
shape this item set **out to remove, relocated to `tests/`.**" The edit replaced the tail with
"…this item set **out to eliminate.**" plus the new S8 paragraph — but the old tail survives at
`:470` as "`out to remove, relocated to `tests/`. **Re-open if** (1) …`". So the pasted entry
would read:

> …the exact "unreachable but keep it anyway" shape this item set **out to eliminate.** [new
> paragraph about `authz-rule-parity.test.ts`] **out to remove, relocated to `tests/`.** Re-open
> if (1) …

A dangling clause with no subject — and it re-asserts the exact phrase ("relocated to `tests/`")
that the new paragraph two lines above exists to disclaim. The S8 fix is undone by the residue of
its own edit.

*Broken blockquote indentation.* `:446-464` and `:470-473` are indented `   >   ` (three spaces,
inside the numbered list item). `:465-469` start at column 0 with `>   `. That breaks the block out
of the list item, so the template is no longer the single coherent unit that `:475-476` instructs
the Coder to paste ("Keep it as a single `-` bullet at the same indentation as its neighbours so
the list structure is unchanged").

*Why this is blocking rather than cosmetic:* this is the verbatim-paste source for the **permanent
backlog register entry** — the artifact that outlives the plan and that round 1's S8 and round 2's
R2-8 were both about. And **no done condition inspects it.** D1 (`:559`) checks the first line's
uniqueness and prefix; D2 checks paths; D3 checks `permissions.ts`. A Coder who pastes this
faithfully produces a malformed, self-contradicting register entry and passes every criterion in
§7.1.

**R3-2 — REQUIRED. The sweep survivors: `:350` (§6.1 R1) and `:6` (header).** Detail above. Your
own doubt about the method was well founded; the fix for both is the §6.3 Q2 pattern — annotate
in place rather than search for phrasings.

**R3-3 — REQUIRED. The `[provisional]` reconciliation reached §0 but not the manifest.** `:15` is
now correct and good. But `:766-769` still reads "this is `[provisional]` — and nothing in §1–§7 is
built on it; only Appendix B is, and **Appendix B is explicitly gated on the operator answering
Q2**." Q2 is ANSWERED YES at `:392`, and §7 step 5 is built on the premise. Same one-of-two-places
pattern.

**R3-4 — REQUIRED, and new as of this round. The manifest now contradicts step 8.** `:762-765`
still says "I did not run `npm test` … no shell access in this role" and "I deliberately quote
**no** repo-wide test total anywhere in this document, since I could not measure one." Step 8
`:537` now quotes **300 across 34 files, measured**. The measurement is the right call and the
framing in step 8 is right; the manifest simply has not been told, and a reader cannot reconcile
the two. Name who measured it and when — the Architect had no shell, the orchestrating session
did, and that distinction is exactly what a manifest exists to record.

**R3-5 — REQUIRED. The §3.2 concession reached §1.3(a) but not the register entry.** `:457-459`
still reads "and the only non-hostile, non-self-defeating fallback is the local rule, so
`web/src/lib/permissions.ts` survives the change rather than being replaced by it." That is the
claim §3.2's CORRECTION retracts, sitting in the permanent backlog text. I flagged it in round 2 as
the highest-consequence instance for the same reason I'll repeat here: the plan is read by whoever
opens the plan; the backlog entry is read by everyone else, forever.

**R3-6 — REQUIRED. No v4 revision-history entry.** `:780-788` stops at v3. S7's entire purpose was
that each round be recorded, and round 3's changes — including the step 8 rewrite and the
measurement — are the ones a future reader would most want dated and attributed.

**R3-7 — REQUIRED. §7.1 has no criterion covering the body of the pasted backlog entry.** R3-1 is
the proof that this gap is live, not theoretical. D1 checks one line of a ~28-line quoted block.
Add a manual-inspection criterion in the D7/D9 style — *"After pasting, re-read the whole entry as
one bullet: no duplicated or orphaned clause, no broken indentation, and the
`authz-rule-parity.test.ts` sentence present and distinct from the §1.4 awkwardness."* Two-sided:
red on exactly the paste R3-1 would produce, green on a clean one. Label it manual, since `npm
test` cannot see it.

## NITs — none block

- **§4.1 `:276-284`** — you annotated the two-file table rather than updating it, and the note says
  so honestly and names the third path. Defensible: the note is directly above and unmissable.
  Slightly odd in a plan rather than a changelog, but it does not mislead. Leaving it is fine.
- **Manifest `:749-753`** — the count is now correctly "All 10 done conditions (D1-D10)", but the
  *result* sentence that follows still characterises only D1-D6. D7-D10 are claimed as swept and
  not reported on.
- **Step 6 `:515-519`** — the "Row (a) details: It must include a **private list owned by someone
  else**" splice still restates what (a) said two lines up, and "Without it, every row is `true` on
  both sides" is still false now that row (b) exists. Conservative direction.
- Blank lines `:489-490` still left from the v3 renumber.

## Trajectory, and one structural suggestion

Round 1: 13 findings, 2 blocking. Round 2: 8, 2 blocking. Round 3: 7, 1 blocking. Converging, and
the substance has been settled since round 2 — the WONTFIX reasoning, the falsification work, the
test spec and the criteria are all correct and I have no remaining concerns about any of them.

What has not converged is a single recurring mechanic: **every round, a cross-cutting change lands
in three of the four places it belongs.** R3-2, R3-3, R3-5 and R3-6 are all that same shape, and
R3-1 is it in its most damaging form. The common factor is that the step 2 register template is a
28-line verbatim-paste artifact being maintained by scripted replacement, with no criterion
inspecting it.

Concrete suggestion for v5: make step 2's block the **last** edit of the round and re-read it in
full as a unit rather than patching it, and add R3-7's criterion so the next round has a mechanism
instead of a habit. That plus the five small propagations below should be a clean `APPROVE`.

## Required changes

1. **(R3-1, blocking)** Repair step 2's template `:464-473`: delete the orphaned "out to remove,
   relocated to `tests/`." fragment at `:470`, and re-indent `:465-469` to `   >   ` so the block
   is one coherent bullet. Re-read the whole entry as a unit afterwards, not as a diff.
2. **(R3-5)** Remove the retracted claim from the same template `:457-459` — the "only
   non-hostile, non-self-defeating fallback is the local rule" sentence is what §3.2's CORRECTION
   withdraws, and it is going into the permanent register.
3. **(R3-2)** Annotate `:350` (§6.1 R1, "it is not part of this recommendation") and `:6` (header,
   "§7 is a checklist for closing the item, not for implementing it") using the §6.3 Q2 pattern.
4. **(R3-3)** Reconcile the manifest `:766-769` with §0 `:15` — Q2 is answered and §7 step 5 is
   built on the import premise and mitigates it in place.
5. **(R3-4)** Update the manifest `:762-765`: the document now quotes a measured repo-wide total.
   Record who measured 300/34 and when.
6. **(R3-6)** Add the v4 revision-history entry.
7. **(R3-7)** Add a manual-inspection done condition covering the pasted entry's body, in the
   D7/D9 style.
8. **(NITs, optional)** Manifest `:749-753`'s result sentence omits D7-D10; step 6's `:515-519`
   splice and its now-false "Without it, every row is `true`"; blank lines `:489-490`.

APPROVE WITH CHANGES

---

# Round 4 — 2026-09-19 (v4 of the plan)

Line numbers below are the current file's. **All seven round-3 items are discharged, verified by
re-derivation rather than accepted. No blockers remain, and nothing outstanding can produce a
defective build.** Three documentary items are recorded below as fold-ins, not gates.

## Verification of the seven

**R3-1 ✔ — the register template, rewritten as a unit.** `:449-478`. I re-read the block whole
rather than diffing it, since that is the failure mode. Every line from `:449` to `:478` carries
the same `   >   ` indentation — no column-0 escapees — so it renders as one continuous bullet
under the list item. The dangling "out to remove, relocated to `tests/`." tail is gone; `:469-470`
now reads "…the exact 'unreachable but keep it anyway' shape this item set out to **eliminate**,
relocated to `tests/`", followed immediately by the disclaimer, which is coherent.

I also re-checked the entry's *content*, since a clean rewrite is a chance to introduce new errors:
every citation in it resolves (`db.ts:326`, `db.ts:549-550`, `migrations/0001_init.sql:13`,
`db.ts:400-404`, `CLAUDE.md:82`), the cost figures match §0, the re-open criteria match §6.3, and
the first line still satisfies D1. One improvement I did not ask for: the awkwardness sentence now
uses the subjunctive ("the only real guard **would be**"), which correctly marks it as a property
of the build that was rejected rather than of this branch.

**R3-5 ✔ — and this was the one that mattered.** `:457-464`. The concession is now inside the
permanent register entry, and phrased better than my suggestion: "a defense-in-depth
**preference**, not an impossibility … **The closure rests on the constant proof above and the cost
below, not on that argument.**" A future re-opener now inherits the corrected argument rather than
the retracted one. This was round 2's highest-consequence item and it is properly closed.

**R3-2 ✔ — both sweep survivors.** `:5-7` (header) and `:350-353` (§6.1 R1), both using the §6.3 Q2
pattern: current status first, original wording retained and labelled. The addition at `:352-353`
— that the parity test retires only the **JS** half of R1's risk, the SQL predicate staying
unguarded — is a genuine improvement I had not asked for, and it stops the ANSWERED YES being read
as retiring more than it does.

**R3-3 ✔** `:776-779`. **R3-4 ✔** `:771-775`, which names the figure, the measurer, the date, the
method, and the fact that an earlier revision quoted it from a month-old narrative line. That is a
complete disclosure.

**R3-6 ✔** — v4 entry present at `:794-799`, and it records the right things: the malformed
template as the round-3 blocker, and *why* the two sweep survivors escaped.

**R3-7 ✔** — D11 at `:576`. Two-sided test applied: red on the build it names (a faithful paste of
a malformed template), green on a correct one, reachable ("Yes, and it occurred"), and correctly
marked non-redundant with D1 ("D1 checks only the first line's prefix and uniqueness, and cannot
see the body"). Labelled manual inspection, consistent with D5-D9. It does the job.

**Step numbering, re-derived once more** since D11 was added: steps 1-9 at `:443, :446, :483, :488,
:496, :515, :526, :540, :552` — contiguous, no duplicate, no gap. Cross-references at `:438-439`,
`:490`, `:528`, `:351`, `:778` all resolve. Clean.

## On the aborted script

Worth recording, because it is the most useful process finding in four rounds: a script whose first
assertion failed applied **none** of its edits, and the only thing standing between that and a
changelog reporting four completed items that did not exist was the verification grep afterwards. I
independently confirmed all four of those edits are in fact present (`:576` D11, `:771-775` and
`:776-779` manifest, `:794-799` history), so the recovery worked. The lesson generalises: on this
document every round has produced at least one "correct in the section I edited, stale in the
section I did not", and grep-after-edit is what has caught them. Keep it.

## Fold-ins — none blocking, none gating the Coder

1. **D11's middle clause names the wrong artifact.** `:576` requires that "every `>` line sits
   under the list item". That is a property of the *template in this plan*, where `>` is the
   blockquote marker. The artifact D11 says it inspects — the pasted entry in `docs/backlog.md` —
   should contain **no** `>` lines at all; its neighbours at `backlog.md:160-171` are plain `- `
   bullets. As written the clause is inert (vacuously true on a correct paste). The other two
   clauses are correctly aimed and do the work, so D11 still passes the two-sided test. Suggested
   reword, which is strictly stronger than what I originally asked for: *"no stray `>` blockquote
   markers survive the paste — the entry is a plain `- ` bullet matching its neighbours."* That
   converts an inert clause into a real defect check, and it catches a paste error D1 cannot see on
   continuation lines.
2. **The manifest's criteria count is stale again** — `:756` says "All 10 done conditions
   (D1-D10)"; D11 makes eleven, and the result sentence that follows still characterises only
   D1-D6. Third round running for this sentence (6 → 10 → 11). It is the artifact the next reviewer
   samples, so it is worth getting right once.
3. **The stub changelog at `:10` still reads "v1 (2026-09-19) — first draft."** It sits directly
   under the title of a v4 document, with the real revision history 780 lines below. Either delete
   it in favour of §"Revision history" or keep it current. Flagging it now because it is the single
   most visible stale line in a document whose last two rounds were about exactly that.

**NITs:** the v4 entry is filed between v2 and v3 rather than at the top or bottom — both are
present and dated, so the content is complete, just misordered. `:776-779` reads as a splice
("Formerly: nothing … **was** built on it; only Appendix B **is** … **is** explicitly gated"),
though the meaning is clear. Step 6's `:520-524` "Row (a) details" restatement and its now-false
"Without it, every row is `true` on both sides", and the blank lines at `:494-495`, both carried
from earlier rounds as optional.

## Verdict rationale

Findings by round: 13 (2 blocking) → 8 (2 blocking) → 7 (1 blocking) → 3 fold-ins (0 blocking).

The substance has been settled since round 2 and I have had no concerns about it since: the WONTFIX
reasoning is sound and correctly hedged, the §1.2 proof survives an adversarial counterexample hunt,
the falsification work on the parity test is genuine, and D1-D11 are each either two-sided or
honestly labelled as manual inspection. The register template — the artifact that broke in three
consecutive rounds — has been rebuilt as a unit and now has a criterion watching it.

None of the three fold-ins can cause a wrong implementation: one is an inert clause in a criterion
that works anyway, one affects the next reviewer, one is a line nobody acts on. Holding a fifth
round for them would cost more than it buys, and the plan is ready for the Coder. Fold them in when
convenient — no re-review needed.

APPROVE
