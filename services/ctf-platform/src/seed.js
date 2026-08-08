const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const config = require('./config');
const { runMigrations } = require('./migrate');

function hashFlag(flag) {
  return crypto.createHash('sha256').update(flag, 'utf8').digest('hex');
}

// Phase 1: only "getting-started" is enabled and solvable end-to-end, to
// validate the challenge/flag submission framework. The remaining 17 rows
// are placeholders reserving the slug/category/points/order for each
// planned challenge; their real vulnerable implementations and real flags
// arrive in later phases. Flags below are synthetic placeholders.
const CHALLENGES = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    description:
      'Welcome to INSTANT WEB CTF. This challenge exists to confirm your dashboard, ' +
      'flag submission, and scoreboard are working. Submit the flag shown here: ' +
      'INSTANT{welcome_to_instant}',
    category: 'Getting Started',
    difficulty: 'beginner',
    points: 10,
    flag: 'INSTANT{welcome_to_instant}',
    enabled: true,
    order_index: 1,
  },
  { slug: 'public-product-catalog', title: 'Product Catalog Recon', category: 'Public Website', difficulty: 'beginner', points: 50, order_index: 2 },
  { slug: 'public-blog-metadata', title: 'Blog Metadata Exposure', category: 'Public Website', difficulty: 'beginner', points: 50, order_index: 3 },
  { slug: 'customer-auth', title: 'Customer Portal Authentication', category: 'Customer Portal', difficulty: 'easy', points: 100, order_index: 4 },
  { slug: 'customer-order-access', title: 'Order Access Control', category: 'Customer Portal', difficulty: 'easy', points: 125, order_index: 5 },
  { slug: 'customer-invoice-handling', title: 'Invoice Handling', category: 'Customer Portal', difficulty: 'medium', points: 150, order_index: 6 },
  { slug: 'customer-support-tickets', title: 'Support Ticket Exposure', category: 'Customer Portal', difficulty: 'medium', points: 150, order_index: 7 },
  { slug: 'employee-auth', title: 'Employee Portal Authentication', category: 'Employee Portal', difficulty: 'easy', points: 125, order_index: 8 },
  { slug: 'employee-directory', title: 'Employee Directory Exposure', category: 'Employee Portal', difficulty: 'medium', points: 150, order_index: 9 },
  { slug: 'employee-documents', title: 'Document Handling', category: 'Employee Portal', difficulty: 'medium', points: 175, order_index: 10 },
  { slug: 'employee-file-upload', title: 'File Upload Handling', category: 'Employee Portal', difficulty: 'hard', points: 200, order_index: 11 },
  { slug: 'employee-analytics', title: 'Analytics Dashboard', category: 'Employee Portal', difficulty: 'medium', points: 150, order_index: 12 },
  { slug: 'company-admin-access', title: 'Company Admin Access Control', category: 'Company Admin', difficulty: 'hard', points: 225, order_index: 13 },
  { slug: 'company-admin-users', title: 'Admin User Management', category: 'Company Admin', difficulty: 'hard', points: 225, order_index: 14 },
  { slug: 'internal-api-exposure', title: 'Internal API Exposure', category: 'Internal Services', difficulty: 'hard', points: 250, order_index: 15 },
  { slug: 'template-service-rendering', title: 'Template Rendering', category: 'Internal Services', difficulty: 'advanced', points: 275, order_index: 16 },
  { slug: 'infra-service-recon', title: 'Infrastructure Service Recon', category: 'Internal Services', difficulty: 'advanced', points: 275, order_index: 17 },
  { slug: 'full-chain-compromise', title: 'Full Chain: Company Compromise', category: 'Attack Chain', difficulty: 'advanced', points: 400, order_index: 18 },
];

async function seedChallenges(client) {
  for (const c of CHALLENGES) {
    const flag = c.flag || `INSTANT{placeholder_${c.slug}}`;
    const description =
      c.description ||
      'This challenge is reserved for a later build phase and is currently disabled.';
    await client.query(
      `INSERT INTO challenges (slug, title, description, category, difficulty, points, flag_hash, enabled, order_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         category = EXCLUDED.category,
         difficulty = EXCLUDED.difficulty,
         points = EXCLUDED.points,
         flag_hash = EXCLUDED.flag_hash,
         order_index = EXCLUDED.order_index`,
      [
        c.slug,
        c.title,
        description,
        c.category,
        c.difficulty,
        c.points,
        hashFlag(flag),
        c.enabled ?? false,
        c.order_index,
      ]
    );
  }
  console.log(`[seed] upserted ${CHALLENGES.length} challenges`);
}

async function seedPlayers(client) {
  const adminHash = await bcrypt.hash(config.seed.adminPassword, 12);
  const playerHash = await bcrypt.hash(config.seed.playerPassword, 12);

  await client.query(
    `INSERT INTO players (username, email, password_hash, is_admin)
     VALUES ($1,$2,$3,TRUE)
     ON CONFLICT (username) DO NOTHING`,
    [config.seed.adminUsername, config.seed.adminEmail, adminHash]
  );

  await client.query(
    `INSERT INTO players (username, email, password_hash, is_admin)
     VALUES ($1,$2,$3,FALSE)
     ON CONFLICT (username) DO NOTHING`,
    [config.seed.playerUsername, config.seed.playerEmail, playerHash]
  );

  console.log('[seed] ensured admin + demo player accounts exist');
}

async function seed() {
  await runMigrations();
  const client = await pool.connect();
  try {
    await seedChallenges(client);
    await seedPlayers(client);
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed] failed', err);
      process.exit(1);
    });
}

module.exports = { seed };
