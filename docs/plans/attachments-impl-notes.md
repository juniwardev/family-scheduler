# Implementation notes: `feat/attachments` (file attachments on items via R2)

Plan: `docs/plans/attachments.md` (rev 2). Review: `docs/reviews/attachments-review.md` (round 1 +
round 2 APPROVE). Branch: `feat/attachments` (already checked out at session start). Base commit:
`8176170` (main, per `git log` at session start). Working tree left **uncommitted** per
instructions.

## 1. Phase-1 spike result (hard gate — passed)

`env.ATTACHMENTS` DOES surface in the worker vitest-pool-workers project. Exact config used:

```ts
// vitest.workspace.ts — worker project's inline miniflare block
miniflare: {
  d1Databases: { DB: "local-test-db" },
  r2Buckets: ["ATTACHMENTS"],
},
```

`tests/unit/attachments-binding.test.ts` proves it: `env.ATTACHMENTS.put()/get()/delete()`
round-trip correctly against the miniflare-emulated bucket. Ran alone first (green) before any
route/db code was built on top of it, per the plan's hard-gate instruction. No key-name mismatch
was found for the installed `@cloudflare/vitest-pool-workers@^0.6.0` — `r2Buckets: [...]` (array of
binding names) was correct on the first try.

## 2. Files changed, by layer

### Migration
- `migrations/0006_attachments.sql` (new) — additive `attachment` table + `idx_attachment_item`
  index, exactly per plan §5.1.

### Wrangler / infra
- `wrangler.toml` — added `[[r2_buckets]]` block (`binding = "ATTACHMENTS"`,
  `bucket_name = "family-scheduler-attachments"`). **Not deployed** (prod R2 not enabled — owner
  action still pending per plan §8).

### Worker
- `src/worker/env.ts` — added `ATTACHMENTS: R2Bucket` to `Env`.
- `src/worker/types.ts` — added `Attachment`, `AttachmentRow`, `CreateAttachmentInput`.
- `src/worker/config.ts` — added `ATTACHMENT_MAX_FILE_BYTES` (10 MB), `ATTACHMENT_MAX_ITEM_BYTES`
  (25 MB), `ATTACHMENT_MAX_ITEM_COUNT` (10), and `ATTACHMENT_ALLOWLIST` (extension -> allowed
  Content-Type(s), PNG/JPEG/PDF/DOCX/XLSX/TXT).
- `src/worker/db.ts`:
  - Added `mapAttachment`, `listAttachments`, `getAttachmentForDownload`,
    `prepareAttachmentUpload` (single authz + cap check), `createAttachment` (INSERT-only, pinned
    signature `(db, email, itemId, id, input, now)`), `deleteAttachment`,
    `deleteAttachmentObjectsForItem` (best-effort R2 prefix delete with a `truncated`/`cursor`
    pagination loop, per m6 — chose the cursor-loop option over a cap-tied comment).
  - Changed `deleteItem` signature to `(db, email, id, bucket: R2Bucket)` — inserted R2-object
    delete + `DELETE FROM attachment` between the dispatch purge and the existing child deletes
    (P2-N1 ordering preserved verbatim).
  - Changed `deleteList` signature to `(db, email, id, bucket: R2Bucket)` — enumerates item ids
    BEFORE any delete, R2-deletes per item, then `DELETE FROM attachment WHERE item_id IN (...)`,
    inserted in the same P2-N1-safe slot.
- `src/worker/routes/items.ts` — added the four attachment routes
  (`POST/GET(list)/GET(download)/DELETE /api/items/:id/attachments[/:attachmentId]`), plus
  `validateAttachmentFile`, `isUploadedFile`, `sanitizeFilename`, `sanitizeForHeader` helpers.
  Updated the existing `DELETE /api/items/:id` handler to pass `c.env.ATTACHMENTS`.
- `src/worker/routes/lists.ts` — updated `DELETE /api/lists/:id` to pass `c.env.ATTACHMENTS`.

### Tests (worker)
- `tests/unit/attachments-binding.test.ts` (new) — Phase-1 spike.
- `tests/unit/attachments-validation.test.ts` (new, 14 tests) — allowlist accept (all 6 types
  incl. DOCX/XLSX) / reject (`.exe`, SVG, mismatched ext/type) / oversize / per-item-bytes-cap /
  per-item-count-cap / empty-Content-Type `.txt` fallback.
- `tests/unit/attachments-routes.test.ts` (new, 7 tests) — owner upload/list/download/delete
  happy path; image vs doc `Content-Disposition`; non-owner-on-private 403 across all 4 routes;
  missing-item 404 across all 4 routes; missing-attachment-id 404; shared-list read/write by any
  member; `uploaded_by` always from JWT even if a client tries to spoof it via the form body.
- `tests/unit/attachments-cascade.test.ts` (new, 4 tests) — `r2_key` scheme assertion;
  `deleteItem` removes row + R2 object (against the real emulated bucket); `deleteList` does the
  same across two items; best-effort R2 delete (op succeeds even if the object was already gone).
- `tests/unit/db.test.ts` — updated `deleteItem`/`deleteList` call sites for the new signature
  (added a minimal `fakeBucket` since these tests exercise the dispatch/reminders cascade, not
  the R2 cascade); added the `attachment` DDL to `applyMigrations`; added `"attachment"` to
  `clearTables` ahead of `"items"` (m1); added attachment-row seed + orphan-row assertions to both
  existing cascade tests.
- `tests/unit/vitest.d.ts` — added `ATTACHMENTS: R2Bucket` to the `cloudflare:test` `ProvidedEnv`
  declaration (required for `env.ATTACHMENTS` to typecheck in test files).
- `tests/unit/push-vapid.test.ts` — added `ATTACHMENTS: {} as R2Bucket` to `buildFakeEnv()`'s
  literal (mechanical fallout of `Env` gaining a new required field; this file is unrelated to
  attachments but constructs a full `Env` object literal, so it needed the new field to
  typecheck — see "Deviations" below).

### Frontend
- `web/src/types.ts` — added the browser-safe `Attachment` type (no `r2_key`).
- `web/src/apiClient.ts` — added `listAttachments`, `uploadAttachment` (own `fetch` + `FormData`,
  does NOT use the JSON `request()` helper), `deleteAttachment`, `attachmentDownloadUrl`.
- `web/src/components/AttachmentsEditor.tsx` (new) — upload/list/remove control, edit-mode only;
  exports `AttachmentsCreateHint` for create-mode ("save first" hint).
- `web/src/components/AttachmentsView.tsx` (new) — minimal read-only thumbnail/download panel,
  lazy-fetch on mount (mounted only when the row's expander is open).
- `web/src/components/ItemEditor.tsx` — renders `<AttachmentsEditor>` in edit mode,
  `<AttachmentsCreateHint>` in create mode.
- `web/src/components/ItemListView.tsx` — added a per-row "Attachments ▲/▼" toggle
  (`useState` local to `ItemRow`) that lazily mounts `<AttachmentsView>`. Does not touch
  `activeView`/`initialOpenItem` (n2).
- `web/src/components/AttachmentsEditor.test.tsx` (new, colocated, 5 tests) — list-on-mount,
  select→upload→appears, remove→disappears, client pre-validation rejects a disallowed extension.
- `web/src/components/AttachmentsView.test.tsx` (new, colocated, 4 tests) — image thumbnail vs.
  filename+download link, empty-list message, lazy single-fetch-on-mount.

## 3. Migration created + applied locally

`migrations/0006_attachments.sql` created and applied via
`npx wrangler d1 migrations apply family-scheduler --local` — confirmed `✅` in the local D1
instance (`.wrangler/state/v3/d1`).

## 4. Typecheck result

Clean: `npm run typecheck` (both `tsconfig.worker.json` and `tsconfig.web.json` passes) with no
errors, at every checkpoint through the implementation.

## 5. Lint result

0 errors throughout. Final `npm run lint`: **0 errors, 4 warnings** (all 4 warnings are
pre-existing, unrelated to this feature: one `no-explicit-any` unused-disable in `push.ts`, three
`react-hooks/exhaustive-deps` in `App.tsx`/`ItemListView.tsx`/`RecurrenceEditor.tsx` — the
`ItemListView.tsx` one predates this change, at a different line number now due to the new import).

## 6. `npm test` result

**174/174 passing** (baseline before this feature was 139/139, per the task brief). New tests:
1 (spike) + 14 (validation) + 7 (routes) + 4 (cascade) + 5 (AttachmentsEditor) + 4
(AttachmentsView) = **35 new tests**. All pre-existing tests still pass unchanged, including the
two `db.test.ts` cascade tests that were extended with attachment-row assertions.

## 7. Notable implementation details / deviations from the literal plan text

None of these are scope deviations — all are mechanical consequences of implementing the plan
against the real, current codebase (as instructed: "If any plan step proves infeasible... STOP".
None of the below made a plan step infeasible; they were necessary, narrowly-scoped fixes
discovered while proving the code against the real toolchain):

1. **`cloudflare:test` `ProvidedEnv` needed the new binding declared** (`tests/unit/vitest.d.ts`).
   Not explicitly called out in the plan, but required for `env.ATTACHMENTS` to typecheck in any
   test file — a direct, mechanical consequence of adding `ATTACHMENTS` to `Env` (plan's own
   Phase-1 instruction).
2. **`tests/unit/push-vapid.test.ts` needed `ATTACHMENTS` added to its literal `Env` object.** This
   file is unrelated to attachments but builds a full `Env` value via `buildFakeEnv()`; adding a
   required field to `Env` (as the plan explicitly instructs) breaks that literal until updated.
   One-line fix, no logic change to that file.
3. **Installed `@cloudflare/workers-types` types `FormData.get()` as `string | null`**, omitting
   the `File` arm present in some dated snapshots — even though the real Workers runtime returns a
   `File` for a file part. Worked around with a runtime duck-type check (`isUploadedFile`) instead
   of a bare `instanceof File` (which fails to typecheck against the mistyped return), then a
   type-only cast. This does not weaken validation — the actual allowlist/size/authz checks are
   unchanged; it only fixes a compile-time type gap in a third-party `.d.ts`.
4. **Empty declared Content-Type over real multipart bodies normalizes to
   `application/octet-stream`**, not `""`, once a `File` with `type: ""` round-trips through an
   actual HTTP multipart request body in workerd (confirmed empirically via a throwaway debug
   test, since removed). The plan's documented empty-type-`.txt` fallback (§5.3) is implemented to
   also treat `application/octet-stream` as "no real type declared" for this reason — otherwise a
   legitimate empty-type `.txt` upload over real multipart would be wrongly rejected. This is an
   extension of the plan's own stated intent, not a contradiction of it.
5. **`deleteAttachmentObjectsForItem` uses the cursor-loop option from m6/§3.4** (not the
   cap-tied-assertion alternative), with an inline comment explaining the choice, per the plan's
   instruction to pick one explicitly.

## 8. Bug fix verification approach

N/A — this is a new feature (`feat/attachments`), not a bug fix. No slug starting with `fix-`.

## 9. Out-of-scope observations

None found. No pre-existing bugs were discovered outside the plan's scope during implementation.

## 10. How to run the feature locally

```
npm install
npx wrangler d1 migrations apply family-scheduler --local   # already applied this session
npm run dev                                                  # wrangler dev — serves Worker + PWA
```

Then, in the app: open an existing item's editor to see the "Attachments" upload/list/remove
control (create mode shows the "save first" hint); on the item list row, click "Attachments ▼" to
expand the read-only thumbnail/download panel.

To re-run just the new tests:
```
npx vitest run tests/unit/attachments-binding.test.ts tests/unit/attachments-validation.test.ts \
  tests/unit/attachments-routes.test.ts tests/unit/attachments-cascade.test.ts
npx vitest run --project web web/src/components/AttachmentsEditor.test.tsx \
  web/src/components/AttachmentsView.test.tsx
```

## 11. Deferred / infeasible

Nothing was deferred or found infeasible. The Phase-1 R2 binding spike passed on the first
attempt with the plan's exact prescribed config, so no blocker document
(`docs/plans/attachments-coder-questions.md`) was needed.

Reiterating from the plan (§8, owner-facing, not a Coder deferral): production deploy is still
gated on the owner enabling R2 + creating the `family-scheduler-attachments` bucket + applying
`0006` to production D1 — none of that was done here per explicit instruction ("Do NOT deploy").
