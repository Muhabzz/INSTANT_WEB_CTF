-- Instant company schema: users, products, orders, invoices, support
-- tickets, documents, blog posts. Owned by instant-web. Portal session
-- tables (customer_sessions, employee_sessions, admin_sessions) are managed
-- automatically by connect-pg-simple at runtime.

CREATE TABLE IF NOT EXISTS company_users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(128) NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          VARCHAR(16) NOT NULL CHECK (role IN ('customer', 'employee', 'admin')),
    department    VARCHAR(64),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    slug        VARCHAR(128) UNIQUE NOT NULL,
    description TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    category    VARCHAR(64) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
    id          SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES company_users(id) ON DELETE CASCADE,
    status      VARCHAR(24) NOT NULL DEFAULT 'pending',
    total_cents INTEGER NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
    id             SERIAL PRIMARY KEY,
    order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    invoice_number VARCHAR(32) UNIQUE NOT NULL,
    amount_cents   INTEGER NOT NULL,
    status         VARCHAR(24) NOT NULL DEFAULT 'unpaid',
    issued_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_tickets (
    id          SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES company_users(id) ON DELETE CASCADE,
    subject     VARCHAR(200) NOT NULL,
    message     TEXT NOT NULL,
    status      VARCHAR(24) NOT NULL DEFAULT 'open',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
    id          SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES company_users(id) ON DELETE CASCADE,
    filename    VARCHAR(255) NOT NULL,
    description TEXT,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blog_posts (
    id           SERIAL PRIMARY KEY,
    title        VARCHAR(200) NOT NULL,
    slug         VARCHAR(200) UNIQUE NOT NULL,
    content      TEXT NOT NULL,
    author       VARCHAR(128) NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_customer ON support_tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_documents_employee ON documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_company_users_role ON company_users(role);
