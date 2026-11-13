// routes/items.ts — item CRUD + /complete
import { Hono } from "hono";
import type { Env } from "../env";
import type { User, EpochMs } from "../types";
import {
  getItems,
  getItemForUser,
  createItem,
  updateItem,
  deleteItem,
  completeItem,
  setItemArchived,
  listAttachments,
  getAttachmentForDownload,
  prepareAttachmentUpload,
  createAttachment,
  deleteAttachment,
} from "../db";
import { expandOccurrences } from "../recurrence";
import { ATTACHMENT_ALLOWLIST, ATTACHMENT_MAX_FILE_BYTES } from "../config";

type Variables = { user: User };

export const itemsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/lists/:id/items[?from=&to=][?archived=1]
itemsRouter.get("/lists/:id/items", async (c) => {
  const user = c.get("user");
  const listId = c.req.param("id");
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");
  const archived = c.req.query("archived") === "1";

  // Both or neither
  if ((fromStr === undefined) !== (toStr === undefined)) {
    return c.json(
      { error: { code: "VALIDATION", message: "Provide both 'from' and 'to', or neither" } },
      400
    );
  }

  // Rejected rather than silently ignored (plan §5.5) — silently ignoring `archived` here is
  // how a caller concludes the calendar occurrence feature is broken.
  if (archived && fromStr !== undefined) {
    return c.json(
      { error: { code: "VALIDATION", message: "archived is not supported with from/to" } },
      400
    );
  }

  const result = await getItems(c.env.DB, user.email, listId, archived ? "archived" : "active");
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }

  if (fromStr !== undefined && toStr !== undefined) {
    const from = Number(fromStr) as EpochMs;
    const to = Number(toStr) as EpochMs;

    if (isNaN(from) || isNaN(to)) {
      return c.json({ error: { code: "VALIDATION", message: "from and to must be numbers" } }, 400);
    }
    if (from > to) {
      return c.json({ error: { code: "VALIDATION", message: "from must be <= to" } }, 400);
    }

    // Expand occurrences per item and return a flat occurrences array (F7)
    const occurrences: Array<{
      item_id: string;
      occurrence_at: EpochMs;
      end_at: EpochMs | null;
      item: unknown;
    }> = [];

    for (const item of result.value) {
      const times = expandOccurrences(
        {
          startAt: item.start_at,
          rrule: item.rrule,
          timezone: item.timezone,
          allDay: item.all_day,
        },
        from,
        to
      );
      for (const occurrence_at of times) {
        const duration = item.end_at !== null ? item.end_at - item.start_at : null;
        occurrences.push({
          item_id: item.id,
          occurrence_at,
          end_at: duration !== null ? occurrence_at + duration : null,
          item,
        });
      }
    }

    // Sort by occurrence time
    occurrences.sort((a, b) => a.occurrence_at - b.occurrence_at);
    return c.json({ occurrences });
  }

  return c.json({ items: result.value });
});

// POST /api/items
itemsRouter.post("/items", async (c) => {
  const user = c.get("user");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Invalid JSON" } }, 400);
  }

  const b = body as Record<string, unknown>;
  const validationErr = validateItemInput(b);
  if (validationErr) {
    return c.json({ error: { code: "VALIDATION", message: validationErr } }, 400);
  }

  // Validate RRULE syntax if present
  if (b.rrule !== null && b.rrule !== undefined) {
    const rruleErr = validateRRule(b.rrule as string);
    if (rruleErr) return c.json({ error: { code: "VALIDATION", message: rruleErr } }, 400);
  }

  const locationKindErr = validateLocationKind(b.location_kind);
  if (locationKindErr) {
    return c.json({ error: { code: "VALIDATION", message: locationKindErr } }, 400);
  }

  const result = await createItem(c.env.DB, user.email, {
    list_id: b.list_id as string,
    type: b.type as "event" | "task",
    title: (b.title as string).trim(),
    location: typeof b.location === "string" ? b.location : null,
    notes: typeof b.notes === "string" ? b.notes : null,
    start_at: b.start_at as EpochMs,
    end_at: typeof b.end_at === "number" ? b.end_at : null,
    all_day: Boolean(b.all_day),
    rrule: typeof b.rrule === "string" ? b.rrule : null,
    timezone: typeof b.timezone === "string" ? b.timezone : undefined,
    reminders: Array.isArray(b.reminders) ? b.reminders : [],
    location_kind: isLocationKind(b.location_kind) ? b.location_kind : null,
  }, Date.now());

  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }
  return c.json({ item: result.value }, 201);
});

// GET /api/items/:id — authorized point-read for the deep-link resolution (Ruling 2).
// Mounted on itemsRouter (mounted at "/api" in index.ts), so the path is /api/items/:id —
// distinct from remindersRouter's /api/items/:id/reminders (mounted separately at /api/items).
itemsRouter.get("/items/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const result = await getItemForUser(c.env.DB, user.email, id);
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }
  return c.json({ item: result.value });
});

// PATCH /api/items/:id
itemsRouter.patch("/items/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Invalid JSON" } }, 400);
  }

  const b = body as Record<string, unknown>;

  const patchErr = validateItemPatch(b);
  if (patchErr) return c.json({ error: { code: "VALIDATION", message: patchErr } }, 400);

  if (b.rrule !== undefined && b.rrule !== null) {
    const rruleErr = validateRRule(b.rrule as string);
    if (rruleErr) return c.json({ error: { code: "VALIDATION", message: rruleErr } }, 400);
  }

  if (b.end_at !== undefined && b.end_at !== null && typeof b.start_at === "number") {
    if ((b.end_at as number) < b.start_at) {
      return c.json({ error: { code: "VALIDATION", message: "end_at must be >= start_at" } }, 400);
    }
  }

  if ("location_kind" in b) {
    const locationKindErr = validateLocationKind(b.location_kind);
    if (locationKindErr) {
      return c.json({ error: { code: "VALIDATION", message: locationKindErr } }, 400);
    }
  }

  const result = await updateItem(c.env.DB, user.email, id, {
    type: typeof b.type === "string" ? (b.type as "event" | "task") : undefined,
    title: typeof b.title === "string" ? b.title.trim() : undefined,
    location: b.location !== undefined ? (b.location as string | null) : undefined,
    notes: b.notes !== undefined ? (b.notes as string | null) : undefined,
    start_at: typeof b.start_at === "number" ? b.start_at : undefined,
    end_at: b.end_at !== undefined ? (b.end_at as EpochMs | null) : undefined,
    all_day: b.all_day !== undefined ? Boolean(b.all_day) : undefined,
    rrule: b.rrule !== undefined ? (b.rrule as string | null) : undefined,
    timezone: typeof b.timezone === "string" ? b.timezone : undefined,
    location_kind: "location_kind" in b
      ? (isLocationKind(b.location_kind) ? b.location_kind : null)
      : undefined,
  }, Date.now());

  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND" ? 404 :
      result.code === "FORBIDDEN" ? 403 :
      result.code === "CONFLICT" ? 409 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }
  return c.json({ item: result.value });
});

// DELETE /api/items/:id
itemsRouter.delete("/items/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const result = await deleteItem(c.env.DB, user.email, id, c.env.ATTACHMENTS);
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }
  return new Response(null, { status: 204 });
});

// POST /api/items/:id/complete
itemsRouter.post("/items/:id/complete", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    // body defaults to empty; completed defaults to true
  }

  const completed = body.completed !== undefined ? Boolean(body.completed) : true;
  const occurrenceAt = typeof body.occurrence_at === "number"
    ? (body.occurrence_at as EpochMs)
    : null;

  const result = await completeItem(
    c.env.DB,
    user.email,
    id,
    occurrenceAt,
    completed,
    Date.now()
  );

  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND" ? 404 :
      result.code === "FORBIDDEN" ? 403 :
      result.code === "CONFLICT" ? 409 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }
  return c.json({ ok: true });
});

// POST /api/items/:id/archive — one endpoint, both directions (mirrors /complete's body
// handling). `{archived: boolean}`, defaulting to true when the field is absent. The UI labels
// the two directions Archive and Restore; the wire shape is the boolean.
itemsRouter.post("/items/:id/archive", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    // body defaults to empty; archived defaults to true
  }

  const archived = body.archived !== undefined ? Boolean(body.archived) : true;

  const result = await setItemArchived(c.env.DB, user.email, id, archived, Date.now());

  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND" ? 404 :
      result.code === "FORBIDDEN" ? 403 :
      result.code === "CONFLICT" ? 409 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }
  return c.json({ item: result.value });
});

// ---------------------------------------------------------------------------
// Attachments (feat/attachments) — POST/GET(list)/GET(download)/DELETE
// Mounted on itemsRouter (mounted at "/api" in index.ts), so paths resolve to
// /api/items/:id/attachments[/:attachmentId]. No collision with /api/items/:id or the
// reminders router (mounted separately at /api/items -> /api/items/:id/reminders).
// ---------------------------------------------------------------------------

// GET /api/items/:id/attachments — metadata list (canReadList, enforced in db.ts)
itemsRouter.get("/items/:id/attachments", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("id");
  const result = await listAttachments(c.env.DB, user.email, itemId);
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }
  return c.json({ attachments: result.value });
});

// POST /api/items/:id/attachments — multipart upload (canWriteList, enforced in db.ts)
// Pinned route order (plan §5.5): parse+validate -> generate id/r2_key -> prepareAttachmentUpload
// (SINGLE authz + per-item cap check) -> bucket.put -> createAttachment (INSERT-only).
itemsRouter.post("/items/:id/attachments", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("id");

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Invalid multipart form data" } }, 400);
  }

  // The installed @cloudflare/workers-types version types FormData.get() as `string | null`
  // (it omits the `File` arm present in newer/dated snapshots), even though the real Workers
  // runtime returns a File for a file part. isUploadedFile() duck-types the runtime value
  // (arrayBuffer/name/size/type) without weakening validation, then we narrow via `as File`.
  const rawEntry = form.get("file");
  if (!isUploadedFile(rawEntry)) {
    return c.json({ error: { code: "VALIDATION", message: "A 'file' field is required" } }, 400);
  }
  const file = rawEntry as unknown as File;

  const validation = validateAttachmentFile(file);
  if (!validation.ok) {
    return c.json({ error: { code: "VALIDATION", message: validation.error } }, 400);
  }
  const { filename, contentType } = validation;

  if (file.size > ATTACHMENT_MAX_FILE_BYTES) {
    return c.json(
      {
        error: {
          code: "VALIDATION",
          message: `File exceeds the maximum size of ${ATTACHMENT_MAX_FILE_BYTES} bytes`,
        },
      },
      400
    );
  }

  // Generate id + r2_key in the route (server code owns IDs — project convention).
  const id = crypto.randomUUID();
  const r2Key = `items/${itemId}/${id}`;

  // SINGLE authz + per-item cap check (m3) — BEFORE any R2 write.
  const prep = await prepareAttachmentUpload(c.env.DB, user.email, itemId, file.size);
  if (!prep.ok) {
    const status = prep.code === "NOT_FOUND" ? 404 : prep.code === "FORBIDDEN" ? 403 : 400;
    return c.json({ error: { code: prep.code, message: prep.message } }, status);
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Could not read uploaded file" } }, 400);
  }

  try {
    await c.env.ATTACHMENTS.put(r2Key, bytes, {
      httpMetadata: { contentType },
    });
  } catch {
    return c.json({ error: { code: "INTERNAL", message: "Failed to store attachment" } }, 500);
  }

  const created = await createAttachment(
    c.env.DB,
    user.email,
    itemId,
    id,
    { filename, content_type: contentType, size: file.size, r2_key: r2Key },
    Date.now()
  );
  if (!created.ok) {
    // INSERT-only per m3 — should not fail authz/cap here (already checked), but map defensively.
    const status = created.code === "NOT_FOUND" ? 404 : created.code === "FORBIDDEN" ? 403 : 400;
    return c.json({ error: { code: created.code, message: created.message } }, status);
  }

  return c.json({ attachment: created.value }, 201);
});

// GET /api/items/:id/attachments/:attachmentId — streams bytes (canReadList, enforced in db.ts)
itemsRouter.get("/items/:id/attachments/:attachmentId", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("id");
  const attachmentId = c.req.param("attachmentId");

  const result = await getAttachmentForDownload(c.env.DB, user.email, itemId, attachmentId);
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }
  const attachment = result.value;

  const object = await c.env.ATTACHMENTS.get(attachment.r2_key);
  if (!object) {
    // Row exists but the R2 object is missing (should not happen on the happy path — defensive).
    return c.json(
      { error: { code: "NOT_FOUND", message: "Attachment file not found" } },
      404
    );
  }

  // Content-Type is sourced ONLY from the DB column (m4) — never from object.httpMetadata,
  // which is client-influenced at put time. nosniff defeats browser MIME sniffing.
  const headers = new Headers();
  headers.set("Content-Type", attachment.content_type);
  headers.set("X-Content-Type-Options", "nosniff");
  const disposition = attachment.content_type.startsWith("image/") ? "inline" : "attachment";
  headers.set(
    "Content-Disposition",
    `${disposition}; filename="${sanitizeForHeader(attachment.filename)}"`
  );
  if (object.httpEtag) headers.set("ETag", object.httpEtag);

  return new Response(object.body, { status: 200, headers });
});

// DELETE /api/items/:id/attachments/:attachmentId (canWriteList, enforced in db.ts)
itemsRouter.delete("/items/:id/attachments/:attachmentId", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("id");
  const attachmentId = c.req.param("attachmentId");

  const result = await deleteAttachment(
    c.env.DB,
    user.email,
    itemId,
    attachmentId,
    c.env.ATTACHMENTS
  );
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }
  return new Response(null, { status: 204 });
});

// ---------------------------------------------------------------------------
// Attachment validation helpers (allowlist + filename/header sanitization)
// ---------------------------------------------------------------------------

// Duck-types a FormData entry as an uploaded File at runtime (see the workers-types note above
// `isUploadedFile`'s call site) — checks the shape actually used, without importing DOM lib.
function isUploadedFile(value: unknown): value is File {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    typeof v.size === "number" &&
    typeof v.type === "string" &&
    typeof v.arrayBuffer === "function"
  );
}

type AttachmentFileValidation =
  | { ok: false; error: string }
  | { ok: true; filename: string; contentType: string };

/**
 * Validates the uploaded file's extension + declared Content-Type against the server allowlist
 * (plan §5.3). Extension is derived from the sanitized filename; Content-Type is compared before
 * any `;` parameter (tolerant of "text/plain; charset=..."). Empty/absent Content-Type for .txt
 * is accepted by falling back to the extension's canonical type (some browsers send "" for .txt).
 */
function validateAttachmentFile(file: File): AttachmentFileValidation {
  const filename = sanitizeFilename(file.name);
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0) {
    return { ok: false, error: "File must have a valid extension" };
  }
  const ext = filename.slice(dotIndex).toLowerCase();
  const allowed = ATTACHMENT_ALLOWLIST[ext];
  if (!allowed) {
    return { ok: false, error: `File extension '${ext}' is not allowed` };
  }

  const declaredType = (file.type || "").split(";")[0].trim().toLowerCase();
  // Some browsers send an empty declared type for certain extensions (e.g. .txt); over real
  // multipart/form-data, an empty/absent part Content-Type is also commonly normalized to the
  // generic "application/octet-stream" by the client or the multipart parser. Treat both as
  // "no real type declared" and fall back to the extension's canonical type (documented v1
  // behavior, plan §5.3) rather than rejecting a legitimate .txt upload.
  if (declaredType === "" || declaredType === "application/octet-stream") {
    return { ok: true, filename, contentType: allowed[0] };
  }
  if (!allowed.includes(declaredType)) {
    return {
      ok: false,
      error: `Content-Type '${declaredType}' does not match extension '${ext}'`,
    };
  }
  return { ok: true, filename, contentType: declaredType };
}

/** Strips path separators and control characters from a client-supplied filename before storage. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/]/g, "_")
    // eslint-disable-next-line no-control-regex -- deliberately stripping control chars (CR/LF/etc.)
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
}

/** Strips CR/LF and quotes from a value destined for a response header (Content-Disposition). */
function sanitizeForHeader(value: string): string {
  return value.replace(/[\r\n"]/g, "");
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateItemInput(b: Record<string, unknown>): string | null {
  if (typeof b.list_id !== "string" || !b.list_id) return "list_id is required";
  if (b.type !== "event" && b.type !== "task") return "type must be 'event' or 'task'";
  if (typeof b.title !== "string" || b.title.trim().length === 0 || b.title.trim().length > 200) {
    return "title must be 1–200 chars";
  }
  if (typeof b.start_at !== "number" || isNaN(b.start_at)) return "start_at (EpochMs) is required";
  if (b.end_at !== undefined && b.end_at !== null) {
    if (typeof b.end_at !== "number") return "end_at must be a number";
    if (b.end_at < (b.start_at as number)) return "end_at must be >= start_at";
  }
  if (Array.isArray(b.reminders)) {
    for (const r of b.reminders as unknown[]) {
      const rem = r as Record<string, unknown>;
      if (!Number.isInteger(rem.offset_minutes) || (rem.offset_minutes as number) < 0) {
        return "reminder offset_minutes must be a non-negative integer";
      }
      if (!rem.channel_email && !rem.channel_push) {
        return "each reminder must have at least one channel enabled";
      }
    }
  }
  return null;
}

function validateRRule(rrule: string): string | null {
  // Basic structural validation — must contain FREQ
  if (!rrule.includes("FREQ=")) return "rrule must contain FREQ=";
  return null;
}

const LOCATION_KINDS = ["plain", "address", "meeting"] as const;

function isLocationKind(v: unknown): v is "plain" | "address" | "meeting" {
  return typeof v === "string" && (LOCATION_KINDS as readonly string[]).includes(v);
}

// location_kind (Decision 3 override) is optional and nullable: null/undefined -> auto-detect
// at render. Only a non-null, non-matching value is rejected.
function validateLocationKind(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (!isLocationKind(v)) {
    return "location_kind must be 'plain', 'address', 'meeting', or null";
  }
  return null;
}

// Validates a PATCH body: only fields PRESENT are checked; a present required field must be
// valid. Closes two live write holes (blank title, arbitrary type string) plus one defensive
// case (start_at) — see docs/plans/fix-item-save.md §4.3.
function validateItemPatch(b: Record<string, unknown>): string | null {
  if ("title" in b) {
    const t = typeof b.title === "string" ? b.title.trim() : "";
    if (typeof b.title !== "string" || t.length === 0 || t.length > 200) {
      return "title must be 1–200 chars";
    }
  }
  if ("start_at" in b) {
    if (typeof b.start_at !== "number" || Number.isNaN(b.start_at)) {
      return "start_at (EpochMs) must be a number";
    }
  }
  if ("type" in b && b.type !== "event" && b.type !== "task") {
    return "type must be 'event' or 'task'";
  }
  return null;
}

// Export for use in items router mounted in index.ts
// Provide items sub-router accessible under /api
export { itemsRouter as default };
