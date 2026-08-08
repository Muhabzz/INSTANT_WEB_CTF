// Destructive: wipes all company data (users, orders, invoices, tickets,
// documents, products, blog posts, sessions) back to the seed baseline.
// See docs/ADMIN_GUIDE.md.
const { pool } = require('./db');
const { seed } = require('./seed');

const SESSION_TABLES = ['customer_sessions', 'employee_sessions', 'admin_sessions'];

async function reset() {
  const client = await pool.connect();
  try {
    console.log('[reset] truncating company tables');
    await client.query(`
      TRUNCATE TABLE invoices, orders, support_tickets, documents,
                     blog_posts, products, company_users
      RESTART IDENTITY CASCADE
    `);

    for (const table of SESSION_TABLES) {
      const { rows } = await client.query(`SELECT to_regclass('public.${table}') AS reg`);
      if (rows[0].reg) {
        await client.query(`TRUNCATE TABLE ${table}`);
      }
    }
  } finally {
    client.release();
  }

  console.log('[reset] re-seeding baseline data');
  await seed();
  console.log('[reset] complete');
}

if (require.main === module) {
  reset()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[reset] failed', err);
      process.exit(1);
    });
}

module.exports = { reset };
