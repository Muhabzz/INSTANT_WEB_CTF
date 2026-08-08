-- Session table for connect-pg-simple, created explicitly (rather than via
-- the library's createTableIfMissing) because that option hardcodes the
-- primary key / index names ("session_pkey", "IDX_session_expire")
-- regardless of table name - fine for a single session table, but this
-- database also holds instant-web's three portal session tables, and a
-- second store trying to create a differently-named table still collides
-- on that same hardcoded constraint name. Owning the schema explicitly
-- avoids the collision.

CREATE TABLE IF NOT EXISTS platform_sessions (
    sid    VARCHAR NOT NULL COLLATE "default",
    sess   JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL,
    CONSTRAINT platform_sessions_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS idx_platform_sessions_expire ON platform_sessions (expire);
