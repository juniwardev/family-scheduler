-- Additive: optional user override for smart-location classification (feat/notifications-and-location).
-- NULL = auto-detect at render (default for all existing rows); non-null = explicit user override.
ALTER TABLE items ADD COLUMN location_kind TEXT;   -- NULL | 'plain' | 'address' | 'meeting'
