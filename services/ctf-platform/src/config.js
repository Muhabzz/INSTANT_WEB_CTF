require('dotenv').config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PLATFORM_PORT || '3000', 10),
  sessionSecret: required('PLATFORM_SESSION_SECRET'),
  // Whether to mark session cookies `Secure` (HTTPS-only). Deliberately NOT
  // tied to NODE_ENV: Phase 1 ships with nginx on port 80 only (no TLS), and
  // a `Secure` cookie sent over that setup is silently dropped by the
  // browser/express-session, breaking login entirely. Flip this on once TLS
  // termination is added per docs/DEPLOYMENT.md.
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  db: {
    host: process.env.POSTGRES_HOST || 'postgres',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'instant_ctf',
    user: process.env.POSTGRES_USER || 'instant_ctf',
    password: process.env.POSTGRES_PASSWORD || '',
  },
  seed: {
    adminUsername: process.env.SEED_ADMIN_USERNAME || 'admin',
    adminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@instant-ctf.local',
    adminPassword: process.env.SEED_ADMIN_PASSWORD || 'change_me_admin_password',
    playerUsername: process.env.SEED_PLAYER_USERNAME || 'demo_player',
    playerEmail: process.env.SEED_PLAYER_EMAIL || 'demo_player@instant-ctf.local',
    playerPassword: process.env.SEED_PLAYER_PASSWORD || 'change_me_player_password',
  },
};
