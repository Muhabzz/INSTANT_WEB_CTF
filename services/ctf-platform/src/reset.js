// Destructive: wipes all platform data (players, challenges, solves, logs,
// sessions) back to the seed baseline. See docs/ADMIN_GUIDE.md.
const { pool } = require('./db');
const { seed } = require('./seed');

async function reset() {
  const client = await pool.connect();
  try {
    console.log('[reset] truncating platform tables');
    await client.query(`
      TRUNCATE TABLE submission_log, solves, challenges, players
      RESTART IDENTITY CASCADE
    `);

    const sessionTable = await client.query(
      `SELECT to_regclass('public.platform_sessions') AS reg`
    );
    if (sessionTable.rows[0].reg) {
      await client.query('TRUNCATE TABLE platform_sessions');
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
