const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const config = require('./config');
const { runMigrations } = require('./migrate');

function hashFlag(flag) {
  return crypto.createHash('sha256').update(flag, 'utf8').digest('hex');
}

// Phase 2-6: challenges 01-18 are all real, enabled, and live inside the
// Instant company application (services/instant-web), plus small
// additions to infra-service for challenges 14 and 17. See
// docs/CHALLENGES.md for the intended discovery/exploitation path for each
// one (admin-only doc - player-facing text below is deliberately
// non-spoiling beyond the title, same as any real CTF's challenge catalog).
//
// Challenge 12 was originally reserved for Command Injection, which was
// never implemented - a pre-deployment check found AWS instance metadata
// (IMDS) reachable from inside containers on this host, and granting real
// command execution would have had a live path to that exposure (an
// EC2/AWS-side issue, not fixable in this repo). Per instruction, this
// slot was replaced outright with a Race Condition challenge instead (see
// docs/CHALLENGES.md "12 - Race Condition") rather than implementing
// command execution.
//
// NOTE: Phase 1 seeded a different slug set (getting-started,
// public-product-catalog, customer-auth, etc), Phase 2 seeded placeholder
// slugs for 06-10 (public-blog-metadata, customer-order-access,
// customer-invoice-handling, employee-auth, employee-directory) that
// Phase 3 replaced, Phase 4 replaced the 11/13 placeholders
// (employee-documents, employee-analytics), Phase 5 replaced the 14-18
// placeholders (company-admin-access, company-admin-users,
// internal-api-exposure, template-service-rendering,
// full-chain-compromise), and this revision replaces the 12 placeholder
// (employee-file-upload) with the actual challenge definition below
// (different vulnerability classes than originally placeholder-planned).
// Upgrading an existing deployment should use `scripts/reset.sh`, not just
// `scripts/seed.sh` - re-seeding alone leaves old rows in place as
// orphaned, still-disabled challenges since their
// slugs no longer appear in this list.
const CHALLENGES = [
  {
    slug: 'information-disclosure',
    title: 'Information Disclosure',
    description:
      "Instant's engineering team moves fast - sometimes a little too fast. " +
      'See what you can find by exploring the public site a bit more closely ' +
      'than a normal visitor would.',
    category: 'Public Website',
    difficulty: 'beginner',
    points: 50,
    flag: config.flags.infoDisclosure,
    enabled: true,
    order_index: 1,
  },
  {
    slug: 'sql-injection',
    title: 'SQL Injection',
    description:
      "The product search on Instant's public site queries a real database " +
      'behind the scenes. Explore how it handles unusual input.',
    category: 'Public Website',
    difficulty: 'beginner',
    points: 50,
    flag: config.flags.sqlInjection,
    enabled: true,
    order_index: 2,
  },
  {
    slug: 'path-traversal',
    title: 'Path Traversal',
    description:
      'Instant customers can generate and download account reports. Take a ' +
      'close look at how the download feature selects which file to serve.',
    category: 'Customer Portal',
    difficulty: 'beginner',
    points: 50,
    flag: config.flags.pathTraversal,
    enabled: true,
    order_index: 3,
  },
  {
    slug: 'auth-bypass',
    title: 'Authentication Bypass',
    description:
      'Not every login form at Instant gets the same attention. Some older ' +
      'flows may not have kept up with the rest of the platform.',
    category: 'Customer Portal',
    difficulty: 'beginner',
    points: 75,
    flag: config.flags.authBypass,
    enabled: true,
    order_index: 4,
  },
  {
    slug: 'xss',
    title: 'Cross-Site Scripting',
    description:
      "Instant's support team reviews every ticket that comes in. What " +
      'happens if a ticket contains more than plain text?',
    category: 'Customer Portal',
    difficulty: 'beginner',
    points: 75,
    flag: config.flags.xss,
    enabled: true,
    order_index: 5,
  },
  {
    slug: 'idor-invoice-access',
    title: 'Invoice Access Control',
    description:
      'Your own account has invoices you can view any time. See how the ' +
      "portal decides which invoice you're allowed to look at.",
    category: 'Customer Portal',
    difficulty: 'easy',
    points: 100,
    flag: config.flags.idor,
    enabled: true,
    order_index: 6,
  },
  {
    slug: 'jwt-auth-weakness',
    title: 'JWT Authentication Weakness',
    description:
      'Instant offers self-service API access tokens for the API Access ' +
      'add-on. Take a close look at how those tokens are structured and verified.',
    category: 'Customer Portal',
    difficulty: 'easy',
    points: 100,
    flag: config.flags.jwt,
    enabled: true,
    order_index: 7,
  },
  {
    slug: 'business-logic-flaw',
    title: 'Business Logic Flaw',
    description:
      "Instant customers can redeem loyalty points for account credit. " +
      'The redemption form trusts you more than you might expect.',
    category: 'Customer Portal',
    difficulty: 'medium',
    points: 125,
    flag: config.flags.businessLogic,
    enabled: true,
    order_index: 8,
  },
  {
    slug: 'csrf-notification-settings',
    title: 'Cross-Site Request Forgery',
    description:
      'Account preferences can be changed a couple of different ways at ' +
      "Instant. Not every way gets the same protection as the settings form.",
    category: 'Customer Portal',
    difficulty: 'medium',
    points: 125,
    flag: config.flags.csrf,
    enabled: true,
    order_index: 9,
  },
  {
    slug: 'unrestricted-file-upload',
    title: 'Unrestricted File Upload',
    description:
      'Customers can upload a profile avatar. See what the upload form ' +
      'actually checks about the file you send it.',
    category: 'Customer Portal',
    difficulty: 'medium',
    points: 150,
    flag: config.flags.fileUpload,
    enabled: true,
    order_index: 10,
  },
  {
    slug: 'local-file-inclusion',
    title: 'Local File Inclusion',
    description:
      'Invoices can be viewed as a formatted receipt in a few different ' +
      'styles. Take a close look at how the receipt style is selected.',
    category: 'Customer Portal',
    difficulty: 'medium',
    points: 175,
    flag: config.flags.lfi,
    enabled: true,
    order_index: 11,
  },
  {
    slug: 'race-condition-bonus-claim',
    title: 'Race Condition',
    description:
      'New accounts can claim a one-time welcome bonus on the Rewards ' +
      "page. \"One-time\" is a business rule, not something the server " +
      'actually enforces atomically.',
    category: 'Customer Portal',
    difficulty: 'medium',
    points: 200,
    flag: config.flags.raceCondition,
    enabled: true,
    order_index: 12,
  },
  {
    slug: 'advanced-sql-injection',
    title: 'Advanced SQL Injection',
    description:
      "Instant's public order tracker will tell you whether an order " +
      "number and email match, nothing more. Sometimes that's already enough.",
    category: 'Public Website',
    difficulty: 'hard',
    points: 250,
    flag: config.flags.advancedSqli,
    enabled: true,
    order_index: 13,
  },
  {
    slug: 'ssrf',
    title: 'Server-Side Request Forgery',
    description:
      'The Integrations page can check whether one of our internal services ' +
      "is reachable. See exactly what it's checking, and how.",
    category: 'Customer Portal',
    difficulty: 'medium',
    points: 200,
    flag: config.flags.ssrf,
    enabled: true,
    order_index: 14,
  },
  {
    slug: 'open-redirect',
    title: 'Open Redirect',
    description:
      "Instant's partner links go through a redirect helper on their way " +
      'out. Take a look at what it actually checks before sending you there.',
    category: 'Public Website',
    difficulty: 'easy',
    points: 125,
    flag: config.flags.openRedirect,
    enabled: true,
    order_index: 15,
  },
  {
    slug: 'cors-misconfiguration',
    title: 'CORS Misconfiguration',
    description:
      'A small widget API lets you embed your account summary elsewhere. ' +
      'Check which origins it actually trusts.',
    category: 'Customer Portal',
    difficulty: 'medium',
    points: 200,
    flag: config.flags.cors,
    enabled: true,
    order_index: 16,
  },
  {
    slug: 'remote-file-inclusion',
    title: 'Remote File Inclusion',
    description:
      'Support ticket signatures are pulled from a small internal snippet ' +
      "library. The picker only shows three options - that doesn't mean " +
      'only three exist.',
    category: 'Customer Portal',
    difficulty: 'hard',
    points: 275,
    flag: config.flags.rfi,
    enabled: true,
    order_index: 17,
  },
  {
    slug: 'chained-attack',
    title: 'Chained Web Attack',
    description:
      'Some accounts on Instant are not meant for customer login at all. ' +
      "Finding one is only half the problem - the other half is something " +
      "you've already solved elsewhere.",
    category: 'Attack Chain',
    difficulty: 'advanced',
    points: 400,
    flag: config.flags.chainedAttack,
    enabled: true,
    order_index: 18,
  },
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
