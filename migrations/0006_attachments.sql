-- Additive: file attachments on items (feat/attachments).
-- Metadata only; bytes live in R2 under r2_key. DB cascade removes rows, NOT R2 objects —
-- R2 cleanup is explicit in db.ts deleteItem/deleteList (P2-N1 pattern).
CREATE TABLE attachment (
  id           TEXT PRIMARY KEY,                                  -- server crypto.randomUUID()
  item_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,                                     -- sanitized original name (display + Content-Disposition)
  content_type TEXT NOT NULL,                                     -- from the validated allowlist
  size         INTEGER NOT NULL,                                  -- bytes
  r2_key       TEXT NOT NULL UNIQUE,                              -- 'items/<item_id>/<attachment_id>'
  uploaded_by  TEXT NOT NULL REFERENCES users(email),             -- verified JWT identity
  created_at   INTEGER NOT NULL                                   -- EpochMs UTC
);

CREATE INDEX idx_attachment_item ON attachment(item_id);
