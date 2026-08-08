# Admin Guide

## Seeded accounts

All credentials below are read from `.env` at seed time (see
`.env.example`) — **change them** before deploying anywhere shared or
public. Defaults shown are placeholders.

| Portal | Username/Email | Password (env var) |
|---|---|---|
| CTF platform admin | `SEED_ADMIN_USERNAME` (default `admin`) | `SEED_ADMIN_PASSWORD` |
| CTF platform demo player | `SEED_PLAYER_USERNAME` (default `demo_player`) | `SEED_PLAYER_PASSWORD` |
| Instant customer | `SEED_CUSTOMER_EMAIL` | `SEED_CUSTOMER_PASSWORD` |
| Instant employee | `SEED_EMPLOYEE_EMAIL` | `SEED_EMPLOYEE_PASSWORD` |
| Instant company admin | `SEED_COMPANY_ADMIN_EMAIL` | `SEED_COMPANY_ADMIN_PASSWORD` |

These are two entirely separate identity domains — see
"Identity domains" in `docs/ARCHITECTURE.md`. The CTF platform admin
account manages the CTF itself (players, challenges, scoreboard); the
Instant company admin account is a seeded **target** account within the
fictional company, reachable at `/company/admin/login`.

## CTF platform admin panel

Log in as the seeded CTF admin, then visit `/admin`:

- **`/admin`** — overview counts (players, challenges, solves), plus Seed /
  Reset actions.
- **`/admin/players`** — every registered player, their score, and solve
  count.
- **`/admin/challenges`** — every challenge, with an Enable/Disable toggle.
  Disabled challenges are hidden from the player-facing `/challenges` list.
- **`/admin/solves`** — most recent 200 solves across all players, most
  recent first.
- **`/admin/health`** — this service's DB connectivity, plus a live check of
  `instant-web`'s `/health` endpoint.

### Seed (from the UI)

"Run Seed" on `/admin` calls the same idempotent seed logic as
`scripts/seed.sh` — safe to click repeatedly. It upserts challenge
definitions and ensures the built-in admin/demo-player accounts exist; it
does not touch existing player accounts, scores, or solves.

### Reset (from the UI)

"Reset Platform" on `/admin` is **destructive** — it wipes every player,
solve, and challenge row, then re-seeds from scratch (equivalent to
`scripts/reset.sh` for the CTF platform half). You must type `RESET` in the
confirmation field. After a reset, you'll be logged out (your own player row
no longer exists) — log back in with the seeded admin credentials from
`.env`.

**When to reset:** between CTF cohorts/events, or after a testing session
where you don't want leftover player accounts/scores. Not something to run
casually on a live event.

## Instant company admin portal

Log in at `/company/admin/login` with the seeded company admin credentials.
This is the **target application's** admin surface (part of the fictional
Instant company, not the CTF meta-layer):

- **`/company/admin/dashboard`** — user/order/revenue overview.
- **`/company/admin/users`** — all company accounts (customer/employee/admin).
- **`/company/admin/orders`** — all orders across all customers.
- **`/company/admin/analytics`** — users-by-role, tickets-by-status, revenue.
- **`/company/admin/tools`** — live status of `internal-api`,
  `template-service`, and `infra-service`, fetched server-side over the
  `internal` Docker network (these three services are not reachable any
  other way, including from the CTF platform's own admin panel).
- **`/company/admin/settings`** — placeholder, no settings management yet.

## Command-line operations

```bash
./scripts/setup.sh        # first-time: build, start, wait for health, seed
./scripts/seed.sh          # idempotent: upsert challenges/products, ensure demo accounts
./scripts/reset.sh          # DESTRUCTIVE: wipe + re-seed everything (prompts for confirmation)
./scripts/reset.sh --yes    # same, without the interactive prompt
./scripts/healthcheck.sh    # check every service's /health through nginx + container health status
```

Equivalent direct commands:

```bash
docker compose exec ctf-platform node src/seed.js
docker compose exec instant-web node src/seed.js
docker compose exec ctf-platform node src/reset.js
docker compose exec instant-web node src/reset.js
```

## Troubleshooting

- **A service won't become healthy**: `docker compose logs <service>` —
  structured JSON log lines include an `event` field
  (`login_failed`, `flag_submission`, `unhandled_error`, etc.).
- **Migrations seem stuck/failed**: migrations run automatically on service
  startup and are wrapped in transactions; a failed migration prevents the
  service from starting — check `docker compose logs ctf-platform` /
  `instant-web` for the specific `[migrate] applying ...` line that failed.
- **Can't reach an internal service directly**: that's by design — see
  `docs/SECURITY.md` "Verifying isolation". Use `/company/admin/tools`
  instead, which proxies status through `instant-web`.
- **Locked out of the CTF admin panel**: log in with the credentials from
  your `.env` (`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`). If those were
  changed after the account already existed, seeding won't reset the
  password (seed only creates missing accounts, `ON CONFLICT DO NOTHING`) —
  use `scripts/reset.sh` to fully rebuild, or update the password directly
  in Postgres.
