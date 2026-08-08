# Deployment

## Requirements

- Docker Engine + Docker Compose v2 (`docker compose version`)
- A host with at least 2 vCPU / 4GB RAM (target: AWS EC2, Ubuntu 24.04, 2 vCPU / 8GB RAM / ~77GB disk, per `docs/TECH_STACK.md`)

## Quick start

```bash
git clone <this repo>
cd INSTANT_WEB_CTF
./scripts/setup.sh
```

`scripts/setup.sh`:
1. Copies `.env.example` → `.env` if `.env` doesn't exist yet (edit it and set real secrets before deploying anywhere shared/public).
2. `docker compose build`
3. `docker compose up -d`
4. Waits for `ctf-platform`, `instant-web`, and `nginx` to report healthy.
5. Runs `scripts/seed.sh`.

Then visit:
- `http://<host>/` — the CTF platform (register/login here first)
- `http://<host>/company/` — the Instant company environment

## Manual steps (equivalent to setup.sh)

```bash
cp .env.example .env        # edit secrets first
docker compose build
docker compose up -d
docker compose exec ctf-platform node src/seed.js
docker compose exec instant-web node src/seed.js
```

## Environment variables

See `.env.example` for the full list with inline documentation. Required
categories:

- Postgres credentials (`POSTGRES_*`)
- Session secrets, one per trust domain (`PLATFORM_SESSION_SECRET`,
  `COMPANY_CUSTOMER_SESSION_SECRET`, `COMPANY_EMPLOYEE_SESSION_SECRET`,
  `COMPANY_ADMIN_SESSION_SECRET`) — generate with e.g. `openssl rand -hex 32`
- Seed account credentials (`SEED_*`) — change these before any
  shared/public deployment
- Internal service URLs (`INTERNAL_API_URL`, `TEMPLATE_SERVICE_URL`,
  `INFRA_SERVICE_URL`) — Docker service DNS names, only resolvable inside
  the `internal` network; leave as-is unless you rename services in
  `docker-compose.yml`

Never commit a real `.env` file — it's excluded via `.gitignore`.

## Database initialization

Handled automatically: each service (`ctf-platform`, `instant-web`) runs its
own migrations on startup before it starts listening (`src/migrate.js`,
invoked from `src/index.js`). No manual migration step is required after
`docker compose up -d`; seeding is the only manual step (see above).

## Reset

```bash
./scripts/reset.sh
```

**Destructive.** Wipes all players, company users, orders, invoices,
tickets, documents, and sessions, then re-seeds from scratch. Prompts for
confirmation unless run as `./scripts/reset.sh --yes`. See
`docs/ADMIN_GUIDE.md` for when to use this, and the admin panel's
"Reset Platform" button for triggering it from the ctf-platform UI.

## Health checks

```bash
./scripts/healthcheck.sh
# or, against a non-default host:
./scripts/healthcheck.sh http://your-host
```

Checks (through nginx, the only public entrypoint):
- `GET /nginx-health` → 200 (nginx itself)
- `GET /health` → 200 JSON (`ctf-platform`)
- `GET /company/health` → 200 JSON (`instant-web`)

Also prints each container's Docker-reported health status and published
host ports (should show `80`/`443` on `nginx` only — every other service
should show no published ports).

## TLS / HTTPS (443)

Phase 1 ships with nginx listening on port 80 only; port 443 is published by
the `nginx` container in `docker-compose.yml` but has no `server` block yet,
since there's no domain/certificate available in this local/Phase-1
environment. To enable HTTPS on a real deployment:

1. Obtain a certificate for your domain (e.g. via `certbot`).
2. Mount the certificate/key into the `nginx` service in `docker-compose.yml`
   (read-only bind mount, same pattern as the existing config mounts).
3. Add a `server { listen 443 ssl; ... }` block to
   `nginx/conf.d/default.conf` pointing at the mounted cert/key, and either
   redirect port 80 to 443 or leave both active.
4. Set `COOKIE_SECURE=true` in `.env` and restart `ctf-platform` and
   `instant-web`. Session cookies are marked `Secure` based on this flag,
   not `NODE_ENV` — leaving it `false` without TLS is required (a `Secure`
   cookie sent over plain HTTP is silently dropped by the browser, which
   breaks login); leaving it `false` **with** TLS in front just means
   cookies aren't forced HTTPS-only.

## Restarting

`docker compose restart` (or `down` + `up -d`) is safe — Postgres data
persists in the named volume `postgres-data`, and migrations/seeds are
idempotent.

## Scaling down / stopping

```bash
docker compose down          # stop and remove containers, keep data volume
docker compose down -v       # stop and remove containers AND the Postgres data volume (destructive)
```
