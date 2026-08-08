const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT COALESCE(SUM(points_awarded), 0)::int AS score, COUNT(*)::int AS solved_count
       FROM solves WHERE player_id = $1`,
      [req.player.id]
    );
    res.render('profile', {
      title: 'Profile',
      score: rows[0].score,
      solvedCount: rows[0].solved_count,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
