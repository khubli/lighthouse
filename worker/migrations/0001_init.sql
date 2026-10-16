-- The Lighthouse schema. 0004 adds users.email for Cloudflare Access.
--
-- There is no 0002 or 0003: they were steps toward this schema before 1.0, and
-- are folded in here. Installs that ran them keep them recorded by name, so
-- nothing is applied twice; 0004 keeps its number for the same reason.
--
-- Every capture is kept in raw_captures exactly as it arrived, before any
-- processing; items is the list, one row per title and type per account (one
-- per post for X and Reddit posts); item_sources ties the two together.
-- Column order and defaults match installs that were built up in steps before
-- 1.0, so later migrations apply the same way to both.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  pin_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS raw_captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_text TEXT NOT NULL,
  raw_url TEXT,
  message_metadata_json TEXT NOT NULL DEFAULT '{}',
  source_platform TEXT,
  processed_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  media_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'inbox',
  synopsis TEXT,
  image_url TEXT,
  release_year TEXT,
  external_ids_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  availability_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_identity
  ON items(normalized_title, media_type, user_id);

CREATE TABLE IF NOT EXISTS item_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  raw_capture_id INTEGER NOT NULL,
  source_name TEXT,
  source_url TEXT,
  reason_saved TEXT,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS enrichment_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER,
  raw_capture_id INTEGER,
  status TEXT NOT NULL,
  provider TEXT,
  logs_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Reserved for per-item notes, mood and priority; not used yet.
CREATE TABLE IF NOT EXISTS personal_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  reason_saved TEXT,
  mood TEXT,
  priority INTEGER,
  tags_json TEXT NOT NULL DEFAULT '[]',
  trust_score REAL,
  estimated_effort TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id INTEGER NOT NULL DEFAULT 0
);
