// tests/unit/recurrence-consumers.test.ts — recurrence consumers (materialize, sendDue, daily
// digest, completion key) against a real local D1, for the DST fall-back / window-bound fix
// (docs/plans/dst-fallback-ambiguous-time.md §7.3, C0-C7).
//
// SAFETY (plan §7.1, review F1): the worker pool loads .dev.vars into `env`, so env.RESEND_API_KEY
// is the REAL key. Three independent layers keep every send offline:
//   1. Sends receive TEST_ENV (dummy key + sender), never the bare pool `env`.
//   2. fetchMock is activated with net connect disabled in beforeEach, before anything can send, so
//      an unintercepted request throws instead of leaving the machine.
//   3. A fetch spy captures what would have been sent.
// No test here may call sendDue/sendDailyDigest with anything but TEST_ENV.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { Settings } from "luxon";
import type { Env } from "../../src/worker/env";
import {
  upsertUser,
  createList,
  createItem,
  completeItem,
} from "../../src/worker/db";
import { materialize } from "../../src/worker/reminders/materialize";
import { sendDue, sendDailyDigest } from "../../src/worker/reminders/send";
import { expandOccurrences } from "../../src/worker/recurrence";
import { DEFAULT_ENGINE_CONFIG } from "../../src/worker/config";
import { formatOccurrenceTime } from "../../src/shared/itemLabels";
import type { EpochMs } from "../../src/worker/types";

const TEST_ENV = {
  ...env,
  RESEND_API_KEY: "test-not-a-real-key",
  EMAIL_FROM: "test@example.com",
} as unknown as Env;

const TZ_LA = "America/Los_Angeles";
const OWNER_EMAIL = "owner@example.com";
const STAMP = 1_800_000_000_000; // arbitrary created_at stamp; plays no part in occurrence math

const CLOCK_S = Date.UTC(2026, 6, 15, 12, 0);
const CLOCK_W = Date.UTC(2026, 0, 15, 12, 0);
const REAL_LUXON_NOW = Settings.now;

// E1: Nov 1 2026 01:30 PDT, the earlier instant (D10). The later instant (09:30Z) is rejected.
const E1 = Date.UTC(2026, 10, 1, 8, 30);

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

type DispatchRow = { occurrence_at: number; fire_at: number; status: string };

async function dispatchRows(
  itemId: string,
  fromInclusive: number,
  toExclusive: number
): Promise<DispatchRow[]> {
  const res = await env.DB
    .prepare(
      `SELECT occurrence_at, fire_at, status FROM reminder_dispatch
        WHERE item_id = ? AND occurrence_at >= ? AND occurrence_at < ?
        ORDER BY occurrence_at`
    )
    .bind(itemId, fromInclusive, toExclusive)
    .all<DispatchRow>();
  return res.results;
}

let listId: string;
let spy: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">> | null = null;

function installFetchSpy() {
  // Fresh Response per call: a Response body can only be read once.
  spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
}

function capturedBodies(): Array<{ to: string[]; subject: string; text: string }> {
  if (!spy) throw new Error("fetch spy not installed");
  return spy.mock.calls.map(
    (call) =>
      JSON.parse((call[1] as RequestInit).body as string) as {
        to: string[];
        subject: string;
        text: string;
      }
  );
}

beforeEach(async () => {
  // Layer 2 first, before any DB or send work.
  fetchMock.activate();
  fetchMock.disableNetConnect();
  spy = null;
  await applyMigrations(env.DB);
  await clearTables(env.DB);
  await upsertUser(env.DB, OWNER_EMAIL, OWNER_EMAIL, STAMP);
  const list = await createList(env.DB, OWNER_EMAIL, { name: "Private fixture", visibility: "private" }, STAMP);
  listId = list.id;
});

afterEach(() => {
  vi.restoreAllMocks();
  fetchMock.deactivate();
  Settings.now = REAL_LUXON_NOW;
});

async function makeRecurringItem(startAt: number, offsetMinutes: number, title = "Recurring fixture") {
  const created = await createItem(
    env.DB,
    OWNER_EMAIL,
    {
      list_id: listId,
      type: "event",
      title,
      start_at: startAt,
      rrule: "FREQ=DAILY",
      timezone: TZ_LA,
      reminders: [{ offset_minutes: offsetMinutes, channel_email: true, channel_push: false }],
    },
    STAMP
  );
  if (!created.ok) throw new Error("setup failed: " + created.message);
  return created.value;
}

describe("network guard (C0)", () => {
  it("C0 an unintercepted fetch is rejected by fetchMock, not sent", async () => {
    // No spy here: this must reach the fetchMock-patched fetch. `.invalid` never resolves
    // (RFC 2606), so even a broken guard sends nothing anywhere.
    await expect(fetch("https://example.invalid/")).rejects.toThrow(/net\.connect disabled/);
  });
});

describe("recurrence consumers", () => {
  beforeEach(() => {
    installFetchSpy();
  });

  it("C1 materialize near-term: the occurrence 3 h away is materialized, 60 rows total", async () => {
    const item = await makeRecurringItem(Date.UTC(2026, 10, 10, 16, 0), 15);
    const now = Date.UTC(2026, 10, 13, 13, 0);
    await materialize(env.DB, now as EpochMs, DEFAULT_ENGINE_CONFIG);

    const occ = Date.UTC(2026, 10, 13, 16, 0);
    expect(await dispatchRows(item.id, occ, occ + 1)).toEqual([
      { occurrence_at: occ, fire_at: Date.UTC(2026, 10, 13, 15, 45), status: "pending" },
    ]);
    const agg = await env.DB
      .prepare("SELECT MIN(occurrence_at) AS first, COUNT(*) AS n FROM reminder_dispatch WHERE item_id = ?")
      .bind(item.id)
      .first<{ first: number; n: number }>();
    expect(agg).toEqual({ first: occ, n: 60 });
  });

  it("C2 within grace: the newly materialized near-term row is sent", async () => {
    const item = await makeRecurringItem(Date.UTC(2026, 10, 10, 16, 0), 15);
    const now = Date.UTC(2026, 10, 13, 15, 50) as EpochMs;
    await materialize(env.DB, now, DEFAULT_ENGINE_CONFIG);
    await sendDue(env.DB, TEST_ENV, now, DEFAULT_ENGINE_CONFIG);

    const occ = Date.UTC(2026, 10, 13, 16, 0);
    expect(await dispatchRows(item.id, occ, occ + 1)).toEqual([
      { occurrence_at: occ, fire_at: Date.UTC(2026, 10, 13, 15, 45), status: "sent" },
    ]);
    const bodies = capturedBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].to).toEqual([OWNER_EMAIL]);
  });

  it("C3 beyond grace: a row whose fire_at is older than the grace window is inert", async () => {
    const item = await makeRecurringItem(Date.UTC(2026, 10, 10, 16, 0), 60);
    const now = Date.UTC(2026, 10, 13, 15, 50) as EpochMs;
    await materialize(env.DB, now, DEFAULT_ENGINE_CONFIG);
    await sendDue(env.DB, TEST_ENV, now, DEFAULT_ENGINE_CONFIG);

    const occ = Date.UTC(2026, 10, 13, 16, 0);
    expect(await dispatchRows(item.id, occ, occ + 1)).toEqual([
      { occurrence_at: occ, fire_at: Date.UTC(2026, 10, 13, 15, 0), status: "pending" },
    ]);
    expect(capturedBodies()).toHaveLength(0);
  });

  it("C4 an occurrence already in the past is never materialized", async () => {
    const item = await makeRecurringItem(Date.UTC(2026, 10, 10, 16, 0), 15);
    await materialize(env.DB, Date.UTC(2026, 10, 13, 16, 1) as EpochMs, DEFAULT_ENGINE_CONFIG);

    const past = Date.UTC(2026, 10, 13, 16, 0);
    expect(await dispatchRows(item.id, past, past + 1)).toEqual([]);
    const agg = await env.DB
      .prepare("SELECT MIN(occurrence_at) AS first FROM reminder_dispatch WHERE item_id = ?")
      .bind(item.id)
      .first<{ first: number }>();
    expect(agg).toEqual({ first: Date.UTC(2026, 10, 14, 16, 0) });
  });

  describe.each([
    ["CLOCK_S", CLOCK_S],
    ["CLOCK_W", CLOCK_W],
  ])("C5 ambiguous hour under %s", (_name, clock) => {
    beforeEach(() => {
      Settings.now = () => clock;
    });

    it("materializes exactly one row, at the earlier instant", async () => {
      const item = await makeRecurringItem(Date.UTC(2026, 9, 25, 8, 30), 15);
      await materialize(env.DB, Date.UTC(2026, 9, 31, 12, 0) as EpochMs, DEFAULT_ENGINE_CONFIG);

      expect(
        await dispatchRows(item.id, Date.UTC(2026, 10, 1, 7, 0), Date.UTC(2026, 10, 1, 11, 0))
      ).toEqual([{ occurrence_at: E1, fire_at: Date.UTC(2026, 10, 1, 8, 15), status: "pending" }]);
    });
  });

  describe.each([
    ["S->W", CLOCK_S, CLOCK_W],
    ["W->S", CLOCK_W, CLOCK_S],
  ])("C6 completion key across seasons %s", (_name, clockA, clockB) => {
    it("a completion recorded under one season suppresses the reminder under the other", async () => {
      const item = await makeRecurringItem(Date.UTC(2026, 9, 25, 8, 30), 15);

      // What the calendar route returns (routes/items.ts), read under clock A.
      Settings.now = () => clockA;
      const keys = expandOccurrences(
        { startAt: item.start_at, rrule: item.rrule, timezone: TZ_LA, allDay: false },
        Date.UTC(2026, 10, 1, 0, 0) as EpochMs,
        Date.UTC(2026, 10, 2, 0, 0) as EpochMs
      );
      expect(keys).toEqual([E1]);
      const done = await completeItem(env.DB, OWNER_EMAIL, item.id, keys[0], true, STAMP as EpochMs);
      expect(done.ok).toBe(true);

      // Materialize under clock B, the other season.
      Settings.now = () => clockB;
      await materialize(env.DB, Date.UTC(2026, 9, 31, 12, 0) as EpochMs, DEFAULT_ENGINE_CONFIG);

      expect(
        await dispatchRows(item.id, Date.UTC(2026, 10, 1, 7, 0), Date.UTC(2026, 10, 1, 11, 0))
      ).toEqual([]);
    });
  });

  it("C7 daily digest 'today' includes the occurrence 2 h after the cron tick", async () => {
    await makeRecurringItem(Date.UTC(2026, 10, 10, 16, 0), 15);
    await sendDailyDigest(env.DB, TEST_ENV, Date.UTC(2026, 10, 13, 14, 0) as EpochMs);

    const bodies = capturedBodies();
    expect(bodies).toHaveLength(1);
    const lines = bodies[0].text.split("\n").filter((l) => l.startsWith("- Recurring fixture ("));
    // Instants are asserted via the shared formatter: formatting itself is not under test and
    // ICU spacing (U+202F) varies by runtime.
    const dateParts = lines.map((l) => l.split(" — ")[1]);
    expect(dateParts).toEqual([
      formatOccurrenceTime(Date.UTC(2026, 10, 13, 16, 0) as EpochMs, TZ_LA, false),
      formatOccurrenceTime(Date.UTC(2026, 10, 14, 16, 0) as EpochMs, TZ_LA, false),
    ]);
  });
});
