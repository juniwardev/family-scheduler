// tests/unit/me-maps-provider.test.ts — PATCH /api/me maps_provider validation (Decision 6, NEW-5).
// Accepts 'apple'/'google'; rejects null/missing/junk with 400 VALIDATION; identity always
// comes from the verified-JWT user set on the request context, never the request body.
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../../src/worker/env";
import type { User } from "../../src/worker/types";
import { meRouter } from "../../src/worker/routes/me";

type Variables = { user: User };

const CALLER_EMAIL = "caller@example.com";
const NOW = 1719500000000;

const FAKE_USER: User = {
  email: CALLER_EMAIL,
  display_name: "Caller",
  role: "member",
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
  app.route("/api/me", meRouter);
  return app;
}

const testApp = buildTestApp();

async function applyMigrations(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        display_name TEXT,
        role TEXT NOT NULL DEFAULT 'member',
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        maps_provider TEXT
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        owner_email TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private',
        created_at INTEGER NOT NULL
      )`
    )
    .run();
}

async function clearTables(db: D1Database) {
  for (const t of ["lists", "users"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
}

async function makeRequest(method: string, path: string, body?: unknown): Promise<Response> {
  return testApp.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    env as unknown as Env
  );
}

describe("PATCH /api/me — maps_provider", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearTables(env.DB);
    await env.DB
      .prepare(
        "INSERT INTO users (email, display_name, role, active, created_at, maps_provider) VALUES (?, ?, 'member', 1, ?, NULL)"
      )
      .bind(CALLER_EMAIL, "Caller", NOW)
      .run();
  });

  it("accepts 'apple' and persists it for the JWT-identified caller", async () => {
    const res = await makeRequest("PATCH", "/api/me", { maps_provider: "apple" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { user: { maps_provider: string | null } };
    expect(json.user.maps_provider).toBe("apple");

    const row = await env.DB
      .prepare("SELECT maps_provider FROM users WHERE email = ?")
      .bind(CALLER_EMAIL)
      .first<{ maps_provider: string | null }>();
    expect(row?.maps_provider).toBe("apple");
  });

  it("accepts 'google' and persists it", async () => {
    const res = await makeRequest("PATCH", "/api/me", { maps_provider: "google" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { user: { maps_provider: string | null } };
    expect(json.user.maps_provider).toBe("google");
  });

  it("rejects missing maps_provider -> 400 VALIDATION", async () => {
    const res = await makeRequest("PATCH", "/api/me", {});
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION");
  });

  it("rejects null maps_provider -> 400 VALIDATION", async () => {
    const res = await makeRequest("PATCH", "/api/me", { maps_provider: null });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION");
  });

  it("rejects junk maps_provider (e.g. 'waze') -> 400 VALIDATION", async () => {
    const res = await makeRequest("PATCH", "/api/me", { maps_provider: "waze" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION");
  });

  it("rejects a non-string maps_provider (array) -> 400 VALIDATION", async () => {
    const res = await makeRequest("PATCH", "/api/me", { maps_provider: ["apple"] });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION");
  });

  it("ignores a body-supplied email — identity always comes from the JWT-derived user context", async () => {
    // Even if a malicious/careless client includes an "email" field, the write must target
    // the context user (CALLER_EMAIL), never a body value.
    const res = await makeRequest("PATCH", "/api/me", {
      maps_provider: "google",
      email: "someone-else@example.com",
    });
    expect(res.status).toBe(200);

    const otherRow = await env.DB
      .prepare("SELECT maps_provider FROM users WHERE email = ?")
      .bind("someone-else@example.com")
      .first();
    expect(otherRow).toBeNull(); // no such user was ever created/touched

    const callerRow = await env.DB
      .prepare("SELECT maps_provider FROM users WHERE email = ?")
      .bind(CALLER_EMAIL)
      .first<{ maps_provider: string | null }>();
    expect(callerRow?.maps_provider).toBe("google");
  });
});
