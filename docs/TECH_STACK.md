# Tech Stack

## Summary

| Layer | Choice |
|---|---|
| Backend runtime | Node.js 20 (Alpine) |
| Web framework | Express 4 |
| Server-rendered views | EJS |
| Database | PostgreSQL 16 |
| DB driver | `pg` (node-postgres), raw parameterized SQL, no ORM |
| Session store | `express-session` + `connect-pg-simple` (Postgres-backed, no Redis) |
| Password hashing | `bcryptjs` |
| Reverse proxy | Nginx (Alpine) |
| Process orchestration | Docker Compose v2 |

## Backend: Node.js + Express

- Express is lightweight, has first-class Docker support, and a huge ecosystem of
  well-understood, well-documented vulnerable patterns (raw SQL, `child_process`,
  template engines, `multer` uploads, JWT libraries, SSRF-prone HTTP clients).
  That matters a lot for later phases: introducing a controlled vulnerability is a
  small, localized diff rather than fighting framework defaults.
- Idle memory footprint is small (~40-70MB per Node process), which matters on a
  2 vCPU / 8GB box running 7 containers plus Postgres and Nginx.
- Single language (JavaScript) across every custom service reduces maintenance
  burden — one dependency ecosystem, one style of Dockerfile, one test approach.

## Views: Server-rendered EJS (no SPA/JS framework)

- No frontend build pipeline (Webpack/Vite/etc.) to maintain, no separate frontend
  container, no CORS concerms between an SPA and API.
- Server-rendered HTML is also simply more realistic for an "enterprise SaaS from
  a few years ago" — and it is the natural substrate for classic web
  vulnerability classes (reflected/stored XSS, SSTI, IDOR via URL/body params)
  that later phases will introduce.
- Plain hand-written CSS (no framework) keeps the asset pipeline at zero — static
  files are served directly by Express/Nginx.

## Database: PostgreSQL 16

- Single Postgres instance, single database (`instant_ctf`), shared by all
  services that need persistence, differentiated by table ownership (see
  `docs/DATABASE.md`). One database process instead of "18 heavyweight
  databases" per the resource constraints in the spec.
- Raw SQL via `pg` (no ORM/query builder). This is deliberate: Phase 2+ will
  introduce SQL injection challenges into *specific, designated* endpoints, and
  raw parameterized queries make it trivial to swap one query from
  parameterized to string-concatenated without an ORM's query builder getting
  in the way or leaking protections into "vulnerable" code paths.
- Sessions are stored in Postgres via `connect-pg-simple` rather than adding
  Redis. A CTF platform for a single small EC2 instance does not need a
  separate cache/session tier — Postgres comfortably handles session reads at
  this scale, and one fewer moving part is one fewer thing to secure and
  operate.

## Reverse proxy: Nginx

- Nginx is the only container with a published host port (80/tcp, 443/tcp).
  Every other service is reachable only over internal Docker networks.
- Path-based routing sends `/` traffic to `ctf-platform` and `/company/*`
  traffic to `instant-web`. See `docs/ARCHITECTURE_DECISIONS.md` for why
  path-based routing was chosen over subdomains.

## Why not Laravel/PHP or Flask/Python

Both were reasonable alternatives (see the tech-stack question this project
started from). Node/Express was chosen over them because:

- **vs. Laravel/PHP**: Eloquent's query builder and Blade's auto-escaping are
  good defaults but add friction when a later phase needs a single endpoint to
  intentionally regress to raw, unparameterized SQL or unescaped output —
  Express has no such default to fight. PHP-FPM + MySQL is also a slightly
  heavier baseline footprint than Node + Postgres for equivalent functionality.
- **vs. Flask/Python**: Comparable fit (Jinja2 is great for later SSTI
  challenges), but Node's async I/O model maps more naturally onto the
  internal-service fan-out this design uses (instant-web calling internal-api,
  template-service, infra-service over HTTP), and keeps every service on one
  language/toolchain.

## Expected resource usage (steady state, idle)

| Container | RAM (idle) | Notes |
|---|---|---|
| nginx | ~5-10 MB | |
| postgres | ~80-150 MB | single instance, all schemas |
| ctf-platform | ~50-80 MB | Node/Express |
| instant-web | ~50-80 MB | Node/Express |
| internal-api | ~40-60 MB | Node/Express, minimal deps |
| template-service | ~40-60 MB | Node/Express, minimal deps |
| infra-service | ~40-60 MB | Node/Express, minimal deps |
| **Total** | **~350-500 MB** | Comfortable headroom in 8 GiB, no swap needed |

CPU usage is negligible at idle and low under single/small-group CTF player
load (this is a training platform, not a production SaaS under real traffic).
