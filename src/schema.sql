-- IdeaHub DDUC schema (SQLite). See docs/DESIGN.md for the reasoning behind each table.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- login name, unique ignoring case
  email           TEXT,                                 -- optional, not used for login
  password_hash   TEXT NOT NULL,
  course          TEXT NOT NULL,
  year            INTEGER NOT NULL,
  bio             TEXT NOT NULL DEFAULT '',
  interests       TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  role            TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','moderator')),
  reputation      INTEGER NOT NULL DEFAULT 0,
  streak          INTEGER NOT NULL DEFAULT 0,
  best_streak     INTEGER NOT NULL DEFAULT 0,
  last_active_day TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY,
  token      TEXT NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_challenges (
  id        INTEGER PRIMARY KEY,
  title     TEXT NOT NULL,
  prompt    TEXT NOT NULL,
  category  TEXT,
  starts_on TEXT NOT NULL,
  ends_on   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ideas (
  id              INTEGER PRIMARY KEY,
  author_id       INTEGER NOT NULL REFERENCES users(id),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  category        TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'idea' CHECK (kind IN ('idea','problem')),
  difficulty      TEXT NOT NULL DEFAULT 'intermediate' CHECK (difficulty IN ('beginner','intermediate','advanced')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','improving','verified')),
  needs_help      INTEGER NOT NULL DEFAULT 0,
  lab_open        INTEGER NOT NULL DEFAULT 0,
  lab_draft       TEXT,
  current_version INTEGER NOT NULL DEFAULT 1,
  challenge_id    INTEGER REFERENCES weekly_challenges(id),
  sources         TEXT NOT NULL DEFAULT '',
  images          TEXT NOT NULL DEFAULT '[]',   -- JSON array of image URLs
  hidden          INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  verified_at     TEXT
);
CREATE INDEX IF NOT EXISTS ideas_category ON ideas(category);
CREATE INDEX IF NOT EXISTS ideas_author   ON ideas(author_id);

CREATE TABLE IF NOT EXISTS idea_versions (
  id                      INTEGER PRIMARY KEY,
  idea_id                 INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  version                 INTEGER NOT NULL,
  title                   TEXT NOT NULL,
  body                    TEXT NOT NULL,
  change_note             TEXT NOT NULL DEFAULT '',
  editor_id               INTEGER NOT NULL REFERENCES users(id),
  credited_user_ids       TEXT NOT NULL DEFAULT '[]',  -- JSON array
  credited_correction_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array
  created_at              TEXT NOT NULL,
  UNIQUE (idea_id, version)
);

CREATE TABLE IF NOT EXISTS corrections (
  id                 INTEGER PRIMARY KEY,
  idea_id            INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  author_id          INTEGER NOT NULL REFERENCES users(id),
  type               TEXT NOT NULL CHECK (type IN ('math','logic','fact','missing','better','alternative')),
  quote              TEXT NOT NULL DEFAULT '',
  explanation        TEXT NOT NULL,
  suggestion         TEXT NOT NULL DEFAULT '',
  evidence           TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','correct','partial','incorrect','discussion')),
  decided_by         INTEGER REFERENCES users(id),
  decided_via        TEXT CHECK (decided_via IN ('author','moderator','community')),
  decision_note      TEXT NOT NULL DEFAULT '',
  applied_in_version INTEGER,
  hidden             INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  decided_at         TEXT
);
CREATE INDEX IF NOT EXISTS corrections_idea ON corrections(idea_id);

CREATE TABLE IF NOT EXISTS verdicts (
  id            INTEGER PRIMARY KEY,
  correction_id INTEGER NOT NULL REFERENCES corrections(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  verdict       TEXT NOT NULL CHECK (verdict IN ('correct','partial','incorrect','discussion')),
  created_at    TEXT NOT NULL,
  UNIQUE (correction_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id            INTEGER PRIMARY KEY,
  idea_id       INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  correction_id INTEGER REFERENCES corrections(id) ON DELETE CASCADE,
  parent_id     INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  author_id     INTEGER NOT NULL REFERENCES users(id),
  body          TEXT NOT NULL,
  helpful       INTEGER NOT NULL DEFAULT 0,
  hidden        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_idea ON comments(idea_id);

CREATE TABLE IF NOT EXISTS votes (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('idea','correction','comment')),
  target_id   INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS reputation_events (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  points     INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('improvement','quality','activity')),
  idea_id    INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rep_user ON reputation_events(user_id);

CREATE TABLE IF NOT EXISTS user_badges (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  badge      TEXT NOT NULL,
  awarded_at TEXT NOT NULL,
  UNIQUE (user_id, badge)
);

CREATE TABLE IF NOT EXISTS lab_edits (
  id         INTEGER PRIMARY KEY,
  idea_id    INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  editor_id  INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lab_tasks (
  id         INTEGER PRIMARY KEY,
  idea_id    INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  claimed_by INTEGER REFERENCES users(id),
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  text       TEXT NOT NULL,
  link       TEXT NOT NULL DEFAULT '',
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('idea','correction','comment')),
  target_id   INTEGER NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('bullying','harassment','plagiarism','spam','personal_attack','other')),
  details     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','hidden','dismissed')),
  resolved_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);
