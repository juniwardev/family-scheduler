// Shared types for the web frontend (mirrors worker/types.ts but browser-safe)
export type EpochMs = number;
export type Email = string;
export type UUID = string;

export interface User {
  email: Email;
  display_name: string | null;
  role: "admin" | "member";
  active: boolean;
  created_at: EpochMs;
  // Per-user preferred maps provider for tappable addresses. NULL = default (Apple Maps).
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

export interface ItemReminder {
  id: UUID;
  item_id: UUID;
  offset_minutes: number;
  channel_email: boolean;
  channel_push: boolean;
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
  all_day: boolean;
  rrule: string | null;
  timezone: string;
  completed_at: EpochMs | null;
  created_by: Email;
  created_at: EpochMs;
  updated_at: EpochMs;
  reminders: ItemReminder[];
  // Optional user override for smart-location classification. NULL = auto-detect at render.
  location_kind: "plain" | "address" | "meeting" | null;
  // Archived state. NULL = live; non-null = EpochMs the item was archived. Reversible.
  archived_at: EpochMs | null;
}

export interface OccurrenceEntry {
  item_id: UUID;
  occurrence_at: EpochMs;
  end_at: EpochMs | null;
  item: Item;
}

export interface ReminderInput {
  offset_minutes: number;
  channel_email: boolean;
  channel_push: boolean;
}

export interface ItemDraft {
  list_id: UUID;
  type: "event" | "task";
  title: string;
  location: string;
  notes: string;
  start_at: EpochMs;
  end_at: EpochMs | null;
  all_day: boolean;
  rrule: string | null;
  timezone: string;
  reminders: ReminderInput[];
  // Optional user override for smart-location classification. null = "Auto" (auto-detect).
  location_kind: "plain" | "address" | "meeting" | null;
}

export type AppView = "list" | "calendar" | "admin";

// Attachments (feat/attachments) — browser-safe (no r2_key, an internal storage detail; see
// src/worker/types.ts's Attachment for the server-side shape).
export interface Attachment {
  id: UUID;
  item_id: UUID;
  filename: string;
  content_type: string;
  size: number;
  uploaded_by: Email;
  created_at: EpochMs;
}
