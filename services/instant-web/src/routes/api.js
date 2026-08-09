const express = require('express');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const config = require('../config');
const logger = require('../logger');

const router = express.Router();

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const withPad = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  return Buffer.from(withPad, 'base64').toString('utf8');
}

// Challenge 07 (JWT Authentication Weakness). This "Instant API" predates
// the rest of the app's move to a single vetted auth library, and its
// bearer-token verification was written by hand. Tokens declaring
// `alg: "none"` in their header skip signature verification entirely and
// are trusted as-is - a classic, well-documented JWT implementation flaw
// (not a flaw in the `jsonwebtoken` library itself, which is only used for
// the legitimate HS256 signing/verification path below). An attacker who
// has ANY valid token (e.g. their own, from the customer portal's
// "API Tokens" page) can base64url-decode it, change the header to
// `{"alg":"none"}`, edit the payload's `scope` claim, and re-encode with an
// empty signature segment to forge arbitrary claims.
function verifyApiToken(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Missing bearer token.' });
  }
  const token = match[1].trim();
  const parts = token.split('.');
  if (parts.length < 2) {
    return res.status(401).json({ error: 'Malformed token.' });
  }

  let headerJson;
  try {
    headerJson = JSON.parse(base64UrlDecode(parts[0]));
  } catch (err) {
    return res.status(401).json({ error: 'Malformed token.' });
  }

  if (headerJson.alg === 'none') {
    try {
      req.apiAuth = JSON.parse(base64UrlDecode(parts[1]));
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Malformed token.' });
    }
  }

  try {
    req.apiAuth = jwt.verify(token, config.apiJwtSecret, { algorithms: ['HS256'] });
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

router.get('/account', verifyApiToken, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, email, role, department FROM company_users WHERE id = $1`,
      [req.apiAuth.sub]
    );
    const account = rows[0];
    if (!account) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    res.json({ account, scope: req.apiAuth.scope || null });
  } catch (err) {
    next(err);
  }
});

// Never reachable with a legitimately-issued token - the token generation
// endpoint (routes/portal.js `/api-tokens/generate`) only ever issues
// `scope: "account:read"`. Reachable only by forging a token with
// `scope: "admin:internal"`, e.g. via the alg:none bypass above.
router.get('/internal/diagnostics', verifyApiToken, (req, res) => {
  if (req.apiAuth.scope !== 'admin:internal') {
    logger.warn('api_diagnostics_denied', { sub: req.apiAuth.sub, scope: req.apiAuth.scope });
    return res.status(403).json({ error: 'Insufficient scope.' });
  }
  logger.warn('api_diagnostics_accessed', { sub: req.apiAuth.sub });
  res.json({
    service: 'instant-api',
    status: 'ok',
    queue_depth: 0,
    last_deploy: '2024.11.02-rc3',
    internal_notice: `Internal diagnostics scope confirmed. Tracking ref: ${config.flags.jwt}`,
  });
});

// Challenge 18 (Chained Attack). Reuses the exact same alg:none forgery
// technique as challenge 07's /internal/diagnostics above, but scope alone
// isn't enough here - `sub` must also match the ops-integration service
// account's own id, which is never given directly. It's only reachable via
// challenge 06's IDOR (GET /invoices/:id, no ownership check) against that
// account's seeded invoice - two distinct, already-taught weaknesses
// chained together, not a new vulnerability class.
router.get('/internal/ops-console', verifyApiToken, async (req, res, next) => {
  if (req.apiAuth.scope !== 'admin:internal') {
    logger.warn('api_ops_console_denied', { sub: req.apiAuth.sub, reason: 'scope' });
    return res.status(403).json({ error: 'Insufficient scope.' });
  }
  try {
    const { rows } = await query(
      `SELECT id FROM company_users WHERE email = 'ops-integration@instant.example' AND role = 'customer'`
    );
    const opsIntegrationId = rows[0] && rows[0].id;
    if (!opsIntegrationId || Number(req.apiAuth.sub) !== opsIntegrationId) {
      logger.warn('api_ops_console_denied', { sub: req.apiAuth.sub, reason: 'sub' });
      return res.status(403).json({ error: 'This scope is only valid for the ops-integration service account.' });
    }
    logger.warn('api_ops_console_accessed', { sub: req.apiAuth.sub });
    res.json({
      service: 'ops-console',
      status: 'ok',
      internal_notice: `Ops console access confirmed for the ops-integration service account. Tracking ref: ${config.flags.chainedAttack}`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
