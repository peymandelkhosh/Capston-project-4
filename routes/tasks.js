'use strict';
const express = require('express');
const router  = express.Router();
const { tasks }    = require('../db');
const { syncToGCS} = require('../gcs');

router.get('/',        (_req, res) => res.json(tasks.getAll()));
router.get('/pending', (_req, res) => res.json(tasks.getPending()));

router.post('/', (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const row = tasks.create(req.body);
  syncToGCS();
  res.status(201).json(row);
});

router.put('/:id', (req, res) => {
  const row = tasks.update(parseInt(req.params.id), req.body);
  syncToGCS();
  res.json(row);
});

router.patch('/:id/complete', (req, res) => {
  const row = tasks.complete(parseInt(req.params.id));
  syncToGCS();
  res.json(row);
});

router.delete('/:id', (req, res) => {
  tasks.delete(parseInt(req.params.id));
  syncToGCS();
  res.json({ ok: true });
});

module.exports = router;
