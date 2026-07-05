'use strict';
const express       = require('express');
const router        = express.Router();
const { milestones } = require('../db');
const { syncToGCS }  = require('../gcs');

// GET all milestones
router.get('/', (_req, res) => res.json(milestones.getAll()));

// GET single milestone
router.get('/:id', (req, res) => {
  const row = milestones.getById(parseInt(req.params.id));
  if (!row) return res.status(404).json({ error: 'Milestone not found' });
  res.json(row);
});

// POST create milestone
router.post('/', (req, res) => {
  const { title, category, target_metric, target_value } = req.body;
  if (!title || !category || !target_metric || target_value == null)
    return res.status(400).json({ error: 'title, category, target_metric, and target_value are required' });
  const row = milestones.create(req.body);
  syncToGCS();
  res.status(201).json(row);
});

// PUT update milestone
router.put('/:id', (req, res) => {
  const { title, category, target_metric, target_value } = req.body;
  if (!title || !category || !target_metric || target_value == null)
    return res.status(400).json({ error: 'title, category, target_metric, and target_value are required' });
  const row = milestones.update(parseInt(req.params.id), req.body);
  syncToGCS();
  res.json(row);
});

// DELETE milestone
router.delete('/:id', (req, res) => {
  milestones.delete(parseInt(req.params.id));
  syncToGCS();
  res.json({ ok: true });
});

module.exports = router;
