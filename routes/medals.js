'use strict';
const express = require('express');
const router  = express.Router();
const { medals }    = require('../db');
const { syncToGCS } = require('../gcs');

router.get('/', (_req, res) => res.json(medals.getAll()));

router.get('/:id', (req, res) => {
  const row = medals.getById(parseInt(req.params.id));
  if (!row) return res.status(404).json({ error: 'Medal not found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const row = medals.create(req.body);
  syncToGCS();
  res.status(201).json(row);
});

router.put('/:id', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const row = medals.update(parseInt(req.params.id), req.body);
  syncToGCS();
  res.json(row);
});

router.post('/:id/log', (req, res) => {
  const row = medals.logToday(parseInt(req.params.id));
  if (!row) return res.status(404).json({ error: 'Medal not found' });
  syncToGCS();
  res.json(row);
});

router.delete('/:id', (req, res) => {
  medals.delete(parseInt(req.params.id));
  syncToGCS();
  res.json({ ok: true });
});


module.exports = router;
