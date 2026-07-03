/**
 * db.js — SQLite database layer using sql.js (pure JavaScript, no native compilation)
 * Loads DB from disk on startup, saves to disk after every write.
 * All queries are synchronous after initialization.
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'syncroutine.db');
let db = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Save in-memory database back to disk */
function save() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/** Run a SELECT and return all rows as objects */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/** Run a SELECT and return the first row as object (or null) */
function get(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

/** Run an INSERT/UPDATE/DELETE and return last insert rowid */
function run(sql, params = []) {
  db.run(sql, params);
  const row = get('SELECT last_insert_rowid() as id');
  save();
  return row ? row.id : null;
}

/** Run multiple SQL statements (schema setup) */
function exec(sql) {
  db.exec(sql);
  save();
}

// ─── Initialize ───────────────────────────────────────────────────────────────

async function initDb() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
    console.log('[DB] Loaded existing database from disk ✓');
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new in-memory database ✓');
  }

  // ── Schema ──────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT    NOT NULL,
      duration   INTEGER NOT NULL,
      notes      TEXT    DEFAULT '',
      date       TEXT    NOT NULL,
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL,
      notes      TEXT    DEFAULT '',
      due_date   TEXT,
      status     TEXT    DEFAULT 'pending',
      priority   TEXT    DEFAULT 'medium',
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL,
      time       TEXT    NOT NULL,
      date       TEXT    NOT NULL,
      recurrence TEXT    DEFAULT 'none',
      notes      TEXT    DEFAULT '',
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      content    TEXT    NOT NULL,
      mood       INTEGER DEFAULT 3,
      mood_label TEXT    DEFAULT 'neutral',
      ai_insight TEXT    DEFAULT '',
      date       TEXT    NOT NULL,
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_medals (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      icon       TEXT    DEFAULT '🏅',
      streak     INTEGER DEFAULT 0,
      last_logged TEXT,
      created_at TEXT    DEFAULT (datetime('now'))
    );
  `);

  // Seed default medals only if empty
  const count = get('SELECT COUNT(*) as n FROM user_medals');
  if (!count || count.n === 0) {
    db.run("INSERT INTO user_medals (name, icon, streak) VALUES ('Reading',   '📚', 0)");
    db.run("INSERT INTO user_medals (name, icon, streak) VALUES ('Meditation','🧘', 0)");
    db.run("INSERT INTO user_medals (name, icon, streak) VALUES ('Exercise',  '💪', 0)");
    save();
    console.log('[DB] Seeded default medals ✓');
  }

  return db;
}

// ─── Activities ───────────────────────────────────────────────────────────────

const activities = {
  getAll: () => all('SELECT * FROM activities ORDER BY date DESC, created_at DESC'),

  getRecent: (days = 7) => all(
    "SELECT * FROM activities WHERE date >= date('now', '-' || ? || ' days') ORDER BY date DESC",
    [days]
  ),

  stats: () => get(`
    SELECT
      COUNT(*)    as total_count,
      SUM(duration) as total_minutes,
      AVG(duration) as avg_minutes,
      MAX(date)   as last_logged
    FROM activities
  `),

  create: (data) => {
    const id = run(
      'INSERT INTO activities (type, duration, notes, date) VALUES (?, ?, ?, ?)',
      [data.type, data.duration, data.notes || '', data.date]
    );
    return get('SELECT * FROM activities WHERE id = ?', [id]);
  },

  update: (id, data) => {
    run(
      'UPDATE activities SET type=?, duration=?, notes=?, date=? WHERE id=?',
      [data.type, data.duration, data.notes || '', data.date, id]
    );
    return get('SELECT * FROM activities WHERE id = ?', [id]);
  },

  delete: (id) => { db.run('DELETE FROM activities WHERE id = ?', [id]); save(); },
};

// ─── Tasks ────────────────────────────────────────────────────────────────────

const tasks = {
  getAll: () => all('SELECT * FROM tasks ORDER BY due_date ASC, created_at DESC'),

  getPending: () => all("SELECT * FROM tasks WHERE status='pending' ORDER BY due_date ASC"),

  create: (data) => {
    const id = run(
      'INSERT INTO tasks (title, notes, due_date, priority) VALUES (?, ?, ?, ?)',
      [data.title, data.notes || '', data.due_date || null, data.priority || 'medium']
    );
    return get('SELECT * FROM tasks WHERE id = ?', [id]);
  },

  update: (id, data) => {
    run(
      'UPDATE tasks SET title=?, notes=?, due_date=?, status=?, priority=? WHERE id=?',
      [data.title, data.notes || '', data.due_date || null, data.status || 'pending', data.priority || 'medium', id]
    );
    return get('SELECT * FROM tasks WHERE id = ?', [id]);
  },

  complete: (id) => {
    db.run("UPDATE tasks SET status='done' WHERE id=?", [id]);
    save();
    return get('SELECT * FROM tasks WHERE id = ?', [id]);
  },

  delete: (id) => { db.run('DELETE FROM tasks WHERE id = ?', [id]); save(); },
};

// ─── Schedules ────────────────────────────────────────────────────────────────

const schedules = {
  getAll: () => all('SELECT * FROM schedules ORDER BY date ASC, time ASC'),

  getByDate: (date) => all('SELECT * FROM schedules WHERE date = ?', [date]),

  getUpcoming: () => all(
    "SELECT * FROM schedules WHERE date >= date('now') ORDER BY date ASC, time ASC LIMIT 20"
  ),

  create: (data) => {
    const id = run(
      'INSERT INTO schedules (title, time, date, recurrence, notes) VALUES (?, ?, ?, ?, ?)',
      [data.title, data.time, data.date, data.recurrence || 'none', data.notes || '']
    );
    return get('SELECT * FROM schedules WHERE id = ?', [id]);
  },

  update: (id, data) => {
    run(
      'UPDATE schedules SET title=?, time=?, date=?, recurrence=?, notes=? WHERE id=?',
      [data.title, data.time, data.date, data.recurrence || 'none', data.notes || '', id]
    );
    return get('SELECT * FROM schedules WHERE id = ?', [id]);
  },

  delete: (id) => { db.run('DELETE FROM schedules WHERE id = ?', [id]); save(); },
};

// ─── Journal ──────────────────────────────────────────────────────────────────

const journal = {
  getAll: () => all('SELECT * FROM journal_entries ORDER BY date DESC, created_at DESC'),

  getRecent: (days = 7) => all(
    "SELECT * FROM journal_entries WHERE date >= date('now', '-' || ? || ' days') ORDER BY date DESC",
    [days]
  ),

  moodStats: () => get(
    'SELECT AVG(mood) as avg_mood, COUNT(*) as total_entries, MAX(date) as last_entry FROM journal_entries'
  ),

  create: (data) => {
    const id = run(
      'INSERT INTO journal_entries (content, mood, mood_label, ai_insight, date) VALUES (?, ?, ?, ?, ?)',
      [data.content, data.mood || 3, data.mood_label || 'neutral', data.ai_insight || '', data.date]
    );
    return get('SELECT * FROM journal_entries WHERE id = ?', [id]);
  },

  update: (id, data) => {
    run(
      'UPDATE journal_entries SET content=?, mood=?, mood_label=?, ai_insight=? WHERE id=?',
      [data.content, data.mood || 3, data.mood_label || 'neutral', data.ai_insight || '', id]
    );
    return get('SELECT * FROM journal_entries WHERE id = ?', [id]);
  },

  delete: (id) => { db.run('DELETE FROM journal_entries WHERE id = ?', [id]); save(); },
};

// ─── Medals ───────────────────────────────────────────────────────────────────

const medals = {
  getAll: () => all('SELECT * FROM user_medals ORDER BY streak DESC'),

  getById: (id) => get('SELECT * FROM user_medals WHERE id = ?', [id]),

  create: (data) => {
    const id = run(
      'INSERT INTO user_medals (name, icon) VALUES (?, ?)',
      [data.name, data.icon || '🏅']
    );
    return get('SELECT * FROM user_medals WHERE id = ?', [id]);
  },

  logToday: (id) => {
    const medal = get('SELECT * FROM user_medals WHERE id = ?', [id]);
    if (!medal) return null;
    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const newStreak = medal.last_logged === yesterday ? medal.streak + 1
                    : medal.last_logged === today     ? medal.streak
                    : 1;
    db.run('UPDATE user_medals SET streak=?, last_logged=? WHERE id=?', [newStreak, today, id]);
    save();
    return get('SELECT * FROM user_medals WHERE id = ?', [id]);
  },

  delete: (id) => { db.run('DELETE FROM user_medals WHERE id = ?', [id]); save(); },
};

// ─── Context snapshot for AI ──────────────────────────────────────────────────

function getContextSnapshot() {
  return {
    activities : activities.getRecent(7),
    tasks      : tasks.getPending(),
    schedules  : schedules.getUpcoming(),
    journal    : journal.getRecent(7),
    medals     : medals.getAll(),
    stats: {
      activities : activities.stats(),
      mood       : journal.moodStats(),
    },
  };
}

module.exports = { initDb, activities, tasks, schedules, journal, medals, getContextSnapshot, DB_PATH };
