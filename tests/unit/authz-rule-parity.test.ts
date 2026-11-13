// tests/unit/authz-rule-parity.test.ts — client/server authorization-rule drift detector.
//
// Origin: docs/plans/server-can-write.md (v4, APPROVE after 4 review rounds), Appendix B,
// approved by the operator on 2026-09-19. Closes docs/backlog.md's WONTFIX entry for
// "Server-supplied `can_write` on `GET /api/lists`" — see docs/backlog.md:167.
//
// What this compares: the real server-side rule (src/worker/db.ts's canWriteList) against the
// client mirror (web/src/lib/permissions.ts's canWriteList), across a matrix of (caller, list)
// pairs. This test goes red if EITHER side changes without the other following — the actual
// drift event. A server-supplied `can_write` field could never catch that direction of drift: an
// HTTP-level field-presence test can only catch an UNDER-permissive rule, never an OVER-permissive
// one, because every list the real API can ever emit is, by construction, one the caller can
// already write (the plan's §1.2 proof: `getVisibleLists`' SQL predicate, db.ts:326, and
// `canWriteList`'s JS predicate, db.ts:549-550, are the same two disjuncts over the same two
// column values with the same caller normalisation and the same case-sensitivity).
//
// Falsification requirement (docs/plans/calendar-show-more.md §5.2, applied by this plan's §7
// step 6): a parity assertion over rows where both sides are always `true` passes on two
// implementations that both hardcode `true`. This file therefore includes TWO rows where both
// sides correctly return `false`:
//   (a) a private list owned by someone else, queried through canWriteList DIRECTLY — this row is
//       unreachable through the public API (getVisibleLists never emits it, db.ts:326), which is
//       exactly why it must be queried directly rather than driven through GET /api/lists;
//   (b) a missing list id — the one branch where the two functions' signatures genuinely diverge:
//       the server resolves a row from an id and returns false on NOT_FOUND (db.ts:548); the
//       client takes an already-resolved `List | undefined` and returns false on `undefined`
//       (permissions.ts:22) — reached for real at ItemModal.tsx:137 via `lists.find(...)`.
//
// Deliberate divergence (do NOT "fix"): a mixed-case owner_email is unreachable through
// createList (db.ts:341 computes the lowercased `norm`, db.ts:351 binds it), so it requires a raw
// `INSERT`. On that input the server (db.ts:543/550 — lowercases only the CALLER) and the client
// (permissions.ts:24 — lowercases BOTH sides) genuinely disagree, on purpose
// (permissions.ts:8-13, the header comment's documented superset). Asserting parity naively over
// this input fails on `main`; asserting it as a *known, intended* disagreement is the honest
// test. "Fixing" it by lowercasing the server side in this test would silently delete the
// divergence this file exists to document.
//
// What this file does NOT cover: it compares the two JS rules only. The SQL predicate inside
// getVisibleLists (db.ts:326) is not exercised here — see docs/plans/server-can-write.md §6.1 R3
// and §7.1's "What the parity test does NOT cover". A future edit to that WHERE clause would not
// go red here.
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createList, canWriteList as serverCanWriteList } from "../../src/worker/db";
import { canWriteList as clientCanWriteList } from "../../web/src/lib/permissions";
import type { User } from "../../web/src/types";

const OWNER_EMAIL = "owner@example.com";
const OTHER_EMAIL = "other@example.com";
const NOW = 1_719_500_000_000;

function userFor(email: string): User {
  return {
    email,
    display_name: null,
    role: "member",
    active: true,
    created_at: NOW,
    maps_provider: null,
  };
}

// Schema for the `lists` table only — this file never touches items or users, so it needs no
// other table. The worker project's D1 is real but EMPTY; every existing worker test that
// touches a table hand-copies its DDL. Copied from
// tests/unit/list-isolation-http.test.ts:70-87's `lists` definition (that file is the plan's
// named precedent, §7 step 5). No `REFERENCES users(email)` — same as that precedent — since
// SQLite FK enforcement is off by default (db.test.ts's applyMigrations notes this explicitly)
// and this file seeds no `users` row.
async function applyMigrations(db: D1Database) {
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
  await db.prepare("DELETE FROM lists").run();
}

beforeEach(async () => {
  await applyMigrations(env.DB);
  await clearTables(env.DB);
});

describe("authz rule parity — server canWriteList (db.ts) vs client canWriteList (permissions.ts)", () => {
  // --- Reachable domain: (caller, list) pairs GET /api/lists / GET /api/me / POST / PATCH can
  // actually produce (the plan's §1.2 proof). Seeded with the real createList, per §7 step 5.
  it("reachable: shared list, caller is the owner -> both true", async () => {
    const list = await createList(env.DB, OWNER_EMAIL, { name: "Shared", visibility: "shared" }, NOW);
    const server = await serverCanWriteList(env.DB, OWNER_EMAIL, list.id);
    const client = clientCanWriteList(list, userFor(OWNER_EMAIL));
    expect(server).toBe(true);
    expect(client).toBe(true);
  });

  it("reachable: shared list, caller is NOT the owner -> both true", async () => {
    const list = await createList(env.DB, OWNER_EMAIL, { name: "Shared", visibility: "shared" }, NOW);
    const server = await serverCanWriteList(env.DB, OTHER_EMAIL, list.id);
    const client = clientCanWriteList(list, userFor(OTHER_EMAIL));
    expect(server).toBe(true);
    expect(client).toBe(true);
  });

  it("reachable: private list, caller is the owner -> both true", async () => {
    const list = await createList(env.DB, OWNER_EMAIL, { name: "Private", visibility: "private" }, NOW);
    const server = await serverCanWriteList(env.DB, OWNER_EMAIL, list.id);
    const client = clientCanWriteList(list, userFor(OWNER_EMAIL));
    expect(server).toBe(true);
    expect(client).toBe(true);
  });

  // --- Falsification rows (plan §7 step 6 / review D7 & D2): unreachable through the public
  // API, reachable only by calling canWriteList directly. Without these, every row above is
  // `true` on both sides and this test would pass on two implementations that both hardcode
  // `true`.
  it("unreachable-through-the-API, both false: private list owned by someone else, queried directly via canWriteList", async () => {
    const list = await createList(env.DB, OWNER_EMAIL, { name: "Private", visibility: "private" }, NOW);
    // getVisibleLists (db.ts:326) would never emit this row to OTHER_EMAIL — that is exactly why
    // this test calls canWriteList directly instead of driving GET /api/lists.
    const server = await serverCanWriteList(env.DB, OTHER_EMAIL, list.id);
    const client = clientCanWriteList(list, userFor(OTHER_EMAIL));
    expect(server).toBe(false);
    expect(client).toBe(false);
  });

  it("unreachable-through-the-API, both false: missing list — the one branch where the two signatures genuinely differ", async () => {
    // Server resolves the row itself and returns false on NOT_FOUND (db.ts:548).
    const server = await serverCanWriteList(env.DB, OWNER_EMAIL, "no-such-id");
    // Client takes an already-resolved List | undefined and returns false on undefined
    // (permissions.ts:22) — reached for real at ItemModal.tsx:137 via `lists.find(...)`.
    const client = clientCanWriteList(undefined, userFor(OWNER_EMAIL));
    expect(server).toBe(false);
    expect(client).toBe(false);
  });

  // --- Deliberate, documented divergence (review D8). createList CANNOT produce this row
  // (db.ts:341 computes the lowercased norm, db.ts:351 binds it) — requires a raw INSERT.
  it("KNOWN, INTENDED divergence: mixed-case owner_email — server denies, client allows (permissions.ts:8-13)", async () => {
    const id = crypto.randomUUID();
    await env.DB
      .prepare(
        `INSERT INTO lists (id, name, color, owner_email, visibility, created_at)
         VALUES (?, ?, NULL, ?, 'private', ?)`
      )
      .bind(id, "Mixed-case owner list", "Owner@Example.com", NOW)
      .run();

    const server = await serverCanWriteList(env.DB, "owner@example.com", id);
    const client = clientCanWriteList(
      {
        id,
        name: "Mixed-case owner list",
        color: null,
        owner_email: "Owner@Example.com",
        visibility: "private",
        created_at: NOW,
      },
      userFor("owner@example.com")
    );

    // Server: db.ts:543 lowercases ONLY the caller; db.ts:550 compares
    // "Owner@Example.com" === "owner@example.com" under BINARY/=== byte-exact equality -> false.
    expect(server).toBe(false);
    // Client: permissions.ts:24 lowercases BOTH sides -> true. This is the deliberate superset
    // permissions.ts's header comment (permissions.ts:8-13) describes, not a bug in either
    // implementation. Do NOT "fix" this by lowercasing the server side here — that would
    // silently delete the divergence this test exists to document.
    expect(client).toBe(true);
  });

  // --- Companion invariant (review D9): justifies restricting the parity assertions above to
  // the reachable (lowercase owner_email) domain — without this, that restriction is unjustified.
  it("invariant: createList always stores owner_email lowercased (db.ts:341 computes, db.ts:351 binds)", async () => {
    const list = await createList(env.DB, "MiXeD@Example.COM", { name: "Case check" }, NOW);
    expect(list.owner_email).toBe("mixed@example.com");
  });
});
