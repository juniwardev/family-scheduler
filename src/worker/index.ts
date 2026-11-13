// Worker entry point — Hono router + cron scheduler
// Middleware ordering (load-bearing for admin auth):
//   app.use('/api/*', requireAuth) registered FIRST globally,
//   then admin sub-router additionally applies requireAdmin.
//   Hono runs middleware in registration order, so requireAdmin can never run before requireAuth.

import { Hono } from "hono";
import type { Env } from "./env";
import type { User } from "./types";
import { requireAuth, requireAdmin } from "./auth";
import { meRouter } from "./routes/me";
import { listsRouter } from "./routes/lists";
import { itemsRouter } from "./routes/items";
import { remindersRouter } from "./routes/reminders";
import { subscriptionsRouter } from "./routes/subscriptions";
import { adminRouter } from "./routes/admin";
import { materialize } from "./reminders/materialize";
import { sendDue, sendDailyDigest } from "./reminders/send";
import { DEFAULT_ENGINE_CONFIG } from "./config";

type Variables = { user: User };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Global auth middleware — must be registered FIRST (before any routes)
// ---------------------------------------------------------------------------
app.use("/api/*", requireAuth);

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.route("/api/me", meRouter);
app.route("/api/lists", listsRouter);

// Items routes — note: items are nested under /api/lists/:id/items for GET,
// and under /api/items for POST/PATCH/DELETE
app.route("/api", itemsRouter);

// Reminders
app.route("/api/items", remindersRouter);

// Subscriptions + VAPID key
app.route("/api/subscriptions", subscriptionsRouter);
app.get("/api/vapid-public-key", async (c) => {
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
});

// Admin routes — requireAdmin runs AFTER requireAuth (guaranteed by mount order)
const adminApp = new Hono<{ Bindings: Env; Variables: Variables }>();
adminApp.use("/*", requireAdmin);
adminApp.route("/", adminRouter);
app.route("/api/admin", adminApp);

// ---------------------------------------------------------------------------
// SPA / Static assets fallback
// ---------------------------------------------------------------------------
app.all("*", async (c) => {
  // For non-API paths, serve the PWA via Static Assets
  return c.env.ASSETS.fetch(c.req.raw);
});

// ---------------------------------------------------------------------------
// Scheduled handler (cron — does not pass through Access)
// ---------------------------------------------------------------------------
async function handleScheduled(
  event: ScheduledController,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const now = Date.now();

  if (event.cron === "*/5 * * * *") {
    // Reminder engine: materialize then send (spec §9)
    const { inserted } = await materialize(env.DB, now, DEFAULT_ENGINE_CONFIG);
    const summary = await sendDue(env.DB, env, now, DEFAULT_ENGINE_CONFIG);
    console.log(`[cron] materialize inserted=${inserted} send=${JSON.stringify(summary)}`);
  } else if (event.cron === "0 14 * * *") {
    // Daily digest (Decision D4)
    const summary = await sendDailyDigest(env.DB, env, now);
    console.log(`[cron] daily-digest ${JSON.stringify(summary)}`);
  }
}

export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
};
