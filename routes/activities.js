'use strict';
const express  = require('express');
const router   = express.Router();
const { activities } = require('../db');
const { syncToGCS }  = require('../gcs');

router.get('/',       (_req, res) => res.json(activities.getAll()));
router.get('/recent', (req, res)  => res.json(activities.getRecent(parseInt(req.query.days) || 7)));
router.get('/stats',  (_req, res) => res.json(activities.stats()));

router.post('/', (req, res) => {
  const { type, duration, notes, date } = req.body;
  if (!type || !duration || !date)
    return res.status(400).json({ error: 'type, duration, date are required' });
  const row = activities.create({ type, duration: parseInt(duration), notes, date });
  syncToGCS();
  res.status(201).json(row);
});

router.put('/:id', (req, res) => {
  const row = activities.update(parseInt(req.params.id), req.body);
  syncToGCS();
  res.json(row);
});

router.delete('/:id', (req, res) => {
  activities.delete(parseInt(req.params.id));
  syncToGCS();
  res.json({ ok: true });
});

module.exports = router;
