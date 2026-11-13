// e2e/fixtures/api-mocks.ts — the whole mock contract (plan §3.4.3, §5.1).
//
// Alternative B (route-mocked API): all /api/* traffic is intercepted in the browser via
// page.route(); nothing reaches the Worker. EVERY fulfilled body must originate from a typed
// factory in this file — enforced by the no-restricted-syntax ban on inline JSON.stringify in
// e2e/**/*.spec.ts (eslint.config.js, plan §4.2b). Fixtures files (this one) are exempt from
// that ban — JSON.stringify has to live somewhere, and it lives here, behind a typed signature.
import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { Attachment, Item, List, OccurrenceEntry, User } from "../../web/src/types";
import { epochMsOnCurrentMonthDay } from "./dates";

const MOCK_OWNER_EMAIL = "e2e-owner@example.test";

export function buildUser(overrides: Partial<User> = {}): User {
  return {
    email: MOCK_OWNER_EMAIL,
    display_name: "E2E Owner",
    role: "admin",
    active: true,
    created_at: Date.now(),
    maps_provider: null,
    ...overrides,
  };
}

export function buildList(overrides: Partial<List> = {}): List {
  return {
    id: randomUUID(),
    name: "E2E Test List",
    color: null,
    owner_email: MOCK_OWNER_EMAIL,
    visibility: "shared",
    created_at: Date.now(),
    ...overrides,
  };
}

export interface ItemFixtureOptions {
  /** 1-28 of the CURRENT month — days 29-31 do not exist in every month (§3.4.3(d)). */
  day: number;
  title: string;
  listId: string;
  hour?: number;
  /** EpochMs the item was archived, or undefined for a live item (feat/item-archive). */
  archivedAt?: number;
}

export function buildItem(opts: ItemFixtureOptions): Item {
  const start = epochMsOnCurrentMonthDay(opts.day, opts.hour ?? 9);
  return {
    id: randomUUID(),
    list_id: opts.listId,
    type: "event",
    title: opts.title,
    location: null,
    notes: null,
    start_at: start,
    end_at: start + 30 * 60 * 1000,
    all_day: false,
    rrule: null,
    timezone: "UTC",
    completed_at: null,
    created_by: MOCK_OWNER_EMAIL,
    created_at: start,
    updated_at: start,
    reminders: [],
    location_kind: null,
    archived_at: opts.archivedAt ?? null,
  };
}

export function buildOccurrence(opts: ItemFixtureOptions): OccurrenceEntry {
  const item = buildItem(opts);
  return {
    item_id: item.id,
    occurrence_at: item.start_at,
    end_at: item.end_at,
    item,
  };
}

/**
 * E1's fixture geometry (plan §3.2 E1): A1 on day 5, B1 on day 6, E1..E5 on day 12 (five, to
 * force "+N more"), F1 on day 19 — mirroring the geometry QA used in
 * calendar-roving-tabindex-report.md:29-33. Days 5/6/12/19 are day ± 7 apart and therefore
 * share a column in EVERY month regardless of the first weekday (calendarFocus.ts's day ± 7
 * identity), so arrow-key geometry is exercised deterministically.
 */
export function keyboardFixtureOccurrences(listId: string): OccurrenceEntry[] {
  return [
    buildOccurrence({ day: 5, title: "A1", listId }),
    buildOccurrence({ day: 6, title: "B1", listId }),
    buildOccurrence({ day: 12, title: "E1", listId, hour: 8 }),
    buildOccurrence({ day: 12, title: "E2", listId, hour: 9 }),
    buildOccurrence({ day: 12, title: "E3", listId, hour: 10 }),
    buildOccurrence({ day: 12, title: "E4", listId, hour: 11 }),
    buildOccurrence({ day: 12, title: "E5", listId, hour: 12 }),
    buildOccurrence({ day: 19, title: "F1", listId }),
  ];
}

/**
 * E2's fixture geometry: five occurrences on day 12 of the current month, forcing "+2 more"
 * collapsed / "Show less" expanded (plan §3.2 E2).
 */
export function densityFixtureOccurrences(listId: string): OccurrenceEntry[] {
  return [
    buildOccurrence({ day: 12, title: "D1", listId, hour: 8 }),
    buildOccurrence({ day: 12, title: "D2", listId, hour: 9 }),
    buildOccurrence({ day: 12, title: "D3", listId, hour: 10 }),
    buildOccurrence({ day: 12, title: "D4", listId, hour: 11 }),
    buildOccurrence({ day: 12, title: "D5", listId, hour: 12 }),
  ];
}

function meResponseBody(user: User, list: List): string {
  const payload: { user: User; lists: List[] } = { user, lists: [list] };
  return JSON.stringify(payload);
}

function itemsResponseBody(items: Item[]): string {
  const payload: { items: Item[] } = { items };
  return JSON.stringify(payload);
}

function itemResponseBody(item: Item): string {
  const payload: { item: Item } = { item };
  return JSON.stringify(payload);
}

function occurrencesResponseBody(occurrences: OccurrenceEntry[]): string {
  const payload: { occurrences: OccurrenceEntry[] } = { occurrences };
  return JSON.stringify(payload);
}

function attachmentsResponseBody(attachments: Attachment[]): string {
  const payload: { attachments: Attachment[] } = { attachments };
  return JSON.stringify(payload);
}

export interface InstallApiMocksOptions {
  list: List;
  user?: User;
  items?: Item[];
  occurrences?: OccurrenceEntry[];
}

export interface InstallArchiveApiMocksOptions {
  list: List;
  user?: User;
  /** Mutable working set — mutated in place as the spec archives/restores/duplicates. */
  items: Item[];
}

function draftToItem(draft: Record<string, unknown>): Item {
  // Minimal, typed reconstruction of createItem's server-side behaviour for the fields
  // Duplicate's flow actually exercises (plan Decision 7's field list). archived_at is
  // hardcoded NULL here exactly as the real createItem hardcodes it (db.ts) — a duplicate is
  // always live, regardless of what (if anything) the client body claimed.
  const now = Date.now();
  return {
    id: randomUUID(),
    list_id: String(draft.list_id ?? ""),
    type: (draft.type as "event" | "task") ?? "event",
    title: String(draft.title ?? ""),
    location: typeof draft.location === "string" && draft.location.length > 0 ? draft.location : null,
    notes: typeof draft.notes === "string" && draft.notes.length > 0 ? draft.notes : null,
    start_at: Number(draft.start_at),
    end_at: typeof draft.end_at === "number" ? draft.end_at : null,
    all_day: Boolean(draft.all_day),
    rrule: null,
    timezone: typeof draft.timezone === "string" ? draft.timezone : "UTC",
    completed_at: null,
    created_by: MOCK_OWNER_EMAIL,
    created_at: now,
    updated_at: now,
    reminders: [],
    location_kind: null,
    archived_at: null,
  };
}

/**
 * A STATEFUL /api/* mock, purpose-built for e2e/archive.spec.ts's full round trip (plan E1).
 * installApiMocks() above is intentionally left untouched — its 6 existing consumers rely on a
 * static, pre-baked response contract, and this spec needs the opposite: archive/restore/
 * duplicate must be visible in the NEXT fetch, which only a mutable working set can do.
 *
 * `options.items` is mutated in place, so the caller can seed it once and read it back after
 * the spec if it wants to assert on server-side state directly.
 */
export async function installArchiveApiMocks(page: Page, options: InstallArchiveApiMocksOptions): Promise<void> {
  const { list, items } = options;
  const user = options.user ?? buildUser();

  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/api/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: meResponseBody(user, list) });
      return;
    }

    const itemsMatch = /^\/api\/lists\/([^/]+)\/items$/.exec(pathname);
    if (method === "GET" && itemsMatch) {
      if (url.searchParams.has("from")) {
        // Every fixture item here is non-recurring (Duplicate/Archive never touch recurring
        // items — NG2), so "one occurrence per active item, at its own start_at" is exact, not
        // an approximation of the real server's expandOccurrences.
        const occurrences: OccurrenceEntry[] = items
          .filter((i) => i.archived_at === null)
          .map((i) => ({ item_id: i.id, occurrence_at: i.start_at, end_at: i.end_at, item: i }));
        await route.fulfill({ status: 200, contentType: "application/json", body: occurrencesResponseBody(occurrences) });
        return;
      }
      const archived = url.searchParams.get("archived") === "1";
      const scoped = items.filter((i) => (archived ? i.archived_at !== null : i.archived_at === null));
      await route.fulfill({ status: 200, contentType: "application/json", body: itemsResponseBody(scoped) });
      return;
    }

    if (method === "GET" && /^\/api\/items\/[^/]+\/attachments$/.test(pathname)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: attachmentsResponseBody([]) });
      return;
    }

    const archiveMatch = /^\/api\/items\/([^/]+)\/archive$/.exec(pathname);
    if (method === "POST" && archiveMatch) {
      const id = archiveMatch[1];
      const item = items.find((i) => i.id === id);
      if (!item) {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Item not found" } }) });
        return;
      }
      const body = (request.postDataJSON() ?? {}) as { archived?: boolean };
      const archived = body.archived !== undefined ? body.archived : true;
      item.archived_at = archived ? Date.now() : null;
      await route.fulfill({ status: 200, contentType: "application/json", body: itemResponseBody(item) });
      return;
    }

    const pointReadMatch = /^\/api\/items\/([^/]+)$/.exec(pathname);
    if (method === "GET" && pointReadMatch) {
      const item = items.find((i) => i.id === pointReadMatch[1]);
      if (!item) {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Item not found" } }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: itemResponseBody(item) });
      return;
    }

    if (method === "POST" && pathname === "/api/items") {
      const draft = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      const created = draftToItem(draft);
      items.push(created);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: itemResponseBody(created),
      });
      return;
    }

    throw new Error(`Unmatched /api/* request in E2E archive mocks: ${method} ${request.url()}`);
  });
}

/**
 * Installs the complete /api/* mock contract for one test (plan §3.4.3, §5.1):
 *
 *   GET /api/me                                  -> { user, lists: [list] }
 *   GET /api/lists/:id/items        (no query)   -> { items }        (App.tsx:25 — fires FIRST
 *                                                      on every run, activeView starts "list")
 *   GET /api/lists/:id/items  (from/to query)     -> { occurrences }  (CalendarView.tsx:64)
 *   GET /api/items/:id/attachments                -> { attachments: [] } (lazy, on modal mount —
 *                                                      E1 beat 8 opens a view-mode modal, which
 *                                                      fires this; confirmed live in
 *                                                      calendar-roving-tabindex-report.md:158)
 *
 * getItems and getOccurrences resolve to the SAME path (web/src/apiClient.ts:104 and :117) and
 * return DIFFERENT shapes, discriminated ONLY by the from/to query string — the trap the plan's
 * §8 preamble names first. Get this branch backwards and the calendar receives { items }, reads
 * r.occurrences as undefined, and silently renders empty.
 *
 * Any /api/* request this function does not recognise THROWS with the method and full URL
 * (§3.4.3(c)) rather than falling through to the real Worker or fulfilling an empty 200 — that
 * throw is what turns "a component starts fetching a new endpoint" into an immediate, named
 * failure instead of a silently empty calendar (B's characteristic failure mode, §7 R2c).
 *
 * STATIC contract — every response is pre-baked from `options.items`/`options.occurrences` and
 * never mutated. For a mutable working set (needed by e2e/archive.spec.ts, where
 * archive/restore/duplicate must be visible in the NEXT fetch), see installArchiveApiMocks
 * below instead.
 */
export async function installApiMocks(page: Page, options: InstallApiMocksOptions): Promise<void> {
  const { list } = options;
  const user = options.user ?? buildUser();
  const items = options.items ?? [];
  const occurrences = options.occurrences ?? [];

  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/api/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: meResponseBody(user, list) });
      return;
    }

    if (method === "GET" && /^\/api\/lists\/[^/]+\/items$/.test(pathname)) {
      if (url.searchParams.has("from")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: occurrencesResponseBody(occurrences),
        });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: itemsResponseBody(items) });
      }
      return;
    }

    if (method === "GET" && /^\/api\/items\/[^/]+\/attachments$/.test(pathname)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: attachmentsResponseBody([]),
      });
      return;
    }

    throw new Error(`Unmatched /api/* request in E2E mocks: ${method} ${request.url()}`);
  });
}
