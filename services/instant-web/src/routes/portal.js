const path = require('path');
const fs = require('fs');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
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
  { href: '/company/portal/rewards', label: 'Rewards' },
  { href: '/company/portal/api-tokens', label: 'API Tokens' },
  { href: '/company/portal/integrations', label: 'Integrations' },
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
    const newCustomerId = rows[0].id;

    // Every new signup starts on the Starter plan, same as a real
    // self-service SaaS trial - this gives every customer a real order and
    // invoice of their own from day one (not just the one seeded demo
    // account), so their own Invoices page has a real, clickable
    // /invoices/:id link instead of an empty list. No internal_memo is set
    // here - that stays specific to the challenge 06 target invoice.
    const { rows: orderRows } = await query(
      `INSERT INTO orders (customer_id, status, total_cents) VALUES ($1,'paid',2900) RETURNING id`,
      [newCustomerId]
    );
    const starterOrderId = orderRows[0].id;
    await query(
      `INSERT INTO invoices (order_id, invoice_number, amount_cents, status)
       VALUES ($1,$2,$3,'paid')
       ON CONFLICT (invoice_number) DO NOTHING`,
      [starterOrderId, `INV-2026-${String(starterOrderId).padStart(4, '0')}`, 2900]
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
  res.render('portal/profile', {
    title: 'Profile',
    uploadError: null,
    avatarFlag: req.companyUser.avatar_flagged ? config.flags.fileUpload : null,
  });
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

// Challenge 06 (IDOR). Invoice ids are small sequential integers, visible
// in the invoice list above (and in this route's own URL). Intended
// restriction: only show an invoice belonging to the requesting customer.
// Actual query below looks up the invoice by id alone - it never joins
// back to orders.customer_id to check ownership, so any authenticated
// customer can view any other customer's invoice (including its
// internal_memo) just by changing the id in the URL. This is a missing
// authorization check, not a missing authentication check - the request is
// fully logged-in the whole time.
router.get('/invoices/:id', customerAuth.requireAuth, async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });
  }
  try {
    const { rows } = await query(
      `SELECT i.id, i.invoice_number, i.amount_cents, i.status, i.issued_at, i.internal_memo
       FROM invoices i WHERE i.id = $1`,
      [id]
    );
    const invoice = rows[0];
    if (!invoice) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });
    }
    res.render('portal/invoice_detail', { title: `Invoice ${invoice.invoice_number}`, invoice });
  } catch (err) {
    next(err);
  }
});

const RECEIPT_TEMPLATE_DENYLIST = /\/proc\/|\/etc\/shadow|\.ssh\/|docker\.sock/i;

// Challenge 11 (LFI). Receipts can be previewed in a few styles
// (standard/detailed/minimal) - the `template` param is meant to only ever
// select one of the .txt files in challengeData.receiptTemplatesDir.
// Ownership of the invoice itself IS checked correctly below (unlike
// challenge 06, this route is not also an IDOR) - the vulnerability is
// isolated to how the template file is located.
router.get('/invoices/:id/receipt', customerAuth.requireAuth, async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });
  }
  try {
    const { rows } = await query(
      `SELECT i.id, i.invoice_number, i.amount_cents, i.status
       FROM invoices i JOIN orders o ON o.id = i.order_id
       WHERE i.id = $1 AND o.customer_id = $2`,
      [id, req.companyUser.id]
    );
    const invoice = rows[0];
    if (!invoice) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });
    }

    const requestedTemplate = (req.query.template || 'standard').toString();
    const requestedPath = requestedTemplate.endsWith('.txt') ? requestedTemplate : `${requestedTemplate}.txt`;

    // Patched after an earlier pentest finding that flagged a couple of
    // obviously dangerous paths - doesn't address the underlying issue
    // below, which is that there is no containment/allowlist check at all.
    if (RECEIPT_TEMPLATE_DENYLIST.test(requestedPath)) {
      return res.status(400).render('error', { title: 'Invalid Request', message: 'That template is not valid.' });
    }

    // BUG: path.resolve() treats an absolute-path second argument as an
    // anchor that DISCARDS the base directory entirely (e.g.
    // path.resolve('/app/challenge-data/receipt-templates', '/etc/passwd')
    // === '/etc/passwd'), and relative `../` segments are never blocked
    // either since there is no `startsWith(receiptTemplatesDir)` check like
    // challenge 03 has. Both an absolute path and `../` traversal reach
    // outside receiptTemplatesDir - but since a `.txt` suffix is enforced
    // above whenever the caller doesn't already supply one, this stays
    // bounded to files that happen to end in `.txt` (which is exactly why
    // the challenge 11 target file is named `notes.txt`, not something
    // that would collide with a sensitive path like `/etc/shadow` or
    // `/proc/self/environ`, neither of which end in `.txt`).
    const resolved = path.resolve(config.challengeData.receiptTemplatesDir, requestedPath);

    fs.readFile(resolved, 'utf8', (err, template) => {
      if (err) {
        return res.status(404).render('error', { title: 'Not Found', message: 'Receipt template not found.' });
      }
      const rendered = template
        .replace(/{{invoice_number}}/g, invoice.invoice_number)
        .replace(/{{amount}}/g, `$${(invoice.amount_cents / 100).toFixed(2)}`)
        .replace(/{{status}}/g, invoice.status);
      res.type('text/plain').send(rendered);
    });
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
  res.render('portal/settings', {
    title: 'Settings',
    // Challenge 09 (CSRF). Shown only when this account's notification
    // preference was last changed via the unprotected legacy link path
    // below, rather than through this CSRF-protected form - proof the
    // state change happened without the form's synchronizer token.
    csrfFlag: req.companyUser.notification_pref_source === 'email_link' ? config.flags.csrf : null,
  });
});

router.post('/settings/notifications', customerAuth.requireAuth, verifyCsrfToken, async (req, res, next) => {
  const enabled = req.body.email_notifications === 'on';
  try {
    await query(
      `UPDATE company_users SET email_notifications_enabled = $1, notification_pref_source = 'settings_form' WHERE id = $2`,
      [enabled, req.companyUser.id]
    );
    logger.info('notification_pref_updated', { userId: req.companyUser.id, source: 'settings_form' });
    res.redirect('/company/portal/settings');
  } catch (err) {
    next(err);
  }
});

// Challenge 09 (CSRF). A one-click "unsubscribe from emails" link, the kind
// many transactional-email footers use so a recipient doesn't have to log
// in just to opt out. Realistic in isolation, but state-changing GET
// requests can't carry the synchronizer-token protection every POST form
// in this app uses (see middleware/csrf.js) - so this route intentionally
// has none, and mutates account state anyway. Any page (or bare <img>/
// <a> tag) that causes a logged-in customer's browser to load this URL
// changes their preference, no form submission or token required.
// Referenced from robots.txt (see routes/public.js) and from the settings
// page's own "email footer preview", same discovery pattern as challenges
// 01 and 04.
router.get('/settings/quick-unsubscribe', customerAuth.requireAuth, async (req, res, next) => {
  try {
    await query(
      `UPDATE company_users SET email_notifications_enabled = FALSE, notification_pref_source = 'email_link' WHERE id = $1`,
      [req.companyUser.id]
    );
    logger.info('notification_pref_updated', { userId: req.companyUser.id, source: 'email_link' });
    res.render('portal/unsubscribed', { title: 'Unsubscribed' });
  } catch (err) {
    next(err);
  }
});

// Challenge 08 (Business Logic). Loyalty points, redeemable for account
// credit. Intended business rule: a redemption must be a positive amount
// no larger than the current balance. See the POST handler below for what
// actually gets checked.
const LOYALTY_TIER_THRESHOLD = 100000;

router.get('/rewards', customerAuth.requireAuth, (req, res) => {
  const bonusClaims = req.companyUser.welcome_bonus_claims || 0;
  res.render('portal/rewards', {
    title: 'Rewards',
    balance: req.companyUser.loyalty_points,
    unlocked: req.companyUser.loyalty_points >= LOYALTY_TIER_THRESHOLD,
    flag: req.companyUser.loyalty_points >= LOYALTY_TIER_THRESHOLD ? config.flags.businessLogic : null,
    formError: null,
    bonusClaims,
    bonusError: null,
    raceFlag: bonusClaims >= 2 ? config.flags.raceCondition : null,
  });
});

router.post('/rewards/redeem', customerAuth.requireAuth, verifyCsrfToken, async (req, res, next) => {
  const points = parseInt(req.body.points, 10);
  const balance = req.companyUser.loyalty_points;

  // Bug: only checks the redemption doesn't exceed the current balance.
  // Never checks that `points` is positive, so a negative redemption
  // passes the `points > balance` check (any negative number is less than
  // a non-negative balance) and then *increases* the balance below, since
  // subtracting a negative number is addition.
  if (!Number.isInteger(points) || points > balance) {
    return res.status(400).render('portal/rewards', {
      title: 'Rewards',
      balance,
      unlocked: balance >= LOYALTY_TIER_THRESHOLD,
      flag: balance >= LOYALTY_TIER_THRESHOLD ? config.flags.businessLogic : null,
      formError: 'Enter a whole number of points, up to your current balance.',
    });
  }

  try {
    await query('UPDATE company_users SET loyalty_points = loyalty_points - $1 WHERE id = $2', [
      points,
      req.companyUser.id,
    ]);
    logger.info('loyalty_points_redeemed', { userId: req.companyUser.id, points });
    res.redirect('/company/portal/rewards');
  } catch (err) {
    next(err);
  }
});

// Challenge 12 (Race Condition). One-time signup bonus - the intended
// business rule is "claimable exactly once per account" (0 or 1). The
// check (read the current claim count) and the act (increment it) are two
// separate round-trips with no transaction, no row lock
// (`SELECT ... FOR UPDATE`), and no atomic compare-and-swap
// (`UPDATE ... SET welcome_bonus_claims = welcome_bonus_claims + 1 WHERE
// welcome_bonus_claims = 0`). The ~400ms delay between the check and the
// write is framed as a fraud-check lookup - a realistic reason a claim
// endpoint would pause - and exists to widen the window enough to
// reliably demonstrate this with ordinary concurrent tooling (a handful
// of parallel requests) instead of requiring sub-millisecond timing. The
// race itself is real: genuinely concurrent HTTP requests each run their
// own SELECT against the same pre-write value during that window: this is
// not a "repeat the request and pretend" shortcut - a single request, or
// requests sent one after another, always resolves to exactly one
// successful claim (see the accepted-values check below).
router.post('/rewards/claim-bonus', customerAuth.requireAuth, verifyCsrfToken, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT welcome_bonus_claims FROM company_users WHERE id = $1',
      [req.companyUser.id]
    );
    const alreadyClaimed = rows[0].welcome_bonus_claims > 0;

    await new Promise((resolve) => setTimeout(resolve, 400));

    let claims = rows[0].welcome_bonus_claims;
    let balance = req.companyUser.loyalty_points;
    let bonusError = null;

    if (alreadyClaimed) {
      bonusError = 'You have already claimed your welcome bonus.';
    } else {
      const { rows: updated } = await query(
        `UPDATE company_users
         SET loyalty_points = loyalty_points + 500,
             welcome_bonus_claims = welcome_bonus_claims + 1
         WHERE id = $1
         RETURNING loyalty_points, welcome_bonus_claims`,
        [req.companyUser.id]
      );
      claims = updated[0].welcome_bonus_claims;
      balance = updated[0].loyalty_points;
      logger.info('welcome_bonus_claimed', { userId: req.companyUser.id, claims });
    }

    res.render('portal/rewards', {
      title: 'Rewards',
      balance,
      unlocked: balance >= LOYALTY_TIER_THRESHOLD,
      flag: balance >= LOYALTY_TIER_THRESHOLD ? config.flags.businessLogic : null,
      formError: null,
      bonusClaims: claims,
      bonusError,
      raceFlag: claims >= 2 ? config.flags.raceCondition : null,
    });
  } catch (err) {
    next(err);
  }
});

// Challenge 12 (Race Condition) reset/retry mechanism. Deliberately not
// linked from the Rewards page UI (see docs/CHALLENGES.md) - resets only
// the requesting account's own bonus-claim state, so a player whose
// concurrent attempt didn't land cleanly can retry without a full
// platform reset. Resetting your own state is not itself racy (there is
// no interesting outcome from concurrent resets - it only ever restores a
// clean starting point) and never increments welcome_bonus_claims.
router.post('/rewards/reset-bonus', customerAuth.requireAuth, verifyCsrfToken, async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE company_users
       SET loyalty_points = GREATEST(loyalty_points - (500 * welcome_bonus_claims), 0),
           welcome_bonus_claims = 0
       WHERE id = $1
       RETURNING loyalty_points, welcome_bonus_claims`,
      [req.companyUser.id]
    );
    logger.info('welcome_bonus_reset', { userId: req.companyUser.id });
    res.render('portal/rewards', {
      title: 'Rewards',
      balance: rows[0].loyalty_points,
      unlocked: rows[0].loyalty_points >= LOYALTY_TIER_THRESHOLD,
      flag: rows[0].loyalty_points >= LOYALTY_TIER_THRESHOLD ? config.flags.businessLogic : null,
      formError: null,
      bonusClaims: rows[0].welcome_bonus_claims,
      bonusError: null,
      raceFlag: null,
    });
  } catch (err) {
    next(err);
  }
});

// Challenge 07 (JWT Authentication Weakness). Self-service API token
// generation for the "Instant API Access" add-on (see the public product
// catalog). Tokens are signed HS256 and only ever issued with
// `scope: "account:read"` - see routes/api.js for the verification side
// and its deliberate weakness.
router.get('/api-tokens', customerAuth.requireAuth, (req, res) => {
  res.render('portal/api_tokens', { title: 'API Tokens', token: null });
});

router.post('/api-tokens/generate', customerAuth.requireAuth, verifyCsrfToken, (req, res) => {
  const token = jwt.sign(
    { sub: req.companyUser.id, email: req.companyUser.email, scope: 'account:read' },
    config.apiJwtSecret,
    { algorithm: 'HS256', expiresIn: '2h' }
  );
  logger.info('api_token_issued', { userId: req.companyUser.id });
  res.render('portal/api_tokens', { title: 'API Tokens', token });
});

// Challenge 10 (Unrestricted File Upload). Profile avatar upload. Weak
// validation: only the multipart part's declared Content-Type is checked
// against an image allowlist - that value is attacker-controlled and isn't
// verified against the file's actual bytes. Stored file keeps only its
// extension from the client-supplied name (traversal-safe: path.extname
// never contains a path separator), under challenge-data/uploads/, which
// is created fresh at container startup (src/index.js) and is never a host
// bind mount.
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.challengeData.uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '') || '.dat';
      cb(null, `avatar-${req.companyUser.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only PNG, JPEG, or GIF images are allowed.'));
    }
    cb(null, true);
  },
});

const IMAGE_MAGIC_BYTES = [
  Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG
  Buffer.from([0xff, 0xd8, 0xff]), // JPEG
  Buffer.from([0x47, 0x49, 0x46, 0x38]), // GIF87a/GIF89a
];

function looksLikeRealImage(buf) {
  return IMAGE_MAGIC_BYTES.some((sig) => buf.length >= sig.length && buf.subarray(0, sig.length).equals(sig));
}

router.post('/profile/avatar', customerAuth.requireAuth, (req, res, next) => {
  const avatarFlag = req.companyUser.avatar_flagged ? config.flags.fileUpload : null;
  avatarUpload.single('avatar')(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).render('portal/profile', { title: 'Profile', uploadError: uploadErr.message, avatarFlag });
    }
    verifyCsrfToken(req, res, () => {
      if (!req.file) {
        return res.status(400).render('portal/profile', { title: 'Profile', uploadError: 'Please choose a file.', avatarFlag });
      }
      // Automated content scanner, same narrative device as the support
      // ticket scanner in challenge 05: the declared type claimed an
      // image, but the file's own bytes say otherwise.
      let flagged = false;
      try {
        const buf = fs.readFileSync(req.file.path);
        flagged = !looksLikeRealImage(buf);
      } catch (err) {
        return next(err);
      }
      query(
        `UPDATE company_users SET avatar_filename = $1, avatar_flagged = $2 WHERE id = $3`,
        [req.file.filename, flagged, req.companyUser.id]
      )
        .then(() => {
          logger.info('avatar_uploaded', { userId: req.companyUser.id, flagged });
          res.redirect('/company/portal/profile');
        })
        .catch(next);
    });
  });
});

// Serves uploaded avatars back. Restricted to challengeData.uploadsDir
// itself (unlike challenge 03, this containment check is correct) - the
// point of challenge 10 is the upload-time type check, not a second path
// traversal bug here.
router.get('/uploads/:filename', customerAuth.requireAuth, (req, res) => {
  const resolved = path.resolve(config.challengeData.uploadsDir, req.params.filename);
  if (!resolved.startsWith(config.challengeData.uploadsDir + path.sep)) {
    return res.status(400).render('error', { title: 'Invalid Request', message: 'That file is not valid.' });
  }
  res.sendFile(resolved, (err) => {
    if (err) {
      res.status(404).render('error', { title: 'Not Found', message: 'File not found.' });
    }
  });
});

// Challenge 14 (SSRF). "Test Integration Connectivity" - intended to be a
// single fixed check (confirm Instant's own template-rendering service is
// reachable), so the visible UI only ever shows one button. The actual
// implementation reads the fetch target from a hidden form field instead
// of hardcoding it server-side, and only validates the target's host:port
// against an allowlist prefix - real, unbypassable for host/port (blocks
// AWS metadata, external hosts, everything but these three containers),
// but it says nothing about which *path* on an allowed host is acceptable.
const SSRF_ALLOWED_PREFIXES = [
  `${config.internal.internalApiUrl}/`,
  `${config.internal.templateServiceUrl}/`,
  `${config.internal.infraServiceUrl}/`,
];

router.get('/integrations', customerAuth.requireAuth, (req, res) => {
  res.render('portal/integrations', { title: 'Integrations', result: null, target: null });
});

router.post('/integrations/connectivity-test', customerAuth.requireAuth, verifyCsrfToken, async (req, res, next) => {
  const target = (req.body.target || `${config.internal.templateServiceUrl}/health`).toString();

  if (!SSRF_ALLOWED_PREFIXES.some((prefix) => target.startsWith(prefix))) {
    return res.status(400).render('portal/integrations', {
      title: 'Integrations',
      target,
      result: { ok: false, body: 'Target must be one of Instant\'s internal services.' },
    });
  }

  try {
    const r = await fetch(target, { signal: AbortSignal.timeout(3000) });
    const body = await r.text();
    logger.info('integration_connectivity_test', { userId: req.companyUser.id, target, status: r.status });
    res.render('portal/integrations', { title: 'Integrations', target, result: { ok: true, body } });
  } catch (err) {
    res.render('portal/integrations', {
      title: 'Integrations',
      target,
      result: { ok: false, body: `Request failed: ${err.message}` },
    });
  }
});

// Challenge 16 (CORS Misconfiguration). Session-cookie authenticated (not
// bearer-token, unlike challenge 07's API - CORS credential theft is only
// meaningful against cookie auth, since a foreign page never has the
// player's bearer token to attach itself). Reflects any Origin instead of
// checking it against an allowlist, and allows credentials - the classic
// combination that lets a foreign page's JS read this response in a
// victim's own browser, using the victim's own session cookie.
router.get('/api/widget-summary', customerAuth.requireAuth, (req, res) => {
  const origin = req.headers.origin;
  const ownOrigin = `${req.protocol}://${req.headers.host}`;

  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  const body = {
    name: req.companyUser.name,
    email: req.companyUser.email,
    loyalty_points: req.companyUser.loyalty_points,
  };

  // Only a genuine cross-origin request (foreign Origin header) proves the
  // browser's CORS check actually let a foreign page read this - a normal
  // same-origin page load never sends a mismatched Origin.
  if (origin && origin !== ownOrigin) {
    logger.warn('widget_summary_cross_origin_access', { userId: req.companyUser.id, origin });
    body.security_notice = `Cross-origin credentialed request detected from ${origin}. Reference: ${config.flags.cors}`;
  }

  res.json(body);
});

// Challenge 17 (RFI). "Support Signature" preview - fetches a named
// snippet from infra-service (a separate container, reached over the
// `internal` Docker network - the "remote" in remote file inclusion) and
// embeds the fetched bytes DIRECTLY into the rendered preview, unescaped
// (see views/portal/integrations.ejs's sibling view
// portal/signature_preview usage below) - genuine inclusion, not just a
// raw text/JSON display. The actual vulnerable file-resolution logic (no
// containment check, bounded only by a mandatory .txt suffix) lives on
// infra-service itself - see services/infra-service/src/index.js - this
// route only ever talks to the hardcoded infra-service host, never a
// player-influenced one, so there is no SSRF-style host confusion here,
// only which file gets included from that one fixed, sandboxed host.
const SIGNATURE_SNIPPETS = ['default', 'formal', 'minimal'];

router.get('/settings/signature-preview', customerAuth.requireAuth, async (req, res, next) => {
  const snippet = (req.query.snippet || 'default').toString();
  try {
    const r = await fetch(
      `${config.internal.infraServiceUrl}/assets?name=${encodeURIComponent(snippet)}`,
      { signal: AbortSignal.timeout(3000) }
    );
    const content = await r.text();
    res.render('portal/signature_preview', {
      title: 'Signature Preview',
      snippet,
      snippets: SIGNATURE_SNIPPETS,
      content: r.ok ? content : null,
      error: r.ok ? null : 'That snippet could not be loaded.',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
