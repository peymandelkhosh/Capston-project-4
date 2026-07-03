'use strict';
const express = require('express');
const router  = express.Router();
const { journal }   = require('../db');
const { syncToGCS } = require('../gcs');

router.get('/',       (_req, res) => res.json(journal.getAll()));
router.get('/recent', (req, res)  => res.json(journal.getRecent(parseInt(req.query.days) || 7)));
router.get('/stats',  (_req, res) => res.json(journal.moodStats()));

router.post('/', (req, res) => {
  const { content, date } = req.body;
  if (!content || !date) return res.status(400).json({ error: 'content and date are required' });
  const row = journal.create(req.body);
  syncToGCS();
  res.status(201).json(row);
});

router.put('/:id', (req, res) => {
  const row = journal.update(parseInt(req.params.id), req.body);
  syncToGCS();
  res.json(row);
});

router.delete('/:id', (req, res) => {
  journal.delete(parseInt(req.params.id));
  syncToGCS();
  res.json({ ok: true });
});

module.exports = router;
