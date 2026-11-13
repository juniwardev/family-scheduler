-- Additive: per-user preferred maps provider for tappable addresses (feat/notifications-and-location).
-- NULL = default (Apple Maps). Non-null: 'apple' | 'google'.
ALTER TABLE users ADD COLUMN maps_provider TEXT;   -- NULL | 'apple' | 'google'
