const express = require('express');
const router = express.Router();
const { todos } = require('../db');

router.get('/', (req, res) => res.json(todos.getAll()));
router.get('/pending', (req, res) => res.json(todos.getPending()));

router.post('/', (req, res) => {
  try {
    const data = todos.create(req.body);
    res.status(201).json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const data = todos.update(req.params.id, req.body);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/complete', (req, res) => {
  try {
    const data = todos.complete(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  todos.delete(req.params.id);
  res.status(204).send();
});

module.exports = router;
