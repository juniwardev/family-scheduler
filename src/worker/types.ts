// Shared TypeScript types for the Family Scheduler
// All timestamps are epoch milliseconds (UTC). Display is converted to timezone on the client.

export type EpochMs = number;
export type Email = string; // always lowercase-normalized
export type UUID = string;

// Result<T> for explicit error handling in Worker modules.
// Throw only for infrastructure failures (-> 500); use Result for expected errors.
// 'DEACTIVATED' (D14) is emitted by requireAuth (403) for an active=0 user; it is included here
// so the typed code set has a single source of truth shared with the §2 code->status table
// (DEACTIVATED -> 403, distinct from FORBIDDEN -> 403 via requireAdmin).
export type Result<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "VALIDATION" | "FORBIDDEN" | "DEACTIVATED" | "NOT_FOUND" | "CONFLICT" | "INTERNAL";
      message: string;
    };

export interface User {
  email: Email;
  display_name: string | null;
  role: "admin" | "member"; // single-admin model (F3/O1)
  active: boolean; // DB 0/1, default 1 (D6 / migration 0003)
  created_at: EpochMs;
  // Per-user preferred maps provider for tappable addresses (migration 0005).
  // NULL = default (Apple Maps); resolved via resolveMapsProvider() at send time.
  maps_provider: "apple" | "google" | null;
}

export interface List {
  id: UUID;
  name: string;
  color: string | null;
  owner_email: Email;
  visibility: "private" | "shared";
  created_at: EpochMs;
}

export interface Item {
  id: UUID;
  list_id: UUID;
  type: "event" | "task";
  title: string;
  location: string | null;
  notes: string | null;
  start_at: EpochMs;
  end_at: EpochMs | null;
  all_day: boolean; // DB 0/1
  rrule: string | null;
  timezone: string; // IANA timezone string
  completed_at: EpochMs | null; // non-recurring tasks only
  created_by: Email;
  created_at: EpochMs;
  updated_at: EpochMs;
  // Optional user override for smart-location classification (migration 0004).
  // NULL = auto-detect via classifyLocation() at render time (default for all existing
  // rows and any item the user never touches the toggle on).
  location_kind: "plain" | "address" | "meeting" | null;
  // Archived state (migration 0007). NULL = live (default for all existing rows); non-null =
  // EpochMs the item was archived. Reversible (plan Decision 8) — a non-null value is a current
  // state, not a historical record. Separate axis from completed_at.
  archived_at: EpochMs | null;
}

// Which items a getItems() call returns. Only two members: with archived items excluded from
// the calendar too (plan Decision 4), nothing needs a third "all" value.
export type ItemScope = "active" | "archived";

export interface ItemReminder {
  id: UUID;
  item_id: UUID;
  offset_minutes: number; // integer >= 0
  channel_email: boolean;
  channel_push: boolean;
}

export interface ItemWithReminders extends Item {
  reminders: ItemReminder[];
}

export interface ReminderDispatch {
  id: UUID;
  item_id: UUID;
  item_reminder_id: UUID;
  occurrence_at: EpochMs;
  fire_at: EpochMs;
  channel: "email" | "push";
  recipient_email: Email;
  // D13: transient failures stay 'pending' for grace-window retry; only permanent 4xx -> 'failed';
  // zero-subscription push -> 'sent' no-op. A 'pending' row whose fire_at ages past the grace window
  // (P2-N3) is never re-selected by sendDue and is left inert as 'pending' (no sweep to 'failed').
  // reminder_dispatch has NO FK to items/lists (engine owns its lifecycle); deletion cleanup
  // must precede any items/lists FK cascade (P2-N1).
  status: "pending" | "sent" | "failed";
  sent_at: EpochMs | null;
}

export interface PushSubscription {
  id: UUID;
  user_email: Email;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: EpochMs;
}

export interface OccurrenceCompletion {
  // Decision D5 / migration 0002
  item_id: UUID;
  occurrence_at: EpochMs;
  completed_at: EpochMs;
}

// Route input DTOs
export interface CreateListInput {
  name: string;
  color?: string | null;
  visibility?: "private" | "shared";
}

export interface UpdateListInput {
  name?: string;
  color?: string | null;
  visibility?: "private" | "shared";
}

export interface ReminderInput {
  offset_minutes: number;
  channel_email: boolean;
  channel_push: boolean;
}

export interface CreateItemInput {
  list_id: UUID;
  type: "event" | "task";
  title: string;
  location?: string | null;
  notes?: string | null;
  start_at: EpochMs;
  end_at?: EpochMs | null;
  all_day?: boolean;
  rrule?: string | null;
  timezone?: string;
  reminders?: ReminderInput[];
  // Optional user override for smart-location classification (migration 0004).
  location_kind?: "plain" | "address" | "meeting" | null;
}

export type UpdateItemInput = Partial<
  Omit<CreateItemInput, "list_id" | "reminders">
>;

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string;
}

// Admin DTO (§2.6, F14: target carried in body, not path — avoids email in access logs)
export interface AdminUpdateUserInput {
  target_email: Email;
  active?: boolean;
  display_name?: string;
}

// Internal D1 row types (snake_case from the database)
export interface UserRow {
  email: string;
  display_name: string | null;
  role: string;
  active: number;
  created_at: number;
  maps_provider: string | null;
}

export interface ListRow {
  id: string;
  name: string;
  color: string | null;
  owner_email: string;
  visibility: string;
  created_at: number;
}

export interface ItemRow {
  id: string;
  list_id: string;
  type: string;
  title: string;
  location: string | null;
  notes: string | null;
  start_at: number;
  end_at: number | null;
  all_day: number;
  rrule: string | null;
  timezone: string;
  completed_at: number | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  location_kind: string | null;
  archived_at: number | null;
}

export interface ItemReminderRow {
  id: string;
  item_id: string;
  offset_minutes: number;
  channel_email: number;
  channel_push: number;
}

export interface DispatchRow {
  id: string;
  item_id: string;
  item_reminder_id: string;
  occurrence_at: number;
  fire_at: number;
  channel: string;
  recipient_email: string;
  status: string;
  sent_at: number | null;
}

export interface PushSubscriptionRow {
  id: string;
  user_email: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: number;
}

// New dispatch row for insertDispatchIgnore
export interface NewDispatchRow {
  id: UUID;
  item_id: UUID;
  item_reminder_id: UUID;
  occurrence_at: EpochMs;
  fire_at: EpochMs;
  channel: "email" | "push";
  recipient_email: Email;
}

// ---------------------------------------------------------------------------
// Attachments (feat/attachments) — metadata only; bytes live in R2 under r2_key.
// r2_key is intentionally NOT exposed on the domain type sent to the client
// (internal storage detail) — see web/src/types.ts's browser-safe Attachment.
// ---------------------------------------------------------------------------

export interface Attachment {
  id: UUID;
  item_id: UUID;
  filename: string; // sanitized original name (display + Content-Disposition)
  content_type: string; // from the validated allowlist
  size: number; // bytes
  r2_key: string; // 'items/<item_id>/<attachment_id>' — internal; routes must not leak this
  uploaded_by: Email; // verified JWT identity
  created_at: EpochMs;
}

export interface AttachmentRow {
  id: string;
  item_id: string;
  filename: string;
  content_type: string;
  size: number;
  r2_key: string;
  uploaded_by: string;
  created_at: number;
}

// Input to createAttachment (route generates id + r2_key; db.ts is INSERT-only — plan §5.4/m3).
export interface CreateAttachmentInput {
  filename: string;
  content_type: string;
  size: number;
  r2_key: string;
}
