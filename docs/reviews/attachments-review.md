# Plan Review: `feat/attachments` (file attachments on items via R2)

Reviewer: Plan-Reviewer (adversarial). Plan under review: `docs/plans/attachments.md`.
Brief: `docs/attachments-kickoff.md`. Read-only pass; no code or plan edited.

## Verdict: APPROVE WITH CHANGES

The plan is strong on the highest-risk area (P2-N1 cascade) and on authorization. It correctly
preserves the dispatch-before-items ordering, threads the R2 bucket through `deleteItem`/`deleteList`,
enumerates item ids before deleting for `deleteList`, and keeps `uploaded_by` strictly from the JWT.
Its line/callsite claims (`items.ts:212`, `lists.ts:89`, `db.ts` L430/L722) are all accurate against
the code. However it points the Coder at the **wrong test-config file** for R2 emulation, uses a
**non-existent test directory convention** for web tests, and misses a **`clearTables` update** that
will cause cross-test bleed. Those are concrete, fixable defects that must be folded in before Coder.

---

## Findings by severity

### Blocker

None. The cascade design, authz mirroring, and signature-change blast radius are correct and complete
enough to build against once the Major items below are corrected.

### Major

**M1 — Wrong test-config target for R2 emulation (§4, §7.2).**
The plan tells the Coder to "add an R2 bucket to `vitest.config.ts` miniflare config." But the actual
worker test project is defined in `vitest.workspace.ts` (lines 14–27), and its own comment states
`vitest.config.ts` is deliberately NOT loaded as a workspace project ("referenced exactly once,
inline below, to avoid double-loading"). Editing `vitest.config.ts` will have **no effect** on the
tests run by `npm test` (`vitest run` → workspace). The worker pool there uses
`wrangler: { configPath: "./wrangler.toml" }` yet still declares `d1Databases: { DB: "local-test-db" }`
explicitly in `miniflare` — i.e. wrangler bindings are not being relied on to auto-surface in the
pool. So it is unproven that adding `[[r2_buckets]]` to `wrangler.toml` alone makes `env.ATTACHMENTS`
exist in tests.
Fix: add the R2 bucket to the **worker project's `miniflare` block in `vitest.workspace.ts`** (e.g.
`miniflare: { d1Databases: { DB: "local-test-db" }, r2Buckets: ["ATTACHMENTS"] }`), and drop the
`vitest.config.ts` instruction. Confirm the `@cloudflare/vitest-pool-workers` R2 emulation key name
against its version (`^0.6.0`) as a Phase-1 spike before writing route tests.

**M2 — Web component tests placed in a directory that does not match the repo convention (§4, §7.8).**
The plan lists new tests at `web/src/components/__tests__/AttachmentsEditor.test.tsx` /
`AttachmentsView.test.tsx`. Existing web tests are **colocated** (`web/src/components/ItemEditor.test.tsx`,
`NotificationSetup.test.tsx`, `InstallBanner.test.tsx`) and the web project's include glob is
`web/**/*.test.tsx`. A `__tests__/` file still matches the glob so it would run, but it breaks the
established convention (CLAUDE.md: "Match the tone and structure of existing project conventions"). The
plan hedges ("if none exists…") but states the wrong default as primary.
Fix: colocate as `web/src/components/AttachmentsEditor.test.tsx` and `AttachmentsView.test.tsx`.

### Minor

**m1 — `clearTables` update omitted (§4, §7.8).**
The plan only says to add the `attachment` table to `applyMigrations` in `tests/unit/db.test.ts`. But
`db.test.ts` also has a `clearTables` helper (lines 130–143) run in every `beforeEach`. Without adding
`attachment` there (before `items` in the reverse-FK list), attachment rows leak across tests and the
"no orphan attachment rows" assertion can pass/fail nondeterministically.
Fix: add `"attachment"` to `clearTables` ahead of `"items"`, and note that each NEW test file
(`attachments-*.test.ts`) carries its own inline `applyMigrations` copy — the harness does NOT read the
migration files, so the `attachment` DDL must be duplicated into every new worker test file that needs it.

**m2 — OQ-2 (DOCX/XLSX) is treated as open but the owner already locked it (§6, kickoff §2).**
The kickoff explicitly locks "images + PDF + common docs … PNG, JPEG, PDF, DOCX, XLSX, plain text." OQ-2
asks whether DOCX/XLSX "are actually needed for v1." That decision is already made; leaving it framed as
open invites a redundant owner round-trip.
Fix: mark OQ-2 RESOLVED (included per locked kickoff decision) and delete the "or whether …suffice"
phrasing. No owner action required.

**m3 — `createAttachment` signature in prose diverges from the resolved call shape (§5.4 vs §5.5/§7.3).**
§5.4 declares `createAttachment(db, email, itemId, input, now)` while §5.5/§5.4-note/§7.3 resolve to
passing `id` in explicitly: `createAttachment(db, email, itemId, id, {filename,…}, now)`. Same for whether
it re-runs authz. The plan says "the Coder picks one and documents it." That is under-specified for the
single most subtle correctness point (authz-enforced-exactly-once).
Fix: pin ONE signature in §5.4 (recommend: `createAttachment(db, email, itemId, id, input, now)` where
`input = {filename, content_type, size, r2_key}`) and state definitively that `prepareAttachmentUpload`
owns the authz + cap check and `createAttachment` is INSERT-only (no second authz round-trip). Remove the
"Coder picks one" latitude here.

**m4 — Download route: force `Content-Type` from stored value, never echo R2/client type (§3.6).**
The plan says to set `Content-Type` from the stored `content_type` (good) but also mentions R2
`httpMetadata`/`customMetadata` as defense-in-depth (§3.3/§3.2). Make it explicit that the response
`Content-Type` is derived ONLY from the DB `content_type` (which came from the server allowlist), never
from `object.httpMetadata.contentType` (which is client-influenced at put time). Also add
`X-Content-Type-Options: nosniff` on the download response to defeat MIME sniffing.
Fix: state the authoritative source for the response `Content-Type` is the DB column, and add the nosniff
header to the checklist (§7.4).

**m5 — Per-item aggregate cap has a TOCTOU race under concurrent uploads (§5.3).**
`SELECT SUM(size) … + incoming` then INSERT is not atomic; two concurrent uploads can each pass the 25 MB
check and both insert, overshooting the cap. At single-family scale this is benign, but it should be
acknowledged rather than presented as a hard guarantee.
Fix: add one line noting the cap is best-effort under concurrency (acceptable at family scale); no locking
required for v1.

**m6 — R2 `list({ prefix })` pagination not addressed in the cascade helper (§3.4).**
`deleteAttachmentObjectsForItem` uses `list({ prefix })` then `delete(keys)`. With the ≤10-files-per-item
cap this never paginates, so it is fine — but the helper should either rely on that cap explicitly or
loop on `truncated`/`cursor` defensively, so a future cap bump doesn't silently orphan objects past the
first page.
Fix: add a one-line note that the helper assumes ≤ `ATTACHMENT_MAX_ITEM_COUNT` objects per prefix (no
pagination needed) OR loop the cursor; pick one.

### Nit

**n1 — Multipart "reject before buffering" is aspirational in Workers (§5.2, §5.3).**
`await request.formData()` already buffers the full body into memory before you can read `file.size`, so
the per-file 10 MB cap bounds memory but the check is not strictly "before buffering." The claim
"rejects oversize BEFORE reading bytes into memory" overstates it. Consider also checking the
`Content-Length` header as an early cheap reject and keep the cap wording honest (the real bound is the
10 MB cap, enforced before the R2 `put`).

**n2 — `AttachmentsView` expander vs the `activeView` single-source-of-truth model (§3.7).**
The expander state is local per-row in `ItemListView` and does not touch `App`'s `activeView`
(`AppView = "list"|"calendar"|"admin"`) nor the `initialOpenItem` one-shot guard, so there is no
conflict — good. Worth stating explicitly in the plan that the expander is component-local `useState`
and does not interact with the recently unified view state (commit f64c556), so a reviewer/QA doesn't
suspect regression there.

**n3 — `Env` location.** §4 correctly says `src/worker/env.ts` gets `ATTACHMENTS: R2Bucket`; a couple of
prose references say "Env/bindings type in index.ts." `index.ts` only imports `Env`; the type lives in
`env.ts`. Minor wording only.

---

## Cross-check against the scrutiny checklist

- **Cascade (P2-N1):** Correct. R2 delete + `DELETE FROM attachment` inserted AFTER the dispatch purge
  and BEFORE `DELETE FROM items`, in both `deleteItem` and `deleteList`. `deleteList` enumerates item ids
  before any delete (matches the dispatch-subquery rationale). Verified against db.ts L430/L722.
- **Signature blast radius:** Correct and complete — `routes/items.ts` (delete handler L209–218),
  `routes/lists.ts` (L86–95), and `tests/unit/db.test.ts` call sites (L354, L432). typecheck is the safety
  net as claimed. (Add `clearTables` — see m1.)
- **Authz:** Sound. read=`canReadList`, write/delete=`canWriteList`, 404-before-403 mirrors
  `getItemForUser`. Download resolves the item/attachment via a `canReadList`-enforcing db.ts fn before
  streaming, so a non-owner cannot pull a private item's blob by attachment id. `uploaded_by` from JWT.
- **Best-effort R2 delete:** Reasonable; the orphan direction is the safe one (DB is source of truth).
  Orphan-sweep is correctly a documented future task, not a claimed guarantee.
- **r2_key scheme:** `items/<item_id>/<attachment_id>` is collision-free and prefix-deletable; delete path
  uses the stored key / prefix, not a reconstructed filename. No user bytes in the key. Good.
- **Migration 0006:** Additive, `0006` is the correct next number (0001–0005 exist), app-level cascade
  authoritative per convention. Good.
- **Download safety / header injection:** Sanitize filename for `Content-Disposition` is called out; see
  m4 for forcing the response `Content-Type` from the DB column + nosniff. SVG/HTML excluded deliberately.
- **Locked zones:** Confirmed untouched — auth, reminder engine, `channels/push.ts`, notification builders.

## Must-fix punch-list (fold in before Coder)

1. **M1** — Move the R2 test-binding into the worker project in `vitest.workspace.ts` (not
   `vitest.config.ts`); verify `env.ATTACHMENTS` actually surfaces in the worker pool as a Phase-1 spike.
2. **M2** — Colocate web component tests (`web/src/components/AttachmentsEditor.test.tsx` /
   `AttachmentsView.test.tsx`), not under `__tests__/`.
3. **m1** — Add `"attachment"` to `clearTables` in `db.test.ts`; note each new worker test file needs its
   own inline `attachment` DDL in its `applyMigrations` copy.
4. **m3** — Pin ONE `createAttachment` signature and state authz is enforced exactly once
   (`prepareAttachmentUpload`), INSERT-only creator.
5. **m4** — Response `Content-Type` sourced ONLY from the DB column; add `X-Content-Type-Options: nosniff`.
6. **m2** — Mark OQ-2 RESOLVED (owner already locked DOCX/XLSX).

## Open questions needing the owner before Coder?

No. OQ-1 (size caps) and OQ-3 (attachment count badge) are safe with the architect's defaults and are
tunable/deferrable. OQ-2 is already answered by the locked kickoff decision (fold in as m2). None block
the Coder once the punch-list is applied.

APPROVE WITH CHANGES

---

## Re-review (round 2)

Focused re-review of the amended plan (rev 2, per its revision note at plan L13–36). I re-read
`CLAUDE.md` (hard rules unchanged) and re-verified every load-bearing amendment against the actual
code. Round-1 content above is preserved verbatim.

### Code re-verification (what I confirmed this pass)

- `vitest.workspace.ts` L14–27: the worker project declares `miniflare: { d1Databases: { DB:
  "local-test-db" } }` **inline** (L20–22). Adding `r2Buckets: ["ATTACHMENTS"]` alongside `d1Databases`
  is exactly the right place. The block comment (L10–12) confirms `vitest.config.ts` is intentionally
  NOT loaded as a workspace project — so the rev-1 target was genuinely inert and the rev-2 target is
  correct. Installed `@cloudflare/vitest-pool-workers` is `^0.6.0` (package.json L24) — matches the
  version the plan tells the Coder to confirm the `r2Buckets` key against. PASS.
- `src/worker/env.ts`: `Env` interface lives here (L2–16); `ATTACHMENTS: R2Bucket` belongs in this
  file, not `index.ts`. n3 target correct. PASS.
- `tests/unit/db.test.ts`: `clearTables` (L130–143) is an inline, hard-coded reverse-FK list
  (`… "item_reminders", "push_subscriptions", "items", "lists", "users"`) run every `beforeEach`
  (L152). `attachment` must be inserted before `"items"`. `applyMigrations` (L25–128) hard-codes all
  DDL inline and does NOT read migration files — so per-file DDL duplication is real. `deleteItem`
  call at L354 and `deleteList` at L432 are the 3-arg form the plan says to update. All m1 / blast-radius
  claims verified. PASS.
- `web/src/components/*.test.tsx`: only `InstallBanner`, `ItemEditor`, `NotificationSetup` exist — all
  colocated; no `__tests__/` directory exists. M2 colocation target correct. PASS.
- `routes/items.ts:212` (`deleteItem(c.env.DB, user.email, id)`) and `routes/lists.ts:89`
  (`deleteList(c.env.DB, user.email, id)`) are the exact 3-arg call sites the plan threads
  `c.env.ATTACHMENTS` into. Line references accurate. PASS.

### Per-item punch-list results

| Item | Amendment claimed | Verified in plan | Result |
|------|-------------------|------------------|--------|
| **M1** | R2 binding moved to `vitest.workspace.ts` worker `miniflare` block; Phase 1 is a real spike proving `env.ATTACHMENTS` before dependents | Revision note L14–16; §4 L345–352; §5.6 L560–566; §7.2 L688–700 (spike gated "must pass before Phase 3", real put/get/delete assertions) | PASS |
| **M2** | Web tests colocated; `__tests__/` dropped | Revision note L18–20; §4 L306–313 (colocated, with explicit "do NOT place under `__tests__/`"); §7.8 L791–795 | PASS |
| **m1** | `attachment` added to `clearTables` before `items` (reverse-FK); inline-DDL-per-file requirement stated | §4 L339–343 ("`add "attachment" … ahead of "items"`"); §5.1 note L385–389; §6 L618–621; §7.2 L701–705; §7.8 L784–790 | PASS |
| **m2** | OQ-2 (DOCX/XLSX) folded as v1-included, not open | Revision note L25–26; §5.3 table L427–428 + L431–436; §6 OQ-2 L657–659 ("RESOLVED … no round-trip needed") | PASS |
| **m3** | Single pinned `createAttachment(db,email,itemId,id,input,now)`; `prepareAttachmentUpload` owns authz+caps once; creator INSERT-only | §5.4 L489–526 (pins signature, rejects the no-`id` alternative explicitly); §5.5 L530–549 (pinned route order, "authz enforced exactly once") | PASS |
| **m4** | Download `Content-Type` from DB column ONLY + `nosniff`; never from R2 httpMetadata | §3.2 L115–117; §3.6 L226–234; §5.7 L583; §7.4 L738–740 | PASS |
| **m5** | TOCTOU cap note (best-effort under concurrency) | §5.3 L459–463; §6 L628–629 | PASS |
| **m6** | R2 `list` pagination guard (cursor loop preferred, or cap-tied assertion) | §3.4 L192–198 (cursor loop preferred, must be explicit choice w/ comment); §5.4 L508 | PASS |
| **n1** | Honest multipart size-bound wording (buffers before `file.size`; cap enforced before `put`; optional `Content-Length` pre-check) | §5.2 L411–416; §6 L626–627 | PASS |
| **n2** | Expander is component-local `useState`, not `activeView`; no interaction w/ f64c556 unified state | §3.7 L273–277; §4 L338; §7.7 L766–767 | PASS |
| **n3** | `ATTACHMENTS: R2Bucket` in `env.ts` (not `index.ts`) | §4 L318–319; §5.6 L559; §7.2 L687 | PASS |

All 11 round-1 findings resolved. No PARTIAL, no FAIL.

### New-issue scan (amendment side-effects)

I specifically probed the three risk areas requested plus a general regression scan:

- **Schema drift between migration `0006` and the inline per-file DDL copies (introduced by the m1
  fix).** The plan calls this out honestly (§5.1 L385–389, §7.2 L701–705): the harness never reads
  migration files, so the `attachment` DDL is duplicated by design, and the plan even suggests a shared
  `tests/unit/_schema.ts` DDL export to reduce drift risk. This mirrors the EXISTING pattern in
  `db.test.ts` (which already re-implements 0003/0004/0005 as inline `ALTER` blocks) — so the plan is
  not introducing a novel liability, it is inheriting an existing one and flagging it. Acceptable, and
  the mitigation is noted. NOT a blocker; see minor observation R-1 below.
- **Miniflare `r2Buckets` key correctness at `^0.6.0`.** The plan does not assert the key is correct —
  it makes the Phase-1 spike the proof and tells the Coder to confirm the version-correct key name
  (§4 L351, §7.2 L692–693). That is the right posture; the spike is a hard gate before route/cascade
  tests. No new issue.
- **Cascade / authz / r2_key design intact.** The revision note (L33–36) explicitly lists these as
  "reviewer-validated, deliberately not touched," and §3.4 / §3.8 / §5.1 read identically to round 1:
  dispatch-purge-first, R2-delete + `DELETE FROM attachment` inserted after dispatch and before
  `DELETE FROM items`, item-id enumeration before deletes in `deleteList`, `uploaded_by` from JWT,
  `r2_key = items/<item_id>/<attachment_id>`. The wording changes did not perturb the load-bearing
  ordering. Verified against `db.ts` L430/L722 in round 1 and re-confirmed the route call sites this
  pass. No regression.

New findings:

- **R-1 (Nit, non-blocking).** The m6 guidance (§3.4 L192–198) leaves the cursor-loop-vs-comment
  choice to the Coder ("Pick the cursor loop unless there is a reason not to"). This is acceptable —
  the plan forces it to be an explicit, commented decision rather than an unstated assumption, which
  fully addresses the original m6 concern. Flagging only so the Coder does not skip the comment if
  they choose the cap-tied assertion path. Not a defect in the plan.

No new Major or Minor issues introduced by the amendments.

### Verdict (round 2)

**APPROVE — ready for Coder.**

All 11 round-1 findings (M1, M2, m1–m6, n1–n3) are resolved and verified against code; no new
blockers or majors surfaced; the validated cascade/authz/r2_key design is intact. The single most
important thing for the Coder to watch: **the Phase-1 spike is a hard gate — prove `env.ATTACHMENTS`
actually surfaces in the worker pool (real put/get/delete via `cloudflare:test` `env`) with the
version-correct `@cloudflare/vitest-pool-workers@^0.6.0` `r2Buckets` key BEFORE building any route or
cascade test on top of it.** If that key name is wrong for the installed version, every downstream
attachment test fails at the binding, not the logic.
