# QA Report: `feat/attachments` (file attachments on items via Cloudflare R2)

Branch: `feat/attachments` (uncommitted working tree). QA performed read-only; no application
code edited.

Plan: `docs/plans/attachments.md` (rev 2). Review: `docs/reviews/attachments-review.md` (round 1 +
round 2 APPROVE). Impl notes: `docs/plans/attachments-impl-notes.md`. Kickoff:
`docs/attachments-kickoff.md`.

## Summary verdict: PASS

All automated gates match the Coder's claimed counts exactly. Code read of the risky areas
(cascade ordering, authz mirroring, download safety, validation) matches the plan precisely, with
no deviation found. Live functional testing against the real dev server (Wrangler `wrangler dev`,
emulated R2, dev-auth shim) exercised the full upload → list → download → delete → item-delete
cascade flow for an image, a PDF, and a real (zip-valid) DOCX, all successful with zero console
errors. Oversized and disallowed-extension uploads are rejected server-side with clear
`VALIDATION` errors (also client-pre-validated). No defects found.

## Done-conditions table

| Condition | Status | Evidence |
|---|---|---|
| Automated gates (typecheck/lint/test) | **PASS** | `npm run typecheck`: clean (both tsconfigs). `npm run lint`: 0 errors, 4 warnings (all 4 pre-existing/unrelated, confirmed by content: `push.ts` unused-disable, `App.tsx`/`ItemListView.tsx`/`RecurrenceEditor.tsx` exhaustive-deps). `npm test`: **174/174 passing**, 24 test files. New: `attachments-binding` (1), `attachments-validation` (14), `attachments-routes` (7), `attachments-cascade` (4), `AttachmentsEditor.test.tsx` (5), `AttachmentsView.test.tsx` (4) = **35 new tests**, matching impl notes exactly. |
| Cascade (P2-N1) — `deleteItem`/`deleteList` | **PASS** | Code read of `src/worker/db.ts` L428-517 (`deleteList`) and L771-808 (`deleteItem`): R2 object delete (`deleteAttachmentObjectsForItem`) + `DELETE FROM attachment` inserted strictly AFTER `deletePendingDispatchForItem`/`deletePendingDispatchForList` and strictly BEFORE the existing child deletes (`item_reminders`, `item_occurrence_state`, `items`). `deleteList` enumerates item ids via `SELECT id FROM items WHERE list_id = ?` BEFORE any delete, matching the dispatch-subquery rationale. `deleteAttachmentObjectsForItem` (db.ts L1000-1017) wraps the entire cursor-paginated `list`+`delete` loop in try/catch, `console.warn`s and continues on error — confirmed best-effort, never wedges the row delete. Live-verified: uploaded 2 attachments to a fresh item, confirmed both downloadable (200), deleted the item via the UI, confirmed `GET .../attachments` and both direct downloads return `404 NOT_FOUND` ("Item not found" — item-level 404 fires first, as expected since the item row itself is gone). Unit-level confirmation is even stronger: `attachments-cascade.test.ts` asserts `env.ATTACHMENTS.get(r2Key)` is `null` after `deleteItem`/`deleteList` against the real (non-mocked) emulated R2 bucket — this is a genuine object-absence check, not just a dangling-row inference. |
| Authorization (read=canReadList, write=canWriteList, 404-before-403, `uploaded_by` from JWT) | **PASS** | Code read of `listAttachments`, `getAttachmentForDownload`, `prepareAttachmentUpload`, `deleteAttachment` (db.ts L816-989): every function resolves the item row first (absent → `NOT_FOUND`), then checks `canReadList`/`canWriteList` (false → `FORBIDDEN`) — exact mirror of `getItemForUser`. `createAttachment` is INSERT-only, no second authz check (m3 pinned contract honored). `uploaded_by` bound from the `email` parameter (JWT identity via `user.email` in the route), never the request body — confirmed by `attachments-routes.test.ts`'s "uploaded_by is always the JWT identity, even if a client tries to spoof it via the form" test (passing) and route code (`routes/items.ts` — no code path reads a body field for `uploaded_by`). Second-user/live authz not exercised live (single static dev-auth-shim identity per server process makes swapping users mid-session disruptive); relied on the full passing `attachments-routes.test.ts` suite (7/7) per the plan's explicit fallback allowance — covers 403 on private-item list/download/upload/delete, 404 on missing item, 404 on missing attachment-id, and shared-list-member 200/201. |
| Download safety (`Content-Type` from DB only + nosniff, sanitized filename) | **PASS** | Code read (`routes/items.ts` L384-393): `Content-Type` header set exclusively from `attachment.content_type` (DB column), never from `object.httpMetadata`. `X-Content-Type-Options: nosniff` always set. `Content-Disposition` uses `disposition` computed from the DB content-type (`inline` for `image/*`, else `attachment`) with `sanitizeForHeader()` stripping `\r\n"` from the filename. Live-verified via `curl -D -`: PNG → `Content-Type: image/png`, `Content-Disposition: inline; filename="permission slip.png"`, `X-Content-Type-Options: nosniff`, `ETag` present. PDF/DOCX → `Content-Type` exact allowlisted values, `Content-Disposition: attachment; filename="..."`, `nosniff` present. Filename with an embedded space ("permission slip.png") round-tripped correctly through upload → DB → download header, confirming `sanitizeFilename()` (which strips raw control bytes 0x00-0x1F/0x7F and path separators, NOT spaces/hyphens — see note below) behaves as intended. |
| Validation (MIME+extension allowlist, per-file/per-item/count caps) | **PASS** | Code read (`routes/items.ts` `validateAttachmentFile`, L446-474): extension-from-sanitized-filename + Content-Type-before-`;` comparison against `ATTACHMENT_ALLOWLIST`; empty or `application/octet-stream` declared type falls back to the extension's canonical type (documented empty-`.txt` case, matches plan §5.3 exactly, including the real-multipart `application/octet-stream` normalization the Coder discovered empirically). `prepareAttachmentUpload` (db.ts L880-920) enforces per-item count (≤10) and total-bytes (≤25MB) caps via `SELECT SUM(size)/COUNT` BEFORE any R2 write, TOCTOU risk documented per plan (m5, acceptable at family scale). Live-verified: `.exe` upload → 400 `VALIDATION` "File extension '.exe' is not allowed" (both client pre-check and server, confirmed via direct `curl` bypassing the UI). 11MB PNG → 400 `VALIDATION` "File exceeds the maximum size of 10485760 bytes" (both client pre-check and server-side curl). `attachments-validation.test.ts` (14/14 passing) covers all 6 allowlisted types incl. DOCX/XLSX, oversize, per-item-bytes-cap, per-item-count-cap, empty-type `.txt` fallback. |
| Live upload → list → download → delete (image, PDF, docx) | **PASS** | Full browser flow via Playwright against `http://localhost:8787` (Wrangler dev, emulated R2, dev-auth shim active as `juniwar.dev@gmail.com`). Uploaded `permission slip.png` (1×1 PNG), `field-trip-form.pdf` (minimal valid PDF), `permit-form.docx` (real zip-structured OOXML docx) via the `AttachmentsEditor` "Choose File" control in `ItemEditor` edit mode — all three appeared in the editor's attachment list immediately after upload (server round-trip, not optimistic-only). Read-only `AttachmentsView` (expandable "Attachments ▼" row in `ItemListView`) correctly rendered an `<img>` thumbnail for the PNG and filename+download links for the PDF/DOCX (screenshot: `docs/qa/screenshots/attachments-readonly-view.png`). Deleted the PDF via "Remove" in the editor — disappeared from the UI list immediately; confirmed server-side via `GET .../attachments` (row gone) and direct download (404). Zero console errors throughout (1 pre-existing, unrelated PWA meta-tag deprecation warning). |
| Cascade cleanup (item delete removes attachments, no orphaned access) | **PASS** | See cascade row above — live-tested end to end (create item → upload 2 attachments → confirm both downloadable → delete item via UI → confirm `GET .../attachments` 404 and both direct downloads 404) plus the dedicated unit suite's real-R2-object-absence assertions. |
| Create-mode "save first" hint | **PASS** | Confirmed live: opening "+ New Item" (unsaved) renders "Save the item first, then add attachments." in place of the upload control, exactly per plan §3.7. |
| Expander state isolation (n2) | **PASS** | Code read of `web/src/components/ItemListView.tsx` L173-176, 239: `attachmentsExpanded` is a per-row local `useState`, does not touch `activeView`/`initialOpenItem` (confirmed those are separate `useState` hooks at a different scope, L34-57). No regression risk to the f64c556 unified view-state fix. |
| Prod verification | **DEFERRED (by design, not a QA failure)** | Confirmed: `wrangler.toml` has the `[[r2_buckets]]` binding added but NOT deployed; R2 is not enabled on the prod Cloudflare account (owner action per plan §8: enable R2, create `family-scheduler-attachments` bucket, apply `0006` to prod D1, deploy). This QA validated entirely against local `wrangler dev` with miniflare-emulated R2, per the task's explicit scope boundary. |

## Issues found

None. No defects identified during code read or live functional testing.

### Note on a false-positive I ruled out during review (documenting for transparency)

While statically reading `routes/items.ts`, `sanitizeFilename()`'s regex appeared (via `grep`/`Read`
tool rendering) to be the literal character class `[ -]` (space, hyphen), which would strip spaces
and hyphens from filenames and contradict its comment ("deliberately stripping control chars
(CR/LF/etc.)"). Byte-level inspection (`xxd`/Python) revealed the actual regex is
`/[\x00-\x1f\x7f]/g` — real raw control-character bytes written directly in the source rather than
escape sequences — which several text tools (including `grep` under a default locale, and this
session's `Read` tool) render as blank/whitespace. This is confirmed correct and matches the
comment: only NUL–US (0x00-0x1F) and DEL (0x7F) are stripped, plus `\`/`/` → `_`. Live proof:
uploading `permission slip.png` round-tripped the space intact through upload → DB
(`GET /attachments` returned `"filename": "permission slip.png"`) → download `Content-Disposition`
header. No actual defect. Flagging only because raw control bytes embedded directly in a regex
literal (vs. `\x00-\x1f` escape syntax) are unusual enough to trip up static review tools and a
future reader — the Coder may want to consider switching to escape-sequence syntax
(`/[\x00-\x1f\x7f]/g` written with escapes rather than literal bytes) purely for readability/
grep-ability, but this is a nit, not a defect, and does not affect the verdict.

## Console errors and warnings

Zero console errors across the entire session (page load, list/calendar view, item create/edit,
3× file upload, 1× delete, item delete, cascade verification). One pre-existing warning unrelated
to this feature: `<meta name="apple-mobile-web-app-capable">` deprecation notice (PWA manifest,
not attachments-related).

## Network failures and slow responses

No failed requests. All attachment-related network calls observed during the Playwright session
returned expected statuses: `201 Created` (upload ×3), `200 OK` (list/download), `204 No Content`
(delete). No slow responses observed (local dev server, emulated R2 — all attachment operations
completed well under 100ms per the earlier `npm test` timing and interactively felt instantaneous).

## Accessibility observations

Not a focus of this QA pass (functional/security-focused per the task brief), but incidentally
noted: the "Attachments ▼/▲" toggle and "Choose File"/"Remove" controls are all real `<button>`
elements exposed correctly in the accessibility tree (confirmed via Playwright snapshot — proper
`button` roles, discernible names). The image thumbnail in the read-only view is wrapped in a
`<link>` (anchor) with the `<img>` alt text set to the filename ("permission slip.png"), which is
reasonable but worth a future pass to confirm decorative vs. content semantics if the redesign
touches this component.

## Performance notes

None applicable — this is a local, emulated-R2 functional QA pass, not a performance audit. All
operations were fast; no traces were captured as none were warranted.

## Environment notes

- Dev server: `npm run dev` (`vite build` then `wrangler dev` via `concurrently`), confirmed
  `env.ATTACHMENTS (family-scheduler-attachments) R2 Bucket local` binding present in the startup
  banner, and `[dev-auth] shim active as juniwar.dev@gmail.com` logged (per `.dev.vars`
  `DEV_AUTH_IDENTITY="owner"` → resolved to `OWNER_EMAIL`).
- Migration `0006_attachments.sql`: already applied locally (`npx wrangler d1 migrations apply
  family-scheduler --local` reported "No migrations to apply!" — confirms prior application).
- Browser tool used: **Playwright MCP** for all navigation, file uploads (via file-chooser modal
  interception), form interaction, accessibility snapshots, console/network inspection, and the
  screenshot. Chrome DevTools MCP was not needed — no network-timing, performance-trace, or deep
  debugging requirement arose during this pass.
- Test fixtures: created locally under `.playwright-mcp/qa-uploads/` (Playwright's file-upload
  sandbox restricts to the project directory) — a 1×1 PNG, a minimal structurally-valid PDF, a
  real zip-valid DOCX (built by hand with a minimal OOXML `document.xml`/`.rels`/`[Content_Types].xml`),
  a `.txt`, a disallowed `.exe`, and an 11MB oversized PNG. All deleted after the session; the
  ephemeral local D1/R2 dev state (`.wrangler/state/v3`) was left as-is (not committed, resets on
  next `wrangler dev`).
- No `docs/dev-fixtures.md` exists in this repo (this is not a Shopify storefront project — the
  generic storefront-password fixture instructions in this session's tool preamble do not apply;
  the task-specific brief's dev-auth-shim + Chromium instructions were followed instead, which is
  the correct environment for this codebase per `CLAUDE.md` and `MEMORY.md`).

## Screenshots

- `docs/qa/screenshots/attachments-readonly-view.png` — the expanded read-only `AttachmentsView`
  panel on the item row, showing the PNG thumbnail (linked to its download URL) alongside
  `field-trip-form.pdf` and `permit-form.docx` download links.

## Scope boundary confirmation

Confirmed untouched by this feature (per plan §2/locked zones): `src/worker/auth.ts`,
`src/worker/reminders/*`, `src/worker/channels/push.ts` (verified via `git diff --stat` against
each path — zero changes). `git diff --stat` / `git status --porcelain` confirms the full change
set matches the plan's "Affected files" list (§4) exactly — no unexpected files modified.

Production deploy prerequisites (R2 enablement, bucket creation, prod D1 migration `0006`, deploy)
are explicitly **DEFERRED to the owner** per plan §8 and the task brief's scope boundary — not
treated as a QA blocker.
