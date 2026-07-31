-- D1 数据库迁移: 教你举报
-- 复制到 Cloudflare Dashboard → D1 → jiaoni-jubao-db → Console 执行

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  page TEXT NOT NULL DEFAULT '/',
  referrer TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  visit_time TEXT DEFAULT (datetime('now')),
  visit_date TEXT DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_type TEXT NOT NULL CHECK(user_type IN ('new','returning')),
  session_id TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mode_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('free','guided')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS heatmap_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK(report_type IN ('education','municipal')),
  province TEXT NOT NULL,
  city TEXT NOT NULL,
  district TEXT NOT NULL,
  description TEXT NOT NULL,
  ip TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  user_type TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  helpful TEXT CHECK(helpful IN ('yes','no','skipped')) DEFAULT 'skipped',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_logins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT DEFAULT '',
  success INTEGER DEFAULT 0,
  user_agent TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','+8 hours'))
);

CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  completed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_date);
CREATE INDEX IF NOT EXISTS idx_heatmap_location ON heatmap_data(province, city, district);
CREATE INDEX IF NOT EXISTS idx_heatmap_date ON heatmap_data(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_date ON ai_usage(created_at);

CREATE INDEX IF NOT EXISTS idx_users_date ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_helpful ON feedback(helpful);
