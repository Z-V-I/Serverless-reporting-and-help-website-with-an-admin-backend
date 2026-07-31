const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const DB_PATH = path.join(dbDir, 'report.db');

let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    page TEXT NOT NULL DEFAULT '/',
    referrer TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    visit_time TEXT DEFAULT (datetime('now', 'localtime')),
    visit_date TEXT DEFAULT (date('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_type TEXT NOT NULL CHECK(user_type IN ('new', 'returning')),
    session_id TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS mode_selections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('free', 'guided')),
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS heatmap_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    report_type TEXT NOT NULL CHECK(report_type IN ('education', 'municipal')),
    province TEXT NOT NULL,
    city TEXT NOT NULL,
    district TEXT NOT NULL,
    description TEXT NOT NULL,
    ip TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  )`);
  try { db.run('ALTER TABLE heatmap_data ADD COLUMN ip TEXT DEFAULT \'\''); } catch(e) {}

  db.run(`CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_type TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    helpful TEXT CHECK(helpful IN ('yes', 'no', 'skipped')) DEFAULT 'skipped',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    completed_at TEXT DEFAULT (datetime('now', 'localtime'))
  )`);

  // 创建索引
  try {
    db.run('CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_date)');
    db.run('CREATE INDEX IF NOT EXISTS idx_visits_page ON visits(page)');
    db.run('CREATE INDEX IF NOT EXISTS idx_heatmap_location ON heatmap_data(province, city, district)');
    db.run('CREATE INDEX IF NOT EXISTS idx_heatmap_type ON heatmap_data(report_type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_heatmap_date ON heatmap_data(created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_ai_usage_date ON ai_usage(created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_feedback ON feedback(helpful)');
  } catch(e) {}

  saveDb();
  return db;
}

function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// 定时保存
setInterval(saveDb, 10000);

// 查询辅助
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  if (sql.trim().toUpperCase().startsWith('SELECT') || sql.trim().toUpperCase().startsWith('WITH')) {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } else {
    stmt.bind(params);
    stmt.step();
    stmt.free();
    saveDb();
    return { changes: db.getRowsModified() };
  }
}

function get(sql, params = []) {
  const rows = query(sql, params);
  return rows[0] || null;
}

module.exports = { getDb, query, get, saveDb };
