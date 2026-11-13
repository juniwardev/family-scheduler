-- Additive: archived state for items (feat/item-archive).
-- NULL = live / not archived (default for all existing rows); non-null = EpochMs the item was
-- archived. Reversible: Restore sets it back to NULL (plan Decision 8), so a non-null value is a
-- current state, not a historical record.
-- Separate axis from completed_at: an item can be archived-but-not-done (a past event, which
-- never had a completed_at), done-but-visible, or both.
-- Non-recurring only, matching completed_at's precedent (0001_init.sql:30).
ALTER TABLE items ADD COLUMN archived_at INTEGER;   -- NULL = not archived
