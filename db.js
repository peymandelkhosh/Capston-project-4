/**
 * db.js — SQLite database layer using sql.js (pure JavaScript, no native compilation)
 * Loads DB from disk on startup, saves to disk after every write.
 * All queries are synchronous after initialization.
 */

'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'syncroutine.db');
let db = null;

// ─── Encryption Setup ─────────────────────────────────────────────────────────

/**
 * Derive a 32-byte encryption key.
 * Priority:
 *   1. DB_ENCRYPTION_KEY env var — must be a 64-char hex string (32 bytes).
 *   2. SHA-256 of GEMINI_API_KEY (fallback, deterministic across restarts).
 */
function deriveEncryptionKey() {
  if (process.env.DB_ENCRYPTION_KEY) {
    const keyBuf = Buffer.from(process.env.DB_ENCRYPTION_KEY, 'hex');
    if (keyBuf.length === 32) {
      return keyBuf;
    }
    console.warn('[DB] DB_ENCRYPTION_KEY is not 64 hex chars — falling back to GEMINI_API_KEY derivation.');
  }
  const seed = process.env.GEMINI_API_KEY || 'syncroutine-default-fallback-key';
  return crypto.createHash('sha256').update(seed).digest();
}

const ENCRYPTION_KEY = deriveEncryptionKey(); // 32 bytes, Buffer

/**
 * Encrypt plaintext using AES-256-CBC.
 * A fresh random 16-byte IV is generated per call.
 * Returns a string in the format: "<ivHex>:<ciphertextHex>"
 */
function encrypt(text) {
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypt a value previously produced by encrypt().
 * Expects the format "<ivHex>:<ciphertextHex>".
 * Returns the original plaintext string, or the raw value unchanged on error
 * (so plain-text legacy rows still surface rather than crashing).
 */
function decrypt(stored) {
  try {
    const sep = stored.indexOf(':');
    if (sep === -1) return stored; // not an encrypted value — return as-is
    const iv          = Buffer.from(stored.slice(0, sep), 'hex');
    const ciphertext  = Buffer.from(stored.slice(sep + 1), 'hex');
    const decipher    = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    const decrypted   = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    // Graceful degradation: return the raw stored value if decryption fails
    return stored;
  }
}

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
      time       TEXT,
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

  // ── Safe migration: add description column if missing ────────────────────
  try {
    db.run("ALTER TABLE user_medals ADD COLUMN description TEXT DEFAULT ''");
    console.log('[DB] Added description column to user_medals table ✓');
  } catch (_) { /* column already exists — ignore */ }

  // ── Milestones table (created if missing, safe on repeated startups) ──────
  try {
    db.run(`CREATE TABLE IF NOT EXISTS milestones (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      title          TEXT    NOT NULL,
      description    TEXT    DEFAULT '',
      category       TEXT    NOT NULL,
      target_metric  TEXT    NOT NULL,
      target_value   REAL    NOT NULL,
      current_value  REAL    DEFAULT 0.0,
      unit           TEXT    DEFAULT '',
      created_at     TEXT    DEFAULT (datetime('now'))
    )`);
    console.log('[DB] Milestones table verified ✓');
  } catch(e) {}

  // ── To-Do List table ───────────────────────────────────────────────────────
  try {
    db.run(`CREATE TABLE IF NOT EXISTS todos (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      title              TEXT    NOT NULL,
      description        TEXT    DEFAULT '',
      estimated_duration INTEGER DEFAULT 0,
      deadline           TEXT,
      extra_notes        TEXT    DEFAULT '',
      status             TEXT    DEFAULT 'pending',
      created_at         TEXT    DEFAULT (datetime('now'))
    )`);
    console.log('[DB] Todos table verified ✓');
  } catch(e) {}

  // ── News briefings table ───────────────────────────────────────────────────
  try {
    db.run(`CREATE TABLE IF NOT EXISTS news_briefings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      content    TEXT    NOT NULL,
      date       TEXT    NOT NULL,
      created_at TEXT    DEFAULT (datetime('now'))
    )`);
    console.log('[DB] News briefings table verified ✓');
  } catch(e) {}

  // ── Update legacy tasks to done status ─────────────────────────────────────
  try {
    db.run("UPDATE tasks SET status='done' WHERE status='pending'");
    save();
  } catch(e) {}

  // ── Add time column to activities ──────────────────────────────────────────
  try {
    db.run("ALTER TABLE activities ADD COLUMN time TEXT");
    console.log('[DB] Added time column to activities table ✓');
  } catch(e) {}

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
      'INSERT INTO activities (type, duration, notes, date, time) VALUES (?, ?, ?, ?, ?)',
      [data.type, data.duration, data.notes || '', data.date, data.time || null]
    );
    
    // Automatically log corresponding medal if one exists
    const allMedals = medals.getAll();
    const match = allMedals.find(m => m.name.toLowerCase() === data.type.toLowerCase());
    if (match) {
      medals.logToday(match.id);
    }

    return get('SELECT * FROM activities WHERE id = ?', [id]);
  },

  update: (id, data) => {
    run(
      'UPDATE activities SET type=?, duration=?, notes=?, date=?, time=? WHERE id=?',
      [data.type, data.duration, data.notes || '', data.date, data.time || null, id]
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
      "INSERT INTO tasks (title, notes, due_date, status, priority) VALUES (?, ?, ?, 'done', ?)",
      [data.title, data.notes || '', data.due_date || null, data.priority || 'medium']
    );
    return get('SELECT * FROM tasks WHERE id = ?', [id]);
  },

  update: (id, data) => {
    run(
      'UPDATE tasks SET title=?, notes=?, due_date=?, status=?, priority=? WHERE id=?',
      [data.title, data.notes || '', data.due_date || null, data.status || 'done', data.priority || 'medium', id]
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
  /** Return all journal entries with content decrypted. */
  getAll: () => {
    const rows = all('SELECT * FROM journal_entries ORDER BY date DESC, created_at DESC');
    return rows.map(r => ({ ...r, content: decrypt(r.content) }));
  },

  /** Return recent journal entries (default last 7 days) with content decrypted. */
  getRecent: (days = 7) => {
    const rows = all(
      "SELECT * FROM journal_entries WHERE date >= date('now', '-' || ? || ' days') ORDER BY date DESC",
      [days]
    );
    return rows.map(r => ({ ...r, content: decrypt(r.content) }));
  },

  moodStats: () => get(
    'SELECT AVG(mood) as avg_mood, COUNT(*) as total_entries, MAX(date) as last_entry FROM journal_entries'
  ),

  /** Encrypt content before writing to the database. */
  create: (data) => {
    const encryptedContent = encrypt(data.content || '');
    const id = run(
      'INSERT INTO journal_entries (content, mood, mood_label, ai_insight, date) VALUES (?, ?, ?, ?, ?)',
      [encryptedContent, data.mood || 3, data.mood_label || 'neutral', data.ai_insight || '', data.date]
    );
    // Fetch the row and return with decrypted content
    const row = get('SELECT * FROM journal_entries WHERE id = ?', [id]);
    return row ? { ...row, content: decrypt(row.content) } : null;
  },

  /** Encrypt updated content before writing. Returns row with decrypted content. */
  update: (id, data) => {
    const encryptedContent = encrypt(data.content || '');
    run(
      'UPDATE journal_entries SET content=?, mood=?, mood_label=?, ai_insight=? WHERE id=?',
      [encryptedContent, data.mood || 3, data.mood_label || 'neutral', data.ai_insight || '', id]
    );
    const row = get('SELECT * FROM journal_entries WHERE id = ?', [id]);
    return row ? { ...row, content: decrypt(row.content) } : null;
  },

  delete: (id) => { db.run('DELETE FROM journal_entries WHERE id = ?', [id]); save(); },
};

// ─── Medals ───────────────────────────────────────────────────────────────────

const medals = {
  getAll: () => all('SELECT * FROM user_medals ORDER BY streak DESC'),

  getById: (id) => get('SELECT * FROM user_medals WHERE id = ?', [id]),

  create: (data) => {
    const id = run(
      'INSERT INTO user_medals (name, icon, description) VALUES (?, ?, ?)',
      [data.name, data.icon || '🏅', data.description || '']
    );
    return get('SELECT * FROM user_medals WHERE id = ?', [id]);
  },

  update: (id, data) => {
    run(
      'UPDATE user_medals SET name = ?, icon = ?, description = ? WHERE id = ?',
      [data.name, data.icon || '🏅', data.description || '', id]
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

// ─── Milestones ─────────────────────────────────────────────────────────────

const milestones = {
  getAll: () => all('SELECT * FROM milestones ORDER BY created_at DESC'),

  getById: (id) => get('SELECT * FROM milestones WHERE id = ?', [id]),

  create: (data) => {
    const id = run(
      `INSERT INTO milestones
         (title, description, category, target_metric, target_value, current_value, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.title, data.description || '',
        data.category, data.target_metric,
        parseFloat(data.target_value) || 0,
        parseFloat(data.current_value) || 0,
        data.unit || '',
      ]
    );
    return get('SELECT * FROM milestones WHERE id = ?', [id]);
  },

  update: (id, data) => {
    run(
      `UPDATE milestones
       SET title = ?, description = ?, category = ?, target_metric = ?,
           target_value = ?, current_value = ?, unit = ?
       WHERE id = ?`,
      [
        data.title, data.description || '',
        data.category, data.target_metric,
        parseFloat(data.target_value) || 0,
        parseFloat(data.current_value) || 0,
        data.unit || '', id,
      ]
    );
    return get('SELECT * FROM milestones WHERE id = ?', [id]);
  },

  delete: (id) => { db.run('DELETE FROM milestones WHERE id = ?', [id]); save(); },
};

// ─── News Briefings ──────────────────────────────────────────────────────────

const news = {
  getAll: () => all('SELECT * FROM news_briefings ORDER BY date DESC, created_at DESC'),
  getByDate: (date) => get('SELECT * FROM news_briefings WHERE date = ?', [date]),
  create: (data) => {
    const id = run(
      'INSERT INTO news_briefings (content, date) VALUES (?, ?)',
      [data.content, data.date]
    );
    return get('SELECT * FROM news_briefings WHERE id = ?', [id]);
  },
  deleteByDate: (date) => { db.run('DELETE FROM news_briefings WHERE date = ?', [date]); save(); }
};

// ─── Context snapshot for AI ─────────────────────────────────────────────────────────────────

function getContextSnapshot() {
  return {
    activities : activities.getRecent(7),
    todos      : todos.getPending(),
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

// ─── To-Do List ───────────────────────────────────────────────────────────────

const todos = {
  getAll: () => all('SELECT * FROM todos ORDER BY deadline ASC, created_at DESC'),

  getPending: () => all("SELECT * FROM todos WHERE status='pending' ORDER BY deadline ASC"),

  create: (data) => {
    const id = run(
      "INSERT INTO todos (title, description, estimated_duration, deadline, extra_notes, status) VALUES (?, ?, ?, ?, ?, 'pending')",
      [data.title, data.description || '', parseInt(data.estimated_duration) || 0, data.deadline || null, data.extra_notes || '']
    );
    save();
    return get('SELECT * FROM todos WHERE id = ?', [id]);
  },

  update: (id, data) => {
    run(
      'UPDATE todos SET title=?, description=?, estimated_duration=?, deadline=?, extra_notes=?, status=? WHERE id=?',
      [data.title, data.description || '', parseInt(data.estimated_duration) || 0, data.deadline || null, data.extra_notes || '', data.status || 'pending', id]
    );
    save();
    return get('SELECT * FROM todos WHERE id = ?', [id]);
  },

  complete: (id) => {
    run("UPDATE todos SET status='done' WHERE id=?", [id]);
    save();
    return get('SELECT * FROM todos WHERE id = ?', [id]);
  },

  delete: (id) => { db.run('DELETE FROM todos WHERE id = ?', [id]); save(); },
};

module.exports = { initDb, activities, tasks, schedules, journal, medals, milestones, news, todos, getContextSnapshot, DB_PATH };
