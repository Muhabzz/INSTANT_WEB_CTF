# Challenges

> **Admin-only document.** This file describes intended discovery and
> exploitation paths for every implemented challenge. Never surface this
> file, or its contents, to players. It is not linked from any in-app page.

## Phase 2 status

Challenges 01-05 are fully implemented, enabled, and live inside the
Instant company application (`services/instant-web`). The remaining 13 rows
(06-18) are placeholders: slug/category/points/order reserved in the
database, `enabled = false`, no real vulnerable implementation yet. They
arrive in later phases.

**Upgrading an existing Phase 1 deployment:** Phase 1 seeded a different
slug set (`getting-started`, `public-product-catalog`, `customer-auth`,
etc). Use `scripts/reset.sh`, not just `scripts/seed.sh` — reseeding alone
leaves the old Phase 1 rows in place as orphaned, still-enabled challenges,
since their slugs no longer appear in the current seed list.

An admin can enable/disable any challenge from **Admin → Challenges** in the
CTF platform at any time; disabled challenges are hidden from players.
Disabling a challenge does **not** disable its underlying route in
instant-web — the vulnerable code is always present; only its visibility
and scoring on the CTF platform side is gated.

## Challenge list

| # | Slug | Title | Category | Difficulty | Points | Status |
|---|---|---|---|---|---|---|
| 1 | `information-disclosure` | Information Disclosure | Public Website | beginner | 50 | **Enabled** |
| 2 | `sql-injection` | SQL Injection | Public Website | beginner | 50 | **Enabled** |
| 3 | `path-traversal` | Path Traversal | Customer Portal | beginner | 50 | **Enabled** |
| 4 | `auth-bypass` | Authentication Bypass | Customer Portal | beginner | 75 | **Enabled** |
| 5 | `xss` | Cross-Site Scripting | Customer Portal | beginner | 75 | **Enabled** |
| 6 | `public-blog-metadata` | Blog Metadata Exposure | Public Website | beginner | 50 | Reserved |
| 7 | `customer-order-access` | Order Access Control | Customer Portal | easy | 125 | Reserved |
| 8 | `customer-invoice-handling` | Invoice Handling | Customer Portal | medium | 150 | Reserved |
| 9 | `employee-auth` | Employee Portal Authentication | Employee Portal | easy | 125 | Reserved |
| 10 | `employee-directory` | Employee Directory Exposure | Employee Portal | medium | 150 | Reserved |
| 11 | `employee-documents` | Document Handling | Employee Portal | medium | 175 | Reserved |
| 12 | `employee-file-upload` | File Upload Handling | Employee Portal | hard | 200 | Reserved |
| 13 | `employee-analytics` | Analytics Dashboard | Employee Portal | medium | 150 | Reserved |
| 14 | `company-admin-access` | Company Admin Access Control | Company Admin | hard | 225 | Reserved |
| 15 | `company-admin-users` | Admin User Management | Company Admin | hard | 225 | Reserved |
| 16 | `internal-api-exposure` | Internal API Exposure | Internal Services | hard | 250 | Reserved |
| 17 | `template-service-rendering` | Template Rendering | Internal Services | advanced | 275 | Reserved |
| 18 | `full-chain-compromise` | Full Chain: Company Compromise | Attack Chain | advanced | 400 | Reserved |

Total: 18 challenges, 18 unique flags. Flag plaintext values live in
`.env` (`FLAG_INFO_DISCLOSURE`, `FLAG_SQL_INJECTION`, `FLAG_PATH_TRAVERSAL`,
`FLAG_AUTH_BYPASS`, `FLAG_XSS`) — the single source of truth, read by both
`ctf-platform` (hashed into `challenges.flag_hash` at seed time) and
`instant-web` (embedded at each vulnerable location). Reserved challenges
06-18 currently seed with no real flag value.

---

## 01 — Information Disclosure

- **Difficulty / Points:** Beginner / 50
- **Affected routes:** `GET /company/robots.txt`, `GET /company/debug/deploy-status-8f3a`
- **Vulnerability type:** Information disclosure — undocumented/unauthenticated debug endpoint, discoverable via `robots.txt`.
- **Source:** `services/instant-web/src/routes/public.js`

**Intended discovery:** A player fetches `/company/robots.txt` during
routine recon (or simply guesses common paths). It disallows
`/debug/` and `/portal/legacy-login`, revealing both exist without saying
what they do.

**Intended exploitation:** `GET /company/debug/deploy-status-8f3a` requires
no authentication and returns a JSON blob styled as leftover deploy/debug
info (build number, uptime, deployed-by). Its `notes` field carries the
flag and doubles as a hint pointing at challenge 04's endpoint
(`/portal/legacy-login`).

**Flag location:** `config.flags.infoDisclosure` (`FLAG_INFO_DISCLOSURE`),
interpolated directly into the JSON response's `notes` field. Not present
in any HTML/JS served to a normal visitor.

**Isolation:** Read-only, no DB access, no filesystem access. Cannot affect
or reveal anything beyond the static string it returns.

---

## 02 — SQL Injection

- **Difficulty / Points:** Beginner / 50
- **Affected route:** `GET /company/products/search?q=`
- **Vulnerability type:** SQL injection (UNION-based), via unparameterized string concatenation.
- **Source:** `services/instant-web/src/routes/public.js` (route), `services/instant-web/migrations/0003_challenge_data.sql` + `src/seed.js` (target table)

**Intended discovery:** Every other query in this codebase uses `pg`
parameterized placeholders (`$1`, `$2`, ...); this is the one deliberate
exception. A player fuzzing the search box with a single quote (`'`) gets a
500 error (unhandled Postgres syntax error surfaces as a generic error
page, no stack trace) — the classic SQLi tell.

**Intended exploitation:** The query is
`... WHERE name ILIKE '%<q>%' OR description ILIKE '%<q>%' ORDER BY price_cents ASC`.
A payload like:
```
' UNION SELECT title, reference, content, priority, tag FROM internal_notes -- 
```
breaks out of the ILIKE literal and appends a UNION SELECT against
`internal_notes` (5 columns, types aligned with the products SELECT list:
name/slug/description/price_cents/category ↔ title/reference/content/priority/tag).
The trailing `-- ` comments out the rest of the original query (including
the `ORDER BY`). Table name `internal_notes` isn't given anywhere in the
app — a player must enumerate/guess it, or reach it via error-based
probing (`information_schema.tables`) if they don't guess directly. This is
intentionally a mildly harder step than the injection point itself.

**Flag location:** `internal_notes.content`
(`services/instant-web/migrations/0003_challenge_data.sql` for the table,
seeded via `FLAG_SQL_INJECTION` in `src/seed.js`'s `seedInternalNotes`).
Never read by any legitimate route — reachable only through this injection.

**Isolation:** Same Postgres instance/database as the rest of the app (per
ADR #3), but the Postgres role used by `instant-web` has no privileges
beyond its own application tables — no `pg_read_server_files`, no
superuser, nothing that reaches host paths. A player can read other rows in
this database (by design, that's the challenge) but cannot reach the
filesystem, other containers, or credentials outside Postgres.

---

## 03 — Path Traversal

- **Difficulty / Points:** Beginner / 50
- **Affected route:** `GET /company/portal/documents/download?file=`
- **Vulnerability type:** Path traversal via insufficient path-containment check (off-by-one-directory).
- **Source:** `services/instant-web/src/routes/portal.js`, synthetic files under `services/instant-web/challenge-data/`

**Intended discovery:** Any self-registered customer account (no
credentials need to be "found" — registration is free/self-service) can
reach **Documents**, which lists a few generated reports and download
links shaped like `?file=welcome-guide.txt`. A player tries
`?file=../protected/flag.txt` (or `..%2Fprotected%2Fflag.txt`).

**Intended exploitation:** The handler resolves
`path.resolve(challengeData.documentsDir, requested)` and checks the
result starts with `challengeData.root` — the *parent* of
`documentsDir`, not `documentsDir` itself. This is a realistic
copy-paste mistake (e.g. the check was written before a `protected/`
sibling directory existed) rather than a total absence of validation, and
it's what allows `../protected/flag.txt` through while still rejecting
attempts to escape `challenge-data/` entirely.

**Flag location:** `services/instant-web/challenge-data/protected/flag.txt`,
written at container startup from `FLAG_PATH_TRAVERSAL`
(`src/index.js`'s `writeChallengeFiles()`) rather than baked into the image,
so it stays in sync with `.env` like every other flag.

**Isolation:** `challenge-data/` is baked into the `instant-web` image
(`COPY challenge-data ./challenge-data` in its Dockerfile) — there is no
host bind mount for this service (confirmed: only `nginx`'s own read-only
config files are host-mounted, per `docker-compose.yml`). Traversal is
bounded to the `challenge-data.root` check, which itself is bounded to
whatever exists inside the container's own filesystem — no `/proc`,
`/etc`, Docker socket, SSH keys, or `.env` file are reachable (there is no
`.env` file *inside* any image; environment variables are injected by
Compose, not mounted as a file).

---

## 04 — Authentication Bypass

- **Difficulty / Points:** Beginner / 75
- **Affected routes:** `GET/POST /company/portal/legacy-login`
- **Vulnerability type:** Authentication bypass via SQL injection in a deprecated login endpoint (comment-based bypass, not UNION-based — a distinct skill from challenge 02).
- **Source:** `services/instant-web/src/routes/portal.js`, target account seeded in `src/seed.js`

**Intended discovery:** Referenced in challenge 01's debug JSON
(`notes` field) and listed in `robots.txt` as `Disallow: /portal/legacy-login`.
Also independently guessable (common recon wordlists include
`legacy-login`). The page is visibly styled as an old, deprecated form —
distinct from the modern `/portal/login` — signaling "less scrutiny here."

**Intended exploitation:** The query is
`SELECT id, name, email, role FROM company_users WHERE email = '<email>' AND password_hash = '<password>' AND role = 'customer' LIMIT 1`,
built via raw string concatenation with **no** CSRF check (realistic for a
"legacy, unmaintained" flow). Payload:
```
email = alexandra.chen@meridiancapital.example' -- 
password = (anything)
```
comments out the password/role checks and authenticates as that specific
account — a seeded VIP customer whose real password is a random value
never given to anyone, i.e. unreachable via the legitimate login form.

**Flag location:** `company_users.notes` for the
`alexandra.chen@meridiancapital.example` row (seeded in
`seedCompanyUsers` using `FLAG_AUTH_BYPASS`), rendered on that account's own
`/company/portal/dashboard` under "Account Notes" — a section that only
ever appears when `companyUser.notes` is non-null, which is true for no
other seeded account.

**Isolation:** The bypass stays within the `customer` role/session domain
(`customerAuth`, cookie `customer_sid`) — it cannot reach employee or
company-admin sessions/data, since `attachUser` for every portal filters by
`role = $2` regardless of which row `session.userId` points at. It also
cannot reach the CTF platform's own admin account: that is an entirely
separate identity domain (`players` table, `ctf-platform` service, its own
Postgres session table) with no code path connecting the two.

---

## 05 — Cross-Site Scripting (Stored)

- **Difficulty / Points:** Beginner / 75
- **Affected routes:** `POST /company/portal/support` (injection point), `GET /company/portal/support` and `GET /company/employee/tickets` (unescaped render)
- **Vulnerability type:** Stored XSS via missing output encoding.
- **Source:** `services/instant-web/src/routes/portal.js`, `src/views/portal/support.ejs`, `src/views/employee/tickets.ejs`

**Intended discovery:** The support ticket form has no visible output
sanitization messaging; a player submits a ticket with an HTML payload in
the **message** field (the **subject** field is escaped normally — the
asymmetry is intentional and realistic) and revisits their own ticket list.

**Intended exploitation:** `portal/support.ejs` renders
`<%- t.message %>` (EJS raw/unescaped output) instead of `<%= t.message %>`
(escaped) — the one deliberate exception among this app's templates.
A payload such as `<script>document.title='pwned'</script>` executes in the
submitter's own browser immediately upon revisiting the page — genuine,
verifiable stored XSS (self-triggering, not simulated). The same field is
also rendered unescaped on the employee ticket queue
(`employee/tickets.ejs`), meaning any real staff member viewing tickets in
a live deployment would be compromised too. **Caveat, documented
honestly:** this environment has no automated "agent" browser that visits
the employee queue, so there is no live cross-session detonation to
observe — see "Flag location" below for how the flag is actually delivered
without that infrastructure.

**Flag location:** Awarded via a lightweight, honestly-simplified
mechanism rather than a headless-browser bot (out of scope for the
project's "keep it lightweight, 2 vCPU / 8GB" constraint): at ticket
creation time (`POST /portal/support`), the server checks whether the
submitted subject or message contains a literal `<script` (case-insensitive)
— exactly the payload shape that would execute given the unescaped
rendering above — and if so, sets `support_tickets.flagged = true`. The
submitting customer's own `/company/portal/support` page then displays the
flag (`FLAG_XSS`) directly beneath that ticket, styled as an "automated
content scanner" notice (a believable enterprise feature). This ties flag
delivery to submitting a real, executable script payload without requiring
a second, live browser to actually run it.

**Isolation:** No real session tokens, credentials, or server secrets are
ever exposed through this payload path — only the challenge-specific flag
string, and only to the ticket's own submitter (no other player's tickets
or data are reachable this way).
