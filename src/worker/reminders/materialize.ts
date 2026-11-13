// reminders/materialize.ts — Phase A of the reminder engine
// For each item with reminders, expand occurrences over [now, now + LOOKAHEAD_DAYS],
// compute fire_at, resolve recipients, and INSERT OR IGNORE dispatch rows.
// Idempotency: UNIQUE(item_reminder_id, occurrence_at, channel, recipient_email) + INSERT OR IGNORE.

import type { EpochMs, Item } from "../types";
import type { List } from "../types";
import type { EngineConfig } from "../config";
import {
  getActiveItemsWithReminders,
  getCompletedOccurrences,
  listActiveUsers,
  insertDispatchIgnore,
  getListById,
} from "../db";
import { expandOccurrences, computeFireAt } from "../recurrence";

export async function resolveRecipients(
  db: D1Database,
  item: Item,
  list: List
): Promise<string[]> {
  // Audience rule (spec §4):
  // - Private list: owner only
  // - Shared list: every active user
  if (list.visibility === "private") {
    return [list.owner_email];
  }
  const users = await listActiveUsers(db);
  return users.map((u) => u.email);
}

export async function materialize(
  db: D1Database,
  now: EpochMs,
  config: EngineConfig
): Promise<{ inserted: number }> {
  const windowEnd = (now + config.LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000) as EpochMs;
  const items = await getActiveItemsWithReminders(db);

  let inserted = 0;

  for (const item of items) {
    // Get completed occurrences for this item (for per-occurrence skip — M3)
    const completedOccurrences = item.rrule
      ? new Set(await getCompletedOccurrences(db, item.id))
      : new Set<EpochMs>();

    const list = await getListById(db, item.list_id);
    if (!list) continue; // list was deleted (race); skip

    const recipients = await resolveRecipients(db, item, list);

    const occurrences = expandOccurrences(
      {
        startAt: item.start_at,
        rrule: item.rrule,
        timezone: item.timezone,
        allDay: item.all_day,
      },
      now,
      windowEnd
    );

    for (const occurrence_at of occurrences) {
      // Skip completed occurrences (M3)
      if (completedOccurrences.has(occurrence_at)) continue;

      for (const reminder of item.reminders) {
        const fire_at = computeFireAt(occurrence_at, reminder.offset_minutes);

        for (const recipient_email of recipients) {
          // One dispatch row per (recipient, enabled channel) — Decision D8
          if (reminder.channel_email) {
            await insertDispatchIgnore(db, {
              id: crypto.randomUUID(),
              item_id: item.id,
              item_reminder_id: reminder.id,
              occurrence_at,
              fire_at,
              channel: "email",
              recipient_email,
            });
            inserted++;
          }

          if (reminder.channel_push) {
            // One push dispatch row per recipient (D8); send.ts fans out to all their subscriptions
            await insertDispatchIgnore(db, {
              id: crypto.randomUUID(),
              item_id: item.id,
              item_reminder_id: reminder.id,
              occurrence_at,
              fire_at,
              channel: "push",
              recipient_email,
            });
            inserted++;
          }
        }
      }
    }
  }

  return { inserted };
}
