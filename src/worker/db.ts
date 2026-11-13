// db.ts — All D1 reads/writes with authorization enforced here (not just in routes).
// Pure data-mapping functions; no business logic beyond authorization.
// Error contract: Result<T> for typed errors (NOT_FOUND, FORBIDDEN, CONFLICT, VALIDATION);
// throw only on infrastructure failure (-> 500).

import type {
  EpochMs,
  Result,
  User,
  UserRow,
  List,
  ListRow,
  Item,
  ItemRow,
  ItemReminder,
  ItemReminderRow,
  ItemWithReminders,
  ReminderDispatch,
  DispatchRow,
  PushSubscription,
  PushSubscriptionRow,
  CreateListInput,
  UpdateListInput,
  ReminderInput,
  CreateItemInput,
  UpdateItemInput,
  SubscriptionInput,
  NewDispatchRow,
  Attachment,
  AttachmentRow,
  CreateAttachmentInput,
  ItemScope,
} from "./types";
import { isArchivable, archiveBlockedReason } from "../shared/archive";
import { DEFAULT_TIMEZONE, ATTACHMENT_MAX_ITEM_BYTES, ATTACHMENT_MAX_ITEM_COUNT } from "./config";

// ---------------------------------------------------------------------------
// Row -> domain type mappers
// ---------------------------------------------------------------------------

function mapUser(row: UserRow): User {
  return {
    email: row.email,
    display_name: row.display_name,
    role: row.role as "admin" | "member",
    active: row.active === 1,
    created_at: row.created_at,
    maps_provider: row.maps_provider === "apple" || row.maps_provider === "google"
      ? row.maps_provider
      : null,
  };
}

function mapList(row: ListRow): List {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    owner_email: row.owner_email,
    visibility: row.visibility as "private" | "shared",
    created_at: row.created_at,
  };
}

function mapItem(row: ItemRow): Item {
  return {
    id: row.id,
    list_id: row.list_id,
    type: row.type as "event" | "task",
    title: row.title,
    location: row.location,
    notes: row.notes,
    start_at: row.start_at,
    end_at: row.end_at,
    all_day: row.all_day === 1,
    rrule: row.rrule,
    timezone: row.timezone,
    completed_at: row.completed_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    location_kind:
      row.location_kind === "plain" || row.location_kind === "address" || row.location_kind === "meeting"
        ? row.location_kind
        : null,
    // `?? null`, not decoration (R9): SELECT * against a table without the column yields
    // `undefined`, and `undefined !== null` would make every item read as archived.
    archived_at: row.archived_at ?? null,
  };
}

function mapReminder(row: ItemReminderRow): ItemReminder {
  return {
    id: row.id,
    item_id: row.item_id,
    offset_minutes: row.offset_minutes,
    channel_email: row.channel_email === 1,
    channel_push: row.channel_push === 1,
  };
}

function mapDispatch(row: DispatchRow): ReminderDispatch {
  return {
    id: row.id,
    item_id: row.item_id,
    item_reminder_id: row.item_reminder_id,
    occurrence_at: row.occurrence_at,
    fire_at: row.fire_at,
    channel: row.channel as "email" | "push",
    recipient_email: row.recipient_email,
    status: row.status as "pending" | "sent" | "failed",
    sent_at: row.sent_at,
  };
}

function mapAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    item_id: row.item_id,
    filename: row.filename,
    content_type: row.content_type,
    size: row.size,
    r2_key: row.r2_key,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
  };
}

function mapPushSubscription(row: PushSubscriptionRow): PushSubscription {
  return {
    id: row.id,
    user_email: row.user_email,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    user_agent: row.user_agent,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// User operations
// ---------------------------------------------------------------------------

/**
 * Upsert the user on every login.
 * - On INSERT: role='admin' iff email === ownerEmail, else 'member'; active=1.
 * - On CONFLICT (re-login): promote to 'admin' if email===ownerEmail (fixes a row
 *   created as 'member' before OWNER_EMAIL was set — N5). Never downgrade others.
 *   Never reset `active` or overwrite `display_name` (so deactivated users stay
 *   deactivated and prior name edits survive re-login).
 */
export async function upsertUser(
  db: D1Database,
  email: string,
  ownerEmail: string,
  now: EpochMs
): Promise<User> {
  const normalizedEmail = email.toLowerCase();
  const normalizedOwner = ownerEmail.toLowerCase();
  const isOwner = normalizedEmail === normalizedOwner;
  const role = isOwner ? "admin" : "member";

  await db
    .prepare(
      `INSERT INTO users (email, display_name, role, active, created_at)
       VALUES (?, NULL, ?, 1, ?)
       ON CONFLICT(email) DO UPDATE SET
         role = CASE WHEN email = ? THEN 'admin' ELSE role END`
    )
    .bind(normalizedEmail, role, now, normalizedOwner)
    .run();

  const row = await db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(normalizedEmail)
    .first<UserRow>();

  if (!row) throw new Error("upsertUser: row missing after upsert");
  return mapUser(row);
}

export async function getUser(
  db: D1Database,
  email: string
): Promise<User | null> {
  const row = await db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(email.toLowerCase())
    .first<UserRow>();
  return row ? mapUser(row) : null;
}

export async function updateDisplayName(
  db: D1Database,
  email: string,
  name: string
): Promise<User> {
  await db
    .prepare("UPDATE users SET display_name = ? WHERE email = ?")
    .bind(name, email.toLowerCase())
    .run();
  const row = await db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(email.toLowerCase())
    .first<UserRow>();
  if (!row) throw new Error("updateDisplayName: user not found");
  return mapUser(row);
}

/**
 * Persist the caller's maps-provider preference (Decision 6). email is always the
 * verified-JWT identity supplied by the route (never a body-supplied value — project
 * convention); the enum is validated in the route layer before this is called.
 */
export async function updateMapsProvider(
  db: D1Database,
  email: string,
  provider: "apple" | "google"
): Promise<User> {
  await db
    .prepare("UPDATE users SET maps_provider = ? WHERE email = ?")
    .bind(provider, email.toLowerCase())
    .run();
  const row = await db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(email.toLowerCase())
    .first<UserRow>();
  if (!row) throw new Error("updateMapsProvider: user not found");
  return mapUser(row);
}

// Returns only active users (WHERE active = 1). Used by materialize audience + digest.
export async function listActiveUsers(db: D1Database): Promise<User[]> {
  const { results } = await db
    .prepare("SELECT * FROM users WHERE active = 1 ORDER BY created_at")
    .all<UserRow>();
  return results.map(mapUser);
}

// Admin-only: full roster including inactive.
export async function listAllUsers(db: D1Database): Promise<User[]> {
  const { results } = await db
    .prepare("SELECT * FROM users ORDER BY created_at")
    .all<UserRow>();
  return results.map(mapUser);
}

/**
 * Toggle a user's active flag.
 * Self-deactivation guard: if callerEmail===targetEmail && !active -> VALIDATION error.
 * Side effect on deactivation: also purges that user's pending dispatch rows (D7/M1).
 */
export async function setUserActive(
  db: D1Database,
  callerEmail: string,
  targetEmail: string,
  active: boolean
): Promise<Result<User>> {
  const caller = callerEmail.toLowerCase();
  const target = targetEmail.toLowerCase();

  // Self-deactivation guard (Item 3b / M2) — server-side, cannot be bypassed
  if (caller === target && !active) {
    return {
      ok: false,
      code: "VALIDATION",
      message: "Admin cannot deactivate their own account",
    };
  }

  const existing = await db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(target)
    .first<UserRow>();
  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "User not found" };
  }

  await db
    .prepare("UPDATE users SET active = ? WHERE email = ?")
    .bind(active ? 1 : 0, target)
    .run();

  // Side effect on deactivation: purge that user's pending dispatch rows (D7/M1)
  if (!active) {
    await deletePendingDispatchForRecipient(db, target);
  }

  const row = await db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(target)
    .first<UserRow>();
  if (!row) throw new Error("setUserActive: row missing after update");
  return { ok: true, value: mapUser(row) };
}

export async function adminUpdateDisplayName(
  db: D1Database,
  targetEmail: string,
  name: string
): Promise<Result<User>> {
  const target = targetEmail.toLowerCase();
  const existing = await db
    .prepare("SELECT email FROM users WHERE email = ?")
    .bind(target)
    .first<{ email: string }>();
  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "User not found" };
  }
  const user = await updateDisplayName(db, target, name);
  return { ok: true, value: user };
}

// ---------------------------------------------------------------------------
// List operations
// ---------------------------------------------------------------------------

/**
 * Returns the caller's private lists + all shared lists.
 * Authorization rule: private lists visible only to owner; shared lists to everyone.
 */
export async function getVisibleLists(
  db: D1Database,
  email: string
): Promise<List[]> {
  const norm = email.toLowerCase();
  const { results } = await db
    .prepare(
      `SELECT * FROM lists
       WHERE visibility = 'shared' OR owner_email = ?
       ORDER BY created_at`
    )
    .bind(norm)
    .all<ListRow>();
  return results.map(mapList);
}

export async function createList(
  db: D1Database,
  email: string,
  input: CreateListInput,
  now: EpochMs
): Promise<List> {
  const id = crypto.randomUUID();
  const norm = email.toLowerCase();
  await db
    .prepare(
      `INSERT INTO lists (id, name, color, owner_email, visibility, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.name,
      input.color ?? null,
      norm,
      input.visibility ?? "private",
      now
    )
    .run();
  const row = await db
    .prepare("SELECT * FROM lists WHERE id = ?")
    .bind(id)
    .first<ListRow>();
  if (!row) throw new Error("createList: row missing after insert");
  return mapList(row);
}

/**
 * Update a list.
 * Authorization:
 *  - Private list: owner only for all changes.
 *  - Shared list: any active user can rename/recolor.
 *    But visibility changes (shared -> private) are owner only (Decision D9).
 * Side effect on visibility change: purge pending dispatch for all items in list (D7/M1).
 */
export async function updateList(
  db: D1Database,
  email: string,
  id: string,
  patch: UpdateListInput
): Promise<Result<List>> {
  const norm = email.toLowerCase();
  const list = await db
    .prepare("SELECT * FROM lists WHERE id = ?")
    .bind(id)
    .first<ListRow>();
  if (!list) return { ok: false, code: "NOT_FOUND", message: "List not found" };

  const isOwner = list.owner_email === norm;

  // If changing visibility or editing a private list, must be owner
  if (!isOwner && list.visibility === "private") {
    return { ok: false, code: "FORBIDDEN", message: "Forbidden" };
  }
  if (!isOwner && patch.visibility !== undefined && patch.visibility !== list.visibility) {
    return { ok: false, code: "FORBIDDEN", message: "Only the owner can change list visibility" };
  }

  const visibilityChanging =
    patch.visibility !== undefined && patch.visibility !== list.visibility;

  await db
    .prepare(
      `UPDATE lists SET
         name = COALESCE(?, name),
         color = CASE WHEN ? THEN ? ELSE color END,
         visibility = COALESCE(?, visibility)
       WHERE id = ?`
    )
    .bind(
      patch.name ?? null,
      patch.color !== undefined ? 1 : 0,
      patch.color ?? null,
      patch.visibility ?? null,
      id
    )
    .run();

  // Purge pending dispatch when visibility changes so the new audience gets fresh rows (D7/M1)
  if (visibilityChanging) {
    await deletePendingDispatchForList(db, id);
  }

  const updated = await db
    .prepare("SELECT * FROM lists WHERE id = ?")
    .bind(id)
    .first<ListRow>();
  if (!updated) throw new Error("updateList: row missing after update");
  return { ok: true, value: mapList(updated) };
}

/**
 * Delete a list.
 * HARD REQUIREMENT (P2-N1): purge pending dispatch BEFORE deleting items.
 * reminder_dispatch has NO FK to items/lists, so without this the dispatch rows orphan.
 *
 * Application-level cascade (M5-PROD-FK fix): SQLite FK enforcement is OFF by default and
 * Cloudflare D1's production default is unverified. The real migration declares ON DELETE CASCADE
 * on items.list_id, item_reminders.item_id, and item_occurrence_state.item_id — but we cannot
 * rely on that enforcement being active. Each child table is deleted explicitly in app code so
 * the result is correct regardless of D1's FK enforcement state.
 *
 * Ordering invariant (load-bearing):
 *   1. deletePendingDispatchForList (FIRST — uses subquery via items; must run before items are gone)
 *   2. Delete R2 objects for every item in the list (feat/attachments — enumerate item ids
 *      BEFORE any delete, same rationale as the dispatch subquery: once items are gone we've
 *      lost the id set)
 *   3. DELETE attachment rows for all items in the list (feat/attachments)
 *   4. DELETE item_reminders for all items in the list
 *   5. DELETE item_occurrence_state for all items in the list
 *   6. DELETE items in the list
 *   7. DELETE the lists row
 *
 * `bucket` (R2Bucket) is threaded in so this function stays the authz + cleanup owner
 * (project convention: db.ts owns cleanup, consistent with dispatch purge above) — plan §3.4.
 */
export async function deleteList(
  db: D1Database,
  email: string,
  id: string,
  bucket: R2Bucket
): Promise<Result<void>> {
  const norm = email.toLowerCase();
  const list = await db
    .prepare("SELECT * FROM lists WHERE id = ?")
    .bind(id)
    .first<ListRow>();
  if (!list) return { ok: false, code: "NOT_FOUND", message: "List not found" };
  if (list.owner_email !== norm) {
    return { ok: false, code: "FORBIDDEN", message: "Only the owner can delete a list" };
  }

  // Step 1: purge pending dispatch FIRST (P2-N1, D7).
  // This uses "WHERE item_id IN (SELECT id FROM items WHERE list_id = ?)".
  // It MUST run before items are deleted; otherwise the subquery returns empty and
  // dispatch rows are left as orphans that fire at the old time.
  await deletePendingDispatchForList(db, id);

  // Step 2: delete R2 objects for every item in the list (feat/attachments, P2-N1-shaped).
  // Enumerate item ids BEFORE any delete — once `items` rows are gone we've lost the id set,
  // same reason the dispatch subquery above must run first. Best-effort per item (§3.5).
  const { results: itemIdRows } = await db
    .prepare("SELECT id FROM items WHERE list_id = ?")
    .bind(id)
    .all<{ id: string }>();
  for (const { id: itemId } of itemIdRows) {
    await deleteAttachmentObjectsForItem(bucket, itemId);
  }

  // Step 3: delete attachment rows for all items in the list (feat/attachments).
  // Explicit app-level delete — do not rely on the attachment table's FK ON DELETE CASCADE.
  await db
    .prepare(
      "DELETE FROM attachment WHERE item_id IN (SELECT id FROM items WHERE list_id = ?)"
    )
    .bind(id)
    .run();

  // Steps 4–5: explicit child deletes — application-level cascade (M5-PROD-FK).
  // Cannot rely on SQLite FK ON DELETE CASCADE being active in production D1.
  await db
    .prepare(
      "DELETE FROM item_reminders WHERE item_id IN (SELECT id FROM items WHERE list_id = ?)"
    )
    .bind(id)
    .run();
  await db
    .prepare(
      "DELETE FROM item_occurrence_state WHERE item_id IN (SELECT id FROM items WHERE list_id = ?)"
    )
    .bind(id)
    .run();

  // Step 6: delete all items in the list (explicit — not relying on FK cascade)
  await db.prepare("DELETE FROM items WHERE list_id = ?").bind(id).run();

  // Step 7: delete the list row itself
  await db.prepare("DELETE FROM lists WHERE id = ?").bind(id).run();

  return { ok: true, value: undefined };
}

// ---------------------------------------------------------------------------
// Authorization helpers
// ---------------------------------------------------------------------------

export async function canReadList(
  db: D1Database,
  email: string,
  listId: string
): Promise<boolean> {
  const norm = email.toLowerCase();
  const list = await db
    .prepare("SELECT * FROM lists WHERE id = ?")
    .bind(listId)
    .first<ListRow>();
  if (!list) return false;
  if (list.visibility === "shared") return true;
  return list.owner_email === norm;
}

export async function canWriteList(
  db: D1Database,
  email: string,
  listId: string
): Promise<boolean> {
  const norm = email.toLowerCase();
  const list = await db
    .prepare("SELECT * FROM lists WHERE id = ?")
    .bind(listId)
    .first<ListRow>();
  if (!list) return false;
  if (list.visibility === "shared") return true;
  return list.owner_email === norm;
}

// ---------------------------------------------------------------------------
// Item operations
// ---------------------------------------------------------------------------

async function getItemReminders(
  db: D1Database,
  itemId: string
): Promise<ItemReminder[]> {
  const { results } = await db
    .prepare("SELECT * FROM item_reminders WHERE item_id = ? ORDER BY offset_minutes")
    .bind(itemId)
    .all<ItemReminderRow>();
  return results.map(mapReminder);
}

/**
 * `scope` defaults to "active" (plan §3.2's design invariant): every existing call site keeps
 * its 3-arg call and silently gets the safe behaviour, so a call site the Coder overlooks
 * under-shows (an archived item stays hidden) rather than leaking archived rows into a surface
 * that must not have them. Exactly one call site passes "archived" — the `?archived=1` branch
 * of GET /lists/:id/items (routes/items.ts). Active scope orders ascending (unchanged);
 * archived scope orders most-recent-first (§5.4).
 */
export async function getItems(
  db: D1Database,
  email: string,
  listId: string,
  scope: ItemScope = "active"
): Promise<Result<ItemWithReminders[]>> {
  const readable = await canReadList(db, email, listId);
  if (!readable) {
    const list = await db
      .prepare("SELECT id FROM lists WHERE id = ?")
      .bind(listId)
      .first<{ id: string }>();
    return list
      ? { ok: false, code: "FORBIDDEN", message: "Forbidden" }
      : { ok: false, code: "NOT_FOUND", message: "List not found" };
  }

  const archivedClause = scope === "archived" ? "IS NOT NULL" : "IS NULL";
  const order = scope === "archived" ? "DESC" : "ASC";
  const { results } = await db
    .prepare(
      `SELECT * FROM items WHERE list_id = ? AND archived_at ${archivedClause} ORDER BY start_at ${order}`
    )
    .bind(listId)
    .all<ItemRow>();

  const items: ItemWithReminders[] = await Promise.all(
    results.map(async (row) => ({
      ...mapItem(row),
      reminders: await getItemReminders(db, row.id),
    }))
  );
  return { ok: true, value: items };
}

/**
 * Authorized point-read for a single item by id (used by GET /api/items/:id — the deep-link
 * resolution route, Ruling 2). Mirrors getItems()'s authz semantics exactly, but the
 * NOT_FOUND/FORBIDDEN ordering is decided by ITEM existence, not list existence (a valid,
 * readable list can still lack the requested item):
 *   1. Resolve the item row. Absent -> NOT_FOUND (no leak of whether the list exists).
 *   2. canReadList(item.list_id) — false -> FORBIDDEN (exists, not readable by caller).
 *   3. Otherwise -> the item + reminders (same shape getItems returns per element), so the
 *      deep-link boot handler can pass it straight into ItemEditor with no redundant fetch.
 */
export async function getItemForUser(
  db: D1Database,
  email: string,
  itemId: string
): Promise<Result<ItemWithReminders>> {
  const row = await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(itemId)
    .first<ItemRow>();
  if (!row) return { ok: false, code: "NOT_FOUND", message: "Item not found" };

  const readable = await canReadList(db, email, row.list_id);
  if (!readable) return { ok: false, code: "FORBIDDEN", message: "Forbidden" };

  const reminders = await getItemReminders(db, row.id);
  return { ok: true, value: { ...mapItem(row), reminders } };
}

export async function createItem(
  db: D1Database,
  email: string,
  input: CreateItemInput,
  now: EpochMs
): Promise<Result<ItemWithReminders>> {
  const writable = await canWriteList(db, email, input.list_id);
  if (!writable) {
    const list = await db
      .prepare("SELECT id FROM lists WHERE id = ?")
      .bind(input.list_id)
      .first<{ id: string }>();
    return list
      ? { ok: false, code: "FORBIDDEN", message: "Forbidden" }
      : { ok: false, code: "NOT_FOUND", message: "List not found" };
  }

  const id = crypto.randomUUID();
  const norm = email.toLowerCase();

  await db
    .prepare(
      `INSERT INTO items
         (id, list_id, type, title, location, notes, start_at, end_at, all_day,
          rrule, timezone, completed_at, created_by, created_at, updated_at, location_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.list_id,
      input.type,
      input.title,
      input.location ?? null,
      input.notes ?? null,
      input.start_at,
      input.end_at ?? null,
      input.all_day ? 1 : 0,
      input.rrule ?? null,
      input.timezone ?? DEFAULT_TIMEZONE,
      norm,
      now,
      now,
      input.location_kind ?? null
    )
    .run();

  const reminders = await _upsertReminders(db, id, input.reminders ?? []);

  const row = await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(id)
    .first<ItemRow>();
  if (!row) throw new Error("createItem: row missing after insert");
  return { ok: true, value: { ...mapItem(row), reminders } };
}

export async function updateItem(
  db: D1Database,
  email: string,
  id: string,
  patch: UpdateItemInput,
  now: EpochMs
): Promise<Result<ItemWithReminders>> {
  const item = await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(id)
    .first<ItemRow>();
  if (!item) return { ok: false, code: "NOT_FOUND", message: "Item not found" };

  const writable = await canWriteList(db, email, item.list_id);
  if (!writable) return { ok: false, code: "FORBIDDEN", message: "Forbidden" };

  // G6: start_at cannot move while an item is archived. This is what §5.6's digest-unreachability
  // proof and Decision 8's restore proof both rest on — see the coupling note in Decision 3(ii)
  // before relaxing this guard.
  if (item.archived_at !== null) {
    return { ok: false, code: "CONFLICT", message: "Item is archived" };
  }

  const timingFields = ["start_at", "end_at", "rrule", "timezone", "all_day"] as const;
  const timingChanged = timingFields.some(
    (f) => patch[f] !== undefined && patch[f] !== (item as unknown as Record<string, unknown>)[f]
  );

  await db
    .prepare(
      `UPDATE items SET
         type          = COALESCE(?, type),
         title         = COALESCE(?, title),
         location      = CASE WHEN ? THEN ? ELSE location END,
         notes         = CASE WHEN ? THEN ? ELSE notes END,
         start_at      = COALESCE(?, start_at),
         end_at        = CASE WHEN ? THEN ? ELSE end_at END,
         all_day       = COALESCE(?, all_day),
         rrule         = CASE WHEN ? THEN ? ELSE rrule END,
         timezone      = COALESCE(?, timezone),
         location_kind = CASE WHEN ? THEN ? ELSE location_kind END,
         updated_at    = ?
       WHERE id = ?`
    )
    .bind(
      patch.type ?? null,
      patch.title ?? null,
      patch.location !== undefined ? 1 : 0, patch.location ?? null,
      patch.notes !== undefined ? 1 : 0, patch.notes ?? null,
      patch.start_at ?? null,
      patch.end_at !== undefined ? 1 : 0, patch.end_at ?? null,
      patch.all_day !== undefined ? (patch.all_day ? 1 : 0) : null,
      patch.rrule !== undefined ? 1 : 0, patch.rrule ?? null,
      patch.timezone ?? null,
      patch.location_kind !== undefined ? 1 : 0, patch.location_kind ?? null,
      now,
      id
    )
    .run();

  // If timing changed, purge pending dispatch so materialize rebuilds with correct fire times (D7)
  if (timingChanged) {
    await deletePendingDispatchForItem(db, id);
  }

  const row = await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(id)
    .first<ItemRow>();
  if (!row) throw new Error("updateItem: row missing after update");
  const reminders = await getItemReminders(db, id);
  return { ok: true, value: { ...mapItem(row), reminders } };
}

/**
 * Archive or restore a non-recurring item. One function with a boolean, not two one-way
 * functions — mirrors completeItem's shape, this repo's existing precedent for a REVERSIBLE
 * state flag on items (plan Decision 8's justification for why this is not a one-way action).
 *
 * `updated_at` is deliberately NOT touched in either direction, mirroring completeItem
 * (plan §5.4 / R6) — neither transition is visible to anything that keys off updated_at today.
 */
export async function setItemArchived(
  db: D1Database,
  email: string,
  itemId: string,
  archived: boolean,
  now: EpochMs
): Promise<Result<ItemWithReminders>> {
  const item = await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(itemId)
    .first<ItemRow>();
  if (!item) return { ok: false, code: "NOT_FOUND", message: "Item not found" };

  const writable = await canWriteList(db, email, item.list_id);
  if (!writable) return { ok: false, code: "FORBIDDEN", message: "Forbidden" };

  if (archived) {
    if (item.rrule !== null) {
      return { ok: false, code: "VALIDATION", message: "Recurring items cannot be archived" };
    }
    if (item.archived_at !== null) {
      return { ok: false, code: "CONFLICT", message: "Item is already archived" };
    }
    const mapped = mapItem(item);
    if (!isArchivable(mapped, now)) {
      const reason = archiveBlockedReason(mapped, now) ?? "Item cannot be archived yet";
      return { ok: false, code: "VALIDATION", message: reason };
    }

    // Set-then-purge (plan Decision 3(i)): a readability choice, mirroring completeItem's own
    // set-then-purge order (db.ts's non-recurring completed=true arm above) — not a fix for a
    // materialize race, which cannot occur here (archiving requires start_at < now, and
    // expandOccurrences returns [] for a non-recurring item whose start precedes the window).
    await db.prepare("UPDATE items SET archived_at = ? WHERE id = ?").bind(now, itemId).run();
    await deletePendingDispatchForItem(db, itemId);
  } else {
    if (item.archived_at === null) {
      return { ok: false, code: "CONFLICT", message: "Item is not archived" };
    }
    // WHY no dispatch action: at restore time the item has no pending dispatch rows — they were
    // purged on the way in, and none could have been re-created (archived items are excluded
    // from getActiveItemsWithReminders and, independently, expandOccurrences returns [] for a
    // past non-recurring start). Restoring reminders to a rescheduled item happens through the
    // ordinary updateItem `timingChanged` purge + materialize path, same as any never-archived
    // item — no archive-specific handling needed (plan Decision 8, mirroring completeItem's
    // un-complete arms at the "No dispatch purge — materialize self-heals" comments above).
    // No `rrule` guard either: an archived item is non-recurring by construction, so a guard
    // for it would be unreachable code.
    await db.prepare("UPDATE items SET archived_at = NULL WHERE id = ?").bind(itemId).run();
  }

  const row = await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(itemId)
    .first<ItemRow>();
  if (!row) throw new Error("setItemArchived: row missing after update");
  const reminders = await getItemReminders(db, itemId);
  return { ok: true, value: { ...mapItem(row), reminders } };
}

/**
 * Delete an item.
 * HARD REQUIREMENT (P2-N1): purge pending dispatch BEFORE deleting the item.
 * reminder_dispatch has NO FK to items (engine owns lifecycle), so without this the dispatch rows orphan.
 *
 * Application-level cascade (M5-PROD-FK fix): SQLite FK enforcement is OFF by default and
 * Cloudflare D1's production default is unverified. The real migration declares ON DELETE CASCADE
 * on item_reminders.item_id and item_occurrence_state.item_id — but we cannot rely on that
 * enforcement being active. Each child table is deleted explicitly in app code so the result is
 * correct regardless of D1's FK enforcement state.
 *
 * Ordering invariant (load-bearing):
 *   1. deletePendingDispatchForItem (FIRST — filters by item_id; must run before item is gone)
 *   2. Delete R2 objects for the item (feat/attachments — best-effort, §3.5)
 *   3. DELETE attachment rows for the item (feat/attachments)
 *   4. DELETE item_reminders for the item
 *   5. DELETE item_occurrence_state for the item
 *   6. DELETE the items row
 *
 * `bucket` (R2Bucket) is threaded in so this function stays the authz + cleanup owner
 * (project convention: db.ts owns cleanup, consistent with dispatch purge above) — plan §3.4.
 */
export async function deleteItem(
  db: D1Database,
  email: string,
  id: string,
  bucket: R2Bucket
): Promise<Result<void>> {
  const item = await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(id)
    .first<ItemRow>();
  if (!item) return { ok: false, code: "NOT_FOUND", message: "Item not found" };

  const writable = await canWriteList(db, email, item.list_id);
  if (!writable) return { ok: false, code: "FORBIDDEN", message: "Forbidden" };

  // Step 1: purge pending dispatch FIRST (P2-N1, D7).
  // reminder_dispatch has no FK to items; purge must precede the item delete.
  await deletePendingDispatchForItem(db, id);

  // Step 2: delete R2 objects for the item (feat/attachments, P2-N1-shaped: must precede the
  // items delete conceptually — here it's simply ordered ahead of the attachment row delete).
  // Best-effort — never fails the item delete (§3.5).
  await deleteAttachmentObjectsForItem(bucket, id);

  // Step 3: delete attachment rows for the item (feat/attachments).
  // Explicit app-level delete — do not rely on the attachment table's FK ON DELETE CASCADE.
  await db.prepare("DELETE FROM attachment WHERE item_id = ?").bind(id).run();

  // Steps 4–5: explicit child deletes — application-level cascade (M5-PROD-FK).
  // Cannot rely on SQLite FK ON DELETE CASCADE being active in production D1.
  await db.prepare("DELETE FROM item_reminders WHERE item_id = ?").bind(id).run();
  await db.prepare("DELETE FROM item_occurrence_state WHERE item_id = ?").bind(id).run();

  // Step 6: delete the item row itself
  await db.prepare("DELETE FROM items WHERE id = ?").bind(id).run();

  return { ok: true, value: undefined };
}

// ---------------------------------------------------------------------------
// Attachments (feat/attachments) — metadata CRUD + cascade cleanup helper.
// Authorization mirrors getItemForUser exactly: resolve the item first (absent -> NOT_FOUND,
// no leak of whether the list exists), then canReadList/canWriteList (false -> FORBIDDEN).
// ---------------------------------------------------------------------------

/**
 * List an item's attachments (metadata only, no bytes). Read authz: canReadList.
 */
export async function listAttachments(
  db: D1Database,
  email: string,
  itemId: string
): Promise<Result<Attachment[]>> {
  const item = await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(itemId)
    .first<ItemRow>();
  if (!item) return { ok: false, code: "NOT_FOUND", message: "Item not found" };

  const readable = await canReadList(db, email, item.list_id);
  if (!readable) return { ok: false, code: "FORBIDDEN", message: "Forbidden" };

  const { results } = await db
    .prepare("SELECT * FROM attachment WHERE item_id = ? ORDER BY created_at")
    .bind(itemId)
    .all<AttachmentRow>();
  return { ok: true, value: results.map(mapAttachment) };
}

/**
 * Resolve a single attachment row scoped to its item, for the download route. Read authz:
 * canReadList. NOT_FOUND if the item OR the attachment (scoped to that item) is absent;
 * FORBIDDEN if the item exists but is not readable by the caller.
 */
export async function getAttachmentForDownload(
  db: D1Database,
  email: string,
  itemId: string,
  attachmentId: string
): Promise<Result<Attachment>> {
  const item = await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(itemId)
    .first<ItemRow>();
  if (!item) return { ok: false, code: "NOT_FOUND", message: "Item not found" };

  const readable = await canReadList(db, email, item.list_id);
  if (!readable) return { ok: false, code: "FORBIDDEN", message: "Forbidden" };

  const row = await db
    .prepare("SELECT * FROM attachment WHERE id = ? AND item_id = ?")
    .bind(attachmentId, itemId)
    .first<AttachmentRow>();
  if (!row) return { ok: false, code: "NOT_FOUND", message: "Attachment not found" };

  return { ok: true, value: mapAttachment(row) };
}

/**
 * SINGLE authorization + per-item cap check for the upload path (plan §5.4/m3 — pinned).
 * Enforces canWriteList + the per-item total-bytes and count caps BEFORE any R2 `put` is
 * attempted. `createAttachment` (below) does NOT re-run authz or caps — this is the one place
 * both are checked, so the reviewer-required "authz enforced exactly once, before any R2 write"
 * property holds.
 *
 * TOCTOU note (m5): the SELECT SUM/COUNT check below and the later INSERT are not atomic under
 * concurrent uploads to the same item — best-effort at single-family scale (no row locking /
 * transaction serialization for v1); see plan §5.3.
 */
export async function prepareAttachmentUpload(
  db: D1Database,
  email: string,
  itemId: string,
  incomingSize: number
): Promise<Result<{ list_id: string }>> {
  const item = await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(itemId)
    .first<ItemRow>();
  if (!item) return { ok: false, code: "NOT_FOUND", message: "Item not found" };

  const writable = await canWriteList(db, email, item.list_id);
  if (!writable) return { ok: false, code: "FORBIDDEN", message: "Forbidden" };

  const agg = await db
    .prepare(
      "SELECT COALESCE(SUM(size), 0) AS total_size, COUNT(*) AS count FROM attachment WHERE item_id = ?"
    )
    .bind(itemId)
    .first<{ total_size: number; count: number }>();
  const totalSize = agg?.total_size ?? 0;
  const count = agg?.count ?? 0;

  if (count + 1 > ATTACHMENT_MAX_ITEM_COUNT) {
    return {
      ok: false,
      code: "VALIDATION",
      message: `An item can have at most ${ATTACHMENT_MAX_ITEM_COUNT} attachments`,
    };
  }
  if (totalSize + incomingSize > ATTACHMENT_MAX_ITEM_BYTES) {
    return {
      ok: false,
      code: "VALIDATION",
      message: `Total attachment size for this item would exceed ${ATTACHMENT_MAX_ITEM_BYTES} bytes`,
    };
  }

  return { ok: true, value: { list_id: item.list_id } };
}

/**
 * Create (INSERT-only) an attachment row. Does NOT re-run authz or caps —
 * prepareAttachmentUpload already did (m3). `id` and `input.r2_key` are generated in the route
 * (server code) so the row matches the R2 object already `put`. `email` is passed through
 * solely for `uploaded_by` (verified JWT identity), never from the request body.
 */
export async function createAttachment(
  db: D1Database,
  email: string,
  itemId: string,
  id: string,
  input: CreateAttachmentInput,
  now: EpochMs
): Promise<Result<Attachment>> {
  const norm = email.toLowerCase();
  await db
    .prepare(
      `INSERT INTO attachment (id, item_id, filename, content_type, size, r2_key, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, itemId, input.filename, input.content_type, input.size, input.r2_key, norm, now)
    .run();

  const row = await db
    .prepare("SELECT * FROM attachment WHERE id = ?")
    .bind(id)
    .first<AttachmentRow>();
  if (!row) throw new Error("createAttachment: row missing after insert");
  return { ok: true, value: mapAttachment(row) };
}

/**
 * Delete a single attachment (row + R2 object). Write authz: canWriteList. R2 delete is
 * best-effort (§3.5) — never fails the row delete.
 */
export async function deleteAttachment(
  db: D1Database,
  email: string,
  itemId: string,
  attachmentId: string,
  bucket: R2Bucket
): Promise<Result<void>> {
  const item = await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(itemId)
    .first<ItemRow>();
  if (!item) return { ok: false, code: "NOT_FOUND", message: "Item not found" };

  const writable = await canWriteList(db, email, item.list_id);
  if (!writable) return { ok: false, code: "FORBIDDEN", message: "Forbidden" };

  const row = await db
    .prepare("SELECT * FROM attachment WHERE id = ? AND item_id = ?")
    .bind(attachmentId, itemId)
    .first<AttachmentRow>();
  if (!row) return { ok: false, code: "NOT_FOUND", message: "Attachment not found" };

  try {
    await bucket.delete(row.r2_key);
  } catch (err) {
    // Best-effort (§3.5): a failed R2 delete must never wedge the row delete.
    console.warn(`deleteAttachment: R2 delete failed for key ${row.r2_key}`, err);
  }

  await db.prepare("DELETE FROM attachment WHERE id = ?").bind(attachmentId).run();

  return { ok: true, value: undefined };
}

/**
 * Cascade helper (NO authz — called only from within already-authorized deleteItem/deleteList).
 * Best-effort: lists all R2 objects under the `items/<itemId>/` prefix and deletes them; never
 * throws on R2 error (logs + continues) so it can never wedge the caller's row deletion (§3.5).
 *
 * Pagination (m6/§3.4): loops on `truncated`/`cursor` so a future bump of
 * ATTACHMENT_MAX_ITEM_COUNT past a single R2 `list` page can never silently orphan objects —
 * this is the "cursor loop" option the plan prefers over a cap-tied assertion comment.
 */
export async function deleteAttachmentObjectsForItem(
  bucket: R2Bucket,
  itemId: string
): Promise<void> {
  const prefix = `items/${itemId}/`;
  try {
    let cursor: string | undefined;
    do {
      const listed: R2Objects = await bucket.list({ prefix, cursor });
      if (listed.objects.length > 0) {
        await bucket.delete(listed.objects.map((o) => o.key));
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor !== undefined);
  } catch (err) {
    console.warn(`deleteAttachmentObjectsForItem: R2 cleanup failed for prefix ${prefix}`, err);
  }
}

/**
 * Complete or un-complete an item occurrence.
 * - completed=true, non-recurring (occurrenceAt=null): set completed_at; purge dispatch for item.
 * - completed=true, recurring (occurrenceAt required): upsert item_occurrence_state; purge dispatch for occurrence.
 * - completed=false, non-recurring: clear completed_at. No dispatch action — materialize self-heals.
 * - completed=false, recurring: delete item_occurrence_state row. No dispatch action — materialize self-heals.
 */
export async function completeItem(
  db: D1Database,
  email: string,
  itemId: string,
  occurrenceAt: EpochMs | null,
  completed: boolean,
  now: EpochMs
): Promise<Result<void>> {
  const item = await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(itemId)
    .first<ItemRow>();
  if (!item) return { ok: false, code: "NOT_FOUND", message: "Item not found" };

  const writable = await canWriteList(db, email, item.list_id);
  if (!writable) return { ok: false, code: "FORBIDDEN", message: "Forbidden" };

  // GUARD, not load-bearing (plan §5.5): completed_at is not an input to the live archive rule
  // (Decision 1.3), so this defends consistency (archived-and-freshly-ticked is an incoherent
  // state) rather than any proof. API-reachable, not UI-reachable.
  if (item.archived_at !== null) {
    return { ok: false, code: "CONFLICT", message: "Item is archived" };
  }

  if (item.rrule && completed && occurrenceAt === null) {
    return {
      ok: false,
      code: "VALIDATION",
      message: "occurrence_at is required for recurring items",
    };
  }

  if (occurrenceAt !== null) {
    // Recurring item
    if (completed) {
      await db
        .prepare(
          `INSERT INTO item_occurrence_state (item_id, occurrence_at, completed_at)
           VALUES (?, ?, ?)
           ON CONFLICT(item_id, occurrence_at) DO UPDATE SET completed_at = ?`
        )
        .bind(itemId, occurrenceAt, now, now)
        .run();
      // Purge pending dispatch for this specific occurrence (M3)
      await deletePendingDispatchForOccurrence(db, itemId, occurrenceAt);
    } else {
      await db
        .prepare(
          "DELETE FROM item_occurrence_state WHERE item_id = ? AND occurrence_at = ?"
        )
        .bind(itemId, occurrenceAt)
        .run();
      // No dispatch purge — materialize self-heals
    }
  } else {
    // Non-recurring item
    if (completed) {
      await db
        .prepare("UPDATE items SET completed_at = ? WHERE id = ?")
        .bind(now, itemId)
        .run();
      // Purge all pending dispatch for this item (M3)
      await deletePendingDispatchForItem(db, itemId);
    } else {
      await db
        .prepare("UPDATE items SET completed_at = NULL WHERE id = ?")
        .bind(itemId)
        .run();
      // No dispatch purge — materialize self-heals
    }
  }

  return { ok: true, value: undefined };
}

export async function replaceReminders(
  db: D1Database,
  email: string,
  itemId: string,
  reminders: ReminderInput[]
): Promise<Result<ItemReminder[]>> {
  const item = await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(itemId)
    .first<ItemRow>();
  if (!item) return { ok: false, code: "NOT_FOUND", message: "Item not found" };

  const writable = await canWriteList(db, email, item.list_id);
  if (!writable) return { ok: false, code: "FORBIDDEN", message: "Forbidden" };

  // Purge pending dispatch since reminder offsets/channels may change (D7)
  await deletePendingDispatchForItem(db, itemId);

  const result = await _upsertReminders(db, itemId, reminders);
  return { ok: true, value: result };
}

async function _upsertReminders(
  db: D1Database,
  itemId: string,
  reminders: ReminderInput[]
): Promise<ItemReminder[]> {
  await db.prepare("DELETE FROM item_reminders WHERE item_id = ?").bind(itemId).run();
  const inserted: ItemReminder[] = [];
  for (const r of reminders) {
    const rid = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO item_reminders (id, item_id, offset_minutes, channel_email, channel_push)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(rid, itemId, r.offset_minutes, r.channel_email ? 1 : 0, r.channel_push ? 1 : 0)
      .run();
    inserted.push({
      id: rid,
      item_id: itemId,
      offset_minutes: r.offset_minutes,
      channel_email: r.channel_email,
      channel_push: r.channel_push,
    });
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Push subscriptions
// ---------------------------------------------------------------------------

export async function upsertSubscription(
  db: D1Database,
  email: string,
  sub: SubscriptionInput,
  now: EpochMs
): Promise<PushSubscription> {
  const norm = email.toLowerCase();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO push_subscriptions (id, user_email, endpoint, p256dh, auth, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_email = ?,
         p256dh     = ?,
         auth       = ?,
         user_agent = ?,
         id         = CASE WHEN user_email = ? THEN id ELSE ? END`
    )
    .bind(
      id,
      norm,
      sub.endpoint,
      sub.p256dh,
      sub.auth,
      sub.user_agent ?? null,
      now,
      // ON CONFLICT updates
      norm,
      sub.p256dh,
      sub.auth,
      sub.user_agent ?? null,
      norm,
      id
    )
    .run();

  const row = await db
    .prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
    .bind(sub.endpoint)
    .first<PushSubscriptionRow>();
  if (!row) throw new Error("upsertSubscription: row missing after upsert");
  return mapPushSubscription(row);
}

export async function deleteSubscriptionByEndpoint(
  db: D1Database,
  email: string,
  endpoint: string
): Promise<void> {
  await db
    .prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_email = ?")
    .bind(endpoint, email.toLowerCase())
    .run();
}

export async function deleteSubscriptionById(
  db: D1Database,
  id: string
): Promise<void> {
  await db
    .prepare("DELETE FROM push_subscriptions WHERE id = ?")
    .bind(id)
    .run();
}

export async function getSubscriptionsForUser(
  db: D1Database,
  email: string
): Promise<PushSubscription[]> {
  const { results } = await db
    .prepare("SELECT * FROM push_subscriptions WHERE user_email = ?")
    .bind(email.toLowerCase())
    .all<PushSubscriptionRow>();
  return results.map(mapPushSubscription);
}

// ---------------------------------------------------------------------------
// Reminder engine support
// ---------------------------------------------------------------------------

/**
 * Returns all items that have at least one reminder.
 * Non-recurring items whose completed_at is set are excluded (M3 — materialize should skip them).
 * Recurring items' per-occurrence completion is checked in materialize via getCompletedOccurrences.
 */
export async function getActiveItemsWithReminders(
  db: D1Database
): Promise<ItemWithReminders[]> {
  // Join to ensure only items with reminders; exclude completed non-recurring items.
  // GUARD, not a live mechanism (plan Decision 3(ii)): archiving requires start_at < now
  // (Decision 5), so expandOccurrences already returns [] for an archived item regardless of
  // this clause. Kept beside its completed_at sibling so the two predicates cannot drift apart.
  // Unconditional (outside the rrule disjunction) because recurring items can never be archived.
  const { results: itemRows } = await db
    .prepare(
      `SELECT DISTINCT i.* FROM items i
       INNER JOIN item_reminders ir ON ir.item_id = i.id
       WHERE (i.rrule IS NOT NULL OR i.completed_at IS NULL)
         AND i.archived_at IS NULL
       ORDER BY i.start_at`
    )
    .all<ItemRow>();

  return Promise.all(
    itemRows.map(async (row) => ({
      ...mapItem(row),
      reminders: await getItemReminders(db, row.id),
    }))
  );
}

/**
 * Returns all occurrence_at values that are completed for a given item (for materialize's skip).
 */
export async function getCompletedOccurrences(
  db: D1Database,
  itemId: string
): Promise<EpochMs[]> {
  const { results } = await db
    .prepare(
      "SELECT occurrence_at FROM item_occurrence_state WHERE item_id = ?"
    )
    .bind(itemId)
    .all<{ occurrence_at: number }>();
  return results.map((r) => r.occurrence_at);
}

/** INSERT OR IGNORE for idempotent dispatch creation (UNIQUE constraint prevents double-send). */
export async function insertDispatchIgnore(
  db: D1Database,
  row: NewDispatchRow
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO reminder_dispatch
         (id, item_id, item_reminder_id, occurrence_at, fire_at, channel, recipient_email, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .bind(
      row.id,
      row.item_id,
      row.item_reminder_id,
      row.occurrence_at,
      row.fire_at,
      row.channel,
      row.recipient_email
    )
    .run();
}

/**
 * Selects pending dispatch rows due to fire within the grace window.
 * Predicate: status='pending' AND fire_at <= now AND fire_at > now - GRACE_MINUTES*60000
 */
export async function getDueDispatch(
  db: D1Database,
  now: EpochMs,
  graceMinutes: number
): Promise<ReminderDispatch[]> {
  const graceMs = graceMinutes * 60 * 1000;
  const { results } = await db
    .prepare(
      `SELECT * FROM reminder_dispatch
       WHERE status = 'pending'
         AND fire_at <= ?
         AND fire_at > ?
       ORDER BY fire_at`
    )
    .bind(now, now - graceMs)
    .all<DispatchRow>();
  return results.map(mapDispatch);
}

/**
 * Mark dispatch as sent or failed.
 * WHERE id=? AND status='pending' — so a row purged mid-flight by a concurrent edit (N8) is not clobbered.
 */
export async function markDispatch(
  db: D1Database,
  id: string,
  status: "sent" | "failed",
  now: EpochMs
): Promise<void> {
  await db
    .prepare(
      `UPDATE reminder_dispatch
       SET status = ?, sent_at = ?
       WHERE id = ? AND status = 'pending'`
    )
    .bind(status, now, id)
    .run();
}

// ---------------------------------------------------------------------------
// Stale dispatch cleanup helpers (Decision D7)
// ---------------------------------------------------------------------------

/** Purge pending dispatch for all reminders on an item.
 * Used on: item timing change, reminder-set change, item delete (BEFORE the cascade — P2-N1). */
export async function deletePendingDispatchForItem(
  db: D1Database,
  itemId: string
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM reminder_dispatch
       WHERE item_id = ? AND status = 'pending'`
    )
    .bind(itemId)
    .run();
}

/** Purge pending dispatch for all items in a list.
 * Used on: list visibility flip, list delete (BEFORE the cascade — P2-N1). */
export async function deletePendingDispatchForList(
  db: D1Database,
  listId: string
): Promise<void> {
  // Join via items since reminder_dispatch has no FK to lists
  await db
    .prepare(
      `DELETE FROM reminder_dispatch
       WHERE item_id IN (SELECT id FROM items WHERE list_id = ?)
         AND status = 'pending'`
    )
    .bind(listId)
    .run();
}

/** Purge pending dispatch for a deactivated user.
 * Used on: user deactivation (D7/M1). */
export async function deletePendingDispatchForRecipient(
  db: D1Database,
  recipientEmail: string
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM reminder_dispatch
       WHERE recipient_email = ? AND status = 'pending'`
    )
    .bind(recipientEmail.toLowerCase())
    .run();
}

/** Purge pending dispatch for a specific completed occurrence (M3). */
export async function deletePendingDispatchForOccurrence(
  db: D1Database,
  itemId: string,
  occurrenceAt: EpochMs
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM reminder_dispatch
       WHERE item_id = ? AND occurrence_at = ? AND status = 'pending'`
    )
    .bind(itemId, occurrenceAt)
    .run();
}

// ---------------------------------------------------------------------------
// List access helper for engine
// ---------------------------------------------------------------------------

export async function getListById(
  db: D1Database,
  listId: string
): Promise<List | null> {
  const row = await db
    .prepare("SELECT * FROM lists WHERE id = ?")
    .bind(listId)
    .first<ListRow>();
  return row ? mapList(row) : null;
}

/**
 * Engine (trusted cron) raw item read — NO authz, NO email argument. Mirrors getListById
 * above. WHY no authorization check: the dispatch row was already authorized when
 * materialize created it, and sendDue runs in the trusted cron context, not a user request.
 * P2-N1 (pending dispatch is purged BEFORE the FK cascade on item delete) means a dispatch
 * row referencing a since-deleted item is rare/defensive, not a normal path — callers should
 * treat a null return as "item deleted between materialize and send" and skip the send.
 *
 * Deliberately named apart from getItemForUser (the authorized, email-scoped route helper)
 * so the two very different trust models are never confused at a call site.
 */
export async function getItemByIdUnchecked(
  db: D1Database,
  itemId: string
): Promise<Item | null> {
  const row = await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(itemId)
    .first<ItemRow>();
  return row ? mapItem(row) : null;
}
