// tests/unit/archive-db.test.ts — src/worker/db.ts's setItemArchived, plus the archive-aware
// changes to getItems, getActiveItemsWithReminders, updateItem and completeItem
// (plan Decision 1/3/8, §5.4, §7.1 T1-T11 / T13r-T16r).
//
// Follows tests/unit/db.test.ts's applyMigrations pattern (real D1 via vitest-pool-workers).
// NOTE (checklist step 9): its inline DDL needs archived_at INTEGER on items, added below.
// FK enforcement stays OFF (db.test.ts:29-34's rationale applies here unchanged).
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  upsertUser,
  createList,
  createItem,
  updateItem,
  completeItem,
  setItemArchived,
  getItems,
  getActiveItemsWithReminders,
  insertDispatchIgnore,
} from "../../src/worker/db";
import { materialize } from "../../src/worker/reminders/materialize";
import { DEFAULT_ENGINE_CONFIG } from "../../src/worker/config";
import type { CreateItemInput } from "../../src/worker/types";

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
      owner_email TEXT NOT NULL REFERENCES users(email),
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
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
      created_by TEXT NOT NULL REFERENCES users(email),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      location_kind TEXT,
      archived_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS item_reminders (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
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
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      occurrence_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL,
      PRIMARY KEY (item_id, occurrence_at)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_items_list ON items(list_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dispatch_due ON reminder_dispatch(status, fire_at)`,
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

const OWNER_EMAIL = "owner@example.com";
const MEMBER_EMAIL = "member@example.com";
const NOW = 1_800_000_000_000; // fixed epoch-ms "now" for every test in this file
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let listId: string;
let privateListId: string;

beforeEach(async () => {
  await applyMigrations(env.DB);
  await clearTables(env.DB);
  await upsertUser(env.DB, OWNER_EMAIL, OWNER_EMAIL, NOW);
  await upsertUser(env.DB, MEMBER_EMAIL, OWNER_EMAIL, NOW);
  const list = await createList(env.DB, OWNER_EMAIL, { name: "Family", visibility: "shared" }, NOW);
  listId = list.id;
  const priv = await createList(env.DB, OWNER_EMAIL, { name: "Private", visibility: "private" }, NOW);
  privateListId = priv.id;
});

function pastTimedInput(overrides: Partial<CreateItemInput> = {}): CreateItemInput {
  return {
    list_id: listId,
    type: "event",
    title: "Past timed event",
    start_at: NOW - DAY,
    end_at: null,
    all_day: false,
    ...overrides,
  };
}

describe("setItemArchived — archive direction (T1, T3-T9)", () => {
  it("T1 — after archiving, id is absent from active scope and present in archived scope, by id", async () => {
    const created = await createItem(env.DB, OWNER_EMAIL, pastTimedInput(), NOW);
    if (!created.ok) throw new Error("setup failed");
    const other = await createItem(env.DB, OWNER_EMAIL, pastTimedInput({ title: "Live sibling" }), NOW);
    if (!other.ok) throw new Error("setup failed");

    const result = await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, NOW);
    expect(result.ok).toBe(true);

    const active = await getItems(env.DB, OWNER_EMAIL, listId, "active");
    const archived = await getItems(env.DB, OWNER_EMAIL, listId, "archived");
    if (!active.ok || !archived.ok) throw new Error("getItems failed");

    expect(active.value.map((i) => i.id)).not.toContain(created.value.id);
    expect(active.value.map((i) => i.id)).toContain(other.value.id);
    expect(archived.value.map((i) => i.id)).toContain(created.value.id);
    expect(archived.value.map((i) => i.id)).not.toContain(other.value.id);
  });

  it("T2 — archiving purges only that item's pending dispatch; an unrelated item's survives (TIMED fixture)", async () => {
    const target = await createItem(
      env.DB,
      OWNER_EMAIL,
      pastTimedInput({ reminders: [{ offset_minutes: 10, channel_email: true, channel_push: false }] }),
      NOW
    );
    const unrelated = await createItem(
      env.DB,
      OWNER_EMAIL,
      pastTimedInput({ title: "Unrelated", reminders: [{ offset_minutes: 10, channel_email: true, channel_push: false }] }),
      NOW
    );
    if (!target.ok || !unrelated.ok) throw new Error("setup failed");

    await insertDispatchIgnore(env.DB, {
      id: crypto.randomUUID(),
      item_id: target.value.id,
      item_reminder_id: target.value.reminders[0].id,
      occurrence_at: target.value.start_at,
      fire_at: target.value.start_at - 10 * 60 * 1000,
      channel: "email",
      recipient_email: OWNER_EMAIL,
    });
    await insertDispatchIgnore(env.DB, {
      id: crypto.randomUUID(),
      item_id: unrelated.value.id,
      item_reminder_id: unrelated.value.reminders[0].id,
      occurrence_at: unrelated.value.start_at,
      fire_at: unrelated.value.start_at - 10 * 60 * 1000,
      channel: "email",
      recipient_email: OWNER_EMAIL,
    });

    await setItemArchived(env.DB, OWNER_EMAIL, target.value.id, true, NOW);

    const remaining = await env.DB
      .prepare("SELECT item_id FROM reminder_dispatch WHERE status = 'pending'")
      .all<{ item_id: string }>();
    const ids = remaining.results.map((r) => r.item_id);
    expect(ids).not.toContain(target.value.id);
    expect(ids).toContain(unrelated.value.id);
  });

  it("T3 — recurring item -> VALIDATION, and archived_at re-read as NULL", async () => {
    const created = await createItem(
      env.DB,
      OWNER_EMAIL,
      pastTimedInput({ rrule: "FREQ=DAILY" }),
      NOW
    );
    if (!created.ok) throw new Error("setup failed");

    const result = await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("VALIDATION");

    const reread = await getItems(env.DB, OWNER_EMAIL, listId, "active");
    if (!reread.ok) throw new Error("getItems failed");
    const row = reread.value.find((i) => i.id === created.value.id);
    expect(row?.archived_at).toBeNull();
  });

  it("T4 — future-dated timed item -> VALIDATION, and archived_at still NULL", async () => {
    const created = await createItem(
      env.DB,
      OWNER_EMAIL,
      pastTimedInput({ start_at: NOW + DAY }),
      NOW
    );
    if (!created.ok) throw new Error("setup failed");

    const result = await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("VALIDATION");
    expect(created.value.archived_at).toBeNull();
  });

  it("T5 — timed item, start_at past, end_at FUTURE -> VALIDATION (anchor is MAX, not start_at)", async () => {
    const created = await createItem(
      env.DB,
      OWNER_EMAIL,
      pastTimedInput({ start_at: NOW - DAY, end_at: NOW + DAY }),
      NOW
    );
    if (!created.ok) throw new Error("setup failed");
    const result = await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("VALIDATION");
  });

  it("T5a — all-day single-day: own day -> VALIDATION; next day ~03:00 (+27h) -> success", async () => {
    // Local-midnight convention: start_at IS the day's midnight instant (ItemEditor.tsx's
    // convention). Not a DST-transition date (see archive-rule.test.ts's header note).
    const midnight = NOW - (NOW % DAY);
    const created = await createItem(
      env.DB,
      OWNER_EMAIL,
      pastTimedInput({ start_at: midnight, end_at: null, all_day: true }),
      NOW
    );
    if (!created.ok) throw new Error("setup failed");

    const onOwnDay = await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, midnight + 9 * HOUR);
    expect(onOwnDay.ok).toBe(false);

    const nextDay = await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, midnight + 27 * HOUR);
    expect(nextDay.ok).toBe(true);
  });

  it("T5b — setItemArchived calls the shared 25h gate: at exactly +24.5h it is still VALIDATION", async () => {
    // Proves the wiring, not the constant (archive-rule.test.ts's T5b pins the constant
    // itself). If setItemArchived ever re-derived the gate inline instead of importing
    // isArchivable, this is the row most likely to drift from it.
    const midnight = NOW - (NOW % DAY);
    const created = await createItem(
      env.DB,
      OWNER_EMAIL,
      pastTimedInput({ start_at: midnight, end_at: null, all_day: true }),
      NOW
    );
    if (!created.ok) throw new Error("setup failed");

    const result = await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, midnight + 24.5 * HOUR);
    expect(result.ok).toBe(false);
  });

  it("T6 — end_at < start_at (raw insert), start_at future -> VALIDATION (outer MAX wins)", async () => {
    const created = await createItem(env.DB, OWNER_EMAIL, pastTimedInput({ start_at: NOW + DAY }), NOW);
    if (!created.ok) throw new Error("setup failed");
    // Simulate the stale-end_at row the outer MAX exists for (routes/items.ts only validates
    // end_at >= start_at when both are present in the same PATCH body).
    await env.DB
      .prepare("UPDATE items SET end_at = ? WHERE id = ?")
      .bind(NOW - DAY, created.value.id)
      .run();

    const result = await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("VALIDATION");
  });

  it("T6a — all-day Fri->Sun: Sunday noon -> VALIDATION; Monday ~03:00 -> success", async () => {
    const sunMidnight = NOW - (NOW % DAY);
    const created = await createItem(
      env.DB,
      OWNER_EMAIL,
      pastTimedInput({ start_at: sunMidnight - 2 * DAY, end_at: sunMidnight, all_day: true }),
      NOW
    );
    if (!created.ok) throw new Error("setup failed");

    const sundayNoon = await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, sunMidnight + 12 * HOUR);
    expect(sundayNoon.ok).toBe(false);

    const mondayMorning = await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, sunMidnight + 27 * HOUR);
    expect(mondayMorning.ok).toBe(true);
  });

  it("T7 — already-archived -> CONFLICT, archived_at unchanged from its original exact value", async () => {
    const created = await createItem(env.DB, OWNER_EMAIL, pastTimedInput(), NOW);
    if (!created.ok) throw new Error("setup failed");
    const first = await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, NOW);
    if (!first.ok) throw new Error("first archive failed");
    const originalArchivedAt = first.value.archived_at;

    const second = await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, NOW + HOUR);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.code).toBe("CONFLICT");

    const reread = await getItems(env.DB, OWNER_EMAIL, listId, "archived");
    if (!reread.ok) throw new Error("getItems failed");
    expect(reread.value.find((i) => i.id === created.value.id)?.archived_at).toBe(originalArchivedAt);
  });

  it("T8 — GUARD: non-writable list -> FORBIDDEN; missing id -> NOT_FOUND, in both directions", async () => {
    const created = await createItem(
      env.DB,
      OWNER_EMAIL,
      pastTimedInput({ list_id: privateListId }),
      NOW
    );
    if (!created.ok) throw new Error("setup failed");

    const forbiddenArchive = await setItemArchived(env.DB, MEMBER_EMAIL, created.value.id, true, NOW);
    expect(forbiddenArchive.ok).toBe(false);
    if (!forbiddenArchive.ok) expect(forbiddenArchive.code).toBe("FORBIDDEN");

    const notFoundArchive = await setItemArchived(env.DB, OWNER_EMAIL, "nonexistent-id", true, NOW);
    expect(notFoundArchive.ok).toBe(false);
    if (!notFoundArchive.ok) expect(notFoundArchive.code).toBe("NOT_FOUND");

    await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, NOW);
    const forbiddenRestore = await setItemArchived(env.DB, MEMBER_EMAIL, created.value.id, false, NOW);
    expect(forbiddenRestore.ok).toBe(false);
    if (!forbiddenRestore.ok) expect(forbiddenRestore.code).toBe("FORBIDDEN");

    const notFoundRestore = await setItemArchived(env.DB, OWNER_EMAIL, "nonexistent-id", false, NOW);
    expect(notFoundRestore.ok).toBe(false);
    if (!notFoundRestore.ok) expect(notFoundRestore.code).toBe("NOT_FOUND");
  });

  it("T9 — updateItem on an archived item -> CONFLICT and the title is unchanged on re-read (G6)", async () => {
    const created = await createItem(env.DB, OWNER_EMAIL, pastTimedInput({ title: "Original" }), NOW);
    if (!created.ok) throw new Error("setup failed");
    await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, NOW);

    const patch = await updateItem(env.DB, OWNER_EMAIL, created.value.id, { title: "Changed" }, NOW);
    expect(patch.ok).toBe(false);
    if (!patch.ok) expect(patch.code).toBe("CONFLICT");

    const archived = await getItems(env.DB, OWNER_EMAIL, listId, "archived");
    if (!archived.ok) throw new Error("getItems failed");
    expect(archived.value.find((i) => i.id === created.value.id)?.title).toBe("Original");
  });

  it("T10 — GUARD: completeItem on an archived item -> CONFLICT, completed_at unchanged", async () => {
    const created = await createItem(env.DB, OWNER_EMAIL, pastTimedInput({ type: "task" }), NOW);
    if (!created.ok) throw new Error("setup failed");
    await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, NOW);

    const result = await completeItem(env.DB, OWNER_EMAIL, created.value.id, null, true, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");

    const archived = await getItems(env.DB, OWNER_EMAIL, listId, "archived");
    if (!archived.ok) throw new Error("getItems failed");
    expect(archived.value.find((i) => i.id === created.value.id)?.completed_at).toBeNull();
  });

  it("T11 — GUARD: getActiveItemsWithReminders omits an archived item and returns a live one with reminders", async () => {
    const archived = await createItem(
      env.DB,
      OWNER_EMAIL,
      pastTimedInput({ reminders: [{ offset_minutes: 10, channel_email: true, channel_push: false }] }),
      NOW
    );
    const live = await createItem(
      env.DB,
      OWNER_EMAIL,
      pastTimedInput({
        title: "Live with reminders",
        start_at: NOW + DAY,
        reminders: [{ offset_minutes: 10, channel_email: true, channel_push: false }],
      }),
      NOW
    );
    if (!archived.ok || !live.ok) throw new Error("setup failed");
    await setItemArchived(env.DB, OWNER_EMAIL, archived.value.id, true, NOW);

    const active = await getActiveItemsWithReminders(env.DB);
    const ids = active.map((i) => i.id);
    expect(ids).not.toContain(archived.value.id);
    expect(ids).toContain(live.value.id);
  });
});

describe("setItemArchived — restore direction (T13r-T16r)", () => {
  it("T13r — restore + materialize creates ZERO dispatch rows; a live sibling still gets rows (anti-vacuity)", async () => {
    const restored = await createItem(
      env.DB,
      OWNER_EMAIL,
      pastTimedInput({ reminders: [{ offset_minutes: 10, channel_email: true, channel_push: false }] }),
      NOW
    );
    const liveSibling = await createItem(
      env.DB,
      OWNER_EMAIL,
      pastTimedInput({
        title: "Live sibling",
        start_at: NOW + DAY,
        reminders: [{ offset_minutes: 10, channel_email: true, channel_push: false }],
      }),
      NOW
    );
    if (!restored.ok || !liveSibling.ok) throw new Error("setup failed");

    await setItemArchived(env.DB, OWNER_EMAIL, restored.value.id, true, NOW);
    const back = await setItemArchived(env.DB, OWNER_EMAIL, restored.value.id, false, NOW);
    expect(back.ok).toBe(true);

    await materialize(env.DB, NOW, DEFAULT_ENGINE_CONFIG);

    const restoredRows = await env.DB
      .prepare("SELECT COUNT(*) as n FROM reminder_dispatch WHERE item_id = ?")
      .bind(restored.value.id)
      .first<{ n: number }>();
    expect(restoredRows?.n).toBe(0);

    const siblingRows = await env.DB
      .prepare("SELECT COUNT(*) as n FROM reminder_dispatch WHERE item_id = ?")
      .bind(liveSibling.value.id)
      .first<{ n: number }>();
    expect(siblingRows?.n ?? 0).toBeGreaterThan(0);
  });

  it("T14r — restore then reschedule self-heals: dispatch rows exist with the NEW occurrence_at", async () => {
    const created = await createItem(
      env.DB,
      OWNER_EMAIL,
      pastTimedInput({ reminders: [{ offset_minutes: 10, channel_email: true, channel_push: false }] }),
      NOW
    );
    if (!created.ok) throw new Error("setup failed");
    await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, NOW);
    await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, false, NOW);

    const newStart = NOW + 2 * DAY;
    const patched = await updateItem(env.DB, OWNER_EMAIL, created.value.id, { start_at: newStart }, NOW);
    expect(patched.ok).toBe(true);

    await materialize(env.DB, NOW, DEFAULT_ENGINE_CONFIG);

    const rows = await env.DB
      .prepare("SELECT occurrence_at FROM reminder_dispatch WHERE item_id = ?")
      .bind(created.value.id)
      .all<{ occurrence_at: number }>();
    expect(rows.results.length).toBeGreaterThan(0);
    for (const row of rows.results) {
      expect(row.occurrence_at).toBe(newStart);
    }
  });

  it("T15r — restore flips the flag and moves the scope: leaves archived, returns to active", async () => {
    const created = await createItem(env.DB, OWNER_EMAIL, pastTimedInput(), NOW);
    if (!created.ok) throw new Error("setup failed");
    await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, true, NOW);

    const restore = await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, false, NOW);
    expect(restore.ok).toBe(true);
    if (restore.ok) expect(restore.value.archived_at).toBeNull();

    const active = await getItems(env.DB, OWNER_EMAIL, listId, "active");
    const archived = await getItems(env.DB, OWNER_EMAIL, listId, "archived");
    if (!active.ok || !archived.ok) throw new Error("getItems failed");
    expect(active.value.map((i) => i.id)).toContain(created.value.id);
    expect(archived.value.map((i) => i.id)).not.toContain(created.value.id);
  });

  it("T16r — restoring a non-archived item -> CONFLICT, archived_at stays NULL", async () => {
    const created = await createItem(env.DB, OWNER_EMAIL, pastTimedInput(), NOW);
    if (!created.ok) throw new Error("setup failed");

    const result = await setItemArchived(env.DB, OWNER_EMAIL, created.value.id, false, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
    expect(created.value.archived_at).toBeNull();
  });
});
