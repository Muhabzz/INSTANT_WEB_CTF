const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const config = require('./config');
const { runMigrations } = require('./migrate');

const PRODUCTS = [
  { name: 'Instant Starter', slug: 'instant-starter', description: 'Core workflow automation for small teams.', price_cents: 2900, category: 'Plans' },
  { name: 'Instant Growth', slug: 'instant-growth', description: 'Advanced automation, analytics, and integrations.', price_cents: 9900, category: 'Plans' },
  { name: 'Instant Enterprise', slug: 'instant-enterprise', description: 'Custom SLAs, SSO, and dedicated support.', price_cents: 29900, category: 'Plans' },
  { name: 'Instant Analytics Add-on', slug: 'instant-analytics-addon', description: 'Deeper reporting and export tooling.', price_cents: 1900, category: 'Add-ons' },
  { name: 'Instant API Access', slug: 'instant-api-access', description: 'Programmatic access to the Instant platform.', price_cents: 1500, category: 'Add-ons' },
  { name: 'Instant Priority Support', slug: 'instant-priority-support', description: '24/7 priority support with a 1 hour SLA.', price_cents: 4900, category: 'Support' },
];

const BLOG_POSTS = [
  { title: 'Announcing Instant Growth', slug: 'announcing-instant-growth', author: 'Instant Team', content: 'Today we are launching the Instant Growth plan for scaling teams.' },
  { title: 'How We Think About Reliability', slug: 'how-we-think-about-reliability', author: 'Instant Engineering', content: 'A look at how the Instant platform team approaches uptime and incident response.' },
  { title: '5 Ways to Automate Your Workflow', slug: '5-ways-to-automate-your-workflow', author: 'Instant Team', content: 'Practical tips for getting more out of Instant automations.' },
  { title: 'Instant Named a Leader in SaaS Automation', slug: 'instant-named-a-leader', author: 'Instant Team', content: 'We are proud to be recognized in this year\'s industry report.' },
  // Challenge 04 (Authentication Bypass) breadcrumb: a customer-spotlight
  // guest post naming the seeded VIP account and its exact email, so the
  // legacy-login bypass has a real, in-app way to learn WHICH account to
  // target - not just that the bypass technique works. Guest/case-study
  // posts with a named contact byline are a completely ordinary B2B SaaS
  // marketing pattern; this one just happens to name the right person.
  {
    title: 'Customer Spotlight: How Meridian Capital Scaled Their Back Office',
    slug: 'customer-spotlight-meridian-capital',
    author: 'Alexandra Chen, Meridian Capital',
    content:
      'Enterprise renewals used to mean weeks of back-and-forth for our operations team. ' +
      'Since moving onto Instant Enterprise, we have centralized every workflow our finance ' +
      'and ops teams touch, and cut new-hire onboarding time in half. Instant\'s account team ' +
      'has been a genuine partner throughout our renewal this year. ' +
      '— Alexandra Chen, Head of Operations, Meridian Capital. ' +
      'Questions about our enterprise rollout? Reach me directly at ' +
      'alexandra.chen@meridiancapital.example.',
  },
];

async function seedCompanyUsers(client) {
  const customerHash = await bcrypt.hash(config.seed.customerPassword, 12);
  const employeeHash = await bcrypt.hash(config.seed.employeePassword, 12);
  const adminHash = await bcrypt.hash(config.seed.companyAdminPassword, 12);
  // Random, never-communicated passwords - these accounts are never meant
  // to be reached via a normal, correctly-guessed login (see challenges 04
  // and 06).
  const vipHash = await bcrypt.hash(require('crypto').randomBytes(24).toString('hex'), 12);
  const idorTargetHash = await bcrypt.hash(require('crypto').randomBytes(24).toString('hex'), 12);

  const upsert = async (name, email, hash, role, department, notes) => {
    const { rows } = await client.query(
      `INSERT INTO company_users (name, email, password_hash, role, department, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [name, email, hash, role, department, notes || null]
    );
    if (rows[0]) return rows[0].id;
    const existing = await client.query('SELECT id FROM company_users WHERE email = $1', [email]);
    return existing.rows[0].id;
  };

  const customerId = await upsert('Jordan Customer', config.seed.customerEmail, customerHash, 'customer', null);
  const employeeId = await upsert('Sam Employee', config.seed.employeeEmail, employeeHash, 'employee', 'Support');
  const adminId = await upsert('Riley Admin', config.seed.companyAdminEmail, adminHash, 'admin', 'Operations');

  // Challenge 04 (Authentication Bypass) target account: a VIP enterprise
  // customer with no publicly known credentials. Reachable only via the
  // vulnerable legacy login endpoint (see routes/portal.js).
  await upsert(
    'Alexandra Chen',
    'alexandra.chen@meridiancapital.example',
    vipHash,
    'customer',
    null,
    'VIP account - Meridian Capital enterprise renewal in progress, handle ' +
      'personally. Do not share account details outside the account team. ' +
      `Internal tracking ref: ${config.flags.authBypass}`
  );

  // Challenge 06 (IDOR) target account: an ordinary synthetic customer, no
  // special credentials involved - the point is that ANY logged-in
  // customer can view THIS account's invoice by id, not that this account
  // itself is special or reachable via any auth flaw.
  const idorTargetId = await upsert(
    'Morgan Reyes',
    'morgan.reyes@northstar-industries.example',
    idorTargetHash,
    'customer',
    null
  );

  // Challenge 18 (Chained Attack) target account: a synthetic
  // "ops-integration" service account. Its own numeric id is the second
  // piece a player needs (alongside challenge 07's alg:none forgery
  // technique) to reach GET /company/api/internal/ops-console - see
  // routes/api.js. No publicly known password, same as the challenge 04/06
  // targets above.
  const opsIntegrationHash = await bcrypt.hash(require('crypto').randomBytes(24).toString('hex'), 12);
  const opsIntegrationId = await upsert(
    'Ops Integration',
    'ops-integration@instant.example',
    opsIntegrationHash,
    'customer',
    null
  );

  // Seed the demo customer with a starting loyalty point balance for
  // challenge 08 (Business Logic). Ordinary, not itself sensitive.
  await client.query(
    `UPDATE company_users SET loyalty_points = 150 WHERE id = $1 AND loyalty_points = 0`,
    [customerId]
  );

  console.log('[seed] ensured customer/employee/admin company accounts exist');
  return { customerId, employeeId, adminId, idorTargetId, opsIntegrationId };
}

async function seedProducts(client) {
  for (const p of PRODUCTS) {
    await client.query(
      `INSERT INTO products (name, slug, description, price_cents, category)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         price_cents = EXCLUDED.price_cents, category = EXCLUDED.category`,
      [p.name, p.slug, p.description, p.price_cents, p.category]
    );
  }
  console.log(`[seed] upserted ${PRODUCTS.length} products`);
}

async function seedBlogPosts(client) {
  for (const b of BLOG_POSTS) {
    await client.query(
      `INSERT INTO blog_posts (title, slug, content, author)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title, content = EXCLUDED.content, author = EXCLUDED.author`,
      [b.title, b.slug, b.content, b.author]
    );
  }
  console.log(`[seed] upserted ${BLOG_POSTS.length} blog posts`);
}

async function seedOrdersAndInvoices(client, customerId) {
  const { rows: existing } = await client.query(
    'SELECT COUNT(*)::int AS n FROM orders WHERE customer_id = $1',
    [customerId]
  );
  if (existing[0].n > 0) {
    console.log('[seed] orders/invoices already present for demo customer, skipping');
    return;
  }

  const orderRows = [
    { status: 'paid', total_cents: 9900 },
    { status: 'paid', total_cents: 1900 },
    { status: 'pending', total_cents: 4900 },
  ];

  let i = 0;
  for (const o of orderRows) {
    i += 1;
    const { rows } = await client.query(
      `INSERT INTO orders (customer_id, status, total_cents) VALUES ($1,$2,$3) RETURNING id`,
      [customerId, o.status, o.total_cents]
    );
    const orderId = rows[0].id;
    await client.query(
      `INSERT INTO invoices (order_id, invoice_number, amount_cents, status)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (invoice_number) DO NOTHING`,
      [orderId, `INV-2026-${String(orderId).padStart(4, '0')}`, o.total_cents, o.status === 'paid' ? 'paid' : 'unpaid']
    );
  }
  console.log(`[seed] created ${orderRows.length} demo orders + invoices`);
}

async function seedIdorTargetInvoice(client, idorTargetId) {
  // Challenge 06 (IDOR) target row: an invoice belonging to the seeded
  // "Morgan Reyes" account (see seedCompanyUsers), reachable by any
  // authenticated customer who requests it by id via
  // GET /company/portal/invoices/:id - see routes/portal.js. Never linked
  // from that account's own pages to anyone but that account in normal use.
  const { rows: existing } = await client.query(
    'SELECT o.id FROM orders o WHERE o.customer_id = $1 LIMIT 1',
    [idorTargetId]
  );
  if (existing.length > 0) return;

  const { rows: orderRows } = await client.query(
    `INSERT INTO orders (customer_id, status, total_cents) VALUES ($1,'paid',29900) RETURNING id`,
    [idorTargetId]
  );
  const orderId = orderRows[0].id;

  await client.query(
    `INSERT INTO invoices (order_id, invoice_number, amount_cents, status, internal_memo)
     VALUES ($1,$2,$3,'paid',$4)
     ON CONFLICT (invoice_number) DO NOTHING`,
    [
      orderId,
      `INV-2026-${String(orderId).padStart(4, '0')}`,
      29900,
      'Enterprise SLA credit approved by finance - do not share this memo ' +
        `outside the billing team. Internal tracking ref: ${config.flags.idor}`,
    ]
  );
  console.log('[seed] created IDOR-target invoice');
}

async function seedOpsIntegrationInvoice(client, opsIntegrationId) {
  // Challenge 18 (Chained Attack), step one: reachable via the exact same
  // IDOR as challenge 06 (routes/portal.js GET /invoices/:id has no
  // ownership check) - a player who is already enumerating small invoice
  // ids for challenge 06 will run across this one too. Its memo reveals
  // the numeric account id needed for step two.
  const { rows: existing } = await client.query(
    'SELECT o.id FROM orders o WHERE o.customer_id = $1 LIMIT 1',
    [opsIntegrationId]
  );
  if (existing.length > 0) return;

  const { rows: orderRows } = await client.query(
    `INSERT INTO orders (customer_id, status, total_cents) VALUES ($1,'paid',0) RETURNING id`,
    [opsIntegrationId]
  );
  const orderId = orderRows[0].id;

  await client.query(
    `INSERT INTO invoices (order_id, invoice_number, amount_cents, status, internal_memo)
     VALUES ($1,$2,0,'paid',$3)
     ON CONFLICT (invoice_number) DO NOTHING`,
    [
      orderId,
      `INV-2026-${String(orderId).padStart(4, '0')}`,
      `Ops integration account - service ID ${opsIntegrationId} - reserved for ` +
        'automated admin:internal diagnostics only. Do not use for customer billing.',
    ]
  );
  console.log('[seed] created ops-integration invoice');
}

async function seedSupportEscalations(client) {
  const { rows: existing } = await client.query('SELECT COUNT(*)::int AS n FROM support_escalations');
  if (existing[0].n > 0) return;

  // Challenge 13 (Advanced SQL Injection) target row: never read by any
  // normal application feature - reachable only via the boolean-blind SQL
  // injection in the public order-tracking lookup (see routes/public.js).
  await client.query(
    `INSERT INTO support_escalations (reference, escalation_note, priority) VALUES ($1,$2,$3)`,
    [
      'ESC-2026-0042',
      'Meridian Capital renewal escalation - executive sponsor requested a ' +
        `same-day callback. Internal tracking ref: ${config.flags.advancedSqli}`,
      1,
    ]
  );
  console.log('[seed] created support escalation record');
}

async function seedSupportTickets(client, customerId) {
  const { rows: existing } = await client.query(
    'SELECT COUNT(*)::int AS n FROM support_tickets WHERE customer_id = $1',
    [customerId]
  );
  if (existing[0].n > 0) return;

  await client.query(
    `INSERT INTO support_tickets (customer_id, subject, message, status) VALUES
     ($1, 'Cannot export analytics report', 'The export button on the analytics page times out.', 'open'),
     ($1, 'Question about Enterprise pricing', 'Do you offer annual billing for the Enterprise plan?', 'closed')`,
    [customerId]
  );
  console.log('[seed] created demo support tickets');
}

async function seedInternalNotes(client) {
  const { rows: existing } = await client.query('SELECT COUNT(*)::int AS n FROM internal_notes');
  if (existing[0].n > 0) return;

  // Challenge 02 (SQL Injection) target row: never read by any normal
  // application feature, reachable only via the UNION-based injection in
  // the product search endpoint (see routes/public.js).
  await client.query(
    `INSERT INTO internal_notes (title, reference, content, priority, tag) VALUES ($1,$2,$3,$4,$5)`,
    [
      'Q3 Security Audit - Action Items',
      'SEC-2024-1187',
      'Product search endpoint flagged during external pen test for improper ' +
        `input handling on the "q" parameter. Tracking ref: ${config.flags.sqlInjection}. ` +
        'Remediate before next release.',
      1,
      'internal',
    ]
  );
  console.log('[seed] created internal engineering memo');
}

async function seedDocuments(client, employeeId) {
  const { rows: existing } = await client.query(
    'SELECT COUNT(*)::int AS n FROM documents WHERE employee_id = $1',
    [employeeId]
  );
  if (existing[0].n > 0) return;

  await client.query(
    `INSERT INTO documents (employee_id, filename, description) VALUES
     ($1, 'onboarding-checklist.txt', 'New hire onboarding checklist.'),
     ($1, 'support-runbook.txt', 'Standard operating procedure for the support queue.'),
     ($1, 'q1-team-notes.txt', 'Notes from the Q1 support team sync.')`,
    [employeeId]
  );
  console.log('[seed] created demo employee documents');
}

async function seed() {
  await runMigrations();
  const client = await pool.connect();
  try {
    const { customerId, employeeId, idorTargetId, opsIntegrationId } = await seedCompanyUsers(client);
    await seedProducts(client);
    await seedBlogPosts(client);
    await seedOrdersAndInvoices(client, customerId);
    await seedSupportTickets(client, customerId);
    await seedDocuments(client, employeeId);
    await seedInternalNotes(client);
    await seedIdorTargetInvoice(client, idorTargetId);
    await seedSupportEscalations(client);
    await seedOpsIntegrationInvoice(client, opsIntegrationId);
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
