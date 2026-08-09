# Challenges

> **Admin-only document.** This file describes intended discovery and
> exploitation paths for every implemented challenge. Never surface this
> file, or its contents, to players. It is not linked from any in-app page.

## Phase 6 status

Challenges 01-18 are all fully implemented, enabled, and live inside the
Instant company application (`services/instant-web`), plus small, sandboxed
additions to `infra-service` for challenges 14 and 17.

**Challenge 12 was originally reserved for Command Injection, which was
never implemented** — a pre-implementation check found AWS instance
metadata (IMDS) reachable over HTTP from inside `instant-web` (and, by the
same Docker networking, every other container on this host); the full
IMDSv2 token flow succeeds, and granting genuine command execution inside
a container on this host would have had a live path to that endpoint. This
was an EC2/AWS-side configuration issue, not something fixable by editing
application code in this repo, so per instruction the slot was replaced
outright with a Race Condition challenge instead (see "12 — Race
Condition" below) rather than implementing command execution. Command
Injection remains unimplemented anywhere in this project.

**Upgrading an existing prior-phase deployment:** Phase 1 seeded a
different slug set (`getting-started`, `public-product-catalog`,
`customer-auth`, etc), Phase 2 seeded placeholder slugs for 06-10
(`public-blog-metadata`, `customer-order-access`,
`customer-invoice-handling`, `employee-auth`, `employee-directory`), Phase
4 seeded placeholder slugs for 11 and 13 (`employee-documents`,
`employee-analytics`), and Phase 5 seeded placeholder slugs for 14-18
(`company-admin-access`, `company-admin-users`, `internal-api-exposure`,
`template-service-rendering`, `full-chain-compromise`) that each
subsequent phase replaces outright with the challenges documented below —
different vulnerability classes than those placeholders originally
reserved. Use `scripts/reset.sh`, not just `scripts/seed.sh` — reseeding
alone leaves old rows in place as orphaned, still-disabled challenges,
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
| 6 | `idor-invoice-access` | Invoice Access Control (IDOR) | Customer Portal | easy | 100 | **Enabled** |
| 7 | `jwt-auth-weakness` | JWT Authentication Weakness | Customer Portal | easy | 100 | **Enabled** |
| 8 | `business-logic-flaw` | Business Logic Flaw | Customer Portal | medium | 125 | **Enabled** |
| 9 | `csrf-notification-settings` | Cross-Site Request Forgery | Customer Portal | medium | 125 | **Enabled** |
| 10 | `unrestricted-file-upload` | Unrestricted File Upload | Customer Portal | medium | 150 | **Enabled** |
| 11 | `local-file-inclusion` | Local File Inclusion | Customer Portal | medium | 175 | **Enabled** |
| 12 | `race-condition-bonus-claim` | Race Condition | Customer Portal | medium | 200 | **Enabled** |
| 13 | `advanced-sql-injection` | Advanced SQL Injection | Public Website | hard | 250 | **Enabled** |
| 14 | `ssrf` | Server-Side Request Forgery | Customer Portal | medium | 200 | **Enabled** |
| 15 | `open-redirect` | Open Redirect | Public Website | easy | 125 | **Enabled** |
| 16 | `cors-misconfiguration` | CORS Misconfiguration | Customer Portal | medium | 200 | **Enabled** |
| 17 | `remote-file-inclusion` | Remote File Inclusion | Customer Portal | hard | 275 | **Enabled** |
| 18 | `chained-attack` | Chained Web Attack | Attack Chain | advanced | 400 | **Enabled** |

Total: 18 challenges, all implemented and enabled. Flag plaintext values
live in `.env` (`FLAG_INFO_DISCLOSURE`, `FLAG_SQL_INJECTION`,
`FLAG_PATH_TRAVERSAL`, `FLAG_AUTH_BYPASS`, `FLAG_XSS`, `FLAG_IDOR`,
`FLAG_JWT`, `FLAG_BUSINESS_LOGIC`, `FLAG_CSRF`, `FLAG_FILE_UPLOAD`,
`FLAG_LFI`, `FLAG_ADVANCED_SQLI`, `FLAG_SSRF`, `FLAG_OPEN_REDIRECT`,
`FLAG_CORS`, `FLAG_RFI`, `FLAG_CHAINED_ATTACK`, `FLAG_RACE_CONDITION`) — the
single source of
truth, read by both `ctf-platform` (hashed into `challenges.flag_hash` at
seed time) and `instant-web` (embedded at each vulnerable location).

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

---

## 06 — IDOR / Broken Object-Level Authorization

- **Difficulty / Points:** Easy / 100
- **Affected route:** `GET /company/portal/invoices/:id`
- **Vulnerability type:** Insecure Direct Object Reference — missing authorization check (not an authentication flaw; the request is fully logged in).
- **Source:** `services/instant-web/src/routes/portal.js`, `services/instant-web/src/seed.js` (`seedIdorTargetInvoice`), `services/instant-web/migrations/0004_phase3_challenge_data.sql`

**Intended discovery:** Any self-registered customer can view their own
invoices at `/company/portal/invoices`, each linking to
`/company/portal/invoices/<id>` with a small sequential integer id. A
player who registers a fresh account will typically be issued no invoices
of their own (or notices their own id doesn't start at 1) and tries
adjacent ids directly in the URL.

**Intended exploitation:** The detail route's query
(`SELECT ... FROM invoices i WHERE i.id = $1`) never joins back to
`orders.customer_id` to confirm the requesting customer owns that invoice —
it only checks that *some* invoice with that id exists. Iterating small
integers reaches the seeded target account's ("Morgan Reyes", a synthetic
customer with no special credentials) invoice.

**Flag location:** `invoices.internal_memo` for the seeded target invoice
(`seedIdorTargetInvoice`), shown on the invoice detail page whenever that
field is non-null — ordinary invoices never have it populated.

**Isolation:** Read-only, single-table lookup within `company_users`/
`invoices`, both owned by the `company_app` Postgres role. No path to any
other customer's payment/auth data beyond the one memo field, and no path
to CTF-platform tables.

**Known limitations:** Invoice ids are small sequential integers by
design, to keep enumeration approachable at the "easy" tier — a real
product would likely use non-sequential ids as defense in depth, but that
would only obscure this vulnerability class, not fix it, and would work
against the challenge's teaching goal.

---

## 07 — JWT Authentication Weakness

- **Difficulty / Points:** Easy / 100
- **Affected routes:** `GET /company/portal/api-tokens` (token issuance UI), `GET /company/api/account`, `GET /company/api/internal/diagnostics`
- **Vulnerability type:** JWT signature verification bypass (`alg: "none"` accepted) leading to claim/scope forgery and privilege escalation.
- **Source:** `services/instant-web/src/routes/api.js`, `services/instant-web/src/routes/portal.js` (`/api-tokens*`)

**Intended discovery:** A logged-in customer visits **API Tokens** (linked
in the portal nav, framed as self-service access for the "Instant API
Access" add-on already listed in the public product catalog), generates a
token, and is shown example `curl` usage against `/company/api/account`.
Decoding the token (any standard base64url JWT decoder) reveals a
`{"alg":"HS256", ...}` header and a payload with `sub`/`email`/`scope`
claims — an experienced player recognizes the shape and tests whether the
server actually enforces `alg`.

**Intended exploitation:** `routes/api.js`'s hand-rolled
`verifyApiToken` middleware decodes the token header first; if
`header.alg === "none"`, it trusts the payload without ever calling
`jwt.verify()` — the legitimate HS256 signing/verification path (via the
`jsonwebtoken` library) is only used otherwise. An attacker takes their own
legitimately-issued token, changes the header to `{"alg":"none"}`, edits
the payload's `scope` from `"account:read"` to `"admin:internal"`, and
resubmits `header.payload.` (empty third segment) as the bearer token to
reach `GET /company/api/internal/diagnostics`, which is gated on
`scope === 'admin:internal'`. No legitimate flow ever issues that scope.

**Flag location:** `config.flags.jwt`, returned in the
`internal_notice` field of `/company/api/internal/diagnostics`'s JSON
response, only when the forged scope check passes.

**Isolation:** `routes/api.js` is a plain Express router inside
`instant-web` reading `company_users` (id/name/email/role/department
only — never `password_hash`) and an app-level JWT secret
(`COMPANY_API_JWT_SECRET`) that is distinct from every portal session
secret. Forging a token here cannot produce a valid `ctf-platform` session
(different service, different secret, different signing scheme — session
cookies vs. bearer JWTs), cannot reach Postgres directly, and cannot reach
any other container.

**Known limitations:** None beyond the deliberate scope of the challenge.

---

## 08 — Business Logic Flaw

- **Difficulty / Points:** Medium / 125
- **Affected route:** `POST /company/portal/rewards/redeem`
- **Vulnerability type:** Business logic flaw — missing lower-bound validation on a user-supplied quantity (negative-value abuse), not an injection or auth bug.
- **Source:** `services/instant-web/src/routes/portal.js`, `services/instant-web/migrations/0004_phase3_challenge_data.sql`

**Intended discovery:** Every customer account starts with a small loyalty
point balance, visible on the new **Rewards** page, redeemable for
account credit via a plain form. A player exploring the redemption form's
edge cases (blank, zero, larger-than-balance, non-numeric, negative) finds
that a negative value is accepted.

**Intended exploitation:** The handler's only validation is
`points > balance` (reject only if the redemption exceeds the balance) —
it never checks `points > 0`. Submitting a large negative number (e.g.
`-500000`) passes that check (a negative number is always less than a
non-negative balance) and is then subtracted from the balance
(`loyalty_points - points`), which — because `points` is negative —
*increases* it. Repeating this (or submitting one sufficiently large
negative value) crosses the 100,000-point "Platinum Concierge" tier
threshold.

**Flag location:** Shown on the Rewards page once
`company_users.loyalty_points >= 100000`, styled as a tier-unlock
"access code" (`config.flags.businessLogic`).

**Isolation:** A single-column update on the requesting customer's own
`company_users` row, guarded by `customerAuth.requireAuth` and CSRF
verification — a player can only inflate their own account's synthetic
point balance, never another customer's, and the balance has no real
monetary value or connection to `orders`/`invoices`.

**Known limitations:** None beyond the deliberate scope of the challenge.

---

## 09 — Cross-Site Request Forgery

- **Difficulty / Points:** Medium / 125
- **Affected route:** `GET /company/portal/settings/quick-unsubscribe` (vulnerable), `POST /company/portal/settings/notifications` (properly protected, for contrast)
- **Vulnerability type:** CSRF via a state-changing `GET` endpoint with no synchronizer-token protection.
- **Source:** `services/instant-web/src/routes/portal.js`, `services/instant-web/src/routes/public.js` (`robots.txt` hint), `services/instant-web/migrations/0004_phase3_challenge_data.sql`

**Intended discovery:** `robots.txt` (see challenges 01/04) lists
`Disallow: /portal/settings/quick-unsubscribe`. The Settings page also
documents the same URL directly, framed as the one-click unsubscribe link
every transactional email footer would contain. A player notices this
route mutates account state (`email_notifications_enabled`) via a bare
`GET` request — no form, no CSRF token field, unlike every other
state-changing route in the app.

**Intended exploitation:** Every `POST` in this app is protected by a
session-bound synchronizer token (`middleware/csrf.js`), but a `GET`
request cannot carry a hidden form field. Instead of leaving this
state-changing action out of scope for `GET` entirely (the correct fix),
it was implemented as a plain `GET` route with no protection at all — a
real-world, common anti-pattern. Simply loading the URL while
authenticated (a bare link, `<img src>`, or auto-redirecting third-party
page would do this to a victim in a real cross-site scenario) changes the
preference, which is recorded as changed via `notification_pref_source =
'email_link'` rather than the CSRF-protected form's `'settings_form'`.

**Flag location:** The Settings page shows `config.flags.csrf` whenever
`company_users.notification_pref_source = 'email_link'` — i.e. whenever
the preference was demonstrably changed through the unprotected path
rather than the protected form.

**Isolation:** A single boolean/enum update on the requesting customer's
own row; requires the customer to already be authenticated (their own
browser holds the session cookie) — this route changes only that
customer's own preference, never another account's, and has no path to
any other service, table, or credential.

**Known limitations:** This environment has no second "victim" browser to
demonstrate a genuine cross-origin forged request landing on someone
else's session (the same honestly-documented constraint noted under
challenge 05). The flag is therefore awarded on evidence that the
state change is reachable and effective through the unprotected path —
which is the actual vulnerability — rather than on a live cross-site
demonstration. `SameSite=Lax` session cookies (see `docs/SECURITY.md`)
would additionally block a cross-site **POST** form submission in a real
browser; that is exactly why this challenge's unprotected action is a
`GET` route, which top-level cross-site navigation is not blocked by
`SameSite=Lax` — remaining realistic under modern default cookie
behavior.

---

## 10 — Unrestricted File Upload

- **Difficulty / Points:** Medium / 150
- **Affected routes:** `POST /company/portal/profile/avatar`, `GET /company/portal/uploads/:filename`
- **Vulnerability type:** Unrestricted file upload — server trusts the client-declared MIME type instead of validating actual file content.
- **Source:** `services/instant-web/src/routes/portal.js`, `services/instant-web/migrations/0004_phase3_challenge_data.sql`, `services/instant-web/src/index.js` (`writeChallengeFiles`)

**Intended discovery:** The Profile page has a standard avatar upload
form, accepting PNG/JPEG/GIF. Normal reconnaissance (trying an unusual
file, or inspecting/replaying the multipart request with a tool like curl
or Burp) reveals the server only checks the upload's declared
`Content-Type` part header against an allowlist — a value the client sets
and fully controls per-part in a multipart request, independent of the
file's actual bytes or extension.

**Intended exploitation:** A player uploads a non-image file (e.g. plain
text) while declaring `Content-Type: image/png` for that part (e.g.
`curl -F "avatar=@payload.txt;type=image/png" ...`). `multer`'s
`fileFilter` accepts it because the declared type is on the allowlist; the
real validation gap is that nothing checks the saved file's actual magic
bytes against that claim.

**Flag location:** After saving, the server reads the file's first bytes
and compares them against real PNG/JPEG/GIF signatures. If they don't
match despite the declared image type, `company_users.avatar_flagged` is
set and the Profile page shows `config.flags.fileUpload` next to an
"automated content scanner" notice — the same narrative device as
challenge 05's ticket scanner.

**Flag location detail:** stored filenames keep only the extension of the
client-supplied name (via `path.extname`, which cannot contain a path
separator, so this is not also a path-traversal vector) and are written
under `challenge-data/uploads/`, created fresh at container startup
(`src/index.js`) — never a host bind mount. Serving them back
(`GET /portal/uploads/:filename`) uses a correct containment check
(`resolved.startsWith(uploadsDir + path.sep)`), unlike challenge 03's
intentionally off-by-one check — this challenge is about the upload-time
type validation, not a second traversal bug in the download path.

**Isolation:** No code execution of any kind is performed on uploaded
content — the server only reads bytes to compare a signature and stores
the file on disk inside the container's own working directory (owned by
the non-root `app` user; see the instant-web `Dockerfile`). There is no
`require()`, `eval`, template rendering, or shell invocation of uploaded
data anywhere in this path, and no Docker socket or host filesystem mount
— none of that changes with this challenge either way, since there's no
code execution here to exploit it with. (Correction from an earlier
revision of this doc: AWS instance metadata *is* network-reachable from
this container at the network layer — see "12 — Command Injection
(deferred)" below. That's irrelevant to this specific challenge, which
grants no command execution or outbound-request capability of any kind,
but the earlier blanket "no AWS metadata endpoint reachable" claim here
was incorrect and is corrected in this revision.)

**Known limitations:** An uploaded file with an HTML/SVG-shaped extension
that also happened to pass the declared-mimetype check would be served
back with a browser-inferred content type when visited directly at
`/portal/uploads/<filename>` (a second, real consequence of unrestricted
upload — content-type confusion in the eyes of a browser, distinct from
this challenge's own flag mechanism). This is a natural, honestly-noted
extension of the same underlying flaw, not a separate bug, and does not
provide any flag beyond `FLAG_FILE_UPLOAD` itself.

---

## 11 — Local File Inclusion

- **Difficulty / Points:** Medium / 175
- **Affected route:** `GET /company/portal/invoices/:id/receipt?template=`
- **Vulnerability type:** Local File Inclusion via an absolute-path bypass of `path.resolve()`, plus unblocked relative traversal — no containment/allowlist check at all, only a narrow denylist.
- **Source:** `services/instant-web/src/routes/portal.js`, `services/instant-web/src/index.js` (`writeChallengeFiles`), `services/instant-web/src/config.js`

**Intended discovery:** Every invoice detail page (`/company/portal/invoices/:id`, see challenge 06) now links to three receipt styles — Standard/Detailed/Minimal — each hitting `/receipt?template=<name>`. A player notices the `template` parameter names a file and tries the classic recon moves: `template=../../../../etc/passwd` or `template=/etc/passwd`.

**Intended exploitation:** The handler resolves the template with `path.resolve(receiptTemplatesDir, requestedPath)`. This has two independent problems: (1) relative `../` segments are never blocked — there is no `startsWith(receiptTemplatesDir)` containment check at all here, unlike challenge 03; (2) if the supplied path is absolute, `path.resolve()`'s documented behavior is to treat that argument as an anchor and **discard every argument before it** — `path.resolve('/app/challenge-data/receipt-templates', '/etc/passwd')` evaluates to `/etc/passwd`, not a path under `receipt-templates/`. A denylist blocks a few specific substrings (`/proc/`, `/etc/shadow`, `.ssh/`, `docker.sock`) — patched after an earlier finding, but addressing symptoms rather than the missing containment check. Critically, the handler also appends a mandatory `.txt` suffix whenever the caller doesn't supply one already, which is what keeps this challenge (and the container) safe — see Isolation below. The intended payload is `template=../internal-billing/notes.txt` (or the absolute-path equivalent `template=/app/challenge-data/internal-billing/notes.txt`).

**Flag location:** `challenge-data/internal-billing/notes.txt`, written at container startup (`writeChallengeFiles()`) from `FLAG_LFI`, in a directory that is a sibling of — not inside — `receiptTemplatesDir`, and never linked from any legitimate route.

**Isolation:** Fully contained to `instant-web`'s own container filesystem — `challenge-data/` is `COPY`'d into the image and `challenge-data/internal-billing/`, like every other challenge-data subdirectory, is never a host bind mount. No code execution, template engine, or `require()` of file contents is involved anywhere in this path — it is a pure `fs.readFile` returning raw text. The mandatory `.txt` suffix (appended whenever the caller's input doesn't already end in `.txt`) is a genuine, load-bearing safety property here, not just a cosmetic detail: it prevents this from reaching any of the specific paths called out as off-limits for this challenge (`/etc/shadow`, SSH keys, `/proc/self/environ` and other `/proc` entries, a Docker socket path, `.env`) because none of those paths end in `.txt`. A player who already supplies a `.txt`-suffixed absolute path is still bounded to whatever the container's own filesystem contains under that path — there is no host filesystem for it to reach in the first place (no host bind mounts anywhere in `instant-web`'s service definition).

**Known limitations:** This is a narrower LFI than a fully unbounded one deliberately — an unrestricted version would have been able to reach `/proc/self/environ` (which would leak every flag value and the live `COMPANY_DB_PASSWORD`/`COMPANY_API_JWT_SECRET`/session secrets in this container's environment, not just `FLAG_LFI`) and other genuinely sensitive in-container paths. Constraining reachable targets to `.txt`-suffixed files is what keeps this a clean, single-flag LFI challenge instead of a full environment-variable disclosure bug — this caution was originally motivated by the AWS IMDS reachability finding that led to Command Injection being replaced by challenge 12's current Race Condition design (see "12 — Race Condition" below).

---

## 12 — Race Condition

- **Difficulty / Points:** Medium / 200
- **Affected route:** `POST /company/portal/rewards/claim-bonus`
- **Vulnerability type:** Race condition — unsynchronized check-then-act on a one-time claim, no transaction, no row lock, no atomic compare-and-swap.
- **Source:** `services/instant-web/src/routes/portal.js`, `services/instant-web/src/views/portal/rewards.ejs`, `services/instant-web/migrations/0007_challenge12_race_condition.sql`

**Note on history:** This slot originally reserved Command Injection (see
prior revisions of this file). That design was found to have a live path
to AWS instance metadata (IMDS reachable from containers on this host,
documented in earlier phase reports) and was never implemented. Per
instruction, the slot was replaced outright with this Race Condition
challenge instead — a different vulnerability class, not a variant of the
original plan. Command Injection remains unimplemented in this project.

**Intended discovery:** The existing Rewards page (see challenge 08) gains
a new "Welcome Bonus" card: any account can claim a one-time 500-point
signup bonus. The button and its one-shot framing ("New accounts can claim
a one-time... bonus") is the standard trigger for a security-minded player
to wonder what happens under concurrent/rapid submission — the same
instinct that applies to any real "claim once" or "redeem code" feature.

**Intended exploitation:** The handler does `SELECT welcome_bonus_claims`
(the check), waits roughly 400ms (framed as a fraud-check lookup — a
realistic reason a claim endpoint would pause, and what widens the race
window enough to demonstrate reliably with ordinary concurrent tooling
rather than requiring sub-millisecond timing), then — if the check showed
zero prior claims — runs an unconditional
`UPDATE ... SET welcome_bonus_claims = welcome_bonus_claims + 1`. There is
no transaction wrapping the two steps, no `SELECT ... FOR UPDATE` row
lock, and the `UPDATE` is not a compare-and-swap
(`WHERE welcome_bonus_claims = 0`). Firing many genuinely concurrent
requests with the same session (e.g. backgrounded `curl` processes, or
Burp Repeater/Turbo Intruder's parallel send) lets every request's check
read the same pre-write value during the delay window, so every one of
them proceeds to increment — verified live with 15 concurrent requests
producing `welcome_bonus_claims = 15` (and reproduced again after a reset,
producing 8 from 8 concurrent requests). A single request, or requests
sent one after another, always and only ever produces exactly one
successful claim — verified live — since the check correctly observes the
prior write once there's no concurrent window to race within.

**Flag condition:** The flag is included only when
`welcome_bonus_claims >= 2` — direct proof multiple increments landed for
one account, which is only reachable via the race (never via any
sequential-use path). Shown on the Rewards page, and directly in the
response of whichever concurrent request(s) observed the already-≥2 state.
No other route increments this column.

**Reset/retry:** `POST /company/portal/rewards/reset-bonus` resets the
*requesting account's own* `welcome_bonus_claims` to 0 and reverses the
associated points, so a player (or a tester) can retry after an
inconclusive attempt without a full platform reset. Deliberately **not**
linked from the Rewards page UI or any other player-facing surface —
verified live that no such link/reference exists in the rendered page —
this is an operator/testing-documented convenience, not part of the
intended solve path. Resetting your own state is not itself racy (no
interesting outcome from concurrent resets — it only ever restores a clean
starting point) and never increments the claim counter.

**Isolation:** Pure application/database-layer logic — no shell execution,
no filesystem access, no outbound network requests, nothing touching
`infra-service`/`internal-api`/Docker/AWS metadata. Confined to a single
`company_users` column update via the existing `company_app` Postgres
role; no new tables, no grant changes, no changes to `docker-compose.yml`
beyond the one additive `FLAG_RACE_CONDITION` environment variable.

**Known limitations:** None beyond the deliberate scope of the challenge.
Challenge 08's own `/rewards/redeem` route and its vulnerability are
byte-for-byte unchanged by this work — the two challenges share only the
Rewards page template, and confirmed via live regression testing that
challenge 08 still works exactly as before.

---

## 13 — Advanced SQL Injection

- **Difficulty / Points:** Hard / 250
- **Affected route:** `POST /company/track-order`
- **Vulnerability type:** Boolean-based blind SQL injection, numeric (unquoted) injection context — meaningfully different from challenge 02's string-context UNION-based injection.
- **Source:** `services/instant-web/src/routes/public.js`, `services/instant-web/migrations/0005_phase4_challenge_data.sql`, `services/instant-web/src/seed.js` (`seedSupportEscalations`)

**Intended discovery:** The public site has an unauthenticated "Track Your Order" page (linked in the main nav, a completely ordinary SaaS feature) taking an order number and an email. Submitting a non-numeric order number doesn't produce a visible SQL error page (the handler catches query errors and falls back to a plain "not found" response) — a player instead notices the response only ever says "found" or "not found," never any order details, and that the order number field accepts more than digits without complaint.

**Intended exploitation:** `order_id` is concatenated directly into the query with **no quoting** (`WHERE o.id = ${orderId}`, a numeric context — no quote-escaping needed to break out, unlike challenge 02). Because the response never echoes any row data, a `UNION SELECT` — challenge 02's technique — has nothing to attach itself to; the only signal available is the found/not-found boolean itself. The intended payload shape is:
```
order_id = 0 OR (SELECT substring(escalation_note,1,1) FROM support_escalations LIMIT 1)='I' --
```
The trailing `-- ` comments out the rest of the query (including the `email` check), the same comment-bypass idea challenge 04 teaches, but here it's a building block for **boolean-based blind extraction**: a player iterates position (`substring(..., N, 1)`) and candidate character (or uses `>`/`<` against `ascii(...)` for a binary search) across many requests, reconstructing `support_escalations.escalation_note` — and the flag inside it — one bit of information at a time, entirely from which of two response states comes back. This requires materially more understanding than challenge 02: recognizing an injection point that returns no data at all is still exploitable, and scripting a multi-request extraction loop rather than reading a single response.

**Flag location:** `support_escalations.escalation_note`, seeded once (`seedSupportEscalations`), never read by any legitimate route — reachable only through this injection, and only by extracting it character-by-character via the boolean oracle above.

**Isolation:** Same Postgres instance/database as every other `instant-web` query, executed under the `company_app` role (see `docs/DATABASE.md`), which has no grants on any `platform_app`-owned table (`players`, `challenges`, `solves`, `submission_log`). A subquery pointed at any of those tables fails with a Postgres permission error, which this route's `catch` block folds into an indistinguishable "not found" response — so the boolean oracle simply doesn't work against platform tables at all; the database-level role boundary holds regardless of how the application-level query is shaped. No superuser, no cross-role grants were added or changed to build this challenge.

**Known limitations:** None beyond the deliberate scope of the challenge. Full manual extraction of the flag is tedious by hand (as with any real blind-SQLi finding) — the challenge is intended to be solved with a short scripted extraction loop (e.g. `sqlmap --technique=B`, or a simple `curl` loop), which is realistic and expected for this difficulty tier.

---

## 14 — Server-Side Request Forgery

- **Difficulty / Points:** Medium / 200
- **Affected route:** `POST /company/portal/integrations/connectivity-test`
- **Vulnerability type:** SSRF via a host/port-safe but path-unrestricted target allowlist.
- **Source:** `services/instant-web/src/routes/portal.js`, `services/instant-web/src/views/portal/integrations.ejs`, `services/infra-service/src/index.js`

**Intended discovery:** The customer portal's new **Integrations** page names all three of Instant's internal services (internal-api, template-service, infra-service) and offers a single "Test Connectivity" button. Viewing the page source (ordinary recon, no tooling required) reveals a hidden `target` field defaulting to `http://template-service:4002/health` alongside the button.

**Intended exploitation:** The server checks that `target` **starts with** one of exactly three allowed origins (`http://internal-api:4001/`, `http://template-service:4002/`, `http://infra-service:4003/`) — a real, unbypassable host/port boundary (blocks AWS metadata, external hosts, everything else) — but never restricts the *path* after that prefix. Changing the hidden field's value to `http://infra-service:4003/status` (still passes the prefix check) returns that service's existing `/status` JSON, which now includes a `diagnostics_endpoint` field pointing at `/diagnostics/internal-report` — a route the admin Tools page never calls. Requesting `http://infra-service:4003/diagnostics/internal-report` returns the flag.

**Flag location:** `infra-service`'s `/diagnostics/internal-report` route, `internal_notice` field.

**Isolation:** The allowlist is a strict prefix match against exactly three hardcoded internal hostnames baked into `instant-web`'s own code (`config.internal.*Url`) — not derived from player input at all beyond the already-validated prefix, so there is no bypass path to `169.254.169.254`, any external domain, or the Docker host. `infra-service` itself makes no outbound requests and stays on the `internal` Docker network only (no published port, confirmed in `docker-compose.yml`), same as before this challenge existed.

**Known limitations:** None beyond the deliberate scope of the challenge.

---

## 15 — Open Redirect

- **Difficulty / Points:** Easy / 125
- **Affected route:** `GET /company/out?url=`
- **Vulnerability type:** Open redirect via a substring-based (not hostname-parsed) partner-domain allowlist.
- **Source:** `services/instant-web/src/routes/public.js`, `services/instant-web/src/views/public/home.ejs`, `services/instant-web/src/views/public/leaving.ejs`

**Intended discovery:** The homepage's new "Trusted by our partners" section links out through `/company/out?url=https://partners.instant.example/...` — a plain, visible link, no hidden mechanism.

**Intended exploitation:** The validation check is `url.includes('partners.instant.example')` — a raw substring test on the entire URL string, not a parsed-hostname comparison. A URL like `http://attacker.example/?x=partners.instant.example` (the allowed domain appears only in the query string) or `http://partners.instant.example.attacker.example/` (the allowed domain appears only as a prefix of an attacker-controlled subdomain) both satisfy the substring check while pointing somewhere else entirely.

**Flag location:** The "You're leaving Instant" interstitial performs its own correct hostname parse (`new URL(url).hostname`) after the substring check already passed. When that proper parse disagrees with the substring check — i.e. a genuine bypass, not a real partner link — the interstitial shows a "destination verification failed" notice containing the flag. Redirecting to an actually-allowed partner domain does not produce a flag.

**Isolation:** No server-side fetch of any kind — the server only issues the *player's own browser* a link to follow, so this creates no new outbound network capability for any container.

**Known limitations:** None beyond the deliberate scope of the challenge.

---

## 16 — CORS Misconfiguration

- **Difficulty / Points:** Medium / 200
- **Affected route:** `GET /company/portal/api/widget-summary`
- **Vulnerability type:** Reflected `Access-Control-Allow-Origin` combined with `Access-Control-Allow-Credentials: true` on a cookie-authenticated endpoint.
- **Source:** `services/instant-web/src/routes/portal.js`, `services/instant-web/src/views/portal/settings.ejs`

**Intended discovery:** The Settings page documents this endpoint under "Developer: account widget" — session-cookie authenticated, explicitly distinct from challenge 07's bearer-token API (CORS credential theft is only meaningful against cookie auth, since a foreign page never has the player's bearer token to attach).

**Intended exploitation:** The handler reflects whatever `Origin` header is present back into `Access-Control-Allow-Origin` and always sets `Access-Control-Allow-Credentials: true` — the textbook misconfiguration. A player builds a two-line local HTML file (no hosting needed — even a `file://` page's `Origin: null` gets reflected) running `fetch('.../widget-summary', {credentials:'include'})` while logged into Instant in the same browser; the browser attaches the session cookie and, because of the misconfigured headers, allows the foreign page's JS to read the response.

**Flag location:** Included in the JSON response only when the request carries both a valid session cookie and an `Origin` header that doesn't match the app's own origin — real, live proof a foreign-origin credentialed request succeeded (no victim bot needed; the player's own browser making a request as itself, from a foreign origin, to its own logged-in session is the complete, honest demonstration).

**Isolation:** The permissive headers are set on this one route only, not global CORS middleware — no other endpoint is affected. Data returned is the player's own synthetic account fields (name/email/loyalty points), never another player's data, never CTF-platform data, never a real secret.

**Known limitations:** None beyond the deliberate scope of the challenge.

---

## 17 — Remote File Inclusion

- **Difficulty / Points:** Hard / 275
- **Affected route:** `GET /company/portal/settings/signature-preview?snippet=`
- **Vulnerability type:** Remote File Inclusion — unescaped inclusion of a network-fetched, attacker-influenced remote resource from a sandboxed internal content host.
- **Source:** `services/instant-web/src/routes/portal.js`, `services/instant-web/src/views/portal/signature_preview.ejs`, `services/infra-service/src/index.js`

**Intended discovery:** Settings → "Support signature" links to a snippet preview page. Its `<select>` only offers three snippets in the UI, but the underlying request is a plain `GET ?snippet=`. The page's own copy explicitly names the sibling `internal/` folder on the content host ("engineering notes moved to `internal/` during a cleanup, not linked from here") — a direct, in-app breadcrumb, not a guess.

**Intended exploitation:** `instant-web` fetches `http://infra-service:4003/assets?name=<snippet>` and embeds the response **unescaped** directly into the live preview pane (`<%- content %>`) — genuine inclusion, distinct from challenge 14's SSRF, which only ever displays raw fetched bytes as a status/report, never renders them as part of the page. The vulnerable file-resolution logic lives on `infra-service` itself: `path.resolve(ASSETS_DIR, name)` with no containment check (the same bug shape as challenge 11's LFI, just reached over the network instead of via a local read). Requesting `?snippet=../internal/flag` resolves outside `assets/` into the sibling `internal/` directory named on the settings page.

**Flag location:** `infra-service`'s `content/internal/flag.txt`, fetched by `instant-web` and rendered verbatim into the preview.

**Isolation:** `instant-web` never supplies a host for this fetch — the target (`config.internal.infraServiceUrl`) is hardcoded, never player-influenced; only the logical snippet *name* is, and only against `infra-service`'s own container filesystem (no host bind mount anywhere in this project). A mandatory `.txt` suffix (appended whenever the caller's input doesn't already end in `.txt`) plus a small denylist (`/proc/`, `/etc/shadow`, `.ssh/`, `docker.sock`) bound the reachable target set the same way challenge 11 is bounded — `infra-service` also makes no outbound requests of its own, so there is no path to AWS metadata regardless. This is not template injection/SSTI: the player selects among plain text files, never supplies template syntax, and no rendering engine evaluates the fetched content as code anywhere in this path.

**Known limitations:** None beyond the deliberate scope of the challenge.

---

## 18 — Chained Web Attack

- **Difficulty / Points:** Advanced / 400
- **Affected routes:** `GET /company/portal/invoices/:id` (challenge 06, reused unmodified) → `GET /company/api/internal/ops-console` (new)
- **Vulnerability type:** Chains challenge 06 (IDOR) and challenge 07 (JWT `alg:none` forgery) — no new vulnerability class.
- **Source:** `services/instant-web/src/routes/api.js`, `services/instant-web/src/seed.js` (`seedOpsIntegrationInvoice`)

**Intended discovery:** The API reference table on the API Tokens page (see challenge 07) lists `GET /company/api/internal/ops-console`, noted as requiring "an authorized ops-integration service account" — a fair hint that scope alone (sufficient for challenge 07's `/internal/diagnostics`) won't be enough here, without revealing why. Separately, a player enumerating small invoice ids for challenge 06 will run across one more than expected: a synthetic "Ops Integration" account's invoice, whose memo reads "Ops integration account - service ID `<n>` - reserved for automated admin:internal diagnostics only."

**Intended exploitation:** Step one is challenge 06's IDOR, verbatim — no code changes to that route — which reveals the ops-integration account's numeric id. Step two reuses challenge 07's exact `alg:none` forgery technique, but `/ops-console` additionally requires `sub` (the forged token's subject claim) to equal that specific id — a token forged with the player's own id and elevated scope (which is all challenge 07 needs) is insufficient here.

**Flag location:** `internal_notice` field of the `/ops-console` response, returned only when both the scope and `sub` checks pass.

**Isolation:** No new attack surface: reuses `company_app`'s existing, unchanged access to the `company_users`/`orders`/`invoices` tables (same role, same grants as challenge 06) and the exact same `verifyApiToken` code path as challenge 07 (no changes to that function). One new `company_users` row (role `customer`, random unpublished password — same "no reachable login" pattern as challenge 04's VIP account and challenge 06's IDOR target) and one new invoice; no new tables, no grant changes.

**Known limitations:** None beyond the deliberate scope of the challenge.
