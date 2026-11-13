-- Add active flag to users (Decision D6, owner-approved 2026-06-28)
-- active=1 means the user participates in reminders/audience rules; active=0 mutes them
-- without removing them from Cloudflare Access (so they can still sign in).
ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
