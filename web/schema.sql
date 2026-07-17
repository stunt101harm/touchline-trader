CREATE TABLE IF NOT EXISTS live_matches (
  fixture_id INTEGER PRIMARY KEY,
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  kickoff INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming', -- upcoming | live | finished
  winner TEXT,                             -- home | draw | away (regulation) once finished
  reg_home INTEGER,
  reg_away INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS live_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id INTEGER NOT NULL,
  t INTEGER NOT NULL,
  type TEXT NOT NULL,                      -- tick | event | danger
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_events_fixture ON live_events (fixture_id, id);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id INTEGER NOT NULL,
  nick TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'replay',     -- replay | live
  pnl INTEGER NOT NULL,
  equity INTEGER NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_fixture ON scores (fixture_id, pnl DESC);
