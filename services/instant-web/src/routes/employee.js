const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { employeeAuth } = require('../middleware/portalAuth');
const { ensureCsrfToken, verifyCsrfToken } = require('../middleware/csrf');
const logger = require('../logger');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

router.use(employeeAuth.sessionMiddleware, employeeAuth.attachUser, ensureCsrfToken);

const NAV_GUEST = [{ href: '/company/', label: 'Instant.com' }, { href: '/company/employee/login', label: 'Employee Login' }];
const NAV_AUTH = [
  { href: '/company/', label: 'Instant.com' },
  { href: '/company/employee/dashboard', label: 'Dashboard' },
  { href: '/company/employee/directory', label: 'Directory' },
  { href: '/company/employee/documents', label: 'Documents' },
  { href: '/company/employee/files', label: 'Files' },
  { href: '/company/employee/tickets', label: 'Tickets' },
  { href: '/company/employee/analytics', label: 'Analytics' },
];

router.use((req, res, next) => {
  res.locals.brandSuffix = 'Employee Portal';
  res.locals.navItems = req.companyUser ? NAV_AUTH : NAV_GUEST;
  res.locals.sessionUserLabel = req.companyUser ? req.companyUser.name : null;
  res.locals.logoutAction = '/company/employee/logout';
  next();
});

router.get('/login', (req, res) => {
  if (req.companyUser) return res.redirect('/company/employee/dashboard');
  res.render('employee/login', { title: 'Employee Login', error: null, formValues: {} });
});

router.post('/login', authLimiter, verifyCsrfToken, async (req, res, next) => {
  const { email = '', password = '' } = req.body;
  try {
    const { rows } = await query(
      `SELECT id, password_hash FROM company_users WHERE email = $1 AND role = 'employee'`,
      [email]
    );
    const user = rows[0];
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!valid) {
      logger.warn('employee_login_failed', { email });
      return res.status(401).render('employee/login', { title: 'Employee Login', error: 'Invalid email or password.', formValues: { email } });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      logger.info('employee_login_succeeded', { userId: user.id });
      const returnTo = req.session.returnTo || '/company/employee/dashboard';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', verifyCsrfToken, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('employee_sid', { path: '/company/employee' });
    res.redirect('/company/employee/login');
  });
});

router.get('/dashboard', employeeAuth.requireAuth, async (req, res, next) => {
  try {
    const { rows: openTickets } = await query(`SELECT COUNT(*)::int AS n FROM support_tickets WHERE status = 'open'`);
    const { rows: docCount } = await query('SELECT COUNT(*)::int AS n FROM documents WHERE employee_id = $1', [req.companyUser.id]);
    res.render('employee/dashboard', { title: 'Dashboard', openTickets: openTickets[0].n, docCount: docCount[0].n });
  } catch (err) {
    next(err);
  }
});

router.get('/directory', employeeAuth.requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT name, email, role, department FROM company_users WHERE role IN ('employee', 'admin') ORDER BY name ASC`
    );
    res.render('employee/directory', { title: 'Directory', people: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/documents', employeeAuth.requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, filename, description, uploaded_at FROM documents WHERE employee_id = $1 ORDER BY uploaded_at DESC',
      [req.companyUser.id]
    );
    res.render('employee/documents', { title: 'Documents', documents: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/files', employeeAuth.requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, filename, description, uploaded_at FROM documents WHERE employee_id = $1 ORDER BY filename ASC',
      [req.companyUser.id]
    );
    res.render('employee/files', { title: 'Files', documents: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/upload', employeeAuth.requireAuth, (req, res) => {
  res.render('employee/upload', { title: 'Upload Document', error: null });
});

router.post('/upload', employeeAuth.requireAuth, verifyCsrfToken, async (req, res, next) => {
  const { filename = '', description = '' } = req.body;
  if (filename.trim().length < 3) {
    return res.status(400).render('employee/upload', { title: 'Upload Document', error: 'Please provide a filename.' });
  }
  try {
    await query(
      'INSERT INTO documents (employee_id, filename, description) VALUES ($1, $2, $3)',
      [req.companyUser.id, filename.trim(), description.trim()]
    );
    logger.info('document_uploaded', { userId: req.companyUser.id });
    res.redirect('/company/employee/documents');
  } catch (err) {
    next(err);
  }
});

router.get('/tickets', employeeAuth.requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT t.id, t.subject, t.message, t.status, t.created_at, u.name AS customer_name
      FROM support_tickets t JOIN company_users u ON u.id = t.customer_id
      ORDER BY t.created_at DESC
    `);
    res.render('employee/tickets', { title: 'Support Tickets', tickets: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics', employeeAuth.requireAuth, async (req, res, next) => {
  try {
    const [{ rows: customers }, { rows: revenue }, { rows: tickets }] = await Promise.all([
      query(`SELECT COUNT(*)::int AS n FROM company_users WHERE role = 'customer'`),
      query('SELECT COALESCE(SUM(total_cents),0)::int AS total FROM orders'),
      query(`SELECT COUNT(*)::int AS n FROM support_tickets WHERE status = 'open'`),
    ]);
    res.render('employee/analytics', {
      title: 'Analytics',
      customerCount: customers[0].n,
      totalRevenueCents: revenue[0].total,
      openTickets: tickets[0].n,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
