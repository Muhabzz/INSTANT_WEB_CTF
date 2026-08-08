const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    const [{ rows: totals }, { rows: solved }, { rows: recent }] = await Promise.all([
      query('SELECT COUNT(*)::int AS total FROM challenges WHERE enabled = TRUE'),
      query(
        `SELECT COALESCE(SUM(points_awarded), 0)::int AS score, COUNT(*)::int AS solved_count
         FROM solves WHERE player_id = $1`,
        [req.player.id]
      ),
      query(
        `SELECT c.title, c.slug, s.points_awarded, s.solved_at
         FROM solves s JOIN challenges c ON c.id = s.challenge_id
         WHERE s.player_id = $1
         ORDER BY s.solved_at DESC LIMIT 5`,
        [req.player.id]
      ),
    ]);

    res.render('dashboard', {
      title: 'Dashboard',
      totalChallenges: totals[0].total,
      score: solved[0].score,
      solvedCount: solved[0].solved_count,
      recentSolves: recent,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
