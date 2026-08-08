#!/bin/bash
# Runs once, automatically, when the postgres container first initializes an
# empty data directory (standard docker-entrypoint-initdb.d behavior - see
# the official postgres image docs). Creates two least-privilege application
# roles so that a SQL injection reachable through one trust domain (the
# Instant company app) cannot read another trust domain's tables (the CTF
# platform's players/challenges/solves) even though they share one Postgres
# instance/database (see ADR #3 in docs/ARCHITECTURE_DECISIONS.md).
#
# Each role only gets CREATE on the public schema - migrations run under
# that role at service startup, and Postgres makes the creating role the
# owner of whatever it creates, so each service ends up with full rights on
# its own tables and NO access to the other's, without needing a giant list
# of manual per-table GRANTs to maintain.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${PLATFORM_DB_USER}') THEN
      CREATE ROLE ${PLATFORM_DB_USER} WITH LOGIN PASSWORD '${PLATFORM_DB_PASSWORD}';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${COMPANY_DB_USER}') THEN
      CREATE ROLE ${COMPANY_DB_USER} WITH LOGIN PASSWORD '${COMPANY_DB_PASSWORD}';
    END IF;
  END
  \$\$;

  GRANT CREATE ON SCHEMA public TO ${PLATFORM_DB_USER};
  GRANT CREATE ON SCHEMA public TO ${COMPANY_DB_USER};

  -- Pre-create the shared migration-tracking table (used by both services'
  -- migrate.js) so neither role's "CREATE TABLE IF NOT EXISTS" ends up
  -- silently owning it ahead of the other - ownership order would otherwise
  -- depend on which container happens to start first.
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  GRANT SELECT, INSERT ON schema_migrations TO ${PLATFORM_DB_USER}, ${COMPANY_DB_USER};
EOSQL
