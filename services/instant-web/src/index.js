const path = require('path');
const express = require('express');

const config = require('./config');
const { runMigrations } = require('./migrate');
const logger = require('./logger');

const healthRoutes = require('./routes/health');
const publicRoutes = require('./routes/public');
const portalRoutes = require('./routes/portal');
const employeeRoutes = require('./routes/employee');
const adminRoutes = require('./routes/admin');

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

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('unhandled_error', { message: err.message, path: req.path });
  res.status(500).render('error', { title: 'Server Error', message: 'Something went wrong.' });
});

async function start() {
  await runMigrations();
  app.listen(config.port, () => {
    logger.info('server_started', { port: config.port, env: config.env });
  });
}

start().catch((err) => {
  logger.error('startup_failed', { message: err.message });
  process.exit(1);
});
