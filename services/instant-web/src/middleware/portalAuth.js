const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { pool, query } = require('../db');
const config = require('../config');

// Each portal (customer/employee/admin) gets its own session cookie, scoped
// by cookie path to the browser-visible mount point (behind the reverse
// proxy that is `/company/<portal>`), its own Postgres-backed session table,
// and its own secret. A customer session cookie is never sent to, and never
// grants, employee or admin routes - these are three separate trust
// boundaries, not one shared login.
function buildPortalAuth({ role, cookieName, cookiePath, secret, tableName }) {
  const sessionMiddleware = session({
    store: new pgSession({ pool, tableName, createTableIfMissing: false }),
    name: cookieName,
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: cookiePath,
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  });

  async function attachUser(req, res, next) {
    req.companyUser = null;
    try {
      if (req.session && req.session.userId) {
        const { rows } = await query(
          `SELECT id, name, email, role, department, notes, created_at,
                  loyalty_points, email_notifications_enabled, notification_pref_source,
                  avatar_filename, avatar_flagged, welcome_bonus_claims
           FROM company_users WHERE id = $1 AND role = $2`,
          [req.session.userId, role]
        );
        req.companyUser = rows[0] || null;
      }
    } catch (err) {
      return next(err);
    }
    res.locals.companyUser = req.companyUser;
    res.locals.portal = role;
    next();
  }

  function requireAuth(req, res, next) {
    if (!req.companyUser) {
      req.session.returnTo = req.originalUrl;
      return res.redirect(`${cookiePath}/login`);
    }
    next();
  }

  return { sessionMiddleware, attachUser, requireAuth };
}

const customerAuth = buildPortalAuth({
  role: 'customer',
  cookieName: 'customer_sid',
  cookiePath: '/company/portal',
  secret: config.sessionSecrets.customer,
  tableName: 'customer_sessions',
});

const employeeAuth = buildPortalAuth({
  role: 'employee',
  cookieName: 'employee_sid',
  cookiePath: '/company/employee',
  secret: config.sessionSecrets.employee,
  tableName: 'employee_sessions',
});

const adminAuth = buildPortalAuth({
  role: 'admin',
  cookieName: 'company_admin_sid',
  cookiePath: '/company/admin',
  secret: config.sessionSecrets.admin,
  tableName: 'admin_sessions',
});

module.exports = { customerAuth, employeeAuth, adminAuth };
