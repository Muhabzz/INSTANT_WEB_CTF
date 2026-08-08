# Architecture

## Overview

```
                              INTERNET
                                 |
                          (80/tcp, 443/tcp)
                                 v
                       +-------------------+
                       |       nginx       |   <-- only publicly reachable service
                       |  (reverse proxy)  |
                       +-------------------+
                          |             |
                     "/"  |             | "/company/*"
                          v             v
                +----------------+  +----------------+
                |  ctf-platform  |  |  instant-web   |
                |  (CTF meta-    |  |  (public site, |
                |   layer)       |  |   customer/    |
                |                |  |   employee/    |
                |                |  |   admin portal)|
                +----------------+  +----------------+
                        |                   |     \
                        |                   |      \  (internal network)
                        |                   |       v
                        |                   |   +--------------+  +------------------+  +---------------+
                        |                   |   | internal-api |  | template-service |  | infra-service |
                        |                   |   +--------------+  +------------------+  +---------------+
                        |                   |          |
                        v                   v          v
                       +------------------------------------+
                       |             postgres               |
                       |     (single instance, db network)  |
                       +------------------------------------+
```

## Services

| Service | Role | Public? | Networks |
|---|---|---|---|
| `nginx` | Reverse proxy, single public entrypoint | Yes (80/443) | `public`, `app` |
| `ctf-platform` | CTF meta-layer: registration, login, dashboard, challenges, flag submission, scoreboard, admin | No | `app`, `db` |
| `instant-web` | Instant company app: public site, customer portal, employee portal, company admin portal | No | `app`, `db`, `internal` |
| `internal-api` | Read-only JSON views over company data, consumed server-side by `instant-web` | No | `internal`, `db` |
| `template-service` | Renders a fixed whitelist of internal HTML templates (e.g. invoices) | No | `internal` |
| `infra-service` | Synthetic internal ops/status endpoint | No | `internal` |
| `postgres` | Single Postgres 16 instance, all application data | No | `db` |

Only `nginx` has ports published to the host. Every other service is reachable
exclusively over internal Docker networks.

## Docker networks

- **`public`** — nginx's internet-facing side. Only nginx is ever a member.
- **`app`** (external-capable bridge) — nginx &harr; `ctf-platform`, nginx &harr; `instant-web`.
- **`internal`** (`internal: true`, no outbound internet route) — `instant-web` &harr; `internal-api` / `template-service` / `infra-service`. Not reachable from `nginx` or `public`.
- **`db`** (`internal: true`, no outbound internet route) — `postgres` &harr; `ctf-platform` / `instant-web` / `internal-api`.

This means a compromise of `template-service` or `infra-service`, for
example, has no direct network path to the public internet, to Postgres, or
to `nginx` — only to `instant-web`, which is the one service that bridges
the `app`, `db`, and `internal` networks.

## Request routing

nginx routes by path prefix on a single host (see
`docs/ARCHITECTURE_DECISIONS.md` #1 for why, instead of subdomains):

- `/` → `ctf-platform` (dashboard, challenges, scoreboard, admin, etc.)
- `/company/*` → `instant-web`, prefix stripped before proxying. Internally,
  `instant-web` mounts:
  - `/` — public site (home, products, blog, about, careers, contact, support)
  - `/portal/*` — customer portal (browser URL: `/company/portal/*`)
  - `/employee/*` — employee portal (browser URL: `/company/employee/*`)
  - `/admin/*` — company admin portal (browser URL: `/company/admin/*`)

## Identity domains

There are two entirely separate identity/session domains, deliberately not
unified (see ADR #5):

1. **CTF players** (`players` table, `ctf-platform`) — the human using this
   platform to play the CTF. One session cookie (`platform_sid`).
2. **Instant company accounts** (`company_users` table, `instant-web`) — NPC
   accounts within the fictional company (`customer`, `employee`, `admin`
   roles) that the player attacks. Three separate session cookies
   (`customer_sid`, `employee_sid`, `company_admin_sid`), each scoped by
   cookie `path` to its portal and backed by its own Postgres session table
   and secret — a customer session is never valid on the employee or admin
   portal, and vice versa.

## Container hardening

Every custom/official container in `docker-compose.yml`:

- `cap_drop: [ALL]` (nginx adds back only `NET_BIND_SERVICE`, required to
  bind ports 80/443)
- `security_opt: [no-new-privileges:true]`
- `privileged: false`
- No Docker socket mounted anywhere
- No host filesystem bind mounts except nginx's own read-only config files
- No `network_mode: host`
- Runs as a non-root user (Node services via a dedicated `app` user in each
  Dockerfile; Postgres via the upstream image's own `postgres` user; nginx's
  worker processes drop to `nginx` internally after the privileged bind)

See `docs/SECURITY.md` for the full checklist and rationale.
