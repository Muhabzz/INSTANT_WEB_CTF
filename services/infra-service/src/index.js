require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');

const PORT = parseInt(process.env.INFRA_SERVICE_PORT || '4003', 10);
const START_TIME = Date.now();

const ASSETS_DIR = path.join(__dirname, '..', 'content', 'assets');
const INTERNAL_DIR = path.join(__dirname, '..', 'content', 'internal');

const app = express();

function log(event, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'infra-service', event, ...meta }));
}

// Challenge 17 (RFI) content, written fresh at container startup - never a
// host bind mount. `assets/` is the customer-facing signature-snippet
// library instant-web's Signature Preview feature (routes/portal.js) is
// meant to be confined to; `internal/` is a sibling directory that was
// never meant to be reachable from that feature.
function writeChallengeContent() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const snippets = {
    'default.txt': 'Thanks for reaching out!\n— The Instant Team',
    'formal.txt': 'Best regards,\nInstant Customer Success',
    'minimal.txt': '— Instant Support',
  };
  for (const [name, contents] of Object.entries(snippets)) {
    fs.writeFileSync(path.join(ASSETS_DIR, name), contents);
  }

  fs.mkdirSync(INTERNAL_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(INTERNAL_DIR, 'flag.txt'),
    'Engineering notes - moved out of assets/ during the content library ' +
      `cleanup, not linked from any customer-facing snippet picker. Tracking ref: ${process.env.FLAG_RFI || ''}\n`
  );
}

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'infra-service' });
});

// Synthetic internal ops dashboard data - not real infrastructure, just
// enough recon surface for later challenge phases to build on. Not
// reachable from the public internet.
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
    environment: 'production',
    services: [
      { name: 'instant-web', status: 'ok' },
      { name: 'internal-api', status: 'ok' },
      { name: 'template-service', status: 'ok' },
      { name: 'postgres', status: 'ok' },
    ],
    version: '1.0.0',
    // Challenge 14 (SSRF). Breadcrumb toward the diagnostics route below -
    // this service has no authentication of its own (see comment on
    // /diagnostics/internal-report), relying entirely on the `internal`
    // Docker network for isolation, same as internal-api.
    diagnostics_endpoint: '/diagnostics/internal-report',
  });
});

// Challenge 14 (SSRF). Not part of the admin Tools health-check set (that
// only ever calls /health) - this exists for infra-service's own
// automation, unauthenticated like every other route here since network
// segmentation is this service's only real access control. Reachable by
// anything that can reach this container on the `internal` network -
// intentionally, that's the entire point of the challenge: instant-web is
// the one service allowed to bridge into this network, and a flaw in how
// instant-web picks its fetch target lets a player ride that legitimate
// position to reach a route no customer-facing feature was meant to hit.
app.get('/diagnostics/internal-report', (req, res) => {
  log('internal_report_accessed');
  res.json({
    service: 'infra-service',
    status: 'ok',
    report: 'nightly-ops-sync',
    internal_notice: `Internal report access confirmed. Tracking ref: ${process.env.FLAG_SSRF || ''}`,
  });
});

const ASSET_DENYLIST = /\/proc\/|\/etc\/shadow|\.ssh\/|docker\.sock/i;

// Challenge 17 (RFI). Serves customer-selectable signature snippets by
// name for instant-web's Signature Preview feature. BUG: path.resolve()
// with no startsWith(ASSETS_DIR) containment check - identical bug shape
// to challenge 11's LFI, just reached over the network from a different
// service instead of a local file read inside instant-web. A denylist
// blocks a few named dangerous paths (defense in depth, doesn't fix the
// underlying issue), and a mandatory .txt suffix is appended whenever the
// caller doesn't already supply one - that suffix is what keeps this
// bounded to .txt-named targets on this container's own filesystem
// (nothing sensitive on this or any other service in this deployment ends
// in .txt), never a host path (no host bind mounts exist anywhere in this
// project) and never a network target (this route makes no outbound
// requests of its own - it only reads local files).
app.get('/assets', (req, res) => {
  const requested = (req.query.name || 'default').toString();
  const requestedPath = requested.endsWith('.txt') ? requested : `${requested}.txt`;

  if (ASSET_DENYLIST.test(requestedPath)) {
    return res.status(400).json({ error: 'invalid_name' });
  }

  const resolved = path.resolve(ASSETS_DIR, requestedPath);
  fs.readFile(resolved, 'utf8', (err, content) => {
    if (err) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.type('text/plain').send(content);
  });
});

writeChallengeContent();
app.listen(PORT, () => log('server_started', { port: PORT }));
