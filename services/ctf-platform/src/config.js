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
  // Plaintext flag values, used only at seed time to compute flag_hash.
  // instant-web reads the same env vars to embed these at the vulnerable
  // locations - see .env.example.
  flags: {
    infoDisclosure: required('FLAG_INFO_DISCLOSURE'),
    sqlInjection: required('FLAG_SQL_INJECTION'),
    pathTraversal: required('FLAG_PATH_TRAVERSAL'),
    authBypass: required('FLAG_AUTH_BYPASS'),
    xss: required('FLAG_XSS'),
    idor: required('FLAG_IDOR'),
    jwt: required('FLAG_JWT'),
    businessLogic: required('FLAG_BUSINESS_LOGIC'),
    csrf: required('FLAG_CSRF'),
    fileUpload: required('FLAG_FILE_UPLOAD'),
    lfi: required('FLAG_LFI'),
    advancedSqli: required('FLAG_ADVANCED_SQLI'),
    ssrf: required('FLAG_SSRF'),
    openRedirect: required('FLAG_OPEN_REDIRECT'),
    cors: required('FLAG_CORS'),
    rfi: required('FLAG_RFI'),
    chainedAttack: required('FLAG_CHAINED_ATTACK'),
    raceCondition: required('FLAG_RACE_CONDITION'),
  },
};
