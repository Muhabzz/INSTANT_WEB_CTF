const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { adminAuth } = require('../middleware/portalAuth');
const { ensureCsrfToken, verifyCsrfToken } = require('../middleware/csrf');
const config = require('../config');
const logger = require('../logger');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

router.use(adminAuth.sessionMiddleware, adminAuth.attachUser, ensureCsrfToken);

const NAV_GUEST = [{ href: '/company/', label: 'Instant.com' }, { href: '/company/admin/login', label: 'Admin Login' }];
const NAV_AUTH = [
  { href: '/company/', label: 'Instant.com' },
  { href: '/company/admin/dashboard', label: 'Dashboard' },
  { href: '/company/admin/users', label: 'Users' },
  { href: '/company/admin/orders', label: 'Orders' },
  { href: '/company/admin/analytics', label: 'Analytics' },
  { href: '/company/admin/tools', label: 'Tools' },
  { href: '/company/admin/settings', label: 'Settings' },
];

router.use((req, res, next) => {
  res.locals.brandSuffix = 'Company Admin';
  res.locals.navItems = req.companyUser ? NAV_AUTH : NAV_GUEST;
  res.locals.sessionUserLabel = req.companyUser ? req.companyUser.name : null;
  res.locals.logoutAction = '/company/admin/logout';
  next();
});

router.get('/login', (req, res) => {
  if (req.companyUser) return res.redirect('/company/admin/dashboard');
  res.render('admin/login', { title: 'Admin Login', error: null, formValues: {} });
});

router.post('/login', authLimiter, verifyCsrfToken, async (req, res, next) => {
  const { email = '', password = '' } = req.body;
  try {
    const { rows } = await query(
      `SELECT id, password_hash FROM company_users WHERE email = $1 AND role = 'admin'`,
      [email]
    );
    const user = rows[0];
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!valid) {
      logger.warn('company_admin_login_failed', { email });
      return res.status(401).render('admin/login', { title: 'Admin Login', error: 'Invalid email or password.', formValues: { email } });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      logger.info('company_admin_login_succeeded', { userId: user.id });
      const returnTo = req.session.returnTo || '/company/admin/dashboard';
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
    res.clearCookie('company_admin_sid', { path: '/company/admin' });
    res.redirect('/company/admin/login');
  });
});

router.get('/dashboard', adminAuth.requireAuth, async (req, res, next) => {
  try {
    const [{ rows: users }, { rows: orders }, { rows: revenue }] = await Promise.all([
      query('SELECT COUNT(*)::int AS n FROM company_users'),
      query('SELECT COUNT(*)::int AS n FROM orders'),
      query('SELECT COALESCE(SUM(total_cents),0)::int AS total FROM orders'),
    ]);
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      userCount: users[0].n,
      orderCount: orders[0].n,
      totalRevenueCents: revenue[0].total,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/users', adminAuth.requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, name, email, role, department, created_at FROM company_users ORDER BY id ASC'
    );
    res.render('admin/users', { title: 'Users', users: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/orders', adminAuth.requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT o.id, o.status, o.total_cents, o.created_at, u.name AS customer_name
      FROM orders o JOIN company_users u ON u.id = o.customer_id
      ORDER BY o.created_at DESC
    `);
    res.render('admin/orders', { title: 'Orders', orders: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics', adminAuth.requireAuth, async (req, res, next) => {
  try {
    const [{ rows: byRole }, { rows: revenue }, { rows: tickets }] = await Promise.all([
      query('SELECT role, COUNT(*)::int AS n FROM company_users GROUP BY role ORDER BY role'),
      query('SELECT COALESCE(SUM(total_cents),0)::int AS total FROM orders'),
      query(`SELECT status, COUNT(*)::int AS n FROM support_tickets GROUP BY status`),
    ]);
    res.render('admin/analytics', {
      title: 'Analytics',
      byRole,
      totalRevenueCents: revenue[0].total,
      ticketsByStatus: tickets,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/tools', adminAuth.requireAuth, async (req, res, next) => {
  const services = [
    { name: 'internal-api', url: `${config.internal.internalApiUrl}/health` },
    { name: 'template-service', url: `${config.internal.templateServiceUrl}/health` },
    { name: 'infra-service', url: `${config.internal.infraServiceUrl}/health` },
  ];

  const results = await Promise.all(
    services.map(async (s) => {
      try {
        const r = await fetch(s.url, { signal: AbortSignal.timeout(3000) });
        const body = await r.json();
        return { name: s.name, status: body.status || 'unknown', detail: body };
      } catch (err) {
        return { name: s.name, status: 'unreachable', detail: { error: err.message } };
      }
    })
  );

  res.render('admin/tools', { title: 'Internal Tools', results });
});

router.get('/settings', adminAuth.requireAuth, (req, res) => {
  res.render('admin/settings', { title: 'Settings' });
});

module.exports = router;
