// Regression test for QA defect B1: item mutation routes mounted at wrong paths.
//
// Before the fix, itemsRouter was mounted at "/api" with handler paths "/", "/:id",
// "/:id/complete". Requests to the spec-required paths POST /api/items,
// PATCH /api/items/:id, DELETE /api/items/:id, POST /api/items/:id/complete
// all fell through to the SPA fallback (or returned 404 for unmatched routes)
// because the handlers were only registered at /api/, /api/:id, /api/:id/complete.
//
// These tests go through the MOUNTED app (not calling handler functions directly)
// to verify that each mutation route resolves at the correct path. The existing
// unit tests in db.test.ts exercise the handler functions directly and could not
// catch this mounting bug.

import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../../src/worker/env";
import type { User, EpochMs } from "../../src/worker/types";
import { itemsRouter } from "../../src/worker/routes/items";

type Variables = { user: User };

const FAKE_USER: User = {
  email: "test@example.com",
  display_name: "Tester",
  role: "member",
  active: true,
  created_at: 1_000_000 as EpochMs,
  maps_provider: null,
};

// Build a minimal Hono app that mounts itemsRouter at /api without requireAuth.
// A stub middleware injects a fake user so c.get("user") is always defined.
// This mirrors the mount in index.ts but skips Access JWT verification so routes
// can be exercised in tests without a real Cloudflare Access JWT.
function buildTestApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("user", FAKE_USER);
    await next();
  });
  // This is the same mount point used in src/worker/index.ts.
  app.route("/api", itemsRouter);
  return app;
}

// Shared test app instance.
const testApp = buildTestApp();

// Apply DB schema once. No rows are inserted so beforeAll is sufficient.
// The schema is needed so that update/delete/complete handlers can reach the DB
// and return NOT_FOUND rather than a schema-missing error.
async function applyMigrations(db: D1Database) {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
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
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS item_reminders (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      offset_minutes INTEGER NOT NULL,
      channel_email INTEGER NOT NULL DEFAULT 1,
      channel_push INTEGER NOT NULL DEFAULT 1
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

// Helper: make a request through the test app, passing the test env so c.env.DB works.
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

describe("item route mount-path regression (QA defect B1)", () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  // ---------------------------------------------------------------------------
  // POST /api/items — create item
  // ---------------------------------------------------------------------------
  it("POST /api/items: route is registered (returns 400 VALIDATION, not 404)", async () => {
    // An empty body fails validateItemInput before any DB call.
    // If the route is NOT registered at /api/items, Hono returns 404 with text "404 Not Found".
    // If the route IS registered, the handler runs and returns 400 JSON with VALIDATION error.
    const res = await makeRequest("POST", "/api/items", {});
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION");
  });

  it("POST /api/items: content-type is application/json (not text/plain 404)", async () => {
    const res = await makeRequest("POST", "/api/items", {});
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/items/:id — update item
  // ---------------------------------------------------------------------------
  it("PATCH /api/items/:id: route is registered (returns JSON error, not bare 404)", async () => {
    // Route is matched → handler runs → DB lookup finds no item → NOT_FOUND JSON response.
    // A bare Hono 404 (route not matched) returns text/plain "404 Not Found", not JSON.
    const res = await makeRequest("PATCH", "/api/items/nonexistent-id", { title: "Test" });
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe("NOT_FOUND");
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/items/:id — delete item
  // ---------------------------------------------------------------------------
  it("DELETE /api/items/:id: route is registered (returns JSON error, not bare 404)", async () => {
    const res = await makeRequest("DELETE", "/api/items/nonexistent-id");
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe("NOT_FOUND");
  });

  // ---------------------------------------------------------------------------
  // POST /api/items/:id/complete — complete item
  // ---------------------------------------------------------------------------
  it("POST /api/items/:id/complete: route is registered (returns JSON error, not bare 404)", async () => {
    const res = await makeRequest("POST", "/api/items/nonexistent-id/complete", {});
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe("NOT_FOUND");
  });

  // ---------------------------------------------------------------------------
  // GET /api/lists/:id/items — smoke check that GET route still resolves after fix
  // ---------------------------------------------------------------------------
  it("GET /api/lists/:id/items: still resolves correctly after path fix", async () => {
    const res = await makeRequest("GET", "/api/lists/nonexistent-list-id/items");
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe("NOT_FOUND");
  });
});
