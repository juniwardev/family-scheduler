// tests/unit/list-isolation-http.test.ts — private-list isolation, exercised at the HTTP layer.
//
// Why this file exists: every other test under tests/ calls db.ts functions directly
// (see db.test.ts, items-get-by-id.test.ts). The Result -> HTTP status mapping
// (`result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 400`) is repeated
// at ~10 call sites across routes/lists.ts and routes/items.ts and is asserted by nothing. This
// is the first test that drives route + middleware + db together as one HTTP request, so a
// future author adding another route-level authz test has a template to copy.
//
// Harness choice (app.fetch vs SELF.fetch from cloudflare:test): every existing HTTP-layer test
// in this repo (auth-deactivated.test.ts, dev-auth-shim.test.ts, items-get-by-id.test.ts) builds
// a Hono app that mirrors the relevant slice of src/worker/index.ts and calls
// `app.fetch(request, mergedEnv)` directly — none of them import the default worker export or
// use SELF. That pattern is proven to work under the "worker" vitest-pool-workers project (real
// D1 via `env.DB`, real R2 via `env.ATTACHMENTS`) and lets each test swap DEV_AUTH_IDENTITY per
// request via a merged env without needing a running dev server. SELF.fetch would dispatch
// through the actual default-exported worker (index.ts's `fetch: app.fetch`), which is a strict
// superset of what's needed here (it also wires reminders/subscriptions/admin/cron) — using the
// smaller, purpose-built app keeps this test scoped to the routers under test (me, lists, items)
// while remaining wired in the same order (`requireAuth` mounted on "/api/*" FIRST) as
// production. Went with app.fetch for consistency with the rest of the suite.
//
// Two-identity driving: per CLAUDE.md's `email` convention, identity always comes from the
// verified Access JWT — never the request body. Locally, that identity is supplied by the
// LOCAL-ONLY dev auth shim (src/worker/auth.ts). Per auth.ts:208-209, the shim substitutes only
// the identity SOURCE — it feeds the exact same upsertUser + D14 active-gate + c.set("user", ...)
// path that the real Cf-Access-Jwt-Assertion flow uses. Two things gate it, checked in order:
//   1. isLocalDevContext(request) — un-forgeable loopback-host check, fails closed. All requests
//      below use an `http://localhost/...` URL so the gate passes.
//   2. env.DEV_AUTH_IDENTITY — read only after (1) passes; a value containing "@" is used
//      verbatim as the caller's email. Each request below builds its own merged env so the
//      switch between the owner and the second user takes effect per-request and never leaks
//      across requests (mirrors dev-auth-shim.test.ts's per-call `{ ...env, ...extraEnv }`).
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../../src/worker/env";
import type { User } from "../../src/worker/types";
import { requireAuth } from "../../src/worker/auth";
import { meRouter } from "../../src/worker/routes/me";
import { listsRouter } from "../../src/worker/routes/lists";
import { itemsRouter } from "../../src/worker/routes/items";
import { createList, createItem } from "../../src/worker/db";

type Variables = { user: User };

const OWNER_EMAIL = "owner@example.com";
const MEMBER_EMAIL = "member@example.com";
const NOW = 1_719_500_000_000;

// Distinctive names so the "no data leak in a 403 body" assertions are meaningful — a generic
// name like "List" could accidentally collide with something in an error message.
const PRIVATE_LIST_NAME = "Very Secret Family Finances";
const SHARED_LIST_NAME = "Shared Grocery List";
const PRIVATE_ITEM_TITLE = "Confidential Therapy Appointment";

// Mirrors src/worker/index.ts's wiring for the routers under test: requireAuth mounted globally
// on "/api/*" FIRST (real middleware — no test stub, same reasoning as dev-auth-shim.test.ts),
// then me/lists/items routed exactly as production mounts them. Reminders/subscriptions/admin
// are intentionally omitted — out of scope for this isolation test.
function buildTestApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("/api/*", requireAuth);
  app.route("/api/me", meRouter);
  app.route("/api/lists", listsRouter);
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

// Drives a single request as `callerEmail` through the REAL requireAuth via the local-dev shim.
// Builds a fresh merged env per call (never mutates the shared cloudflare:test `env`), so the
// identity switch between owner and member phases genuinely takes effect per-request and cannot
// leak between tests or between calls within a test.
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

describe("private-list isolation at the HTTP layer", () => {
  let privateListId: string;
  let sharedListId: string;
  let privateItemId: string;

  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearTables(env.DB);

    // Seed both users directly (mirrors items-get-by-id.test.ts) so upsertUser's promotion
    // logic in the real requireAuth path has a row to find/confirm on the first shimmed request.
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
      .bind(MEMBER_EMAIL, NOW)
      .run();

    // createList's default visibility is 'private' — the shared list below opts in explicitly.
    const privateList = await createList(
      env.DB,
      OWNER_EMAIL,
      { name: PRIVATE_LIST_NAME, visibility: "private" },
      NOW
    );
    privateListId = privateList.id;

    const sharedList = await createList(
      env.DB,
      OWNER_EMAIL,
      { name: SHARED_LIST_NAME, visibility: "shared" },
      NOW
    );
    sharedListId = sharedList.id;

    const privateItemResult = await createItem(
      env.DB,
      OWNER_EMAIL,
      { list_id: privateListId, type: "event", title: PRIVATE_ITEM_TITLE, start_at: NOW + 3_600_000 },
      NOW
    );
    if (!privateItemResult.ok) throw new Error("seed failed: " + privateItemResult.message);
    privateItemId = privateItemResult.value.id;
  });

  it("owner control: GET /api/lists/<own private>/items -> 200 (without this, a bug that 403s everyone would still pass)", async () => {
    const res = await makeRequest(OWNER_EMAIL, "GET", `/api/lists/${privateListId}/items`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { items: Array<{ id: string }> };
    expect(json.items.map((i) => i.id)).toContain(privateItemId);
  });

  it("GET /api/me as a non-owner member: owner's private list is absent, shared list is present", async () => {
    const res = await makeRequest(MEMBER_EMAIL, "GET", "/api/me");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { lists: Array<{ id: string; name: string }> };
    const ids = json.lists.map((l) => l.id);
    expect(ids).not.toContain(privateListId);
    expect(ids).toContain(sharedListId);
  });

  it("GET /api/lists/<private>/items as a non-owner member -> 403 FORBIDDEN, no data leak", async () => {
    const res = await makeRequest(MEMBER_EMAIL, "GET", `/api/lists/${privateListId}/items`);
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error).toEqual({ code: "FORBIDDEN", message: "Forbidden" });

    const text = JSON.stringify(json);
    expect(text).not.toContain(PRIVATE_LIST_NAME);
    expect(text).not.toContain(PRIVATE_ITEM_TITLE);
  });

  it("control: GET /api/lists/<shared>/items as a non-owner member -> 200 (proves 403 above is not blanket denial)", async () => {
    const res = await makeRequest(MEMBER_EMAIL, "GET", `/api/lists/${sharedListId}/items`);
    expect(res.status).toBe(200);
  });

  it("control: GET /api/lists/<nonexistent-uuid>/items -> 404 (proves the 403 above is a real authz decision, not a lookup miss)", async () => {
    const res = await makeRequest(
      MEMBER_EMAIL,
      "GET",
      `/api/lists/${crypto.randomUUID()}/items`
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("PATCH /api/lists/<private> as a non-owner member -> 403 FORBIDDEN", async () => {
    const res = await makeRequest(MEMBER_EMAIL, "PATCH", `/api/lists/${privateListId}`, {});
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("FORBIDDEN");
  });

  it("DELETE /api/lists/<private> as a non-owner member -> 403 FORBIDDEN", async () => {
    const res = await makeRequest(MEMBER_EMAIL, "DELETE", `/api/lists/${privateListId}`);
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("FORBIDDEN");
  });

  it("POST /api/items with list_id = private list as a non-owner member -> 403 FORBIDDEN, no data leak", async () => {
    const res = await makeRequest(MEMBER_EMAIL, "POST", "/api/items", {
      list_id: privateListId,
      type: "event",
      title: "Attempted intrusion",
      start_at: NOW + 3_600_000,
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("FORBIDDEN");

    const text = JSON.stringify(json);
    expect(text).not.toContain(PRIVATE_LIST_NAME);
  });

  it("GET /api/items/<item in private list> as a non-owner member -> 403 FORBIDDEN (deep-link path), no data leak", async () => {
    const res = await makeRequest(MEMBER_EMAIL, "GET", `/api/items/${privateItemId}`);
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("FORBIDDEN");

    const text = JSON.stringify(json);
    expect(text).not.toContain(PRIVATE_ITEM_TITLE);
  });

  it("control: GET /api/items/<nonexistent-uuid> -> 404", async () => {
    const res = await makeRequest(MEMBER_EMAIL, "GET", `/api/items/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("NOT_FOUND");
  });
});
