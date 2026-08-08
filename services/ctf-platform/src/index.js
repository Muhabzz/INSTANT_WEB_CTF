const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const config = require('./config');
const { pool } = require('./db');
const { runMigrations } = require('./migrate');
const logger = require('./logger');
const { attachPlayer } = require('./middleware/auth');
const { ensureCsrfToken } = require('./middleware/csrf');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const challengeRoutes = require('./routes/challenges');
const scoreboardRoutes = require('./routes/scoreboard');
const profileRoutes = require('./routes/profile');
const adminRoutes = require('./routes/admin');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(healthRoutes);

app.use(
  session({
    store: new pgSession({ pool, tableName: 'platform_sessions', createTableIfMissing: false }),
    name: 'platform_sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

app.use(attachPlayer);
app.use(ensureCsrfToken);

app.get('/', (req, res) => {
  res.render('index', { title: 'INSTANT WEB CTF' });
});

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(challengeRoutes);
app.use(scoreboardRoutes);
app.use(profileRoutes);
app.use('/admin', adminRoutes);

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
