const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { customerAuth } = require('../middleware/portalAuth');
const { ensureCsrfToken, verifyCsrfToken } = require('../middleware/csrf');
const logger = require('../logger');
const config = require('../config');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.use(customerAuth.sessionMiddleware, customerAuth.attachUser, ensureCsrfToken);

const NAV_GUEST = [
  { href: '/company/', label: 'Instant.com' },
  { href: '/company/portal/login', label: 'Login' },
  { href: '/company/portal/register', label: 'Register' },
];
const NAV_AUTH = [
  { href: '/company/', label: 'Instant.com' },
  { href: '/company/portal/dashboard', label: 'Dashboard' },
  { href: '/company/portal/orders', label: 'Orders' },
  { href: '/company/portal/invoices', label: 'Invoices' },
  { href: '/company/portal/documents', label: 'Documents' },
  { href: '/company/portal/support', label: 'Support' },
  { href: '/company/portal/settings', label: 'Settings' },
];

router.use((req, res, next) => {
  res.locals.brandSuffix = 'Customer Portal';
  res.locals.navItems = req.companyUser ? NAV_AUTH : NAV_GUEST;
  res.locals.sessionUserLabel = req.companyUser ? req.companyUser.name : null;
  res.locals.logoutAction = '/company/portal/logout';
  next();
});

router.get('/register', (req, res) => {
  if (req.companyUser) return res.redirect('/company/portal/dashboard');
  res.render('portal/register', { title: 'Create your account', error: null, formValues: {} });
});

router.post('/register', authLimiter, verifyCsrfToken, async (req, res, next) => {
  const { name = '', email = '', password = '', confirm_password = '' } = req.body;
  const render = (error) =>
    res.status(400).render('portal/register', { title: 'Create your account', error, formValues: { name, email } });

  if (name.trim().length < 2) return render('Please enter your name.');
  if (!EMAIL_RE.test(email)) return render('Please enter a valid email address.');
  if (password.length < 8) return render('Password must be at least 8 characters.');
  if (password !== confirm_password) return render('Passwords do not match.');

  try {
    const existing = await query('SELECT id FROM company_users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return render('That email is already registered.');

    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO company_users (name, email, password_hash, role) VALUES ($1,$2,$3,'customer') RETURNING id`,
      [name, email, passwordHash]
    );

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = rows[0].id;
      logger.info('customer_registered', { userId: rows[0].id });
      res.redirect('/company/portal/dashboard');
    });
  } catch (err) {
    next(err);
  }
});

router.get('/login', (req, res) => {
  if (req.companyUser) return res.redirect('/company/portal/dashboard');
  res.render('portal/login', { title: 'Customer Login', error: null, formValues: {} });
});

router.post('/login', authLimiter, verifyCsrfToken, async (req, res, next) => {
  const { email = '', password = '' } = req.body;
  try {
    const { rows } = await query(
      `SELECT id, password_hash FROM company_users WHERE email = $1 AND role = 'customer'`,
      [email]
    );
    const user = rows[0];
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!valid) {
      logger.warn('customer_login_failed', { email });
      return res.status(401).render('portal/login', { title: 'Customer Login', error: 'Invalid email or password.', formValues: { email } });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      logger.info('customer_login_succeeded', { userId: user.id });
      const returnTo = req.session.returnTo || '/company/portal/dashboard';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  } catch (err) {
    next(err);
  }
});

// Challenge 04 (Authentication Bypass). A deprecated login flow kept
// mounted for "backwards compatibility" (per the debug endpoint's notes -
// see routes/public.js) and never updated to use the same parameterized
// queries and CSRF protection as the real /login above. Not linked from
// any page; discoverable via robots.txt or generic path guessing.
router.get('/legacy-login', (req, res) => {
  if (req.companyUser) return res.redirect('/company/portal/dashboard');
  res.render('portal/legacy_login', { title: 'Legacy Customer Login', error: null, formValues: {} });
});

router.post('/legacy-login', authLimiter, async (req, res, next) => {
  const { email = '', password = '' } = req.body;
  try {
    // Raw string concatenation, no parameterization, no CSRF check - a
    // single quote in `email` breaks out of the literal and a trailing
    // `-- ` comments out the password/role checks entirely, authenticating
    // as whichever row the injected WHERE clause matches.
    const sql = `SELECT id, name, email, role FROM company_users
       WHERE email = '${email}' AND password_hash = '${password}' AND role = 'customer' LIMIT 1`;
    const { rows } = await query(sql);
    const user = rows[0];

    if (!user) {
      logger.warn('legacy_login_failed', { email });
      return res.status(401).render('portal/legacy_login', {
        title: 'Legacy Customer Login',
        error: 'Invalid email or password.',
        formValues: { email },
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      logger.warn('legacy_login_succeeded', { userId: user.id });
      res.redirect('/company/portal/dashboard');
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', verifyCsrfToken, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('customer_sid', { path: '/company/portal' });
    res.redirect('/company/portal/login');
  });
});

router.get('/dashboard', customerAuth.requireAuth, async (req, res, next) => {
  try {
    const { rows: orderStats } = await query(
      `SELECT COUNT(*)::int AS order_count, COALESCE(SUM(total_cents),0)::int AS total_cents
       FROM orders WHERE customer_id = $1`,
      [req.companyUser.id]
    );
    const { rows: openTickets } = await query(
      `SELECT COUNT(*)::int AS n FROM support_tickets WHERE customer_id = $1 AND status = 'open'`,
      [req.companyUser.id]
    );
    res.render('portal/dashboard', {
      title: 'Dashboard',
      orderCount: orderStats[0].order_count,
      totalCents: orderStats[0].total_cents,
      openTickets: openTickets[0].n,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/profile', customerAuth.requireAuth, (req, res) => {
  res.render('portal/profile', { title: 'Profile' });
});

router.get('/orders', customerAuth.requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, status, total_cents, created_at FROM orders WHERE customer_id = $1 ORDER BY created_at DESC',
      [req.companyUser.id]
    );
    res.render('portal/orders', { title: 'Orders', orders: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/invoices', customerAuth.requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT i.id, i.invoice_number, i.amount_cents, i.status, i.issued_at
       FROM invoices i JOIN orders o ON o.id = i.order_id
       WHERE o.customer_id = $1 ORDER BY i.issued_at DESC`,
      [req.companyUser.id]
    );
    res.render('portal/invoices', { title: 'Invoices', invoices: rows });
  } catch (err) {
    next(err);
  }
});

// Synthetic, always-available reports - not customer-specific, just
// realistic filler representing generated account reports.
const REPORT_FILES = ['welcome-guide.txt', 'usage-report-q3.txt', 'invoice-summary-2024.txt'];

router.get('/documents', customerAuth.requireAuth, (req, res) => {
  res.render('portal/documents', { title: 'Documents', files: REPORT_FILES });
});

router.get('/documents/download', customerAuth.requireAuth, (req, res) => {
  // Challenge 03 (Path Traversal). Intended restriction: stay inside
  // challengeData.documentsDir. Actual check below is against the parent
  // challengeData.root instead - a realistic off-by-one-directory mistake
  // (the kind that happens when a "reports" feature and a later "protected
  // internal files" folder get added to the same parent directory and the
  // check is copy-pasted without updating which directory it guards).
  // Either way this stays fully inside the app's own bundled challenge-data
  // tree, baked into the image - there is no host filesystem, Docker
  // socket, or credential file reachable from here.
  const requested = (req.query.file || '').toString();
  const resolved = path.resolve(config.challengeData.documentsDir, requested);

  if (!resolved.startsWith(config.challengeData.root)) {
    return res.status(400).render('error', {
      title: 'Invalid Request',
      message: 'That file parameter is not valid.',
    });
  }

  res.sendFile(resolved, (err) => {
    if (err) {
      res.status(404).render('error', { title: 'Not Found', message: 'File not found.' });
    }
  });
});

// Challenge 05 (XSS). The ticket MESSAGE is rendered unescaped on both this
// page (portal/support.ejs) and the employee ticket queue
// (employee/tickets.ejs) - a real stored XSS, genuinely exploitable against
// any real browser that views either page, not just simulated. There is no
// automated "agent" browser in this environment to detonate a payload
// against, so as a practical, honestly-documented stand-in, the flag is
// revealed directly on the submitting customer's own ticket list the moment
// their ticket is detected (at creation time) to contain an actual
// <script> tag - i.e. exactly the payload shape that would execute given
// the missing output encoding, whether or not anyone else ever views it.
async function loadTickets(customerId) {
  const { rows } = await query(
    'SELECT id, subject, message, status, flagged, created_at FROM support_tickets WHERE customer_id = $1 ORDER BY created_at DESC',
    [customerId]
  );
  return rows.map((t) => ({ ...t, flagValue: t.flagged ? config.flags.xss : null }));
}

router.get('/support', customerAuth.requireAuth, async (req, res, next) => {
  try {
    const tickets = await loadTickets(req.companyUser.id);
    res.render('portal/support', { title: 'Support', tickets, formError: null });
  } catch (err) {
    next(err);
  }
});

router.post('/support', customerAuth.requireAuth, verifyCsrfToken, async (req, res, next) => {
  const { subject = '', message = '' } = req.body;
  try {
    if (subject.trim().length < 3 || message.trim().length < 3) {
      const tickets = await loadTickets(req.companyUser.id);
      return res.status(400).render('portal/support', {
        title: 'Support',
        tickets,
        formError: 'Please provide a subject and message.',
      });
    }
    const containsScriptTag = /<script/i.test(subject) || /<script/i.test(message);
    await query(
      `INSERT INTO support_tickets (customer_id, subject, message, status, flagged) VALUES ($1,$2,$3,'open',$4)`,
      [req.companyUser.id, subject.trim(), message.trim(), containsScriptTag]
    );
    logger.info('support_ticket_created', { userId: req.companyUser.id, flagged: containsScriptTag });
    res.redirect('/company/portal/support');
  } catch (err) {
    next(err);
  }
});

router.get('/settings', customerAuth.requireAuth, (req, res) => {
  res.render('portal/settings', { title: 'Settings' });
});

module.exports = router;
