-- Family Scheduler: initial schema (verbatim from build spec §4)
CREATE TABLE users (
  email        TEXT PRIMARY KEY,
  display_name TEXT,
  role         TEXT NOT NULL DEFAULT 'member',   -- 'admin' | 'member'
  created_at   INTEGER NOT NULL
);

CREATE TABLE lists (
  id          TEXT PRIMARY KEY,                  -- uuid
  name        TEXT NOT NULL,
  color       TEXT,
  owner_email TEXT NOT NULL REFERENCES users(email),
  visibility  TEXT NOT NULL DEFAULT 'private',   -- 'private' | 'shared'
  created_at  INTEGER NOT NULL
);

CREATE TABLE items (
  id           TEXT PRIMARY KEY,
  list_id      TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,                    -- 'event' | 'task'
  title        TEXT NOT NULL,
  location     TEXT,
  notes        TEXT,
  start_at     INTEGER NOT NULL,                 -- event start, or task due datetime
  end_at       INTEGER,                          -- optional (events)
  all_day      INTEGER NOT NULL DEFAULT 0,
  rrule        TEXT,                             -- optional RFC 5545 RRULE
  timezone     TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  completed_at INTEGER,                          -- tasks (non-recurring only; recurring uses item_occurrence_state)
  created_by   TEXT NOT NULL REFERENCES users(email),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE item_reminders (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  offset_minutes INTEGER NOT NULL,               -- minutes before the occurrence
  channel_email  INTEGER NOT NULL DEFAULT 1,
  channel_push   INTEGER NOT NULL DEFAULT 1
);

-- Idempotent ledger: one row per (reminder, occurrence, channel, recipient)
-- intentionally has NO FK to items or lists (the engine owns its lifecycle);
-- dispatch cleanup must run BEFORE any items/lists FK cascade delete (P2-N1)
CREATE TABLE reminder_dispatch (
  id               TEXT PRIMARY KEY,
  item_id          TEXT NOT NULL,
  item_reminder_id TEXT NOT NULL,
  occurrence_at    INTEGER NOT NULL,
  fire_at          INTEGER NOT NULL,             -- occurrence_at - offset
  channel          TEXT NOT NULL,                -- 'email' | 'push'
  recipient_email  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed'
  sent_at          INTEGER,
  UNIQUE (item_reminder_id, occurrence_at, channel, recipient_email)
);

CREATE TABLE push_subscriptions (
  id         TEXT PRIMARY KEY,
  user_email TEXT NOT NULL REFERENCES users(email),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_items_list ON items(list_id);
CREATE INDEX idx_dispatch_due ON reminder_dispatch(status, fire_at);
CREATE INDEX idx_sub_user ON push_subscriptions(user_email);
