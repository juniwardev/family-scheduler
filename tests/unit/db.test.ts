// Unit/integration tests for db.ts — run against local D1 via vitest-pool-workers
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  upsertUser,
  createList,
  getVisibleLists,
  setUserActive,
  insertDispatchIgnore,
  getDueDispatch,
  createItem,
  deleteItem,
  deleteList,
} from "../../src/worker/db";

// Fake R2 bucket for db.test.ts's deleteItem/deleteList call sites (feat/attachments).
// These tests exercise the dispatch/reminders/occurrence_state cascade, not the R2/attachment
// cascade (that lives in tests/unit/attachments-cascade.test.ts against the real emulated
// ATTACHMENTS binding). A minimal fake satisfies the new required R2Bucket parameter without
// depending on cloudflare:test's R2 emulation here.
const fakeBucket = {
  delete: async () => undefined,
  list: async () => ({ objects: [], truncated: false, cursor: undefined, delimitedPrefixes: [] }),
} as unknown as R2Bucket;

// Apply migrations before each test using the test DB.
// D1 exec() runs one statement at a time, so split each DDL statement.
//
// NOTE: PRAGMA foreign_keys is intentionally NOT enabled here (M5-PROD-FK fix).
// The cascade-ordering tests must prove the application-level cascade in deleteList/deleteItem
// is correct WITHOUT relying on SQLite FK enforcement — because SQLite's default is FK OFF and
// Cloudflare D1's production default is unverified. The FK ON DELETE CASCADE declarations in
// the schema below are kept (they match the real migration and are harmless when FK is off),
// but the guarantee must come from app code (db.ts explicit deletes), not the DB engine.
async function applyMigrations(db: D1Database) {

  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      owner_email TEXT NOT NULL REFERENCES users(email),
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at INTEGER NOT NULL
    )`,
    // items.list_id carries ON DELETE CASCADE so DELETE FROM lists triggers cascade to items.
    // This is the FK relationship that makes ordering in deleteList a hard requirement (P2-N1).
    `CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      location TEXT,
      notes TEXT,
      start_at INTEGER NOT NULL,
      end_at INTEGER,
      all_day INTEGER NOT NULL DEFAULT 0,
      rrule TEXT,
      timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
      completed_at INTEGER,
      created_by TEXT NOT NULL REFERENCES users(email),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS item_reminders (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      offset_minutes INTEGER NOT NULL,
      channel_email INTEGER NOT NULL DEFAULT 1,
      channel_push INTEGER NOT NULL DEFAULT 1
    )`,
    // reminder_dispatch intentionally has NO FK to items/lists (engine owns its lifecycle).
    // Dispatch cleanup must be explicit (deletePendingDispatchFor*) and must precede any
    // FK cascade that would remove the items the cleanup query joins against (P2-N1).
    `CREATE TABLE IF NOT EXISTS reminder_dispatch (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      item_reminder_id TEXT NOT NULL,
      occurrence_at INTEGER NOT NULL,
      fire_at INTEGER NOT NULL,
      channel TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at INTEGER,
      UNIQUE (item_reminder_id, occurrence_at, channel, recipient_email)
    )`,
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email),
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS item_occurrence_state (
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      occurrence_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL,
      PRIMARY KEY (item_id, occurrence_at)
    )`,
    // attachment (migration 0006, feat/attachments) — metadata only; bytes live in R2 under
    // r2_key. DB cascade removes rows, NOT R2 objects — R2 cleanup is explicit in
    // deleteItem/deleteList (P2-N1 pattern). The harness does NOT read migration files, so this
    // DDL must match migrations/0006_attachments.sql exactly (duplicated by design — m1).
    `CREATE TABLE IF NOT EXISTS attachment (
      id           TEXT PRIMARY KEY,
      item_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      filename     TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size         INTEGER NOT NULL,
      r2_key       TEXT NOT NULL UNIQUE,
      uploaded_by  TEXT NOT NULL REFERENCES users(email),
      created_at   INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_items_list ON items(list_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dispatch_due ON reminder_dispatch(status, fire_at)`,
    `CREATE INDEX IF NOT EXISTS idx_sub_user ON push_subscriptions(user_email)`,
    `CREATE INDEX IF NOT EXISTS idx_attachment_item ON attachment(item_id)`,
  ];

  for (const stmt of stmts) {
    // Use prepare().run() since exec() has issues with multi-line DDL in miniflare
    await db.prepare(stmt).run();
  }

  // Migration 0003: add active column if not present
  try {
    await db.prepare(`ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1`).run();
  } catch {
    // Column already exists — ignore
  }

  // Migration 0004: add items.location_kind if not present (feat/notifications-and-location)
  try {
    await db.prepare(`ALTER TABLE items ADD COLUMN location_kind TEXT`).run();
  } catch {
    // Column already exists — ignore
  }

  // Migration 0005: add users.maps_provider if not present (feat/notifications-and-location)
  try {
    await db.prepare(`ALTER TABLE users ADD COLUMN maps_provider TEXT`).run();
  } catch {
    // Column already exists — ignore
  }

  // Migration 0007: add items.archived_at if not present (feat/item-archive)
  try {
    await db.prepare(`ALTER TABLE items ADD COLUMN archived_at INTEGER`).run();
  } catch {
    // Column already exists — ignore
  }
}

async function clearTables(db: D1Database) {
  // Clear in reverse FK order. "attachment" added ahead of "items" (m1 — feat/attachments) so
  // rows don't leak across tests (attachment.item_id references items).
  for (const t of [
    "reminder_dispatch",
    "item_occurrence_state",
    "item_reminders",
    "push_subscriptions",
    "attachment",
    "items",
    "lists",
    "users",
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
}

const OWNER_EMAIL = "owner@example.com";
const MEMBER_EMAIL = "member@example.com";
const NOW = 1719500000000;

describe("upsertUser", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearTables(env.DB);
  });

  it("creates admin user when email matches ownerEmail", async () => {
    const user = await upsertUser(env.DB, OWNER_EMAIL, OWNER_EMAIL, NOW);
    expect(user.email).toBe(OWNER_EMAIL);
    expect(user.role).toBe("admin");
    expect(user.active).toBe(true);
  });

  it("creates member user when email does not match ownerEmail", async () => {
    const user = await upsertUser(env.DB, MEMBER_EMAIL, OWNER_EMAIL, NOW);
    expect(user.role).toBe("member");
    expect(user.active).toBe(true);
  });

  it("promotes a pre-existing member row to admin on re-login when email matches ownerEmail (N5)", async () => {
    // First create as member (ownerEmail was wrong or not set)
    const first = await upsertUser(env.DB, OWNER_EMAIL, "other@example.com", NOW);
    expect(first.role).toBe("member");

    // Now login again with correct ownerEmail — should promote to admin
    const second = await upsertUser(env.DB, OWNER_EMAIL, OWNER_EMAIL, NOW + 1000);
    expect(second.role).toBe("admin");
  });

  it("does NOT downgrade a member's role on re-login", async () => {
    await upsertUser(env.DB, MEMBER_EMAIL, OWNER_EMAIL, NOW);
    const again = await upsertUser(env.DB, MEMBER_EMAIL, OWNER_EMAIL, NOW + 1000);
    expect(again.role).toBe("member");
  });

  it("does NOT reset active flag on re-login (deactivated user stays deactivated)", async () => {
    await upsertUser(env.DB, MEMBER_EMAIL, OWNER_EMAIL, NOW);
    // Deactivate directly in DB
    await env.DB.prepare("UPDATE users SET active = 0 WHERE email = ?").bind(MEMBER_EMAIL).run();
    // Re-login
    const after = await upsertUser(env.DB, MEMBER_EMAIL, OWNER_EMAIL, NOW + 1000);
    expect(after.active).toBe(false);
  });

  it("does NOT overwrite display_name on re-login", async () => {
    await upsertUser(env.DB, MEMBER_EMAIL, OWNER_EMAIL, NOW);
    await env.DB.prepare("UPDATE users SET display_name = 'Alice' WHERE email = ?").bind(MEMBER_EMAIL).run();
    const after = await upsertUser(env.DB, MEMBER_EMAIL, OWNER_EMAIL, NOW + 1000);
    expect(after.display_name).toBe("Alice");
  });

  it("returns the persisted active value — owner row stays active=0 after re-login upsert (D14 P4-N2)", async () => {
    // P4-N2 nit: upsertUser MUST return the persisted row's active value (via re-select),
    // not an optimistically-constructed default. requireAuth's D14 gate reads this value to
    // decide whether to 403 the request.
    // The ON CONFLICT path in upsertUser MUST NOT reset active (only seeds active=1 on INSERT).
    // Even if the owner somehow becomes active=0 (only reachable via direct DB edit in practice),
    // the upsert must preserve that state — the self-deactivation guard is the operative protection.
    await upsertUser(env.DB, OWNER_EMAIL, OWNER_EMAIL, NOW);
    // Force active=0 directly (simulates a direct DB edit; unreachable via app due to the guard)
    await env.DB.prepare("UPDATE users SET active = 0 WHERE email = ?").bind(OWNER_EMAIL).run();

    // Re-login: upsert must NOT reset active to 1 on the ON CONFLICT path
    const after = await upsertUser(env.DB, OWNER_EMAIL, OWNER_EMAIL, NOW + 1000);
    // Returned value must reflect the persisted DB state, not an assumed default
    expect(after.active).toBe(false);
    // Double-check: persisted DB value is still 0 (upsert did not write active=1)
    const row = await env.DB
      .prepare("SELECT active FROM users WHERE email = ?")
      .bind(OWNER_EMAIL)
      .first<{ active: number }>();
    expect(row?.active).toBe(0);
  });
});

describe("createList / getVisibleLists", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearTables(env.DB);
    await upsertUser(env.DB, OWNER_EMAIL, OWNER_EMAIL, NOW);
    await upsertUser(env.DB, MEMBER_EMAIL, OWNER_EMAIL, NOW);
  });

  it("private list is visible only to owner", async () => {
    await createList(env.DB, OWNER_EMAIL, { name: "Private", visibility: "private" }, NOW);
    const ownerLists = await getVisibleLists(env.DB, OWNER_EMAIL);
    const memberLists = await getVisibleLists(env.DB, MEMBER_EMAIL);
    expect(ownerLists.some((l) => l.name === "Private")).toBe(true);
    expect(memberLists.some((l) => l.name === "Private")).toBe(false);
  });

  it("shared list is visible to all users", async () => {
    await createList(env.DB, OWNER_EMAIL, { name: "Shared", visibility: "shared" }, NOW);
    const memberLists = await getVisibleLists(env.DB, MEMBER_EMAIL);
    expect(memberLists.some((l) => l.name === "Shared")).toBe(true);
  });
});

describe("setUserActive — self-deactivation guard", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearTables(env.DB);
    await upsertUser(env.DB, OWNER_EMAIL, OWNER_EMAIL, NOW);
    await upsertUser(env.DB, MEMBER_EMAIL, OWNER_EMAIL, NOW);
  });

  it("returns VALIDATION error when admin tries to deactivate themselves", async () => {
    const result = await setUserActive(env.DB, OWNER_EMAIL, OWNER_EMAIL, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("admin can deactivate another user", async () => {
    const result = await setUserActive(env.DB, OWNER_EMAIL, MEMBER_EMAIL, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.active).toBe(false);
  });

  it("deactivating a user purges their pending dispatch rows (D7/M1)", async () => {
    // Insert a fake pending dispatch row for the member
    await insertDispatchIgnore(env.DB, {
      id: "dispatch-1",
      item_id: "item-1",
      item_reminder_id: "reminder-1",
      occurrence_at: NOW + 3_600_000,
      fire_at: NOW + 1_800_000,
      channel: "email",
      recipient_email: MEMBER_EMAIL,
    });

    // Verify it exists by checking the due dispatch
    const before = await getDueDispatch(env.DB, NOW + 1_800_000, 5);
    expect(before.some((d) => d.recipient_email === MEMBER_EMAIL)).toBe(true);

    // Deactivate member — should purge their pending dispatch rows (D7/M1)
    await setUserActive(env.DB, OWNER_EMAIL, MEMBER_EMAIL, false);

    // Pending dispatch should be gone
    const after = await getDueDispatch(env.DB, NOW + 1_800_000, 5);
    expect(after.some((d) => d.recipient_email === MEMBER_EMAIL)).toBe(false);
  });
});

describe("cascade-ordering: application-level cascade — no orphans without FK enforcement (M5-PROD-FK)", () => {
  // These tests validate the M5-PROD-FK fix: deleteItem and deleteList must leave ZERO orphaned
  // rows in items, item_reminders, item_occurrence_state, AND reminder_dispatch — and they must
  // do so WITHOUT relying on PRAGMA foreign_keys = ON (which is NOT set in applyMigrations).
  //
  // Why this matters (M5-PROD-FK root cause): SQLite FK enforcement is OFF by default and
  // Cloudflare D1's production default is unverified. Prior tests only proved the ordering was
  // correct when FK enforcement was ON (i.e. the guarantee held in tests but not necessarily
  // in prod). The real guarantee must come from explicit app-level deletes in db.ts.
  //
  // How the test proves the real guarantee: with FK enforcement OFF, SQLite does NOT auto-cascade
  // item_reminders or item_occurrence_state when an item is deleted, and does NOT auto-cascade
  // items when a list is deleted. If deleteItem/deleteList relied on the FK cascade, child rows
  // would be orphaned and these assertions would fail. They pass ONLY because db.ts deletes each
  // child table explicitly in the correct order (D7 / P2-N1).
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearTables(env.DB);
    await upsertUser(env.DB, OWNER_EMAIL, OWNER_EMAIL, NOW);
  });

  it("deleteItem: purges dispatch, reminders, and occurrence_state — no orphans (app-level cascade, FK enforcement OFF)", async () => {
    const list = await createList(env.DB, OWNER_EMAIL, { name: "CascadeList", visibility: "private" }, NOW);
    const itemResult = await createItem(
      env.DB,
      OWNER_EMAIL,
      { list_id: list.id, type: "task", title: "Cascade Task", start_at: NOW + 3_600_000 },
      NOW
    );
    if (!itemResult.ok) throw new Error("createItem failed");
    const itemId = itemResult.value.id;

    // Insert an item_reminders row directly — with FK OFF, this is NOT auto-deleted when the
    // item is deleted. deleteItem must explicitly delete it (M5-PROD-FK application-level cascade).
    const reminderId = "co-reminder-item-1";
    await env.DB
      .prepare(
        "INSERT INTO item_reminders (id, item_id, offset_minutes, channel_email, channel_push) VALUES (?, ?, 60, 1, 0)"
      )
      .bind(reminderId, itemId)
      .run();

    // Insert an item_occurrence_state row directly — same rationale: not auto-deleted without FK.
    await env.DB
      .prepare(
        "INSERT INTO item_occurrence_state (item_id, occurrence_at, completed_at) VALUES (?, ?, ?)"
      )
      .bind(itemId, NOW + 3_600_000, NOW)
      .run();

    // Insert a pending dispatch row — reminder_dispatch has NO FK to items (by design, engine
    // owns lifecycle), so this is never auto-deleted regardless of FK enforcement.
    await insertDispatchIgnore(env.DB, {
      id: "co-dispatch-item-1",
      item_id: itemId,
      item_reminder_id: reminderId,
      occurrence_at: NOW + 3_600_000,
      fire_at: NOW + 1_800_000,
      channel: "email",
      recipient_email: OWNER_EMAIL,
    });

    // attachment row — not auto-deleted without FK enforcement (feat/attachments); this table's
    // R2-object cleanup is exercised in tests/unit/attachments-cascade.test.ts against the real
    // emulated ATTACHMENTS binding — here we only assert the ROW is gone (using a fake bucket).
    await env.DB
      .prepare(
        `INSERT INTO attachment (id, item_id, filename, content_type, size, r2_key, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        "co-attachment-item-1",
        itemId,
        "photo.png",
        "image/png",
        1024,
        `items/${itemId}/co-attachment-item-1`,
        OWNER_EMAIL,
        NOW
      )
      .run();

    const result = await deleteItem(env.DB, OWNER_EMAIL, itemId, fakeBucket);
    expect(result.ok).toBe(true);

    // All tables must be clean — app-level cascade is the load-bearing guarantee
    const itemRow = await env.DB.prepare("SELECT id FROM items WHERE id = ?").bind(itemId).first();
    expect(itemRow).toBeNull();

    const reminderCnt = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM item_reminders WHERE item_id = ?")
      .bind(itemId)
      .first<{ cnt: number }>();
    expect(reminderCnt?.cnt).toBe(0);

    const occurrenceCnt = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM item_occurrence_state WHERE item_id = ?")
      .bind(itemId)
      .first<{ cnt: number }>();
    expect(occurrenceCnt?.cnt).toBe(0);

    const dispatchCnt = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM reminder_dispatch WHERE item_id = ?")
      .bind(itemId)
      .first<{ cnt: number }>();
    expect(dispatchCnt?.cnt).toBe(0);

    const attachmentCnt = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM attachment WHERE item_id = ?")
      .bind(itemId)
      .first<{ cnt: number }>();
    expect(attachmentCnt?.cnt).toBe(0);
  });

  it("deleteList: purges dispatch first (P2-N1), then explicitly removes items and all children — no orphans (app-level cascade, FK enforcement OFF)", async () => {
    // CRITICAL P2-N1 ordering test: deletePendingDispatchForList uses
    //   DELETE FROM reminder_dispatch WHERE item_id IN (SELECT id FROM items WHERE list_id = ?)
    // This subquery-based cleanup MUST run before items are deleted. If db.ts deleted items first,
    // the subquery would return empty and dispatch rows would be left as orphaned pending rows.
    //
    // Additionally (M5-PROD-FK): with FK OFF, no child table is auto-deleted when the list is
    // deleted. deleteList must explicitly delete item_reminders, item_occurrence_state, items,
    // and reminder_dispatch. These assertions prove it does so correctly.
    const list = await createList(
      env.DB,
      OWNER_EMAIL,
      { name: "CascadeListDel", visibility: "private" },
      NOW
    );
    const itemResult = await createItem(
      env.DB,
      OWNER_EMAIL,
      { list_id: list.id, type: "event", title: "Cascade Event", start_at: NOW + 7_200_000 },
      NOW
    );
    if (!itemResult.ok) throw new Error("createItem failed");
    const itemId = itemResult.value.id;

    // item_reminders row — not auto-deleted without FK enforcement
    const reminderId = "co-reminder-list-1";
    await env.DB
      .prepare(
        "INSERT INTO item_reminders (id, item_id, offset_minutes, channel_email, channel_push) VALUES (?, ?, 30, 1, 1)"
      )
      .bind(reminderId, itemId)
      .run();

    // item_occurrence_state row — not auto-deleted without FK enforcement
    await env.DB
      .prepare(
        "INSERT INTO item_occurrence_state (item_id, occurrence_at, completed_at) VALUES (?, ?, ?)"
      )
      .bind(itemId, NOW + 7_200_000, NOW)
      .run();

    // Pending dispatch row — no FK to items by design; never auto-deleted
    await insertDispatchIgnore(env.DB, {
      id: "co-dispatch-list-1",
      item_id: itemId,
      item_reminder_id: reminderId,
      occurrence_at: NOW + 7_200_000,
      fire_at: NOW + 3_600_000,
      channel: "push",
      recipient_email: OWNER_EMAIL,
    });

    // attachment row — not auto-deleted without FK enforcement (feat/attachments); R2-object
    // cleanup is exercised in tests/unit/attachments-cascade.test.ts (real emulated bucket) —
    // here we only assert the ROW is gone (using a fake bucket).
    await env.DB
      .prepare(
        `INSERT INTO attachment (id, item_id, filename, content_type, size, r2_key, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        "co-attachment-list-1",
        itemId,
        "flyer.pdf",
        "application/pdf",
        2048,
        `items/${itemId}/co-attachment-list-1`,
        OWNER_EMAIL,
        NOW
      )
      .run();

    const result = await deleteList(env.DB, OWNER_EMAIL, list.id, fakeBucket);
    expect(result.ok).toBe(true);

    // List must be gone
    const listRow = await env.DB.prepare("SELECT id FROM lists WHERE id = ?").bind(list.id).first();
    expect(listRow).toBeNull();

    // Item must be gone — app-level explicit delete (NOT relying on FK cascade)
    const itemRow = await env.DB.prepare("SELECT id FROM items WHERE id = ?").bind(itemId).first();
    expect(itemRow).toBeNull();

    // item_reminders must be gone — app-level explicit delete
    const reminderCnt = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM item_reminders WHERE item_id = ?")
      .bind(itemId)
      .first<{ cnt: number }>();
    expect(reminderCnt?.cnt).toBe(0);

    // item_occurrence_state must be gone — app-level explicit delete
    const occurrenceCnt = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM item_occurrence_state WHERE item_id = ?")
      .bind(itemId)
      .first<{ cnt: number }>();
    expect(occurrenceCnt?.cnt).toBe(0);

    // reminder_dispatch must be gone — purged by deletePendingDispatchForList (FIRST, P2-N1)
    // before items were deleted, so the subquery in that function found the item rows.
    const dispatchCnt = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM reminder_dispatch WHERE item_id = ?")
      .bind(itemId)
      .first<{ cnt: number }>();
    expect(dispatchCnt?.cnt).toBe(0);

    // attachment row must be gone — app-level explicit delete (feat/attachments)
    const attachmentCnt = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM attachment WHERE item_id = ?")
      .bind(itemId)
      .first<{ cnt: number }>();
    expect(attachmentCnt?.cnt).toBe(0);
  });
});
