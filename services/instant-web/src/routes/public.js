const express = require('express');
const { query } = require('../db');
const config = require('../config');

const router = express.Router();

// Container start time, used to compute a plausible-looking uptime figure
// for the debug endpoint below (challenge 01).
const START_TIME = Date.now();

const NAV = [
  { href: '/company/products', label: 'Products' },
  { href: '/company/about', label: 'About' },
  { href: '/company/careers', label: 'Careers' },
  { href: '/company/blog', label: 'Blog' },
  { href: '/company/support', label: 'Support' },
  { href: '/company/track-order', label: 'Track Order' },
  { href: '/company/contact', label: 'Contact' },
  { href: '/company/portal/login', label: 'Customer Login' },
  { href: '/company/employee/login', label: 'Employee Login' },
];

router.use((req, res, next) => {
  res.locals.navItems = NAV;
  res.locals.brandSuffix = '';
  next();
});

router.get('/', (req, res) => {
  res.render('public/home', { title: 'Instant — Workflow automation for growing teams' });
});

// Challenge 01 (Information Disclosure) - part one of the discovery path:
// robots.txt disallowing a couple of paths a crawler shouldn't index. Real
// crawlers respect this; a curious human reads it as a map of what the site
// doesn't want indexed - including an undocumented debug endpoint and an
// old login flow that both should have been removed before launch.
//
// The debug and protected-reports entries below list the exact path, not
// just a directory prefix - the same mistake that got the endpoint here in
// the first place (someone reflexively added a Disallow line without
// thinking about what that reveals to a human reader, rather than actually
// removing the leftover endpoint/report).
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Disallow: /debug/deploy-status-8f3a',
      'Disallow: /portal/legacy-login',
      'Disallow: /portal/settings/quick-unsubscribe',
      'Disallow: /portal/documents/protected/flag.txt',
      '',
    ].join('\n')
  );
});

// Challenge 01 (Information Disclosure) - part two: an undocumented debug
// endpoint, left mounted and unauthenticated. Deliberately not linked from
// anywhere in the UI; discoverable via the exact path robots.txt now lists
// above. Returns realistic-looking deploy/debug info; the flag rides along
// in the "notes" field the way a leftover TODO comment would, and the same
// notes field hints at challenge 04's endpoint.
router.get('/debug/deploy-status-8f3a', (req, res) => {
  res.json({
    service: 'instant-web',
    status: 'ok',
    environment: 'production',
    build: '2024.11.02-rc3',
    deployed_by: 'ci-bot',
    uptime_hours: Math.floor((Date.now() - START_TIME) / 1000 / 3600),
    notes:
      'Legacy customer login retained at /portal/legacy-login for backwards ' +
      'compatibility during the Q4 auth migration - scheduled for removal. ' +
      `Tracking ref: ${config.flags.infoDisclosure}`,
  });
});

router.get('/products', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT name, slug, description, price_cents, category FROM products ORDER BY price_cents ASC');
    res.render('public/products', { title: 'Products', products: rows, q: '' });
  } catch (err) {
    next(err);
  }
});

router.get('/products/search', async (req, res, next) => {
  const q = (req.query.q || '').toString();
  try {
    // Challenge 02 (SQL Injection). Unlike every other query in this
    // codebase, this one builds SQL via string concatenation instead of
    // parameterized placeholders - the search box passes `q` straight into
    // the WHERE clause. A single quote breaks out of the ILIKE literal, and
    // from there a UNION SELECT with a matching column count/types can pull
    // rows from any table, e.g. the `internal_notes` table (never exposed
    // by any legitimate route) that holds this challenge's flag.
    const sql = `SELECT name, slug, description, price_cents, category FROM products
       WHERE name ILIKE '%${q}%' OR description ILIKE '%${q}%' ORDER BY price_cents ASC`;
    const { rows } = await query(sql);
    res.render('public/products', { title: 'Search Products', products: rows, q });
  } catch (err) {
    next(err);
  }
});

router.get('/about', (req, res) => {
  res.render('public/about', { title: 'About Instant' });
});

router.get('/careers', (req, res) => {
  res.render('public/careers', { title: 'Careers' });
});

router.get('/contact', (req, res) => {
  res.render('public/contact', { title: 'Contact Us' });
});

router.get('/blog', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT title, slug, author, published_at FROM blog_posts ORDER BY published_at DESC');
    res.render('public/blog_list', { title: 'Blog', posts: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/blog/:slug', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT title, content, author, published_at FROM blog_posts WHERE slug = $1', [req.params.slug]);
    const post = rows[0];
    if (!post) {
      return res.status(404).render('public/error', { title: 'Not Found', message: 'Post not found.' });
    }
    res.render('public/blog_post', { title: post.title, post });
  } catch (err) {
    next(err);
  }
});

router.get('/support', (req, res) => {
  res.render('public/support', { title: 'Support' });
});

router.get('/track-order', (req, res) => {
  res.render('public/track_order', { title: 'Track Your Order', submitted: false, found: null, orderId: '', email: '' });
});

router.post('/track-order', async (req, res, next) => {
  const orderId = (req.body.order_id || '').toString().trim();
  const email = (req.body.email || '').toString().trim();

  // Challenge 13 (Advanced SQL Injection). Meaningfully different from
  // challenge 02: this is a NUMERIC-context injection point (order_id is
  // never quoted, so no quote-escaping is needed to break out), and unlike
  // the product search, the response here only ever reveals a boolean
  // signal - "an order matching that id and email exists" or "it doesn't"
  // - never any row data. A UNION SELECT would change the column shape
  // returned but nothing is ever echoed back to confirm it, so UNION-based
  // extraction doesn't apply here; the intended technique is boolean-based
  // blind SQL injection, e.g.
  //   order_id = 0 OR (SELECT substring(escalation_note,1,1)
  //                     FROM support_escalations LIMIT 1)='I' --
  // which comments out the trailing email check (same comment-bypass idea
  // as challenge 04) and turns the found/not-found response into a single
  // bit of a much larger extraction, one character/position at a time.
  const sql = `SELECT o.id FROM orders o JOIN company_users u ON u.id = o.customer_id
     WHERE o.id = ${orderId || 0} AND u.email = '${email}' LIMIT 1`;

  try {
    const { rows } = await query(sql);
    res.render('public/track_order', {
      title: 'Track Your Order',
      submitted: true,
      found: rows.length > 0,
      orderId,
      email,
    });
  } catch (err) {
    // A malformed query is itself a (weaker) oracle bit, but the intended
    // primary technique is the found/not-found boolean above, which never
    // requires triggering a syntax error.
    res.render('public/track_order', {
      title: 'Track Your Order',
      submitted: true,
      found: false,
      orderId,
      email,
    });
  }
});

module.exports = router;
