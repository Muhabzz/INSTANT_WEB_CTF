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
];

async function seedCompanyUsers(client) {
  const customerHash = await bcrypt.hash(config.seed.customerPassword, 12);
  const employeeHash = await bcrypt.hash(config.seed.employeePassword, 12);
  const adminHash = await bcrypt.hash(config.seed.companyAdminPassword, 12);

  const upsert = async (name, email, hash, role, department) => {
    const { rows } = await client.query(
      `INSERT INTO company_users (name, email, password_hash, role, department)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [name, email, hash, role, department]
    );
    if (rows[0]) return rows[0].id;
    const existing = await client.query('SELECT id FROM company_users WHERE email = $1', [email]);
    return existing.rows[0].id;
  };

  const customerId = await upsert('Jordan Customer', config.seed.customerEmail, customerHash, 'customer', null);
  const employeeId = await upsert('Sam Employee', config.seed.employeeEmail, employeeHash, 'employee', 'Support');
  const adminId = await upsert('Riley Admin', config.seed.companyAdminEmail, adminHash, 'admin', 'Operations');

  console.log('[seed] ensured customer/employee/admin company accounts exist');
  return { customerId, employeeId, adminId };
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
    const { customerId, employeeId } = await seedCompanyUsers(client);
    await seedProducts(client);
    await seedBlogPosts(client);
    await seedOrdersAndInvoices(client, customerId);
    await seedSupportTickets(client, customerId);
    await seedDocuments(client, employeeId);
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
