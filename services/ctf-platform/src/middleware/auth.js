const { query } = require('../db');

async function attachPlayer(req, res, next) {
  req.player = null;
  try {
    if (req.session && req.session.playerId) {
      const { rows } = await query(
        'SELECT id, username, email, is_admin, created_at FROM players WHERE id = $1',
        [req.session.playerId]
      );
      req.player = rows[0] || null;
    }
  } catch (err) {
    return next(err);
  }
  res.locals.player = req.player;
  next();
}

function requireAuth(req, res, next) {
  if (!req.player) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.player) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  if (!req.player.is_admin) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'You do not have permission to view this page.',
    });
  }
  next();
}

module.exports = { attachPlayer, requireAuth, requireAdmin };
