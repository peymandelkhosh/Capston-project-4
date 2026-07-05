'use strict';
const express = require('express');
const router  = express.Router();
const { news } = require('../db');
const { generateNewsBriefing } = require('../agent');
const { syncToGCS } = require('../gcs');

const today = () => new Date().toISOString().slice(0, 10);

router.get('/', async (_req, res) => {
  try {
    const todayDate = today();
    let currentToday = news.getByDate(todayDate);
    
    if (!currentToday) {
      console.log(`[News] Briefing for ${todayDate} not found — generating via Gemini...`);
      const content = await generateNewsBriefing();
      news.create({ content, date: todayDate });
      syncToGCS();
    }
    
    res.json(news.getAll());
  } catch (err) {
    console.error('[News] GET / failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch news briefings' });
  }
});

router.post('/regenerate', async (_req, res) => {
  try {
    const todayDate = today();
    console.log(`[News] Regenerating briefing for ${todayDate} via Gemini...`);
    
    // Delete existing today's briefing
    news.deleteByDate(todayDate);
    
    const content = await generateNewsBriefing();
    news.create({ content, date: todayDate });
    syncToGCS();
    
    res.json(news.getAll());
  } catch (err) {
    console.error('[News] POST /regenerate failed:', err.message);
    res.status(500).json({ error: 'Failed to regenerate news briefing' });
  }
});

module.exports = router;
