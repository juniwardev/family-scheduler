// routes/admin.ts — admin-only routes (§2.6 / O1)
// Mounted behind requireAuth + requireAdmin (see index.ts middleware ordering)
import { Hono } from "hono";
import type { Env } from "../env";
import type { User } from "../types";
import { listAllUsers, setUserActive, adminUpdateDisplayName } from "../db";

type Variables = { user: User };

export const adminRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/admin/users — full roster including inactive (O1)
adminRouter.get("/users", async (c) => {
  const users = await listAllUsers(c.env.DB);
  return c.json({ users });
});

// PATCH /api/admin/users — target_email in request body (F14: avoids email in access logs)
adminRouter.patch("/users", async (c) => {
  const caller = c.get("user");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Invalid JSON" } }, 400);
  }

  const b = body as Record<string, unknown>;

  if (typeof b.target_email !== "string" || !b.target_email.trim()) {
    return c.json(
      { error: { code: "VALIDATION", message: "target_email is required" } },
      400
    );
  }

  // At least one mutable field required
  if (b.active === undefined && b.display_name === undefined) {
    return c.json(
      { error: { code: "VALIDATION", message: "At least one of active or display_name is required" } },
      400
    );
  }

  const targetEmail = (b.target_email as string).toLowerCase().trim();

  // Handle active toggle
  if (b.active !== undefined) {
    const active = Boolean(b.active);
    const result = await setUserActive(c.env.DB, caller.email, targetEmail, active);
    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404 : result.code === "VALIDATION" ? 400 : 403;
      return c.json({ error: { code: result.code, message: result.message } }, status);
    }

    // If display_name also provided, handle it too
    if (typeof b.display_name === "string") {
      const name = b.display_name.trim();
      if (name.length === 0 || name.length > 80) {
        return c.json(
          { error: { code: "VALIDATION", message: "display_name must be 1–80 chars" } },
          400
        );
      }
      const nameResult = await adminUpdateDisplayName(c.env.DB, targetEmail, name);
      if (!nameResult.ok) {
        const status = nameResult.code === "NOT_FOUND" ? 404 : 400;
        return c.json({ error: { code: nameResult.code, message: nameResult.message } }, status);
      }
      return c.json({ user: nameResult.value });
    }

    return c.json({ user: result.value });
  }

  // Only display_name update
  if (typeof b.display_name === "string") {
    const name = b.display_name.trim();
    if (name.length === 0 || name.length > 80) {
      return c.json(
        { error: { code: "VALIDATION", message: "display_name must be 1–80 chars" } },
        400
      );
    }
    const result = await adminUpdateDisplayName(c.env.DB, targetEmail, name);
    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404 : 400;
      return c.json({ error: { code: result.code, message: result.message } }, status);
    }
    return c.json({ user: result.value });
  }

  return c.json(
    { error: { code: "VALIDATION", message: "No valid fields to update" } },
    400
  );
});
