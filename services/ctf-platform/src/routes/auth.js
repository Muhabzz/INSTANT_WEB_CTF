const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { verifyCsrfToken } = require('../middleware/csrf');
const logger = require('../logger');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/register', (req, res) => {
  if (req.player) return res.redirect('/dashboard');
  res.render('register', { title: 'Register', error: null, formValues: {} });
});

router.post('/register', authLimiter, verifyCsrfToken, async (req, res, next) => {
  const { username = '', email = '', password = '', confirm_password = '' } = req.body;

  const render = (error) =>
    res.status(400).render('register', {
      title: 'Register',
      error,
      formValues: { username, email },
    });

  if (!USERNAME_RE.test(username)) {
    return render('Username must be 3-32 characters: letters, numbers, underscore only.');
  }
  if (!EMAIL_RE.test(email)) {
    return render('Please enter a valid email address.');
  }
  if (password.length < 8) {
    return render('Password must be at least 8 characters.');
  }
  if (password !== confirm_password) {
    return render('Passwords do not match.');
  }

  try {
    const existing = await query(
      'SELECT id FROM players WHERE username = $1 OR email = $2',
      [username, email]
    );
    if (existing.rows.length > 0) {
      return render('That username or email is already registered.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO players (username, email, password_hash, is_admin)
       VALUES ($1, $2, $3, FALSE) RETURNING id`,
      [username, email, passwordHash]
    );

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.playerId = rows[0].id;
      logger.info('player_registered', { playerId: rows[0].id, username });
      res.redirect('/dashboard');
    });
  } catch (err) {
    next(err);
  }
});

router.get('/login', (req, res) => {
  if (req.player) return res.redirect('/dashboard');
  res.render('login', { title: 'Login', error: null, formValues: {} });
});

router.post('/login', authLimiter, verifyCsrfToken, async (req, res, next) => {
  const { username = '', password = '' } = req.body;
  try {
    const { rows } = await query(
      'SELECT id, username, password_hash FROM players WHERE username = $1',
      [username]
    );
    const player = rows[0];
    const valid = player ? await bcrypt.compare(password, player.password_hash) : false;

    if (!valid) {
      logger.warn('login_failed', { username });
      return res.status(401).render('login', {
        title: 'Login',
        error: 'Invalid username or password.',
        formValues: { username },
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.playerId = player.id;
      logger.info('login_succeeded', { playerId: player.id, username: player.username });
      const returnTo = req.session.returnTo || '/dashboard';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', verifyCsrfToken, (req, res, next) => {
  const playerId = req.player && req.player.id;
  req.session.destroy((err) => {
    if (err) return next(err);
    logger.info('logout', { playerId });
    res.clearCookie('platform_sid');
    res.redirect('/');
  });
});

module.exports = router;
