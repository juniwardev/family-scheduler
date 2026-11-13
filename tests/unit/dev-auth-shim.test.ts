// Tests for the local-only dev auth shim (docs/plans/dev-auth-shim.md).
//
// CRITICAL: unlike auth-deactivated.test.ts, these tests mount the REAL
// requireAuth middleware exported from src/worker/auth.ts — NOT a testAuth
// stub. The whole point of DC2 (production-safety) is that the load-bearing
// safety tests (T3/T4) run end-to-end through the actual shipped gate. A
// stub-based test would pass vacuously and prove nothing about the shipped
// code (see docs/reviews/dev-auth-shim-review.md Pass-2/Pass-3).
//
// Harness mechanics (cloudflare:test env, applyMigrations, app.fetch) are
// reused from tests/unit/auth-deactivated.test.ts; the testAuth stub from
// that file is intentionally NOT reused here.

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../../src/worker/env";
import type { User } from "../../src/worker/types";
import { meRouter } from "../../src/worker/routes/me";
import { requireAuth, requireAdmin, isLocalDevContext } from "../../src/worker/auth";

type Variables = { user: User };

const OWNER_EMAIL = "owner@example.com";
const MEMBER_EMAIL = "member@test.dev";

// Build the app exactly as production wires it (mirrors src/worker/index.ts):
// requireAuth mounted globally on /api/*, real middleware, no stub.
function buildTestApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("/api/*", requireAuth);
  app.route("/api/me", meRouter);
  app.get("/api/admin/users", requireAdmin, (c) => c.json({ users: [] }));
  return app;
}

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

// Make a request through the real-requireAuth test app with a merged env.
// `extraEnv` lets each test control DEV_AUTH_IDENTITY presence/value explicitly.
async function makeRequest(
  app: ReturnType<typeof buildTestApp>,
  method: string,
  url: string,
  extraEnv: Partial<Env> = {},
  headers: Record<string, string> = {}
): Promise<Response> {
  const mergedEnv = { ...env, OWNER_EMAIL, ...extraEnv } as unknown as Env;
  return app.fetch(new Request(url, { method, headers }), mergedEnv);
}

const testApp = buildTestApp();

describe("dev auth shim (local-only)", () => {
  beforeEach(async () => {
    await applyMigrations(env.DB);
    await clearUsers(env.DB);
  });

  describe("DC1 — local works (shim active on loopback host)", () => {
    it("T1: localhost + DEV_AUTH_IDENTITY=owner -> 200 as OWNER_EMAIL, admin, active", async () => {
      const res = await makeRequest(testApp, "GET", "http://localhost/api/me", {
        DEV_AUTH_IDENTITY: "owner",
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { user: User };
      expect(json.user.email).toBe(OWNER_EMAIL);
      expect(json.user.role).toBe("admin");
      expect(json.user.active).toBe(true);
    });

    it("T1b: owner identity via the shim can access an admin-only route", async () => {
      const res = await makeRequest(testApp, "GET", "http://localhost/api/admin/users", {
        DEV_AUTH_IDENTITY: "owner",
      });
      expect(res.status).toBe(200);
    });

    it("T2: 127.0.0.1 + DEV_AUTH_IDENTITY=member@test.dev -> 200 as that email, non-admin", async () => {
      const res = await makeRequest(testApp, "GET", "http://127.0.0.1/api/me", {
        DEV_AUTH_IDENTITY: MEMBER_EMAIL,
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { user: User };
      expect(json.user.email).toBe(MEMBER_EMAIL);
      expect(json.user.role).toBe("member");
    });

    it("T2b: D14 still applies through the shimmed path — deactivated shim user gets 403", async () => {
      // First request creates/upserts the member via the shim.
      const first = await makeRequest(testApp, "GET", "http://127.0.0.1/api/me", {
        DEV_AUTH_IDENTITY: MEMBER_EMAIL,
      });
      expect(first.status).toBe(200);

      // Deactivate that user directly in the DB.
      await env.DB.prepare("UPDATE users SET active = 0 WHERE email = ?")
        .bind(MEMBER_EMAIL)
        .run();

      // Re-request through the shim: the D14 active-gate must still 403 it —
      // proves the shim substitutes identity SOURCE only, not authorization.
      const second = await makeRequest(testApp, "GET", "http://127.0.0.1/api/me", {
        DEV_AUTH_IDENTITY: MEMBER_EMAIL,
      });
      expect(second.status).toBe(403);
      const json = (await second.json()) as { error: { code: string } };
      expect(json.error.code).toBe("DEACTIVATED");
    });
  });

  describe("DC2 — LOAD-BEARING production-safety (mounted via the REAL requireAuth)", () => {
    it("T3: deployed-style host + DEV_AUTH_IDENTITY present (worst case) -> shim inert -> 401", async () => {
      const res = await makeRequest(
        testApp,
        "GET",
        "https://family-scheduler.juniwar-dev.workers.dev/api/me",
        { DEV_AUTH_IDENTITY: "owner" }
      );
      expect(res.status).toBe(401);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe("UNAUTHENTICATED");
      expect(json.error.message).toBe("Missing Access JWT");
    });

    it("T4: loopback host + DEV_AUTH_IDENTITY unset -> full verification -> 401", async () => {
      // Explicitly force DEV_AUTH_IDENTITY unset on the merged env rather than merely
      // assuming the base cloudflare:test env omits it: a stray DEV_AUTH_IDENTITY line in a
      // developer's local .dev.vars is loaded into the ambient `env` under miniflare, which
      // would otherwise activate the shim here and make this load-bearing 401 assertion flaky
      // depending on machine state. `{ ...env }` is a shallow own-enumerable copy, so `delete`
      // here cannot mutate the shared cloudflare:test `env` or leak to other tests.
      const mergedEnv = { ...env, OWNER_EMAIL } as unknown as Env;
      delete (mergedEnv as unknown as { DEV_AUTH_IDENTITY?: string }).DEV_AUTH_IDENTITY;
      expect((mergedEnv as unknown as { DEV_AUTH_IDENTITY?: string }).DEV_AUTH_IDENTITY).toBeUndefined();

      const res = await testApp.fetch(
        new Request("http://localhost/api/me", { method: "GET" }),
        mergedEnv
      );
      expect(res.status).toBe(401);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("T5 — isLocalDevContext seam (isolated unit test)", () => {
    it("returns false for a deployed-style host", () => {
      expect(
        isLocalDevContext({
          url: "https://family-scheduler.juniwar-dev.workers.dev/api/me",
        } as unknown as Request)
      ).toBe(false);
    });

    it("returns true for localhost", () => {
      expect(
        isLocalDevContext({ url: "http://localhost/api/me" } as unknown as Request)
      ).toBe(true);
    });

    it("returns true for 127.0.0.1", () => {
      expect(
        isLocalDevContext({ url: "http://127.0.0.1:8787/api/me" } as unknown as Request)
      ).toBe(true);
    });

    it("returns true for [::1]", () => {
      expect(
        isLocalDevContext({ url: "http://[::1]/api/me" } as unknown as Request)
      ).toBe(true);
    });

    it("returns false (fail closed) on URL parse exception", () => {
      expect(isLocalDevContext({ url: "not a url" } as unknown as Request)).toBe(false);
    });
  });
});
