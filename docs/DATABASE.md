# Database

Single PostgreSQL 16 instance, single database (`instant_ctf`), shared by
`ctf-platform`, `instant-web`, and (read-only) `internal-api`. See ADR #3 in
`docs/ARCHITECTURE_DECISIONS.md` for why this isn't split into multiple
database instances/schemas.

Each service owns and migrates its own tables (tracked in a shared
`schema_migrations` table, keyed by migration filename — safe because
migration filenames are unique across services).

## Platform tables (owned by `ctf-platform`)

### `players`
CTF player accounts.

| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| username | varchar(32) unique | |
| email | varchar(255) unique | |
| password_hash | text | bcrypt, cost 12 |
| is_admin | boolean | default false |
| created_at | timestamptz | |

### `challenges`
| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| slug | varchar(64) unique | |
| title | varchar(128) | |
| description | text | |
| category | varchar(64) | |
| difficulty | varchar(16) | beginner/easy/medium/hard/advanced |
| points | integer | |
| flag_hash | char(64) | sha256 hex digest of the flag — the plaintext flag is never stored in the database, only known to the seed source and, once solved, echoed back to the solving player in `solves.submitted_flag` |
| enabled | boolean | admin-togglable |
| order_index | integer | display order |
| prerequisite_id | integer FK → challenges.id | reserved for later hybrid-progression chains |
| created_at | timestamptz | |

### `solves`
Records a correct, first-time flag submission. `UNIQUE (player_id, challenge_id)` is what prevents duplicate scoring — a second correct submission for an already-solved challenge is a no-op (`ON CONFLICT DO NOTHING`).

| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| player_id | integer FK → players.id | |
| challenge_id | integer FK → challenges.id | |
| submitted_flag | text | the flag text that was accepted |
| points_awarded | integer | snapshot of challenge points at solve time |
| solved_at | timestamptz | |

### `submission_log`
Every submission attempt (correct or not), for troubleshooting/analytics. Does not store the submitted flag text (avoids accumulating a plaintext log of guessed flags).

| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| player_id | integer FK → players.id | |
| challenge_id | integer FK → challenges.id | nullable |
| correct | boolean | |
| created_at | timestamptz | |

### `platform_sessions`
Backs `connect-pg-simple`. Created by an explicit migration
(`0002_sessions.sql`), not the library's `createTableIfMissing` — that
option hardcodes the primary key/index names (`session_pkey`,
`IDX_session_expire`) regardless of table name, which collides across the
multiple session tables sharing this database (see the same note under
`instant-web` below).

## Company tables (owned by `instant-web`)

### `company_users`
Instant's own accounts — customers, employees, admins. Distinct from `players`; see ADR #5.

| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| name | varchar(128) | |
| email | varchar(255) unique | |
| password_hash | text | bcrypt, cost 12 |
| role | varchar(16) | CHECK IN ('customer','employee','admin') |
| department | varchar(64) | nullable |
| created_at | timestamptz | |

### `products`
Public product catalog. `id, name, slug, description, price_cents, category, created_at`.

### `orders`
`id, customer_id → company_users.id, status, total_cents, created_at`.

### `invoices`
`id, order_id → orders.id, invoice_number (unique), amount_cents, status, issued_at`.

### `support_tickets`
`id, customer_id → company_users.id, subject, message, status, created_at`.

### `documents`
Employee document metadata (Phase 1 stores metadata only, no binary storage). `id, employee_id → company_users.id, filename, description, uploaded_at`.

### `blog_posts`
`id, title, slug (unique), content, author, published_at`.

### `customer_sessions` / `employee_sessions` / `admin_sessions`
One `connect-pg-simple`-backed table per portal (see ADR #5 / ARCHITECTURE.md
"Identity domains"), created explicitly by `0002_sessions.sql` with distinct
primary key/index names per table — letting `connect-pg-simple` auto-create
these (`createTableIfMissing: true`) fails for the second and third table:
the library's default `table.sql` template names the primary key constraint
literally `session_pkey` and the index `IDX_session_expire` regardless of
the configured table name, so multiple differently-named session tables in
the same schema collide on those fixed names (`relation "session_pkey"
already exists`).

## Migrations

Plain numbered `.sql` files per service (`services/<service>/migrations/000N_*.sql`), applied in filename order by a small runner (`src/migrate.js`) that tracks applied migrations in `schema_migrations` and wraps each file in a transaction. Migrations run automatically on service startup — they are additive (`CREATE TABLE IF NOT EXISTS`) and safe to run repeatedly.

## Seed data

`src/seed.js` in each service is idempotent (`ON CONFLICT` upserts / existence checks) and safe to re-run. See `docs/ADMIN_GUIDE.md` for seeded account credentials and what `scripts/seed.sh` / `scripts/reset.sh` do.
