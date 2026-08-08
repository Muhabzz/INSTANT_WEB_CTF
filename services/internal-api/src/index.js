require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const PORT = parseInt(process.env.INTERNAL_API_PORT || '4001', 10);

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'instant_ctf',
  user: process.env.POSTGRES_USER || 'instant_ctf',
  password: process.env.POSTGRES_PASSWORD || '',
  max: 5,
});

const app = express();

function log(event, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'internal-api', event, ...meta }));
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', service: 'internal-api', db: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error', service: 'internal-api', db: 'unreachable' });
  }
});

// Read-only views over company data, consumed server-side by instant-web.
// Not reachable from the public internet - only over the `internal` Docker
// network. Kept read-only and free of authentication secrets on purpose:
// this is infrastructure surface, not a user-facing API.

app.get('/internal/users', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, department, created_at FROM company_users ORDER BY id ASC'
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

app.get('/internal/orders', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, customer_id, status, total_cents, created_at FROM orders ORDER BY id ASC'
    );
    res.json({ orders: rows });
  } catch (err) {
    next(err);
  }
});

app.get('/internal/tickets', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, customer_id, subject, status, created_at FROM support_tickets ORDER BY id ASC'
    );
    res.json({ tickets: rows });
  } catch (err) {
    next(err);
  }
});

app.get('/internal/documents', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, employee_id, filename, description, uploaded_at FROM documents ORDER BY id ASC'
    );
    res.json({ documents: rows });
  } catch (err) {
    next(err);
  }
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  log('unhandled_error', { message: err.message });
  res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, () => log('server_started', { port: PORT }));
