# Architect Kickoff: File attachments on items (`feat/attachments`)

Requested by a family member: attach files (screenshots + documents) to an item so the details live with the reminder. Cross-layer feature. Produce a plan at `docs/plans/attachments.md`, then plan-review → Coder → QA.

## Owner decisions (LOCKED — do not re-litigate)

1. **Storage: Cloudflare R2** (D1 is wrong for binaries). **R2 is NOT yet enabled on the prod account** — build + test against Wrangler's LOCAL R2 emulation (`wrangler dev --local` / miniflare). Prod deploy is gated on the owner enabling R2 in the dashboard + a bucket being created; the plan must call this out as a deploy prerequisite, but must NOT block development. Specify the `wrangler.toml` R2 binding (e.g. binding name `ATTACHMENTS`, bucket `family-scheduler-attachments`) and how local dev/tests use the emulated bucket.
2. **File types (v1): images + PDF + common docs.** Define an explicit MIME + extension allowlist: PNG, JPEG, PDF, DOCX, XLSX, plain text (`.txt`). Reject anything else with the existing `VALIDATION` error. Validate on the server (never trust the client); decide whether to sniff magic bytes or trust Content-Type + extension (state the tradeoff — at minimum validate extension + declared type; note magic-byte sniffing as optional hardening).
3. **UI (v1): item editor + a MINIMAL read-only item view.** Upload/view/remove attachments in `ItemEditor`. ALSO surface attachments in a read-only item view — NOTE there is no read-only item detail view today (items open into `ItemEditor`). Build a **minimal** read-only view/panel to display an item's attachments (image thumbnails; filename + download for PDF/docs). Keep it lean — do NOT pull in the full `feat/ui-redesign`; this is a small, self-contained viewing surface that the redesign can later absorb/restyle. Justify where it lives (e.g. a lightweight item-detail modal or an expandable row in the list).

## Open decisions for the architect to RESOLVE (with rationale)

- **Size caps:** per-file and per-item total. Recommend sensible defaults (e.g. per-file ≤ 10 MB, per-item total ≤ a bound) and enforce server-side. Consider R2 free-tier friendliness.
- **`attachment` table schema** (additive migration `0006_attachments.sql`): at least `id` (server UUID), `item_id` (FK → items, ON DELETE CASCADE declared but app-level cascade is authoritative per project convention), `filename` (original, sanitized for display), `content_type`, `size` (bytes), `r2_key` (the object key in the bucket), `uploaded_by` (email from JWT), `created_at` (EpochMs). Decide the `r2_key` scheme (e.g. `items/<item_id>/<attachment_id>/<sanitized-name>` or a flat UUID key) with rationale (avoid collisions, enable prefix-delete on item removal).
- **API routes** (thin Hono handlers; authz enforced in `db.ts`):
  - Upload (`POST /api/items/:id/attachments` — multipart or raw body; decide), returns attachment metadata.
  - List (`GET /api/items/:id/attachments`) — metadata list.
  - Download (`GET /api/attachments/:attachmentId` or `/api/items/:id/attachments/:attachmentId`) — streams the R2 object with correct Content-Type/Content-Disposition.
  - Delete (`DELETE .../:attachmentId`) — removes the R2 object AND the row.
  - **Authorization:** a user may read an item's attachments iff they can READ the item's list (`canReadList`); may upload/delete iff they can WRITE the list (`canWriteList`). Mirror the exact 200/403/404 semantics of `getItemForUser`/`getItems`. `uploaded_by` ALWAYS from the verified JWT identity, never the request body (project HARD RULE).
- **Cascade cleanup (P2-N1 HARD REQUIREMENT — read `db.ts` deleteItem ~L722 and deleteList ~L430):** when an item is deleted, its attachment rows AND their R2 objects must be cleaned up; when a list is deleted, this applies to every item in it. R2 object deletion is a network call that can fail — decide ordering and failure handling (e.g. delete R2 objects, then rows; or best-effort R2 delete with orphan-sweep note). Preserve the existing dispatch-cleanup ordering. Be explicit: DB cascade alone does NOT remove R2 blobs.

## Locked / do not touch

- Auth/Access verification; the reminder engine; the push crypto (`channels/push.ts`); the notifications-and-location content builders. Attachments do NOT surface in notifications for v1 (note as a future item).
- The `Result<T>` pattern, EpochMs UTC, server-generated `crypto.randomUUID()` IDs, `email` from JWT.

## Tests / done conditions

- Unit: MIME/size validation (accept allowlist, reject others + oversized); route authz (owner upload/download/delete 200; non-owner on private item 403; missing 404); cascade (deleting an item removes its attachment rows + triggers R2 object deletion — assert against the emulated bucket); `r2_key` scheme.
- Component: the ItemEditor upload control (select file → upload → appears in list → remove); the minimal read-only attachment view (image thumbnail vs. download link).
- Local E2E-ish (QA): against emulated R2 — upload an image + a PDF + a docx to an item, see them listed, download one, delete one, delete the item and confirm cleanup.
- Explicitly deferred to owner: prod verification (needs R2 enabled + bucket + binding).

## Process

Architect plan → plan-review → Coder → QA. Flag the additive migration `0006` and the `wrangler.toml` R2 binding for owner awareness. Deploy is gated on the owner enabling R2 + creating the bucket (call this out in the plan's deploy section).
