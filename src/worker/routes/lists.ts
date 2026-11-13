// routes/lists.ts — /api/lists CRUD
import { Hono } from "hono";
import type { Env } from "../env";
import type { User } from "../types";
import { getVisibleLists, createList, updateList, deleteList } from "../db";

type Variables = { user: User };

export const listsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/lists
listsRouter.get("/", async (c) => {
  const user = c.get("user");
  const lists = await getVisibleLists(c.env.DB, user.email);
  return c.json({ lists });
});

// POST /api/lists
listsRouter.post("/", async (c) => {
  const user = c.get("user");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Invalid JSON" } }, 400);
  }

  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || b.name.trim().length === 0 || b.name.trim().length > 80) {
    return c.json(
      { error: { code: "VALIDATION", message: "name (1–80 chars) is required" } },
      400
    );
  }

  const visibility = b.visibility ?? "private";
  if (visibility !== "private" && visibility !== "shared") {
    return c.json(
      { error: { code: "VALIDATION", message: "visibility must be 'private' or 'shared'" } },
      400
    );
  }

  const list = await createList(c.env.DB, user.email, {
    name: b.name.trim(),
    color: typeof b.color === "string" ? b.color : null,
    visibility: visibility as "private" | "shared",
  }, Date.now());

  return c.json({ list }, 201);
});

// PATCH /api/lists/:id
listsRouter.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "VALIDATION", message: "Invalid JSON" } }, 400);
  }

  const b = body as Record<string, unknown>;
  if (typeof b.name !== "undefined" && (typeof b.name !== "string" || b.name.trim().length === 0 || b.name.trim().length > 80)) {
    return c.json({ error: { code: "VALIDATION", message: "name must be 1–80 chars" } }, 400);
  }
  if (typeof b.visibility !== "undefined" && b.visibility !== "private" && b.visibility !== "shared") {
    return c.json({ error: { code: "VALIDATION", message: "visibility must be 'private' or 'shared'" } }, 400);
  }

  const result = await updateList(c.env.DB, user.email, id, {
    name: typeof b.name === "string" ? b.name.trim() : undefined,
    color: b.color !== undefined ? (b.color as string | null) : undefined,
    visibility: b.visibility as "private" | "shared" | undefined,
  });

  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }
  return c.json({ list: result.value });
});

// DELETE /api/lists/:id
listsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const result = await deleteList(c.env.DB, user.email, id, c.env.ATTACHMENTS);
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 400;
    return c.json({ error: { code: result.code, message: result.message } }, status);
  }
  return new Response(null, { status: 204 });
});
