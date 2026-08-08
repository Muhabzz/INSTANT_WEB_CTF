-- Session tables for connect-pg-simple, created explicitly (rather than via
-- the library's createTableIfMissing) because that option hardcodes the
-- primary key / index names ("session_pkey", "IDX_session_expire")
-- regardless of table name. With three portal session tables in this same
-- database (plus ctf-platform's platform_sessions), letting the library
-- auto-create them causes the second and third to fail with
-- "relation session_pkey already exists". Owning the schema explicitly
-- avoids the collision.

CREATE TABLE IF NOT EXISTS customer_sessions (
    sid    VARCHAR NOT NULL COLLATE "default",
    sess   JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL,
    CONSTRAINT customer_sessions_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_expire ON customer_sessions (expire);

CREATE TABLE IF NOT EXISTS employee_sessions (
    sid    VARCHAR NOT NULL COLLATE "default",
    sess   JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL,
    CONSTRAINT employee_sessions_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS idx_employee_sessions_expire ON employee_sessions (expire);

CREATE TABLE IF NOT EXISTS admin_sessions (
    sid    VARCHAR NOT NULL COLLATE "default",
    sess   JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL,
    CONSTRAINT admin_sessions_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expire ON admin_sessions (expire);
