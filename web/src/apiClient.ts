// apiClient.ts — typed fetch wrapper for /api/*
// Auth is handled by Cloudflare Access: the browser carries the Access cookie/JWT
// to same-origin /api requests automatically.

import type {
  User,
  List,
  Item,
  ItemReminder,
  OccurrenceEntry,
  ReminderInput,
  ItemDraft,
  Attachment,
} from "./types";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const resp = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });

  if (!resp.ok) {
    let errData: { error?: { code?: string; message?: string } } = {};
    try {
      errData = (await resp.json()) as typeof errData;
    } catch {
      // ignore parse failure
    }
    throw new ApiError(
      errData.error?.code ?? "UNKNOWN",
      errData.error?.message ?? `HTTP ${resp.status}`,
      resp.status
    );
  }

  if (resp.status === 204) return undefined as unknown as T;
  return resp.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------
export async function getMe(): Promise<{ user: User; lists: List[] }> {
  return request("GET", "/me");
}

export async function updateMe(display_name: string): Promise<{ user: User }> {
  return request("PUT", "/me", { display_name });
}

export async function updateMapsProvider(
  maps_provider: "apple" | "google"
): Promise<{ user: User }> {
  return request("PATCH", "/me", { maps_provider });
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------
export async function getLists(): Promise<{ lists: List[] }> {
  return request("GET", "/lists");
}

export async function createList(
  name: string,
  color?: string | null,
  visibility?: "private" | "shared"
): Promise<{ list: List }> {
  return request("POST", "/lists", { name, color, visibility });
}

export async function updateList(
  id: string,
  patch: { name?: string; color?: string | null; visibility?: "private" | "shared" }
): Promise<{ list: List }> {
  return request("PATCH", `/lists/${id}`, patch);
}

export async function deleteList(id: string): Promise<void> {
  return request("DELETE", `/lists/${id}`);
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
export async function getItems(
  listId: string,
  opts?: { archived?: boolean }
): Promise<{ items: Item[] }> {
  const qs = opts?.archived ? "?archived=1" : "";
  return request("GET", `/lists/${listId}/items${qs}`);
}

// Authorized point-read for the deep-link resolution (?item=<id> -> open its editor).
export async function getItem(id: string): Promise<{ item: Item }> {
  return request("GET", `/items/${id}`);
}

export async function getOccurrences(
  listId: string,
  from: number,
  to: number
): Promise<{ occurrences: OccurrenceEntry[] }> {
  return request("GET", `/lists/${listId}/items?from=${from}&to=${to}`);
}

export async function createItem(
  draft: ItemDraft
): Promise<{ item: Item }> {
  return request("POST", "/items", draft);
}

export interface ItemUpdatePatch {
  type?: "event" | "task";
  title?: string;
  location?: string | null;
  notes?: string | null;
  start_at?: number;
  end_at?: number | null;
  all_day?: boolean;
  rrule?: string | null;
  timezone?: string;
  location_kind?: "plain" | "address" | "meeting" | null;
}

export async function updateItem(
  id: string,
  patch: ItemUpdatePatch
): Promise<{ item: Item }> {
  return request("PATCH", `/items/${id}`, patch);
}

export async function deleteItem(id: string): Promise<void> {
  return request("DELETE", `/items/${id}`);
}

export async function completeItem(
  id: string,
  occurrence_at?: number,
  completed = true
): Promise<{ ok: boolean }> {
  return request("POST", `/items/${id}/complete`, { occurrence_at, completed });
}

// Archive (true) or Restore (false) a non-recurring item (plan Decision 8).
export async function setItemArchived(
  id: string,
  archived: boolean
): Promise<{ item: Item }> {
  return request("POST", `/items/${id}/archive`, { archived });
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------
export async function replaceReminders(
  itemId: string,
  reminders: ReminderInput[]
): Promise<{ reminders: ItemReminder[] }> {
  return request("PUT", `/items/${itemId}/reminders`, { reminders });
}

// ---------------------------------------------------------------------------
// Push subscriptions
// ---------------------------------------------------------------------------
export async function getVapidPublicKey(): Promise<{ publicKey: string }> {
  return request("GET", "/vapid-public-key");
}

export async function registerSubscription(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string;
}): Promise<{ subscription: { id: string; endpoint: string } }> {
  return request("POST", "/subscriptions", sub);
}

export async function unregisterSubscription(endpoint: string): Promise<void> {
  return request("DELETE", `/subscriptions/${encodeURIComponent(endpoint)}`);
}

// ---------------------------------------------------------------------------
// Attachments (feat/attachments)
// ---------------------------------------------------------------------------

export async function listAttachments(itemId: string): Promise<{ attachments: Attachment[] }> {
  return request("GET", `/items/${itemId}/attachments`);
}

/**
 * Uploads a single file as an attachment on an item. Does NOT use the JSON request() helper
 * (plan §5.2) — it builds a FormData and lets the browser set the multipart boundary, since
 * request() unconditionally sets Content-Type: application/json. Error handling mirrors
 * request(): parse { error: { code, message } } -> ApiError.
 */
export async function uploadAttachment(
  itemId: string,
  file: File
): Promise<{ attachment: Attachment }> {
  const form = new FormData();
  form.append("file", file);

  const resp = await fetch(`/api/items/${itemId}/attachments`, {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });

  if (!resp.ok) {
    let errData: { error?: { code?: string; message?: string } } = {};
    try {
      errData = (await resp.json()) as typeof errData;
    } catch {
      // ignore parse failure
    }
    throw new ApiError(
      errData.error?.code ?? "UNKNOWN",
      errData.error?.message ?? `HTTP ${resp.status}`,
      resp.status
    );
  }

  return resp.json() as Promise<{ attachment: Attachment }>;
}

export async function deleteAttachment(itemId: string, attachmentId: string): Promise<void> {
  return request("DELETE", `/items/${itemId}/attachments/${attachmentId}`);
}

/** URL builder for <img src>/anchor href use — the download route streams bytes directly. */
export function attachmentDownloadUrl(itemId: string, attachmentId: string): string {
  return `/api/items/${itemId}/attachments/${attachmentId}`;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export async function adminGetUsers(): Promise<{ users: User[] }> {
  return request("GET", "/admin/users");
}

export async function adminUpdateUser(
  target_email: string,
  patch: { active?: boolean; display_name?: string }
): Promise<{ user: User }> {
  return request("PATCH", "/admin/users", { target_email, ...patch });
}
