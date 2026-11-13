// tests/unit/attachments-cascade.test.ts — P2-N1-shaped cascade cleanup (plan §7.8/§3.4):
// deleteItem/deleteList must remove attachment ROWS *and* their R2 objects, against the real
// emulated ATTACHMENTS bucket (not a fake). Also asserts the r2_key scheme
// (`items/<item_id>/<attachment_id>`) and the best-effort-R2-delete property (op still succeeds
// even when an R2 object was already removed out-of-band).
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  createList,
  createItem,
  createAttachment,
  deleteItem,
  deleteList,
  deleteAttachmentObjectsForItem,
} from "../../src/worker/db";

const OWNER_EMAIL = "owner@example.com";
const NOW = 1719500000000;

// Schema harness (m1 — this file's own inline DDL copy; mirrors migrations/0006_attachments.sql).
async function applyMigrations(db: D1Database) {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      maps_provider TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      owner_email TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL,
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
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      location_kind TEXT,
      archived_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS item_reminders (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      offset_minutes INTEGER NOT NULL,
      channel_email INTEGER NOT NULL DEFAULT 1,
      channel_push INTEGER NOT NULL DEFAULT 1
    )`,
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
    `CREATE TABLE IF NOT EXISTS item_occurrence_state (
      item_id TEXT NOT NULL,
      occurrence_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL,
      PRIMARY KEY (item_id, occurrence_at)
    )`,
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
    `CREATE INDEX IF NOT EXISTS idx_attachment_item ON attachment(item_id)`,
  ];
  for (const stmt of stmts) {
    await db.prepare(stmt).run();
  }
}

async function clearTables(db: D1Database) {
  for (const t of [
    "reminder_dispatch",
    "item_occurrence_state",
    "item_reminders",
    "attachment",
    "items",
    "lists",
    "users",
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
}

async function clearBucketPrefix(bucket: R2Bucket, prefix: string) {
  const listed = await bucket.list({ prefix });
  if (listed.objects.length > 0) {
    await bucket.delete(listed.objects.map((o) => o.key));
  }
}

/** Uploads a fake attachment: puts bytes at the scheme'd r2_key, then inserts the row. */
async function seedAttachment(
  db: D1Database,
  itemId: string,
  filename: string,
  contentType: string,
  bytes: Uint8Array
): Promise<{ id: string; r2Key: string }> {
  const id = crypto.randomUUID();
  const r2Key = `items/${itemId}/${id}`;
  await env.ATTACHMENTS.put(r2Key, bytes, { httpMetadata: { contentType } });
  const created = await createAttachment(
    db,
    OWNER_EMAIL,
    itemId,
    id,
    { filename, content_type: contentType, size: bytes.byteLength, r2_key: r2Key },
    NOW
  );
  if (!created.ok) throw new Error("seedAttachment: createAttachment failed");
  return { id, r2Key };
}

describe("attachment cascade cleanup (P2-N1-shaped) — real emulated R2", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearTables(env.DB);
    await env.DB
      .prepare(
        "INSERT INTO users (email, display_name, role, active, created_at) VALUES (?, NULL, 'admin', 1, ?)"
      )
      .bind(OWNER_EMAIL, NOW)
      .run();
  });

  it("r2_key scheme is 'items/<item_id>/<attachment_id>'", async () => {
    const list = await createList(env.DB, OWNER_EMAIL, { name: "L1", visibility: "private" }, NOW);
    const itemResult = await createItem(
      env.DB,
      OWNER_EMAIL,
      { list_id: list.id, type: "task", title: "T1", start_at: NOW },
      NOW
    );
    if (!itemResult.ok) throw new Error("seed failed");
    const itemId = itemResult.value.id;

    await clearBucketPrefix(env.ATTACHMENTS, `items/${itemId}/`);
    const { id, r2Key } = await seedAttachment(
      env.DB,
      itemId,
      "slip.pdf",
      "application/pdf",
      new Uint8Array([1, 2, 3])
    );
    expect(r2Key).toBe(`items/${itemId}/${id}`);

    const object = await env.ATTACHMENTS.get(r2Key);
    expect(object).not.toBeNull();
    await object!.arrayBuffer();

    // Cleanup for test isolation (avoid leaking into the next test's R2 storage frame).
    await deleteAttachmentObjectsForItem(env.ATTACHMENTS, itemId);
  });

  it("deleteItem removes the attachment ROW and the R2 object", async () => {
    const list = await createList(env.DB, OWNER_EMAIL, { name: "L2", visibility: "private" }, NOW);
    const itemResult = await createItem(
      env.DB,
      OWNER_EMAIL,
      { list_id: list.id, type: "task", title: "T2", start_at: NOW },
      NOW
    );
    if (!itemResult.ok) throw new Error("seed failed");
    const itemId = itemResult.value.id;

    await clearBucketPrefix(env.ATTACHMENTS, `items/${itemId}/`);
    const { id: attachmentId, r2Key } = await seedAttachment(
      env.DB,
      itemId,
      "photo.png",
      "image/png",
      new Uint8Array([4, 5, 6])
    );

    // Sanity: both the row and the object exist before delete.
    const beforeRow = await env.DB
      .prepare("SELECT id FROM attachment WHERE id = ?")
      .bind(attachmentId)
      .first();
    expect(beforeRow).not.toBeNull();
    const beforeObject = await env.ATTACHMENTS.get(r2Key);
    expect(beforeObject).not.toBeNull();
    await beforeObject!.arrayBuffer();

    const result = await deleteItem(env.DB, OWNER_EMAIL, itemId, env.ATTACHMENTS);
    expect(result.ok).toBe(true);

    const afterRow = await env.DB
      .prepare("SELECT id FROM attachment WHERE id = ?")
      .bind(attachmentId)
      .first();
    expect(afterRow).toBeNull();

    const afterObject = await env.ATTACHMENTS.get(r2Key);
    expect(afterObject).toBeNull();
  });

  it("deleteList removes attachment ROWS and R2 objects across multiple items", async () => {
    const list = await createList(env.DB, OWNER_EMAIL, { name: "L3", visibility: "private" }, NOW);

    const item1Result = await createItem(
      env.DB,
      OWNER_EMAIL,
      { list_id: list.id, type: "task", title: "T3a", start_at: NOW },
      NOW
    );
    const item2Result = await createItem(
      env.DB,
      OWNER_EMAIL,
      { list_id: list.id, type: "task", title: "T3b", start_at: NOW + 60_000 },
      NOW
    );
    if (!item1Result.ok || !item2Result.ok) throw new Error("seed failed");
    const item1Id = item1Result.value.id;
    const item2Id = item2Result.value.id;

    await clearBucketPrefix(env.ATTACHMENTS, `items/${item1Id}/`);
    await clearBucketPrefix(env.ATTACHMENTS, `items/${item2Id}/`);

    const att1 = await seedAttachment(
      env.DB,
      item1Id,
      "a.txt",
      "text/plain",
      new Uint8Array([1])
    );
    const att2 = await seedAttachment(
      env.DB,
      item2Id,
      "b.txt",
      "text/plain",
      new Uint8Array([2])
    );

    const result = await deleteList(env.DB, OWNER_EMAIL, list.id, env.ATTACHMENTS);
    expect(result.ok).toBe(true);

    const rowCnt = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM attachment WHERE item_id IN (?, ?)")
      .bind(item1Id, item2Id)
      .first<{ cnt: number }>();
    expect(rowCnt?.cnt).toBe(0);

    expect(await env.ATTACHMENTS.get(att1.r2Key)).toBeNull();
    expect(await env.ATTACHMENTS.get(att2.r2Key)).toBeNull();
  });

  it("best-effort R2 delete: deleteItem still succeeds if the R2 object was already removed out-of-band", async () => {
    const list = await createList(env.DB, OWNER_EMAIL, { name: "L4", visibility: "private" }, NOW);
    const itemResult = await createItem(
      env.DB,
      OWNER_EMAIL,
      { list_id: list.id, type: "task", title: "T4", start_at: NOW },
      NOW
    );
    if (!itemResult.ok) throw new Error("seed failed");
    const itemId = itemResult.value.id;

    await clearBucketPrefix(env.ATTACHMENTS, `items/${itemId}/`);
    const { id: attachmentId, r2Key } = await seedAttachment(
      env.DB,
      itemId,
      "c.txt",
      "text/plain",
      new Uint8Array([7])
    );

    // Simulate the R2 object having already vanished (e.g. a prior partial failure or manual
    // removal) — deleteAttachmentObjectsForItem's list+delete over an already-empty prefix must
    // not throw, and the item delete must still succeed and remove the row.
    await env.ATTACHMENTS.delete(r2Key);
    expect(await env.ATTACHMENTS.get(r2Key)).toBeNull();

    const result = await deleteItem(env.DB, OWNER_EMAIL, itemId, env.ATTACHMENTS);
    expect(result.ok).toBe(true);

    const afterRow = await env.DB
      .prepare("SELECT id FROM attachment WHERE id = ?")
      .bind(attachmentId)
      .first();
    expect(afterRow).toBeNull();
  });
});
