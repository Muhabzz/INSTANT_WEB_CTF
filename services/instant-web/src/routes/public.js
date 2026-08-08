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
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    ['User-agent: *', 'Disallow: /debug/', 'Disallow: /portal/legacy-login', ''].join('\n')
  );
});

// Challenge 01 (Information Disclosure) - part two: an undocumented debug
// endpoint, left mounted and unauthenticated. Deliberately not linked from
// anywhere in the UI; only discoverable via robots.txt above (or generic
// recon/wordlist guessing). Returns realistic-looking deploy/debug info; the
// flag rides along in the "notes" field the way a leftover TODO comment
// would, and the same notes field hints at challenge 04's endpoint.
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

module.exports = router;
