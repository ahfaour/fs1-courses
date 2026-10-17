-- Uploaded file bytes, for hosts without a persistent disk or a bucket (e.g. Render free + Neon).
-- No foreign key to files: the bytes are stored before the files row is committed, and
-- cleanup-orphans removes any left behind.
CREATE TABLE file_blobs (
  id            TEXT PRIMARY KEY,
  data          BYTEA NOT NULL,
  created_at    TEXT NOT NULL
);
