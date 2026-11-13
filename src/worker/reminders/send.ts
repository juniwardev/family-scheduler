// reminders/send.ts — Phase B of the reminder engine
// Selects due pending dispatch rows and sends them via the appropriate channel.
// Marks sent/failed; prunes dead push subscriptions; implements failure classification (D13).

import type { EpochMs } from "../types";
import type { EngineConfig } from "../config";
import type { Env } from "../env";
import {
  getDueDispatch,
  markDispatch,
  deleteSubscriptionById,
  getSubscriptionsForUser,
  listActiveUsers,
  getVisibleLists,
  getItems,
  getItemByIdUnchecked,
  getUser,
} from "../db";
import { expandOccurrences } from "../recurrence";
import { sendEmail } from "../channels/email";
import { sendPush } from "../channels/push";
import { buildEmailContent, buildPushContent, escapeHtml } from "./content";
import { formatOccurrenceTime } from "../../shared/itemLabels";
import { resolveMapsProvider } from "../../shared/location";
import type { MapsProvider } from "../../shared/location";

export interface SendSummary {
  sent: number;
  failed: number;
  transient: number; // left pending for retry
}

/**
 * Send all due pending dispatch rows.
 * Selection: status='pending' AND fire_at <= now AND fire_at > now - GRACE_MINUTES (spec §9)
 * Aged-out rows (fire_at <= now - GRACE) are skipped — left inert as 'pending' (P2-N3).
 */
export async function sendDue(
  db: D1Database,
  env: Env,
  now: EpochMs,
  config: EngineConfig
): Promise<SendSummary> {
  const rows = await getDueDispatch(db, now, config.GRACE_MINUTES);
  const summary: SendSummary = { sent: 0, failed: 0, transient: 0 };

  for (const row of rows) {
    // Fetch the item at send time so the content is rich (title/type/location/notes/tz).
    // Engine-trusted read (no authz — see getItemByIdUnchecked's WHY comment, P2-N1):
    // the dispatch row was already authorized when materialize created it.
    const item = await getItemByIdUnchecked(db, row.item_id);
    if (!item) {
      // Item deleted between materialize and send (rare/defensive — P2-N1 purges pending
      // dispatch before the FK cascade, so this should be uncommon in practice). Mark the
      // row sent (no-op) so it is not retried, mirroring the zero-subscription push
      // convention below. Nothing is actually delivered.
      await markDispatch(db, row.id, "sent", now);
      summary.sent++;
      continue;
    }

    // Recipient's maps-provider preference (Decision 6): read at send time from the
    // RECIPIENT (dispatch row's recipient_email), not the item owner — the recipient is
    // who taps the notification and opens their own maps app.
    const recipientUser = await getUser(db, row.recipient_email);
    const mapsProvider: MapsProvider = resolveMapsProvider(recipientUser?.maps_provider ?? null);

    if (row.channel === "email") {
      const { subject, html, text } = buildEmailContent(
        item,
        row.occurrence_at,
        env.APP_URL,
        mapsProvider
      );

      const result = await sendEmail(
        { to: row.recipient_email, subject, html, text },
        env
      );

      if (result.ok) {
        await markDispatch(db, row.id, "sent", now);
        summary.sent++;
      } else if (result.permanent) {
        await markDispatch(db, row.id, "failed", now);
        summary.failed++;
      } else {
        // Transient: leave pending for next cron tick (D13)
        summary.transient++;
      }
    } else if (row.channel === "push") {
      const subs = await getSubscriptionsForUser(db, row.recipient_email);

      if (subs.length === 0) {
        // Zero deliverable targets — mark sent (no-op), NOT failed (D13)
        await markDispatch(db, row.id, "sent", now);
        summary.sent++;
        continue;
      }

      const payload = buildPushContent(item, row.occurrence_at, env.APP_URL, mapsProvider);

      let anySuccess = false;
      let allPermFailed = true;
      let anyTransient = false;

      for (const sub of subs) {
        const pushResult = await sendPush(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payload,
          env
        );

        if (pushResult.gone) {
          // 404/410 — dead subscription, delete it
          await deleteSubscriptionById(db, sub.id);
          // A dead endpoint is permanent failure for that endpoint
          continue; // don't count as transient
        }

        if (pushResult.ok) {
          anySuccess = true;
          allPermFailed = false;
        } else if (pushResult.statusCode >= 400 && pushResult.statusCode < 500) {
          // Permanent 4xx (but not 404/410 handled above)
          // allPermFailed stays true for this endpoint
        } else {
          // Transient (5xx, network error, etc.)
          allPermFailed = false;
          anyTransient = true;
        }
      }

      // Dispatch row status based on fan-out results (D8 + D13):
      // - sent if >=1 endpoint succeeded
      // - failed if all endpoints permanently failed (incl. all-gone case)
      // - pending (no mark) if none succeeded but >=1 transient
      // The else branch that previously handled "all gone" was dead code: when every
      // sub had pushResult.gone (continue; no state mutation), allPermFailed stays true
      // and anyTransient stays false, so the allPermFailed && !anyTransient branch fires
      // and marks the row failed — which is correct (permanent, nothing to retry).
      if (anySuccess) {
        await markDispatch(db, row.id, "sent", now);
        summary.sent++;
      } else if (allPermFailed && !anyTransient) {
        await markDispatch(db, row.id, "failed", now);
        summary.failed++;
      } else {
        // anyTransient is true — leave pending for retry (D13)
        summary.transient++;
      }
    }
  }

  return summary;
}

export interface DigestEntry {
  listName: string;
  title: string;
  start_at: EpochMs;
  timezone: string;
  all_day: boolean;
}

/**
 * Compose the daily-digest email body (html + text) from the collected entries.
 * Pure and exported so the timezone rendering is directly unit-testable without a live
 * D1/Resend round-trip. Each occurrence is rendered in the item's OWN stored timezone via
 * formatOccurrenceTime (matching the per-item reminder builders), which degrades gracefully
 * to a labelled-UTC fallback and never emits a raw epoch.
 *
 * Item-supplied `title`/`listName` are HTML-escaped (via escapeHtml, shared with the per-item
 * content builders) before interpolation into the HTML body, so markup/entities in a title
 * render literally and cannot inject HTML. The plain-text body is NOT escaped — it is not HTML,
 * and escaping there would corrupt the literal characters.
 */
export function composeDigestBody(entries: DigestEntry[]): { html: string; text: string } {
  if (entries.length === 0) {
    return {
      html: `<p>No items scheduled for today or tomorrow.</p>`,
      text: `No items scheduled for today or tomorrow.`,
    };
  }
  const rows = entries
    .map((e) => {
      const dateStr = formatOccurrenceTime(e.start_at, e.timezone, e.all_day);
      return `<li><strong>${escapeHtml(e.title)}</strong> &mdash; ${escapeHtml(e.listName)} &mdash; ${dateStr}</li>`;
    })
    .join("\n");
  const html = `<h2>Today &amp; Tomorrow</h2><ul>\n${rows}\n</ul>`;
  const text =
    `Today & Tomorrow:\n` +
    entries
      .map(
        (e) =>
          `- ${e.title} (${e.listName}) — ${formatOccurrenceTime(e.start_at, e.timezone, e.all_day)}`
      )
      .join("\n");
  return { html, text };
}

/**
 * Daily digest: compose and send each active user's today+tomorrow items.
 * Sends once per active user (listActiveUsers — Item 3c / D4).
 * Window: [now, now + 48 h]. Non-recurring items match on start_at; recurring
 * items are expanded via expandOccurrences so their instances are included.
 *
 * External send (Resend) is the only boundary that is DevOps-gated: the logic
 * (list/item lookup, composition) is fully real; only the actual email delivery
 * requires a live RESEND_API_KEY + verified domain.
 */
export async function sendDailyDigest(
  db: D1Database,
  env: Env,
  now: EpochMs
): Promise<SendSummary> {
  const users = await listActiveUsers(db);
  const summary: SendSummary = { sent: 0, failed: 0, transient: 0 };

  // Today + tomorrow window: 48 h from cron fire time
  const dayMs = 24 * 60 * 60 * 1000;
  const windowStart = now;
  const windowEnd = (now + 2 * dayMs) as EpochMs;

  for (const user of users) {
    // Collect items visible to this user that fall in the window
    const entries: DigestEntry[] = [];
    const lists = await getVisibleLists(db, user.email);

    for (const list of lists) {
      const itemsResult = await getItems(db, user.email, list.id);
      if (!itemsResult.ok) continue;

      for (const item of itemsResult.value) {
        if (!item.rrule) {
          // Non-recurring: include if start_at falls in window
          if (item.start_at >= windowStart && item.start_at <= windowEnd) {
            entries.push({
              listName: list.name,
              title: item.title,
              start_at: item.start_at,
              timezone: item.timezone,
              all_day: item.all_day,
            });
          }
        } else {
          // Recurring: expand occurrences in window and include each
          const occs = expandOccurrences(
            {
              startAt: item.start_at,
              rrule: item.rrule,
              timezone: item.timezone,
              allDay: item.all_day,
            },
            windowStart,
            windowEnd
          );
          for (const occ of occs) {
            entries.push({
              listName: list.name,
              title: item.title,
              start_at: occ,
              timezone: item.timezone,
              all_day: item.all_day,
            });
          }
        }
      }
    }

    // Sort chronologically
    entries.sort((a, b) => a.start_at - b.start_at);

    const subject = `Family Scheduler — Daily Digest`;
    const { html, text } = composeDigestBody(entries);

    const result = await sendEmail({ to: user.email, subject, html, text }, env);
    if (result.ok) {
      summary.sent++;
    } else if (result.permanent) {
      summary.failed++;
    } else {
      summary.transient++;
    }
  }

  return summary;
}
