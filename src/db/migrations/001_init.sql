CREATE TABLE profile (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  name          TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL DEFAULT '',
  affiliation   TEXT NOT NULL DEFAULT '',
  intro         TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  office_hours  TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL
);

CREATE TABLE courses (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL DEFAULT '',
  level         TEXT NOT NULL DEFAULT '',
  semester      TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL CHECK (kind IN ('course','program')),
  description   TEXT NOT NULL DEFAULT '',
  topics_json   TEXT NOT NULL DEFAULT '[]',
  color_index   INTEGER NOT NULL DEFAULT 0 CHECK (color_index BETWEEN 0 AND 5),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE files (
  id            TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE materials (
  id            TEXT PRIMARY KEY,
  course_id     TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  section       TEXT NOT NULL CHECK (section IN ('cours','td','tp','proj','exam','read','info')),
  title         TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  material_date TEXT,
  url           TEXT,
  file_id       TEXT REFERENCES files(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK ((url IS NOT NULL) <> (file_id IS NOT NULL))
);
CREATE INDEX idx_materials_course ON materials(course_id, section, material_date DESC);
CREATE INDEX idx_materials_file ON materials(file_id);

CREATE TABLE announcements (
  id            TEXT PRIMARY KEY,
  course_id     TEXT REFERENCES courses(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  posted_on     TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE admins (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  sid           TEXT PRIMARY KEY,
  sess          TEXT NOT NULL,
  expires_at    BIGINT NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
