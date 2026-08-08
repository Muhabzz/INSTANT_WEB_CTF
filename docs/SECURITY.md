# Security

INSTANT_WEB_CTF is an intentionally vulnerable training platform. This
document covers Phase 1 only: the platform skeleton, before any of the 18
planned vulnerabilities are introduced. **Do not deploy this to a host that
also runs anything else you care about**, and do not expose it beyond a
controlled training network unless you understand and accept that later
phases will contain deliberate, exploitable vulnerabilities by design.

## What's safe by design (Phase 1)

The CTF meta-platform (`ctf-platform`) and the Instant company skeleton
(`instant-web`) are built to normal secure-coding standards, and will
**stay** that way even after later phases introduce challenge
vulnerabilities elsewhere:

- Passwords hashed with bcrypt (cost 12), never logged, never returned in
  any response.
- Parameterized SQL everywhere (`pg` with placeholders, no string-built
  queries).
- Session cookies: `httpOnly`, `sameSite=lax`, `secure` when
  `COOKIE_SECURE=true` (set this once TLS is in front — see
  `docs/DEPLOYMENT.md`), signed with a per-portal secret, stored
  server-side in Postgres (not client-readable).
- CSRF protection (synchronizer token pattern) on every state-changing
  (`POST`) form across both apps.
- Rate limiting on all login/register endpoints.
- Flags are stored only as sha256 hashes (`challenges.flag_hash`) —
  plaintext flags exist only in the seed source and, transiently, in a
  solving player's own submission record.
- No secrets, API keys, or real credentials anywhere in the repo; `.env` is
  gitignored; `.env.example` ships only placeholders.

Per the project spec, **intentional vulnerabilities belong only in the
Instant company challenge surfaces** introduced in later phases — never in
the CTF platform's own auth/session/admin machinery.

## Network isolation

See `docs/ARCHITECTURE.md` for the full network diagram. Summary:

- Only `nginx` publishes host ports (80/tcp, 443/tcp).
- `internal-api`, `template-service`, `infra-service`, and `postgres` are
  not reachable from `nginx` or the public internet under any
  circumstances — they sit on Docker networks (`internal`, `db`) with no
  path to `nginx`'s network and no outbound internet route
  (`internal: true`).
- `instant-web` is the only service that bridges the `app`, `db`, and
  `internal` networks (it needs to reach Postgres and, for its admin
  "Tools" page, the internal services).

## Container hardening checklist

All custom and official containers in `docker-compose.yml`:

- [x] `cap_drop: [ALL]` (nginx: `cap_add: [NET_BIND_SERVICE]` only, required to bind ports 80/443)
- [x] `security_opt: [no-new-privileges:true]`
- [x] `privileged: false` (explicit, never overridden)
- [x] No Docker socket mount anywhere
- [x] No host filesystem bind mounts, except nginx's own read-only config files (`nginx/nginx.conf`, `nginx/conf.d/*`) — not the vulnerable-service kind of host mount the spec warns against
- [x] No `network_mode: host`
- [x] Non-root process user: Node services run as a dedicated `app` user (see each `Dockerfile`); Postgres runs as its own upstream `postgres` user; nginx's worker processes drop privileges internally after the initial privileged bind
- [x] No arbitrary high ports exposed (3000/5000/8000/8080/db ports/internal API ports are never published to the host)

## Verifying isolation

```bash
docker compose ps --format '{{.Name}}: {{.Ports}}'
# Expect only nginx to show 0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp.
# Every other service should show no host port mapping at all.

curl -m 3 http://localhost:4001/health   # should fail to connect (internal-api not published)
curl -m 3 http://localhost:5432          # should fail to connect (postgres not published)
```

## Logging

Structured JSON logs to stdout (captured by `docker compose logs`), covering
login successes/failures, registrations, flag submissions, challenge
solves, admin actions (seed/reset/challenge toggles), and unhandled errors.
Passwords, session tokens, and flag values are never logged — see
`src/logger.js` in each service.

## Reporting issues in this platform itself

Phase 1 aims to have zero *unintended* vulnerabilities in `ctf-platform` or
`instant-web`'s core auth/session/admin code. If you find one there (as
opposed to in a later-phase challenge, where it's the point), treat it as a
platform bug, not a challenge.
