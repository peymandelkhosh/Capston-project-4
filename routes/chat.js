'use strict';
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { processMessage, transcribeAudio, INTENTS } = require('../agent');
const { activities, tasks, schedules, journal, medals } = require('../db');
const { syncToGCS } = require('../gcs');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Text chat ─────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim())
    return res.status(400).json({ error: 'message is required' });
  try {
    const response = await processMessage(message.trim());
    res.json(response);
  } catch (err) {
    console.error('[Chat]', err.message);
    res.status(500).json({
      intent: 'GENERAL_CHAT',
      reply: 'Sorry, something went wrong. Please try again.',
      requiresConfirmation: false,
      payload: {},
    });
  }
});

// ── Confirm & Save ────────────────────────────────────────────
router.post('/confirm', async (req, res) => {
  const { intent, payload } = req.body;
  if (!intent || !payload)
    return res.status(400).json({ error: 'intent and payload are required' });
  try {
    let saved;
    switch (intent) {
      case INTENTS.LOG_ACTIVITY:  saved = activities.create(payload); break;
      case INTENTS.CREATE_TASK:   saved = tasks.create(payload); break;
      case INTENTS.ADD_SCHEDULE:  saved = schedules.create(payload); break;
      case INTENTS.LOG_JOURNAL:   saved = journal.create(payload); break;
      case INTENTS.LOG_MEDAL: {
        const all  = medals.getAll();
        const match = all.find(m => m.name.toLowerCase() === (payload.name || '').toLowerCase());
        saved = match ? medals.logToday(match.id) : medals.create(payload);
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown intent: ${intent}` });
    }
    syncToGCS();
    res.json({ ok: true, saved, intent });
  } catch (err) {
    console.error('[Chat/Confirm]', err.message);
    res.status(500).json({ error: 'Failed to save' });
  }
});

// ── Voice Upload ──────────────────────────────────────────────
router.post('/voice', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
  try {
    const transcript = await transcribeAudio(req.file.buffer, req.file.mimetype);
    if (!transcript)
      return res.status(503).json({ error: 'Transcription unavailable — add GEMINI_API_KEY to .env' });
    const response = await processMessage(transcript);
    res.json({ transcript, ...response });
  } catch (err) {
    console.error('[Chat/Voice]', err.message);
    res.status(500).json({ error: 'Voice processing failed' });
  }
});

module.exports = router;
