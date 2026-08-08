const express = require('express');
const { query } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { verifyCsrfToken } = require('../middleware/csrf');
const { seed } = require('../seed');
const { reset } = require('../reset');
const logger = require('../logger');

const router = express.Router();
const COMPANY_HEALTH_URL = process.env.COMPANY_HEALTH_URL || 'http://instant-web:3001/health';

router.use(requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const [{ rows: playerCount }, { rows: challengeCount }, { rows: solveCount }] = await Promise.all([
      query('SELECT COUNT(*)::int AS n FROM players'),
      query('SELECT COUNT(*)::int AS n FROM challenges'),
      query('SELECT COUNT(*)::int AS n FROM solves'),
    ]);
    res.render('admin/index', {
      title: 'Admin',
      playerCount: playerCount[0].n,
      challengeCount: challengeCount[0].n,
      solveCount: solveCount[0].n,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/players', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT p.id, p.username, p.email, p.is_admin, p.created_at,
             COALESCE(SUM(s.points_awarded), 0)::int AS score,
             COUNT(s.id)::int AS solved
      FROM players p
      LEFT JOIN solves s ON s.player_id = p.id
      GROUP BY p.id
      ORDER BY p.id ASC
    `);
    res.render('admin/players', { title: 'Admin - Players', players: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/challenges', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, slug, title, category, difficulty, points, enabled, order_index FROM challenges ORDER BY order_index ASC'
    );
    res.render('admin/challenges', { title: 'Admin - Challenges', challenges: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/challenges/:id/toggle', verifyCsrfToken, async (req, res, next) => {
  try {
    await query('UPDATE challenges SET enabled = NOT enabled WHERE id = $1', [req.params.id]);
    logger.info('challenge_toggled', { adminId: req.player.id, challengeId: req.params.id });
    res.redirect('/admin/challenges');
  } catch (err) {
    next(err);
  }
});

router.get('/solves', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT s.id, p.username, c.title AS challenge_title, s.points_awarded, s.solved_at
      FROM solves s
      JOIN players p ON p.id = s.player_id
      JOIN challenges c ON c.id = s.challenge_id
      ORDER BY s.solved_at DESC
      LIMIT 200
    `);
    res.render('admin/solves', { title: 'Admin - Solves', solves: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/health', async (req, res, next) => {
  let companyHealth = { status: 'unknown' };
  try {
    const r = await fetch(COMPANY_HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    companyHealth = await r.json();
  } catch (err) {
    companyHealth = { status: 'unreachable', error: err.message };
  }

  let dbHealth = 'ok';
  try {
    await query('SELECT 1');
  } catch (err) {
    dbHealth = 'error';
  }

  res.render('admin/health', {
    title: 'Admin - Health',
    dbHealth,
    companyHealth,
  });
});

router.post('/seed', verifyCsrfToken, async (req, res, next) => {
  try {
    await seed();
    logger.info('admin_seed_triggered', { adminId: req.player.id });
    res.render('admin/index', {
      title: 'Admin',
      flash: 'Seed completed successfully.',
      playerCount: (await query('SELECT COUNT(*)::int AS n FROM players')).rows[0].n,
      challengeCount: (await query('SELECT COUNT(*)::int AS n FROM challenges')).rows[0].n,
      solveCount: (await query('SELECT COUNT(*)::int AS n FROM solves')).rows[0].n,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/reset', verifyCsrfToken, async (req, res, next) => {
  if (req.body.confirm !== 'RESET') {
    return res.status(400).render('error', {
      title: 'Reset Cancelled',
      message: 'Reset was not confirmed. Go back and type RESET to confirm.',
    });
  }
  try {
    logger.warn('admin_reset_triggered', { adminId: req.player.id });
    await reset();
    req.session.destroy(() => {
      res.redirect('/login');
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
