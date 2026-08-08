# INSTANT WEB CTF

A self-hosted, intentionally vulnerable Web CTF platform built around a
realistic fictional SaaS company, **Instant**. Players register on the CTF
meta-platform, then perform reconnaissance and penetration testing against
Instant's public website, customer portal, employee portal, admin portal,
and internal services — capturing `INSTANT{...}` flags along the way.

> **Authorized use only.** This is a training platform. Do not deploy it
> anywhere it could be reached by anyone outside your intended training
> audience. See `docs/SECURITY.md`.

## Status: Phase 1

This build currently ships the **platform skeleton only** — architecture,
authentication, database, challenge/flag framework, scoreboard, admin
tooling, Docker isolation, and the full Instant company application
skeleton. **None of the 18 planned vulnerabilities are implemented yet.**
Only one challenge (`getting-started`) is enabled, to validate the
submission/scoring framework end-to-end. See `docs/CHALLENGES.md`.

## Quick start

```bash
cp .env.example .env   # edit secrets before any shared/public deployment
./scripts/setup.sh
```

Then visit:
- `http://localhost/` — the CTF platform (register here first)
- `http://localhost/company/` — the Instant company environment

See `docs/DEPLOYMENT.md` for the full deployment guide, and
`docs/ADMIN_GUIDE.md` for seeded credentials and admin operations.

## Documentation

| Doc | Covers |
|---|---|
| [`docs/TECH_STACK.md`](docs/TECH_STACK.md) | Stack choice and why |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Services, networks, request routing |
| [`docs/ARCHITECTURE_DECISIONS.md`](docs/ARCHITECTURE_DECISIONS.md) | Notable design decisions (decision/reason/alternatives) |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Schema, migrations, seed data |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Local dev, Docker deployment, env vars, TLS |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Isolation posture, hardening checklist |
| [`docs/CHALLENGES.md`](docs/CHALLENGES.md) | The 18 challenges, flag format, progression model |
| [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md) | Seeded accounts, admin panels, CLI operations, troubleshooting |

## Architecture at a glance

```
INTERNET -> nginx (only public service, 80/443)
              |
    +---------+---------+
    |                   |
ctf-platform        instant-web  --(internal network)--> internal-api / template-service / infra-service
 (CTF meta-layer)   (Instant company:                              |
    |                public site, customer/                        |
    |                employee/admin portals)                       |
    +-------------------+-----------------------------------------+
                         |
                     postgres (single instance, db network only)
```

Full diagram and rationale in `docs/ARCHITECTURE.md`.

## Tech stack

Node.js/Express + EJS + PostgreSQL + Nginx, plain Docker Compose (no
Kubernetes, no Redis/Kafka/Elasticsearch). See `docs/TECH_STACK.md` for the
reasoning.

## Repository layout

```
docker-compose.yml
.env.example
nginx/                     reverse proxy config
services/
  ctf-platform/             CTF meta-layer (auth, dashboard, challenges, scoreboard, admin)
  instant-web/               Instant company app (public site + 3 portals)
  internal-api/               internal-only, read-only company data API
  template-service/           internal-only HTML template rendering
  infra-service/               internal-only synthetic ops/status endpoint
scripts/                    setup.sh, seed.sh, reset.sh, healthcheck.sh
docs/                       see table above
```
