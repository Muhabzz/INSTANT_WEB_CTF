const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { verifyCsrfToken } = require('../middleware/csrf');
const logger = require('../logger');

const router = express.Router();

function hashFlag(flag) {
  return crypto.createHash('sha256').update(flag, 'utf8').digest('hex');
}

router.get('/challenges', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.slug, c.title, c.category, c.difficulty, c.points, c.order_index,
              (s.id IS NOT NULL) AS solved
       FROM challenges c
       LEFT JOIN solves s ON s.challenge_id = c.id AND s.player_id = $1
       WHERE c.enabled = TRUE
       ORDER BY c.order_index ASC`,
      [req.player.id]
    );
    res.render('challenges', { title: 'Challenges', challenges: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/challenges/:slug', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.slug, c.title, c.description, c.category, c.difficulty, c.points,
              (s.id IS NOT NULL) AS solved
       FROM challenges c
       LEFT JOIN solves s ON s.challenge_id = c.id AND s.player_id = $1
       WHERE c.slug = $2 AND c.enabled = TRUE`,
      [req.player.id, req.params.slug]
    );
    const challenge = rows[0];
    if (!challenge) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Challenge not found.' });
    }
    res.render('challenge_detail', {
      title: challenge.title,
      challenge,
      result: null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/challenges/:slug/submit', requireAuth, verifyCsrfToken, async (req, res, next) => {
  const submitted = (req.body.flag || '').trim();
  try {
    const { rows } = await query(
      `SELECT id, slug, title, description, category, difficulty, points, flag_hash
       FROM challenges WHERE slug = $1 AND enabled = TRUE`,
      [req.params.slug]
    );
    const challenge = rows[0];
    if (!challenge) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Challenge not found.' });
    }

    const correct = submitted.length > 0 && hashFlag(submitted) === challenge.flag_hash;

    await query(
      'INSERT INTO submission_log (player_id, challenge_id, correct) VALUES ($1, $2, $3)',
      [req.player.id, challenge.id, correct]
    );

    let awarded = false;
    if (correct) {
      const insertResult = await query(
        `INSERT INTO solves (player_id, challenge_id, submitted_flag, points_awarded)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (player_id, challenge_id) DO NOTHING
         RETURNING id`,
        [req.player.id, challenge.id, submitted, challenge.points]
      );
      awarded = insertResult.rowCount > 0;
    }

    logger.info('flag_submission', {
      playerId: req.player.id,
      challengeSlug: challenge.slug,
      correct,
      awarded,
    });

    const { rows: solvedCheck } = await query(
      'SELECT id FROM solves WHERE player_id = $1 AND challenge_id = $2',
      [req.player.id, challenge.id]
    );

    res.render('challenge_detail', {
      title: challenge.title,
      challenge: { ...challenge, solved: solvedCheck.length > 0 },
      result: correct
        ? { ok: true, message: awarded ? `Correct! +${challenge.points} points.` : 'Correct — you already solved this challenge.' }
        : { ok: false, message: 'Incorrect flag. Try again.' },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
