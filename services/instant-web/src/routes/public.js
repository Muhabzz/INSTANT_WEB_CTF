const express = require('express');
const { query } = require('../db');

const router = express.Router();

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
    const { rows } = await query(
      `SELECT name, slug, description, price_cents, category FROM products
       WHERE name ILIKE $1 OR description ILIKE $1 ORDER BY price_cents ASC`,
      [`%${q}%`]
    );
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
