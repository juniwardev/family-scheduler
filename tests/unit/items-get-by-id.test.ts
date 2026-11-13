// tests/unit/items-get-by-id.test.ts — GET /api/items/:id authz (Ruling 2 / getItemForUser).
// Mirrors getItems()'s authz semantics: owner reads own private item -> 200; non-owner on a
// private list -> 403 FORBIDDEN; missing id -> 404 NOT_FOUND; shared-list item readable by
// any member -> 200.
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
// rebuilding the Hono app (mirrors items-validation.test.ts's buildTestApp pattern, but
// parameterized on the caller since this suite needs owner vs non-owner requests).
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
    "items",
    "lists",
    "users",
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
}

async function makeRequest(method: string, path: string): Promise<Response> {
  return testApp.fetch(
    new Request(`http://localhost${path}`, { method }),
    env as unknown as Env
  );
}

describe("GET /api/items/:id — authorized point-read (Ruling 2)", () => {
  let privateListId: string;
  let sharedListId: string;
  let privateItemId: string;
  let sharedItemId: string;

  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearTables(env.DB);
    callerEmail = OWNER_EMAIL;

    await env.DB
      .prepare("INSERT INTO users (email, display_name, role, active, created_at) VALUES (?, NULL, 'admin', 1, ?)")
      .bind(OWNER_EMAIL, NOW)
      .run();
    await env.DB
      .prepare("INSERT INTO users (email, display_name, role, active, created_at) VALUES (?, NULL, 'member', 1, ?)")
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
      { list_id: privateListId, type: "event", title: "Private item", start_at: NOW + 3_600_000 },
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
  });

  it("owner reads their own private item -> 200 with reminders populated", async () => {
    callerEmail = OWNER_EMAIL;
    const res = await makeRequest("GET", `/api/items/${privateItemId}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { item: { id: string; title: string; reminders: unknown[] } };
    expect(json.item.id).toBe(privateItemId);
    expect(json.item.title).toBe("Private item");
    expect(Array.isArray(json.item.reminders)).toBe(true);
  });

  it("non-owner reading a private-list item -> 403 FORBIDDEN (exists, not readable)", async () => {
    callerEmail = OTHER_EMAIL;
    const res = await makeRequest("GET", `/api/items/${privateItemId}`);
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("FORBIDDEN");
  });

  it("missing item id -> 404 NOT_FOUND", async () => {
    callerEmail = OWNER_EMAIL;
    const res = await makeRequest("GET", `/api/items/does-not-exist`);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("shared-list item is readable by any member -> 200", async () => {
    callerEmail = OTHER_EMAIL;
    const res = await makeRequest("GET", `/api/items/${sharedItemId}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { item: { id: string } };
    expect(json.item.id).toBe(sharedItemId);
  });
});
