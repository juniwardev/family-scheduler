// tests/unit/items-archive-http.test.ts — POST /api/items/:id/archive and the
// GET /lists/:id/items ?archived=1 / ?from&to branches, at the HTTP layer
// (plan §5.5, §7.1 T16-T21). Follows list-isolation-http.test.ts's app.fetch harness.
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
// The archive route reads the real wall clock (Date.now()) — it is not injectable at the HTTP
// layer — so item start_at fixtures must be built relative to REAL_NOW, not an arbitrary fixed
// instant. NOW remains a fixed "created_at" stamp; it plays no part in archivability.
const NOW = 1_800_000_000_000;
const REAL_NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

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

const testApp = buildTestApp();

async function makeRequest(
  callerEmail: string,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const mergedEnv = {
    ...env,
    OWNER_EMAIL,
    DEV_AUTH_IDENTITY: callerEmail,
  } as unknown as Env;
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return testApp.fetch(new Request(`http://localhost${path}`, init), mergedEnv);
}

describe("POST /api/items/:id/archive + GET ?archived=1 / ?from&to", () => {
  let listId: string;
  let pastItemId: string;

  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearTables(env.DB);
    await env.DB
      .prepare(
        "INSERT INTO users (email, display_name, role, active, created_at) VALUES (?, NULL, 'admin', 1, ?)"
      )
      .bind(OWNER_EMAIL, NOW)
      .run();

    const list = await createList(env.DB, OWNER_EMAIL, { name: "Family", visibility: "shared" }, NOW);
    listId = list.id;

    const pastItem = await createItem(
      env.DB,
      OWNER_EMAIL,
      { list_id: listId, type: "event", title: "Past event", start_at: REAL_NOW - DAY },
      NOW
    );
    if (!pastItem.ok) throw new Error("seed failed: " + pastItem.message);
    pastItemId = pastItem.value.id;
  });

  it("T16 — {archived:true} -> 200 with a numeric archived_at; then {archived:false} -> 200 with null", async () => {
    const archiveRes = await makeRequest(OWNER_EMAIL, "POST", `/api/items/${pastItemId}/archive`, {
      archived: true,
    });
    expect(archiveRes.status).toBe(200);
    const archiveJson = (await archiveRes.json()) as { item: { archived_at: number | null } };
    expect(typeof archiveJson.item.archived_at).toBe("number");

    const restoreRes = await makeRequest(OWNER_EMAIL, "POST", `/api/items/${pastItemId}/archive`, {
      archived: false,
    });
    expect(restoreRes.status).toBe(200);
    const restoreJson = (await restoreRes.json()) as { item: { archived_at: number | null } };
    expect(restoreJson.item.archived_at).toBeNull();
  });

  it("T16b — omitting the body field entirely defaults to archived: true", async () => {
    const res = await makeRequest(OWNER_EMAIL, "POST", `/api/items/${pastItemId}/archive`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { item: { archived_at: number | null } };
    expect(typeof json.item.archived_at).toBe("number");
  });

  it("T17 — both conflict directions -> 409, not 400", async () => {
    await makeRequest(OWNER_EMAIL, "POST", `/api/items/${pastItemId}/archive`, { archived: true });
    const alreadyArchived = await makeRequest(OWNER_EMAIL, "POST", `/api/items/${pastItemId}/archive`, {
      archived: true,
    });
    expect(alreadyArchived.status).toBe(409);

    await makeRequest(OWNER_EMAIL, "POST", `/api/items/${pastItemId}/archive`, { archived: false });
    const notArchived = await makeRequest(OWNER_EMAIL, "POST", `/api/items/${pastItemId}/archive`, {
      archived: false,
    });
    expect(notArchived.status).toBe(409);
  });

  it("T18 — plain GET omits the archived id and includes a live one; ?archived=1 returns only the archived one", async () => {
    const live = await createItem(
      env.DB,
      OWNER_EMAIL,
      { list_id: listId, type: "event", title: "Live sibling", start_at: REAL_NOW + DAY },
      NOW
    );
    if (!live.ok) throw new Error("seed failed");
    await makeRequest(OWNER_EMAIL, "POST", `/api/items/${pastItemId}/archive`, { archived: true });

    const plainRes = await makeRequest(OWNER_EMAIL, "GET", `/api/lists/${listId}/items`);
    const plainJson = (await plainRes.json()) as { items: Array<{ id: string }> };
    const plainIds = plainJson.items.map((i) => i.id);
    expect(plainIds).not.toContain(pastItemId);
    expect(plainIds).toContain(live.value.id);

    const archivedRes = await makeRequest(OWNER_EMAIL, "GET", `/api/lists/${listId}/items?archived=1`);
    const archivedJson = (await archivedRes.json()) as { items: Array<{ id: string }> };
    const archivedIds = archivedJson.items.map((i) => i.id);
    expect(archivedIds).toContain(pastItemId);
    expect(archivedIds).not.toContain(live.value.id);
  });

  it("T19 — ?from&to&archived=1 -> 400 VALIDATION", async () => {
    const res = await makeRequest(
      OWNER_EMAIL,
      "GET",
      `/api/lists/${listId}/items?from=${REAL_NOW - DAY}&to=${REAL_NOW + DAY}&archived=1`
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION");
  });

  it("T20 — ?from&to EXCLUDES an archived item's occurrence and INCLUDES a live item's occurrence", async () => {
    const live = await createItem(
      env.DB,
      OWNER_EMAIL,
      { list_id: listId, type: "event", title: "Live occurrence", start_at: REAL_NOW - DAY },
      NOW
    );
    if (!live.ok) throw new Error("seed failed");
    await makeRequest(OWNER_EMAIL, "POST", `/api/items/${pastItemId}/archive`, { archived: true });

    const res = await makeRequest(
      OWNER_EMAIL,
      "GET",
      `/api/lists/${listId}/items?from=${REAL_NOW - 2 * DAY}&to=${REAL_NOW + 2 * DAY}`
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { occurrences: Array<{ item_id: string }> };
    const ids = json.occurrences.map((o) => o.item_id);
    expect(ids).not.toContain(pastItemId);
    expect(ids).toContain(live.value.id);
  });

  it("T20b — after restoring, the same ?from&to request includes the occurrence again", async () => {
    await makeRequest(OWNER_EMAIL, "POST", `/api/items/${pastItemId}/archive`, { archived: true });
    await makeRequest(OWNER_EMAIL, "POST", `/api/items/${pastItemId}/archive`, { archived: false });

    const res = await makeRequest(
      OWNER_EMAIL,
      "GET",
      `/api/lists/${listId}/items?from=${REAL_NOW - 2 * DAY}&to=${REAL_NOW + 2 * DAY}`
    );
    const json = (await res.json()) as { occurrences: Array<{ item_id: string }> };
    expect(json.occurrences.map((o) => o.item_id)).toContain(pastItemId);
  });

  it("T21 — GET /api/items/:id still resolves an archived item (200) — the deep-link path", async () => {
    await makeRequest(OWNER_EMAIL, "POST", `/api/items/${pastItemId}/archive`, { archived: true });
    const res = await makeRequest(OWNER_EMAIL, "GET", `/api/items/${pastItemId}`);
    expect(res.status).toBe(200);
  });
});
