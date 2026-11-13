-- Per-occurrence completion storage for recurring items (Decision D5, owner-approved 2026-06-28)
-- Non-recurring items use items.completed_at; recurring items use this table keyed by occurrence_at.
CREATE TABLE item_occurrence_state (
  item_id       TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  occurrence_at INTEGER NOT NULL,
  completed_at  INTEGER NOT NULL,
  PRIMARY KEY (item_id, occurrence_at)
);
