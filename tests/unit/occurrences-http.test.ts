// tests/unit/occurrences-http.test.ts — GET /api/lists/:id/items?from&to (the calendar route)
// for the window-bound fix (docs/plans/dst-fallback-ambiguous-time.md §7.3, H1).
// Follows items-archive-http.test.ts's app.fetch harness. No outbound calls are made here.
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../../src/worker/env";
import type { User } from "../../src/worker/types";
import { requireAuth } from "../../src/worker/auth";
import { itemsRouter } from "../../src/worker/routes/items";
import { createList, createItem } from "../../src/worker/db";

type Variables = { user: User };

const OWNER_EMAIL = "owner@example.com";
const STAMP = 1_800_000_000_000;

function buildTestApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("/api/*", requireAuth);
  app.route("/api", itemsRouter);
  return app;
}

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
  ];
  for (const stmt of stmts) {
    await db.prepare(stmt).run();
  }
}

async function clearTables(db: D1Database) {
  for (const t of ["item_reminders", "items", "lists", "users"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
}

const testApp = buildTestApp();

async function get(path: string): Promise<Response> {
  const mergedEnv = { ...env, OWNER_EMAIL, DEV_AUTH_IDENTITY: OWNER_EMAIL } as unknown as Env;
  return testApp.fetch(new Request(`http://localhost${path}`), mergedEnv);
}

describe("GET /api/lists/:id/items?from&to — recurring occurrences at the window start", () => {
  let listId: string;

  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearTables(env.DB);
    await env.DB
      .prepare(
        "INSERT INTO users (email, display_name, role, active, created_at) VALUES (?, NULL, 'admin', 1, ?)"
      )
      .bind(OWNER_EMAIL, STAMP)
      .run();
    const list = await createList(env.DB, OWNER_EMAIL, { name: "Family", visibility: "shared" }, STAMP);
    listId = list.id;
  });

  it("H1 a daily 03:00 PDT item appears on day 1 of the month (all 30 June days)", async () => {
    const created = await createItem(
      env.DB,
      OWNER_EMAIL,
      {
        list_id: listId,
        type: "event",
        title: "Early recurring fixture",
        start_at: Date.UTC(2026, 4, 20, 10, 0),
        rrule: "FREQ=DAILY",
        timezone: "America/Los_Angeles",
      },
      STAMP
    );
    if (!created.ok) throw new Error("seed failed: " + created.message);

    const from = Date.UTC(2026, 5, 1, 7, 0);
    const to = Date.UTC(2026, 6, 1, 6, 59, 59);
    const res = await get(`/api/lists/${listId}/items?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { occurrences: Array<{ occurrence_at: number }> };

    const expected: number[] = [];
    for (let d = 1; d <= 30; d++) expected.push(Date.UTC(2026, 5, d, 10, 0));
    expect(json.occurrences.map((o) => o.occurrence_at)).toEqual(expected);
  });
});
