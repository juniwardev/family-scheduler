// Server-side regression tests for fix-item-save (docs/plans/fix-item-save.md §8.3).
//
// DC2 — a complete create writes the item + N reminders in one call; bad input writes nothing
//       (pre-write validation, not a DB transaction — see plan §3.2/§7).
// DC4 — PATCH /api/items/:id closes the blank-title and invalid-type write holes: 400
//       VALIDATION, and the DB row is left unchanged. These fail on pre-fix code.
// DC5 — happy paths are preserved: complete create still 201s; PATCH title/type updates still
//       succeed; optional fields (location/notes) can still be cleared to null.
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../../src/worker/env";
import type { User } from "../../src/worker/types";
import { itemsRouter } from "../../src/worker/routes/items";
import { createList } from "../../src/worker/db";

type Variables = { user: User };

const OWNER_EMAIL = "owner@example.com";
const NOW = 1719500000000;

const FAKE_USER: User = {
  email: OWNER_EMAIL,
  display_name: "Owner",
  role: "admin",
  active: true,
  created_at: NOW,
  maps_provider: null,
};

function buildTestApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("user", FAKE_USER);
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
  for (const t of ["reminder_dispatch", "item_occurrence_state", "item_reminders", "items", "lists", "users"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
}

async function makeRequest(method: string, path: string, body?: unknown): Promise<Response> {
  return testApp.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    env as unknown as Env
  );
}

async function countRows(db: D1Database, table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

describe("items validation regression (fix-item-save)", () => {
  let listId: string;

  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearTables(env.DB);
    await env.DB
      .prepare("INSERT INTO users (email, display_name, role, active, created_at) VALUES (?, ?, ?, 1, ?)")
      .bind(OWNER_EMAIL, "Owner", "admin", NOW)
      .run();
    const list = await createList(env.DB, OWNER_EMAIL, { name: "Family", visibility: "shared" }, NOW);
    listId = list.id;
  });

  // ---------------------------------------------------------------------------
  // DC2 — complete create writes item + N reminders in one call; bad input writes nothing
  // ---------------------------------------------------------------------------
  describe("DC2 — POST /api/items", () => {
    it("a complete body with 2 reminders creates exactly 1 item row and 2 reminder rows", async () => {
      const res = await makeRequest("POST", "/api/items", {
        list_id: listId,
        type: "event",
        title: "Family dinner",
        start_at: NOW + 3_600_000,
        reminders: [
          { offset_minutes: 30, channel_email: true, channel_push: true },
          { offset_minutes: 60, channel_email: true, channel_push: false },
        ],
      });
      expect(res.status).toBe(201);
      const json = (await res.json()) as { item: { id: string; reminders: unknown[] } };
      expect(json.item.reminders).toHaveLength(2);

      expect(await countRows(env.DB, "items")).toBe(1);
      expect(await countRows(env.DB, "item_reminders")).toBe(2);
    });

    it("rejected (missing required field) input writes zero items and zero reminders", async () => {
      const res = await makeRequest("POST", "/api/items", {
        list_id: listId,
        type: "event",
        // title missing
        start_at: NOW + 3_600_000,
        reminders: [{ offset_minutes: 30, channel_email: true, channel_push: true }],
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("VALIDATION");

      expect(await countRows(env.DB, "items")).toBe(0);
      expect(await countRows(env.DB, "item_reminders")).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // DC4 — PATCH validation holes closed, nothing written
  // ---------------------------------------------------------------------------
  describe("DC4 — PATCH /api/items/:id validation", () => {
    async function seedItem(): Promise<string> {
      const res = await makeRequest("POST", "/api/items", {
        list_id: listId,
        type: "event",
        title: "Original title",
        start_at: NOW + 3_600_000,
      });
      const json = (await res.json()) as { item: { id: string } };
      return json.item.id;
    }

    it('{title:""} -> 400 VALIDATION naming title, row unchanged', async () => {
      const id = await seedItem();
      const res = await makeRequest("PATCH", `/api/items/${id}`, { title: "" });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe("VALIDATION");
      expect(json.error.message.toLowerCase()).toContain("title");

      const row = await env.DB.prepare("SELECT title FROM items WHERE id = ?").bind(id).first<{ title: string }>();
      expect(row?.title).toBe("Original title");
    });

    it('{title:"   "} (whitespace-only) -> 400 VALIDATION, row unchanged', async () => {
      const id = await seedItem();
      const res = await makeRequest("PATCH", `/api/items/${id}`, { title: "   " });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("VALIDATION");

      const row = await env.DB.prepare("SELECT title FROM items WHERE id = ?").bind(id).first<{ title: string }>();
      expect(row?.title).toBe("Original title");
    });

    it('{type:"bogus"} -> 400 VALIDATION naming type, row unchanged (the third hole)', async () => {
      const id = await seedItem();
      const res = await makeRequest("PATCH", `/api/items/${id}`, { type: "bogus" });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe("VALIDATION");
      expect(json.error.message.toLowerCase()).toContain("type");

      const row = await env.DB.prepare("SELECT type FROM items WHERE id = ?").bind(id).first<{ type: string }>();
      expect(row?.type).toBe("event");
    });
  });

  // ---------------------------------------------------------------------------
  // DC5 — happy paths preserved
  // ---------------------------------------------------------------------------
  describe("DC5 — happy paths preserved", () => {
    it("a fully-completed create still returns 201", async () => {
      const res = await makeRequest("POST", "/api/items", {
        list_id: listId,
        type: "task",
        title: "Buy groceries",
        start_at: NOW,
      });
      expect(res.status).toBe(201);
    });

    it("a create missing a required field still returns 400 VALIDATION (existing behavior)", async () => {
      const res = await makeRequest("POST", "/api/items", {});
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("VALIDATION");
    });

    it('PATCH {title:"New"} -> 200 with title updated', async () => {
      const create = await makeRequest("POST", "/api/items", {
        list_id: listId,
        type: "event",
        title: "Old title",
        start_at: NOW,
      });
      const { item } = (await create.json()) as { item: { id: string } };

      const res = await makeRequest("PATCH", `/api/items/${item.id}`, { title: "New" });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { item: { title: string } };
      expect(json.item.title).toBe("New");
    });

    it('PATCH {type:"task"} -> 200', async () => {
      const create = await makeRequest("POST", "/api/items", {
        list_id: listId,
        type: "event",
        title: "Switch to task",
        start_at: NOW,
      });
      const { item } = (await create.json()) as { item: { id: string } };

      const res = await makeRequest("PATCH", `/api/items/${item.id}`, { type: "task" });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { item: { type: string } };
      expect(json.item.type).toBe("task");
    });

    it("editing location/notes to null still succeeds (optional fields unaffected)", async () => {
      const create = await makeRequest("POST", "/api/items", {
        list_id: listId,
        type: "event",
        title: "Has location",
        location: "Home",
        notes: "Bring snacks",
        start_at: NOW,
      });
      const { item } = (await create.json()) as { item: { id: string } };

      const res = await makeRequest("PATCH", `/api/items/${item.id}`, { location: null, notes: null });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { item: { location: string | null; notes: string | null } };
      expect(json.item.location).toBeNull();
      expect(json.item.notes).toBeNull();
    });
  });
});
