// tests/unit/attachments-validation.test.ts — allowlist + size cap unit tests (plan §7.8).
// Exercises the full upload route so validation runs exactly as production code runs it
// (extension+Content-Type allowlist, per-file cap, per-item total/count caps, empty-type .txt).
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../../src/worker/env";
import type { User } from "../../src/worker/types";
import { itemsRouter } from "../../src/worker/routes/items";
import { createList, createItem } from "../../src/worker/db";
import {
  ATTACHMENT_MAX_FILE_BYTES,
  ATTACHMENT_MAX_ITEM_BYTES,
  ATTACHMENT_MAX_ITEM_COUNT,
} from "../../src/worker/config";

type Variables = { user: User };

const OWNER_EMAIL = "owner@example.com";
const NOW = 1719500000000;

function fakeUser(email: string): User {
  return {
    email,
    display_name: null,
    role: "member",
    active: true,
    created_at: NOW,
    maps_provider: null,
  };
}

function buildTestApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("user", fakeUser(OWNER_EMAIL));
    await next();
  });
  app.route("/api", itemsRouter);
  return app;
}

const testApp = buildTestApp();

// Schema harness (m1 — this file's own inline DDL copy; the harness does not read migration
// files). Mirrors migrations/0006_attachments.sql exactly plus the minimal parent tables.
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

async function uploadFile(
  itemId: string,
  filename: string,
  contentType: string,
  bytes: Uint8Array
): Promise<Response> {
  const form = new FormData();
  const file = new File([bytes], filename, { type: contentType });
  form.append("file", file);
  return testApp.fetch(
    new Request(`http://localhost/api/items/${itemId}/attachments`, {
      method: "POST",
      body: form,
    }),
    env as unknown as Env
  );
}

describe("attachment upload validation (allowlist + size caps)", () => {
  let itemId: string;

  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearTables(env.DB);

    await env.DB
      .prepare(
        "INSERT INTO users (email, display_name, role, active, created_at) VALUES (?, NULL, 'admin', 1, ?)"
      )
      .bind(OWNER_EMAIL, NOW)
      .run();

    const list = await createList(
      env.DB,
      OWNER_EMAIL,
      { name: "Attachment list", visibility: "private" },
      NOW
    );
    const itemResult = await createItem(
      env.DB,
      OWNER_EMAIL,
      { list_id: list.id, type: "task", title: "Permission slip", start_at: NOW + 3_600_000 },
      NOW
    );
    if (!itemResult.ok) throw new Error("seed failed");
    itemId = itemResult.value.id;
  });

  it.each([
    ["photo.png", "image/png"],
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["slip.pdf", "application/pdf"],
    ["report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["notes.txt", "text/plain"],
  ])("accepts allowlisted %s (%s) -> 201", async (filename, contentType) => {
    const res = await uploadFile(itemId, filename, contentType, new Uint8Array([1, 2, 3]));
    expect(res.status).toBe(201);
    const json = (await res.json()) as { attachment: { filename: string; content_type: string } };
    expect(json.attachment.filename).toBe(filename);
    expect(json.attachment.content_type).toBe(contentType);
  });

  it("accepts .txt with an empty declared Content-Type by falling back to text/plain", async () => {
    const res = await uploadFile(itemId, "notes.txt", "", new Uint8Array([1, 2, 3]));
    expect(res.status).toBe(201);
    const json = (await res.json()) as { attachment: { content_type: string } };
    expect(json.attachment.content_type).toBe("text/plain");
  });

  it("rejects a disallowed extension (.exe) -> 400 VALIDATION", async () => {
    const res = await uploadFile(itemId, "virus.exe", "application/octet-stream", new Uint8Array([1]));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION");
  });

  it("rejects SVG (image/svg+xml) -> 400 VALIDATION (deliberately excluded, can carry script)", async () => {
    const res = await uploadFile(itemId, "icon.svg", "image/svg+xml", new Uint8Array([1]));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION");
  });

  it("rejects a mismatched extension/Content-Type pair -> 400 VALIDATION", async () => {
    const res = await uploadFile(itemId, "photo.png", "application/pdf", new Uint8Array([1]));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION");
  });

  it("rejects an oversize file (> per-file cap) -> 400 VALIDATION", async () => {
    const oversized = new Uint8Array(ATTACHMENT_MAX_FILE_BYTES + 1);
    const res = await uploadFile(itemId, "big.png", "image/png", oversized);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION");
  });

  it("rejects when the per-item total-bytes cap would be exceeded -> 400 VALIDATION", async () => {
    // Three uploads whose combined size exceeds ATTACHMENT_MAX_ITEM_BYTES (25 MB) but each is
    // individually under the per-file cap (10 MB): 3 x 9 MB = 27 MB > 25 MB, and 2 x 9 MB = 18 MB
    // is still under the item cap, so the THIRD upload is the one that tips it over.
    const nineMb = 9 * 1024 * 1024;
    const first = await uploadFile(itemId, "a.txt", "text/plain", new Uint8Array(nineMb));
    expect(first.status).toBe(201);

    const second = await uploadFile(itemId, "b.txt", "text/plain", new Uint8Array(nineMb));
    expect(second.status).toBe(201);

    const third = await uploadFile(itemId, "c.txt", "text/plain", new Uint8Array(nineMb));
    expect(third.status).toBe(400);
    const json = (await third.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION");
  });

  it("rejects when the per-item count cap would be exceeded -> 400 VALIDATION", async () => {
    for (let i = 0; i < ATTACHMENT_MAX_ITEM_COUNT; i++) {
      const res = await uploadFile(itemId, `f${i}.txt`, "text/plain", new Uint8Array([1]));
      expect(res.status).toBe(201);
    }
    const overCount = await uploadFile(itemId, "one-too-many.txt", "text/plain", new Uint8Array([1]));
    expect(overCount.status).toBe(400);
    const json = (await overCount.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION");
  });
});
