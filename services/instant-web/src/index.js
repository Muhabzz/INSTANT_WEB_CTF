const path = require('path');
const fs = require('fs');
const express = require('express');

const config = require('./config');
const { runMigrations } = require('./migrate');
const logger = require('./logger');

const healthRoutes = require('./routes/health');
const publicRoutes = require('./routes/public');
const portalRoutes = require('./routes/portal');
const employeeRoutes = require('./routes/employee');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: false }));

// Static assets and every application route are mounted under `/company`,
// matching the path nginx forwards unchanged (see nginx/conf.d/default.conf).
// This has to match exactly: portal session cookies are scoped with
// `cookie.path: '/company/<portal>'`, and express-session silently refuses
// to attach a session at all if the request path it actually sees doesn't
// start with that same prefix.
app.use('/company', express.static(path.join(__dirname, 'public')));

// Health routes are mounted twice: at `/health` for the container's own
// Docker HEALTHCHECK (which hits this service directly, bypassing nginx),
// and at `/company/health` for checks that go through nginx like everything else.
app.use(healthRoutes);
app.use('/company', healthRoutes);

// Each portal owns its own session/CSRF/auth middleware (see
// middleware/portalAuth.js) - mounted here rather than globally so a
// customer session cookie is never parsed on employee/admin routes or
// vice versa.
app.use('/company', publicRoutes);
app.use('/company/portal', portalRoutes);
app.use('/company/employee', employeeRoutes);
app.use('/company/admin', adminRoutes);
// Instant's customer-facing API (challenge 07) - bearer-token auth via its
// own JWT verification, entirely separate from every portal's cookie
// session middleware above.
app.use('/company/api', apiRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('unhandled_error', { message: err.message, path: req.path });
  res.status(500).render('error', { title: 'Server Error', message: 'Something went wrong.' });
});

function writeChallengeFiles() {
  // Challenge 03 (Path Traversal) target file. Written at startup from the
  // FLAG_PATH_TRAVERSAL env var rather than baked into the image, so the
  // single source of truth stays .env like every other flag. Lives outside
  // the "documents" directory the download feature is meant to be
  // restricted to - see routes/portal.js.
  fs.mkdirSync(config.challengeData.protectedDir, { recursive: true });
  fs.writeFileSync(
    path.join(config.challengeData.protectedDir, 'flag.txt'),
    `${config.flags.pathTraversal}\n`
  );

  // Challenge 10 (Unrestricted File Upload) target directory - customer
  // avatar uploads land here (see routes/portal.js). Created fresh at
  // startup; container-local only, never a host bind mount.
  fs.mkdirSync(config.challengeData.uploadsDir, { recursive: true });

  // Challenge 11 (LFI) intended templates - the receipt viewer (see
  // routes/portal.js) is meant to only ever load one of these.
  fs.mkdirSync(config.challengeData.receiptTemplatesDir, { recursive: true });
  const templates = {
    'standard.txt': 'INSTANT RECEIPT\n----------------\nInvoice: {{invoice_number}}\nAmount: {{amount}}\nStatus: {{status}}\n',
    'detailed.txt': 'INSTANT — DETAILED RECEIPT\n==========================\nInvoice number: {{invoice_number}}\nAmount charged: {{amount}}\nCurrent status: {{status}}\nThank you for your business.\n',
    'minimal.txt': '{{invoice_number}} | {{amount}} | {{status}}\n',
  };
  for (const [name, contents] of Object.entries(templates)) {
    fs.writeFileSync(path.join(config.challengeData.receiptTemplatesDir, name), contents);
  }

  // Challenge 11 (LFI) target file - deliberately outside
  // receiptTemplatesDir, reachable only through the vulnerable template
  // selection in routes/portal.js. Never a host bind mount.
  fs.mkdirSync(config.challengeData.internalBillingDir, { recursive: true });
  fs.writeFileSync(
    path.join(config.challengeData.internalBillingDir, 'notes.txt'),
    'Escalation queue notes - Meridian Capital renewal at risk, handle ' +
      `before Friday. Internal tracking ref: ${config.flags.lfi}\n`
  );
}

async function start() {
  writeChallengeFiles();
  await runMigrations();
  app.listen(config.port, () => {
    logger.info('server_started', { port: config.port, env: config.env });
  });
}

start().catch((err) => {
  logger.error('startup_failed', { message: err.message });
  process.exit(1);
});
