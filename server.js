/**
 * server.js — SyncRoutine entry point
 * Initializes DB first (async), then starts Express + Telegram bot.
 */

'use strict';
require('dotenv').config();

const express = require('express');
const path    = require('path');
const { initDb } = require('./db');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

async function start() {
  // 1. Optional GCS restore (before DB init)
  try {
    const { restoreFromGCS } = require('./gcs');
    await restoreFromGCS();
  } catch (_) {}

  // 2. Initialize database (must complete before routes handle requests)
  await initDb();

  // 3. Mount routes
  app.use('/api/activities', require('./routes/activities'));
  app.use('/api/tasks',      require('./routes/tasks'));
  app.use('/api/schedules',  require('./routes/schedules'));
  app.use('/api/journal',    require('./routes/journal'));
  app.use('/api/medals',     require('./routes/medals'));
  app.use('/api/chat',       require('./routes/chat'));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'SyncRoutine', time: new Date().toISOString() }));

  // SPA fallback
  app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  // 4. Start HTTP server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n🚀 SyncRoutine is running → http://localhost:${PORT}`);
    console.log('   Press Ctrl+C to stop\n');
  });

  // 5. Start Telegram bot (non-blocking)
  try {
    const { initTelegram } = require('./telegram');
    initTelegram();
  } catch (err) {
    console.warn('[Telegram] Could not start:', err.message);
  }
}

start().catch(err => {
  console.error('❌ Fatal startup error:', err);
  process.exit(1);
});
