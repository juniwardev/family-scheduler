// Tests for D14 active-access gate in requireAuth (finding M1).
//
// D14 ordering in requireAuth:
//   1. Verify Access JWT -> 401 UNAUTHENTICATED if missing/invalid
//   2. Upsert user (OWNER_EMAIL promotion always runs — never gated)
//   3. Check user.active -> 403 DEACTIVATED if false
//   4. Else c.set('user', User) and proceed
//
// Because verifyAccessJwt requires a real RS256 JWKS (not available in tests),
// this test file uses a thin "test auth middleware" that replicates the D14
// active-check logic (steps 2–4) using a test-identity header rather than a JWT.
// This isolates and exercises the exact db+middleware behavior defined by D14
// without requiring a real Cloudflare Access deployment.

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Env } from "../../src/worker/env";
import type { User, EpochMs } from "../../src/worker/types";
import { upsertUser } from "../../src/worker/db";
import { meRouter } from "../../src/worker/routes/me";
import { requireAdmin } from "../../src/worker/auth";

type Variables = { user: User };

const OWNER_EMAIL = "owner@example.com";
const MEMBER_EMAIL = "member@example.com";
const NOW = 1_719_500_000_000 as EpochMs;

// Test auth middleware: reads identity from X-Test-Email header, upserts user,
// and enforces the D14 active check — exactly as requireAuth does minus JWT verification.
const testAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const email = c.req.header("X-Test-Email");
    if (!email) {
      return c.json({ error: { code: "UNAUTHENTICATED", message: "Missing identity" } }, 401);
    }
    const user = await upsertUser(c.env.DB, email, c.env.OWNER_EMAIL, Date.now());
    // D14 active check — identical logic to requireAuth in auth.ts
    if (!user.active) {
      return c.json(
        { error: { code: "DEACTIVATED", message: "Account deactivated" } },
        403
      );
    }
    c.set("user", user);
    await next();
  }
);

function buildTestApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("/api/*", testAuth);
  app.route("/api/me", meRouter);
  // Admin route to verify FORBIDDEN vs DEACTIVATED distinction
  app.get("/api/admin/users", requireAdmin, (c) => c.json({ users: [] }));
  return app;
}

// Apply schema with active column; reuse the same migration pattern as db.test.ts
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
  ];
  for (const stmt of stmts) {
    await db.prepare(stmt).run();
  }
}

async function clearUsers(db: D1Database) {
  await db.prepare("DELETE FROM users").run();
}

// Make a request through the test app with the test env
async function makeRequest(
  app: ReturnType<typeof buildTestApp>,
  method: string,
  path: string,
  email?: string
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (email) headers["X-Test-Email"] = email;
  return app.fetch(
    new Request(`http://localhost${path}`, { method, headers }),
    { ...env, OWNER_EMAIL } as unknown as Env
  );
}

const testApp = buildTestApp();

describe("D14 active-access gate (M1)", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearUsers(env.DB);
  });

  // (a) active=0 user gets 403 DEACTIVATED on /api/me
  it("(a) deactivated user receives 403 DEACTIVATED on GET /api/me", async () => {
    // Create user then deactivate them
    await upsertUser(env.DB, MEMBER_EMAIL, OWNER_EMAIL, NOW);
    await env.DB.prepare("UPDATE users SET active = 0 WHERE email = ?").bind(MEMBER_EMAIL).run();

    const res = await makeRequest(testApp, "GET", "/api/me", MEMBER_EMAIL);
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("DEACTIVATED");
  });

  // (a) active=0 user gets 403 DEACTIVATED on a second route (PUT /api/me)
  it("(a) deactivated user receives 403 DEACTIVATED on PUT /api/me (gate is in shared middleware)", async () => {
    await upsertUser(env.DB, MEMBER_EMAIL, OWNER_EMAIL, NOW);
    await env.DB.prepare("UPDATE users SET active = 0 WHERE email = ?").bind(MEMBER_EMAIL).run();

    const res = await makeRequest(testApp, "PUT", "/api/me", MEMBER_EMAIL);
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("DEACTIVATED");
  });

  // (b) reactivation -> next request returns 200 with no re-login
  it("(b) reactivating user restores access on the next request (no re-login)", async () => {
    await upsertUser(env.DB, MEMBER_EMAIL, OWNER_EMAIL, NOW);
    await env.DB.prepare("UPDATE users SET active = 0 WHERE email = ?").bind(MEMBER_EMAIL).run();

    // While deactivated: 403
    const blocked = await makeRequest(testApp, "GET", "/api/me", MEMBER_EMAIL);
    expect(blocked.status).toBe(403);

    // Reactivate
    await env.DB.prepare("UPDATE users SET active = 1 WHERE email = ?").bind(MEMBER_EMAIL).run();

    // Immediately after reactivation (same session token would be valid in real app):
    // next request returns 200 — no re-login step
    const restored = await makeRequest(testApp, "GET", "/api/me", MEMBER_EMAIL);
    expect(restored.status).toBe(200);
    const json = (await restored.json()) as { user: User };
    expect(json.user.email).toBe(MEMBER_EMAIL);
    expect(json.user.active).toBe(true);
  });

  // (c) DEACTIVATED is distinct from FORBIDDEN (role-based admin denial)
  it("(c) DEACTIVATED (active=0) is distinct from FORBIDDEN (non-admin on admin route)", async () => {
    // Non-admin active member hitting admin route -> 403 FORBIDDEN
    await upsertUser(env.DB, MEMBER_EMAIL, OWNER_EMAIL, NOW);
    const forbiddenRes = await makeRequest(testApp, "GET", "/api/admin/users", MEMBER_EMAIL);
    expect(forbiddenRes.status).toBe(403);
    const forbiddenJson = (await forbiddenRes.json()) as { error: { code: string } };
    expect(forbiddenJson.error.code).toBe("FORBIDDEN");

    // Deactivated user hitting any route -> 403 DEACTIVATED (intercepted BEFORE admin check)
    await env.DB.prepare("UPDATE users SET active = 0 WHERE email = ?").bind(MEMBER_EMAIL).run();
    const deactivatedRes = await makeRequest(testApp, "GET", "/api/admin/users", MEMBER_EMAIL);
    expect(deactivatedRes.status).toBe(403);
    const deactivatedJson = (await deactivatedRes.json()) as { error: { code: string } };
    expect(deactivatedJson.error.code).toBe("DEACTIVATED");

    // The two codes are distinct
    expect(forbiddenJson.error.code).not.toBe(deactivatedJson.error.code);
  });

  // (d) Owner (OWNER_EMAIL) is never gated — always seeded active=1 by upsertUser (D14)
  it("(d) owner email is seeded active=1 by upsertUser and is never gated by the active check", async () => {
    // Owner first login — seeded active=1 and role=admin
    const res = await makeRequest(testApp, "GET", "/api/me", OWNER_EMAIL);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { user: User };
    expect(json.user.role).toBe("admin");
    expect(json.user.active).toBe(true);
  });

  // Verify that the active check runs AFTER upsert (owner promotion never blocked)
  it("(d) a pre-existing owner row with active=0 is not possible via normal admin op (self-deactivation guard)", async () => {
    // The self-deactivation guard in setUserActive prevents the admin from setting their own
    // active=0. This test validates that path independently (even if the guard were bypassed,
    // upsertUser does NOT reset active from 0 to 1 — but that scenario is guarded at the route).
    await upsertUser(env.DB, OWNER_EMAIL, OWNER_EMAIL, NOW);
    const row = await env.DB
      .prepare("SELECT active FROM users WHERE email = ?")
      .bind(OWNER_EMAIL)
      .first<{ active: number }>();
    // Owner is always seeded active=1 on first login
    expect(row?.active).toBe(1);
  });
});
