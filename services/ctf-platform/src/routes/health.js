const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.status(200).json({ status: 'ok', service: 'ctf-platform', db: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error', service: 'ctf-platform', db: 'unreachable' });
  }
});

module.exports = router;
