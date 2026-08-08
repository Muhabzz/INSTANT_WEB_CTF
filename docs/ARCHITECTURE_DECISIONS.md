# Architecture Decisions

Format: Decision / Reason / Alternatives / Why rejected.

---

## 1. Path-based routing instead of subdomains

**Decision:** Nginx routes by path prefix on a single host: `/` and everything
not explicitly claimed goes to `ctf-platform`; `/company/*` goes to
`instant-web`. Within `instant-web`, `/company/portal/*` is the customer
portal, `/company/employee/*` is the employee portal, `/company/admin/*` is
the company admin portal.

**Reason:** The architecture diagram in the spec implies subdomain-style
separation (`customers.instant.example`, `employees.instant.example`, etc.),
which is the most realistic option. But this deployment target is a single
EC2 instance reachable by IP (or one domain at most) with no wildcard DNS or
per-subdomain TLS setup implied by the spec. Path-based routing on one host
preserves every functional and access-control boundary (distinct
session cookies scoped by `cookie.path`, distinct login flows, distinct
Postgres tables) without requiring DNS infrastructure the spec doesn't
provision.

**Alternatives:** (a) Real subdomains via wildcard DNS + SNI-based Nginx
`server_name` blocks. (b) A single flat namespace with no prefix separation.

**Why rejected:** (a) requires DNS control and TLS certs per subdomain that
are out of scope for "local development / single EC2 deploy" and would block
Phase 1 completion on external DNS setup. (b) would cause path collisions
(`/login`, `/dashboard` are reused by customer, employee, and company-admin
portals per the spec) and would blur trust boundaries that later
access-control challenges depend on being real and distinct.

---

## 2. Internal services are real separate containers, not routers-in-process

**Decision:** `internal-api`, `template-service`, and `infra-service` are
three separate Node/Express containers on an `internal` Docker network that
is not reachable from `nginx` or the public internet — rather than being
mounted as sub-routers inside `instant-web`.

**Reason:** The spec's architecture diagram explicitly draws these as
separate boxes, and later phases (SSRF, internal service exploitation
chains) require the network boundary between "instant-web" and "internal
services" to be a real network hop, not an in-process function call. Making
that boundary real now avoids a breaking architecture change later.

**Alternatives:** Fold internal-api/template-service/infra-service into
`instant-web` as Express sub-routers to save containers.

**Why rejected:** Would work for Phase 1 but would require re-splitting the
monolith into containers later specifically to implement SSRF-style
challenges — a disruptive change to make mid-CTF-build. Three extra
lightweight Node containers cost ~150MB RAM combined, well within the 8GB
budget, so there's no real resource pressure forcing the merge.

---

## 3. Single shared Postgres instance, single database, table-prefix separation

**Decision:** One `postgres` container, one database (`instant_ctf`). Platform
tables (`players`, `challenges`, `solves`, `platform_sessions`) and company
tables (`company_users`, `products`, `orders`, `invoices`, `support_tickets`,
`documents`, `blog_posts`, `company_sessions`) live in the same database,
distinguished by name, each "owned" (migrated/seeded) by one service.

**Reason:** Spec explicitly forbids "18 heavyweight databases" and asks for a
lightweight architecture. A single Postgres instance is enough for this
workload and is far easier to back up, migrate, and reset than multiple
instances.

**Alternatives:** (a) One Postgres instance per app (ctf-platform-db,
company-db). (b) Postgres schemas (`platform.*`, `company.*`) instead of table
prefixes.

**Why rejected:** (a) doubles Postgres memory/connection overhead for no
functional benefit at this scale — nothing in the spec requires physical
database isolation between the CTF meta-layer and the company app. (b) was a
close second choice; plain table naming was chosen only because it keeps
migration SQL and `search_path` handling simpler for a small team to
maintain, per the "easy to maintain" requirement. This is a low-cost decision
to revisit later if a specific challenge needs schema-level isolation.

---

## 4. No Redis / message queue / Kubernetes

**Decision:** Sessions are stored in Postgres (`connect-pg-simple`). No Redis,
no queue, no Kubernetes — plain Docker Compose.

**Reason:** Spec explicitly says not to introduce Redis/Kafka/Elasticsearch
"unless there is a strong technical reason," and not to introduce Kubernetes.
Nothing in Phase 1 (or the planned 18 challenges) needs sub-millisecond
session lookups, pub/sub, or multi-node orchestration — this is a small
single-instance training platform.

**Alternatives:** Redis-backed sessions; Kubernetes (k3s) for "realism."

**Why rejected:** Both add operational surface area (more containers, more
failure modes, more things to secure) with no corresponding functional
requirement. Revisit only if a later phase specifically needs to demonstrate
a Redis- or queue-specific vulnerability class.

---

## 5. CTF player identity is separate from company user identity

**Decision:** `players` (CTF platform accounts) and `company_users` (Instant
SaaS accounts: customer/employee/admin) are distinct tables with distinct
auth flows and distinct session cookies. A player does not log into the
company app "as themselves" — they attack seeded company accounts.

**Reason:** Spec frames the player as an external attacker performing
reconnaissance/pentesting against a fictional company. That framing only
holds if the company's accounts are NPC/seeded targets with their own
credentials, not literally the player's own CTF login.

**Alternatives:** Single unified `users` table with a role enum shared by both
the CTF meta-layer and the company app.

**Why rejected:** Would conflate two different trust domains (the meta-CTF
platform the player is a legitimate registered user of, vs. the company the
player is attacking) and would make it harder to reason about which
authentication surface a future challenge is targeting.

---

## 6. Reset wipes all mutable state back to seed baseline

**Decision:** `scripts/reset.sh` truncates all application tables (players,
solves, company data) and re-runs seed, rather than selectively resetting
only "dirty" rows.

**Reason:** Simpler, fully reproducible, and matches common CTF operational
practice (admins reset between events/cohorts). Selective reset would require
per-table "what counts as mutated by exploitation" logic that isn't needed
yet and would add complexity without a concrete Phase-1 requirement driving
it.

**Alternatives:** Selective/partial reset preserving player accounts across
resets.

**Why rejected:** Deferred — no current requirement demands partial reset.
Documented clearly in `docs/ADMIN_GUIDE.md` as a destructive, full-wipe
operation so operators aren't surprised.
