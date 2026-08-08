const crypto = require('crypto');

// Lightweight session-bound CSRF token (synchronizer token pattern).
// Not a substitute for a vetted library at large scale, but sufficient here
// and dependency-free; the platform's own auth/forms are explicitly meant
// to stay hardened (intentional vulnerabilities live in the challenges, not
// in the CTF meta-platform itself).
function ensureCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function verifyCsrfToken(req, res, next) {
  const sent = req.body && req.body._csrf;
  const expected = req.session && req.session.csrfToken;
  if (!expected || !sent || sent !== expected) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'Invalid or missing CSRF token. Please go back and try again.',
    });
  }
  next();
}

module.exports = { ensureCsrfToken, verifyCsrfToken };
