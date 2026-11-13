// routes/subscriptions.ts — push subscription management
import { Hono } from "hono";
import type { Env } from "../env";
import type { User } from "../types";
import { upsertSubscription, deleteSubscriptionByEndpoint } from "../db";

type Variables = { user: User };

export const subscriptionsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// POST /api/subscriptions
subscriptionsRouter.post("/", async (c) => {
  const user = c.get("user");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Invalid JSON" } }, 400);
  }

  const b = body as Record<string, unknown>;
  if (typeof b.endpoint !== "string" || !b.endpoint) {
    return c.json({ error: { code: "VALIDATION", message: "endpoint is required" } }, 400);
  }
  if (typeof b.p256dh !== "string" || !b.p256dh) {
    return c.json({ error: { code: "VALIDATION", message: "p256dh is required" } }, 400);
  }
  if (typeof b.auth !== "string" || !b.auth) {
    return c.json({ error: { code: "VALIDATION", message: "auth is required" } }, 400);
  }

  const sub = await upsertSubscription(c.env.DB, user.email, {
    endpoint: b.endpoint,
    p256dh: b.p256dh,
    auth: b.auth,
    user_agent: typeof b.user_agent === "string" ? b.user_agent : undefined,
  }, Date.now());

  return c.json({ subscription: { id: sub.id, endpoint: sub.endpoint } }, 201);
});

// DELETE /api/subscriptions/:endpoint (URL-encoded endpoint — F10)
subscriptionsRouter.delete("/:endpoint{.+}", async (c) => {
  const user = c.get("user");
  const encodedEndpoint = c.req.param("endpoint");
  const endpoint = decodeURIComponent(encodedEndpoint);

  await deleteSubscriptionByEndpoint(c.env.DB, user.email, endpoint);
  return new Response(null, { status: 204 });
});

// GET /api/vapid-public-key
subscriptionsRouter.get("/vapid-public-key", async (c) => {
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
});
