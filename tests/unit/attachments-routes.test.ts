// tests/unit/attachments-routes.test.ts — route authz (200/403/404) + happy path against the
// emulated ATTACHMENTS R2 bucket (plan §7.8). Authz mirrors getItemForUser exactly: resolve the
// item first (absent -> 404, no leak of whether the list exists), then canReadList/canWriteList
// (false -> 403). uploaded_by is always the verified JWT identity, never a body-supplied value.
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../../src/worker/env";
import type { User } from "../../src/worker/types";
import { itemsRouter } from "../../src/worker/routes/items";
import { createList, createItem } from "../../src/worker/db";

type Variables = { user: User };

const OWNER_EMAIL = "owner@example.com";
const OTHER_EMAIL = "other@example.com";
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

// Per-request caller identity, mutable so each test can act as a different user without
// rebuilding the Hono app (mirrors items-get-by-id.test.ts's buildTestApp pattern).
let callerEmail = OWNER_EMAIL;

function buildTestApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("user", fakeUser(callerEmail));
    await next();
  });
  app.route("/api", itemsRouter);
  return app;
}

const testApp = buildTestApp();

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

function uploadRequest(itemId: string, filename: string, contentType: string, bytes: Uint8Array) {
  const form = new FormData();
  form.append("file", new File([bytes], filename, { type: contentType }));
  return new Request(`http://localhost/api/items/${itemId}/attachments`, {
    method: "POST",
    body: form,
  });
}

async function makeRequest(method: string, path: string, body?: BodyInit): Promise<Response> {
  return testApp.fetch(
    new Request(`http://localhost${path}`, { method, body }),
    env as unknown as Env
  );
}

describe("attachment routes — authz + happy path (emulated R2)", () => {
  let privateListId: string;
  let sharedListId: string;
  let privateItemId: string;
  let sharedItemId: string;

  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearTables(env.DB);
    callerEmail = OWNER_EMAIL;

    await env.DB
      .prepare(
        "INSERT INTO users (email, display_name, role, active, created_at) VALUES (?, NULL, 'admin', 1, ?)"
      )
      .bind(OWNER_EMAIL, NOW)
      .run();
    await env.DB
      .prepare(
        "INSERT INTO users (email, display_name, role, active, created_at) VALUES (?, NULL, 'member', 1, ?)"
      )
      .bind(OTHER_EMAIL, NOW)
      .run();

    const privateList = await createList(
      env.DB,
      OWNER_EMAIL,
      { name: "Private list", visibility: "private" },
      NOW
    );
    privateListId = privateList.id;

    const sharedList = await createList(
      env.DB,
      OWNER_EMAIL,
      { name: "Shared list", visibility: "shared" },
      NOW
    );
    sharedListId = sharedList.id;

    const privateItemResult = await createItem(
      env.DB,
      OWNER_EMAIL,
      { list_id: privateListId, type: "task", title: "Private item", start_at: NOW + 3_600_000 },
      NOW
    );
    if (!privateItemResult.ok) throw new Error("seed failed");
    privateItemId = privateItemResult.value.id;

    const sharedItemResult = await createItem(
      env.DB,
      OWNER_EMAIL,
      { list_id: sharedListId, type: "task", title: "Shared item", start_at: NOW + 7_200_000 },
      NOW
    );
    if (!sharedItemResult.ok) throw new Error("seed failed");
    sharedItemId = sharedItemResult.value.id;

    // Clear any R2 objects a prior test left behind under these item prefixes.
    await clearBucketPrefix(env.ATTACHMENTS, `items/${privateItemId}/`);
    await clearBucketPrefix(env.ATTACHMENTS, `items/${sharedItemId}/`);
  });

  it("owner upload -> 201, list -> 200, download -> 200, delete -> 204", async () => {
    callerEmail = OWNER_EMAIL;

    const uploadRes = await testApp.fetch(
      uploadRequest(privateItemId, "slip.pdf", "application/pdf", new Uint8Array([1, 2, 3, 4])),
      env as unknown as Env
    );
    expect(uploadRes.status).toBe(201);
    const uploadJson = (await uploadRes.json()) as {
      attachment: { id: string; filename: string; uploaded_by: string };
    };
    expect(uploadJson.attachment.filename).toBe("slip.pdf");
    expect(uploadJson.attachment.uploaded_by).toBe(OWNER_EMAIL);
    const attachmentId = uploadJson.attachment.id;

    const listRes = await makeRequest("GET", `/api/items/${privateItemId}/attachments`);
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as { attachments: Array<{ id: string }> };
    expect(listJson.attachments.map((a) => a.id)).toContain(attachmentId);

    const downloadRes = await makeRequest(
      "GET",
      `/api/items/${privateItemId}/attachments/${attachmentId}`
    );
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get("Content-Type")).toBe("application/pdf");
    expect(downloadRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(downloadRes.headers.get("Content-Disposition")).toContain("attachment");
    expect(downloadRes.headers.get("Content-Disposition")).toContain("slip.pdf");
    const downloadedBytes = new Uint8Array(await downloadRes.arrayBuffer());
    expect(Array.from(downloadedBytes)).toEqual([1, 2, 3, 4]);

    const deleteRes = await makeRequest(
      "DELETE",
      `/api/items/${privateItemId}/attachments/${attachmentId}`
    );
    expect(deleteRes.status).toBe(204);

    const afterDelete = await makeRequest(
      "GET",
      `/api/items/${privateItemId}/attachments/${attachmentId}`
    );
    expect(afterDelete.status).toBe(404);
    await afterDelete.json();
  });

  it("image content-type gets an inline Content-Disposition", async () => {
    callerEmail = OWNER_EMAIL;
    const uploadRes = await testApp.fetch(
      uploadRequest(privateItemId, "photo.png", "image/png", new Uint8Array([9, 9, 9])),
      env as unknown as Env
    );
    expect(uploadRes.status).toBe(201);
    const { attachment } = (await uploadRes.json()) as { attachment: { id: string } };

    const downloadRes = await makeRequest(
      "GET",
      `/api/items/${privateItemId}/attachments/${attachment.id}`
    );
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get("Content-Type")).toBe("image/png");
    expect(downloadRes.headers.get("Content-Disposition")).toContain("inline");
    await downloadRes.arrayBuffer(); // drain the R2 object stream (miniflare isolated-storage requirement)
  });

  it("non-owner on a PRIVATE item's attachments -> 403 FORBIDDEN (list/download/upload/delete)", async () => {
    // Seed one attachment as the owner first.
    callerEmail = OWNER_EMAIL;
    const uploadRes = await testApp.fetch(
      uploadRequest(privateItemId, "slip.pdf", "application/pdf", new Uint8Array([1])),
      env as unknown as Env
    );
    expect(uploadRes.status).toBe(201);
    const { attachment } = (await uploadRes.json()) as { attachment: { id: string } };

    callerEmail = OTHER_EMAIL;

    const listRes = await makeRequest("GET", `/api/items/${privateItemId}/attachments`);
    expect(listRes.status).toBe(403);
    expect(((await listRes.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");

    const downloadRes = await makeRequest(
      "GET",
      `/api/items/${privateItemId}/attachments/${attachment.id}`
    );
    expect(downloadRes.status).toBe(403);
    await downloadRes.json();

    const uploadAsOtherRes = await testApp.fetch(
      uploadRequest(privateItemId, "other.pdf", "application/pdf", new Uint8Array([2])),
      env as unknown as Env
    );
    expect(uploadAsOtherRes.status).toBe(403);
    await uploadAsOtherRes.json();

    const deleteRes = await makeRequest(
      "DELETE",
      `/api/items/${privateItemId}/attachments/${attachment.id}`
    );
    expect(deleteRes.status).toBe(403);
    await deleteRes.json();
  });

  it("missing item -> 404 NOT_FOUND (list/upload/download/delete)", async () => {
    callerEmail = OWNER_EMAIL;
    const missingItemId = "does-not-exist";

    const listRes = await makeRequest("GET", `/api/items/${missingItemId}/attachments`);
    expect(listRes.status).toBe(404);
    await listRes.json();

    const uploadRes = await testApp.fetch(
      uploadRequest(missingItemId, "slip.pdf", "application/pdf", new Uint8Array([1])),
      env as unknown as Env
    );
    expect(uploadRes.status).toBe(404);
    await uploadRes.json();

    const downloadRes = await makeRequest(
      "GET",
      `/api/items/${missingItemId}/attachments/some-id`
    );
    expect(downloadRes.status).toBe(404);
    await downloadRes.json();

    const deleteRes = await makeRequest(
      "DELETE",
      `/api/items/${missingItemId}/attachments/some-id`
    );
    expect(deleteRes.status).toBe(404);
    await deleteRes.json();
  });

  it("missing attachment id on a real item -> 404 NOT_FOUND", async () => {
    callerEmail = OWNER_EMAIL;
    const res = await makeRequest(
      "GET",
      `/api/items/${privateItemId}/attachments/does-not-exist`
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("shared list item is readable/writable by any member -> 200/201", async () => {
    callerEmail = OTHER_EMAIL;
    const uploadRes = await testApp.fetch(
      uploadRequest(sharedItemId, "notes.txt", "text/plain", new Uint8Array([1, 2])),
      env as unknown as Env
    );
    expect(uploadRes.status).toBe(201);
    await uploadRes.json();

    const listRes = await makeRequest("GET", `/api/items/${sharedItemId}/attachments`);
    expect(listRes.status).toBe(200);
    await listRes.json();
  });

  it("uploaded_by is always the JWT identity, even if a client tries to spoof it via the form", async () => {
    callerEmail = OWNER_EMAIL;
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1])], "slip.pdf", { type: "application/pdf" }));
    form.append("uploaded_by", OTHER_EMAIL); // spoof attempt — must be ignored
    const res = await testApp.fetch(
      new Request(`http://localhost/api/items/${privateItemId}/attachments`, {
        method: "POST",
        body: form,
      }),
      env as unknown as Env
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { attachment: { uploaded_by: string } };
    expect(json.attachment.uploaded_by).toBe(OWNER_EMAIL);
  });
});
