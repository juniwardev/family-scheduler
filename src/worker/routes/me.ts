// routes/me.ts — GET /api/me, PUT /api/me, PATCH /api/me
import { Hono } from "hono";
import type { Env } from "../env";
import type { User } from "../types";
import { updateDisplayName, updateMapsProvider, getVisibleLists } from "../db";

type Variables = { user: User };

export const meRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

meRouter.get("/", async (c) => {
  const user = c.get("user");
  const lists = await getVisibleLists(c.env.DB, user.email);
  return c.json({ user, lists });
});

meRouter.put("/", async (c) => {
  const user = c.get("user");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Invalid JSON" } }, 400);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).display_name !== "string"
  ) {
    return c.json(
      { error: { code: "VALIDATION", message: "display_name (string) is required" } },
      400
    );
  }

  const name = ((body as Record<string, unknown>).display_name as string).trim();
  if (name.length === 0 || name.length > 80) {
    return c.json(
      { error: { code: "VALIDATION", message: "display_name must be 1–80 characters" } },
      400
    );
  }

  const updated = await updateDisplayName(c.env.DB, user.email, name);
  return c.json({ user: updated });
});

// PATCH /api/me — persists the maps-provider preference (Decision 6).
// NEW-5 (round-2 review): must reject anything outside {'apple','google'} — including
// null/missing/junk — with 400 VALIDATION, mirroring the PUT handler's validation style
// above. The write target is ALWAYS c.get("user").email (the verified Access JWT identity),
// never a body-supplied email — no new auth surface, same pattern as updateDisplayName.
const MAPS_PROVIDERS = ["apple", "google"] as const;

meRouter.patch("/", async (c) => {
  const user = c.get("user");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Invalid JSON" } }, 400);
  }

  const mapsProvider =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).maps_provider
      : undefined;

  if (
    typeof mapsProvider !== "string" ||
    !(MAPS_PROVIDERS as readonly string[]).includes(mapsProvider)
  ) {
    return c.json(
      { error: { code: "VALIDATION", message: "maps_provider must be 'apple' or 'google'" } },
      400
    );
  }

  const updated = await updateMapsProvider(
    c.env.DB,
    user.email,
    mapsProvider as "apple" | "google"
  );
  return c.json({ user: updated });
});
