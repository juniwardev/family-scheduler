// routes/reminders.ts — PUT /api/items/:id/reminders
import { Hono } from "hono";
import type { Env } from "../env";
import type { User, ReminderInput } from "../types";
import { replaceReminders } from "../db";

type Variables = { user: User };

export const remindersRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// PUT /api/items/:id/reminders — full replacement
remindersRouter.put("/:id/reminders", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Invalid JSON" } }, 400);
  }

  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.reminders)) {
    return c.json(
      { error: { code: "VALIDATION", message: "reminders (array) is required" } },
      400
    );
  }

  const reminders: ReminderInput[] = [];
  for (const r of b.reminders as unknown[]) {
    const rem = r as Record<string, unknown>;
    if (!Number.isInteger(rem.offset_minutes) || (rem.offset_minutes as number) < 0) {
      return c.json(
        { error: { code: "VALIDATION", message: "offset_minutes must be a non-negative integer" } },
        400
      );
    }
    if (!rem.channel_email && !rem.channel_push) {
      return c.json(
        { error: { code: "VALIDATION", message: "each reminder must have at least one channel enabled" } },
        400
      );
    }
    reminders.push({
      offset_minutes: rem.offset_minutes as number,
      channel_email: Boolean(rem.channel_email),
      channel_push: Boolean(rem.channel_push),
    });
  }

  const result = await replaceReminders(c.env.DB, user.email, id, reminders);
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }
  return c.json({ reminders: result.value });
});
