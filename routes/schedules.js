'use strict';
const express = require('express');
const router  = express.Router();
const { schedules } = require('../db');
const { syncToGCS } = require('../gcs');

router.get('/',            (_req, res) => res.json(schedules.getAll()));
router.get('/upcoming',    (_req, res) => res.json(schedules.getUpcoming()));
router.get('/date/:date',  (req, res)  => res.json(schedules.getByDate(req.params.date)));

router.post('/', (req, res) => {
  const { title, time, date } = req.body;
  if (!title || !time || !date)
    return res.status(400).json({ error: 'title, time, date are required' });
  const row = schedules.create(req.body);
  syncToGCS();
  res.status(201).json(row);
});

router.put('/:id', (req, res) => {
  const row = schedules.update(parseInt(req.params.id), req.body);
  syncToGCS();
  res.json(row);
});

router.delete('/:id', (req, res) => {
  schedules.delete(parseInt(req.params.id));
  syncToGCS();
  res.json({ ok: true });
});

module.exports = router;
