const crypto = require('crypto');

// Session-bound CSRF token (synchronizer token pattern), same approach as
// ctf-platform. Works for any of the three portal session middlewares since
// it only touches req.session.
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
