CREATE TABLE IF NOT EXISTS pages (
  path TEXT PRIMARY KEY,
  title TEXT,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  page_path TEXT NOT NULL,
  parent_id TEXT,
  root_id TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_url TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  gravatar_hash TEXT,
  country_code TEXT,
  country_name TEXT,
  asn TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_page_status_created
  ON comments (page_path, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_comments_root
  ON comments (root_id, created_at ASC);
