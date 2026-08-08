const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.get('/scoreboard', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT p.username,
             COALESCE(SUM(s.points_awarded), 0)::int AS score,
             COUNT(s.id)::int AS solved,
             MAX(s.solved_at) AS last_solve
      FROM players p
      LEFT JOIN solves s ON s.player_id = p.id
      GROUP BY p.id, p.username
      ORDER BY score DESC, last_solve ASC NULLS LAST, p.username ASC
    `);
    res.render('scoreboard', { title: 'Scoreboard', rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
