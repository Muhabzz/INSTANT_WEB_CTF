# Challenges

> **Admin-only document.** This file describes intended discovery and
> exploitation paths for every implemented challenge. Never surface this
> file, or its contents, to players. It is not linked from any in-app page.

## Phase 4 status

Challenges 01-11 and 13 are fully implemented, enabled, and live inside the
Instant company application (`services/instant-web`). The remaining rows
(12, 14-18) are placeholders: slug/category/points/order reserved in the
database, `enabled = false`, no real vulnerable implementation yet.

**Challenge 12 (Command Injection) was deliberately deferred, not skipped
by omission.** See "12 — Command Injection (deferred)" below for the full
finding. In short: a pre-implementation check found AWS instance metadata
(IMDS) reachable over HTTP from inside `instant-web` (and, by the same
Docker networking, every other container on this host) — the full IMDSv2
token flow succeeds. No IAM role happens to be attached to this EC2
instance today, so there are no instance-role credentials to steal right
now, but granting genuine command execution inside a container on this
host would have a live path to that endpoint regardless. This is an
EC2/AWS-side configuration issue (the metadata hop-limit hardening,
`--http-put-response-hop-limit 1`, isn't set) — not something fixable by
editing application code or `docker-compose.yml` in this repo. Per explicit
project instructions to stop and report rather than silently work around
this class of finding, challenge 12 was left unimplemented this phase.

**Upgrading an existing prior-phase deployment:** Phase 1 seeded a
different slug set (`getting-started`, `public-product-catalog`,
`customer-auth`, etc), Phase 2 seeded placeholder slugs for 06-10
(`public-blog-metadata`, `customer-order-access`,
`customer-invoice-handling`, `employee-auth`, `employee-directory`), and
Phase 4 seeded placeholder slugs for 11 and 13 (`employee-documents`,
`employee-analytics`) that each subsequent phase replaces outright with
the challenges documented below — different vulnerability classes than
those placeholders originally reserved. Use `scripts/reset.sh`, not just
`scripts/seed.sh` — reseeding alone leaves old rows in place as orphaned,
still-disabled challenges, since their slugs no longer appear in the
current seed list.

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
| 12 | `employee-file-upload` | *(placeholder — intended: Command Injection)* | Employee Portal | hard | 200 | Reserved — deferred, see above |
| 13 | `advanced-sql-injection` | Advanced SQL Injection | Public Website | hard | 250 | **Enabled** |
| 14 | `company-admin-access` | Company Admin Access Control | Company Admin | hard | 225 | Reserved |
| 15 | `company-admin-users` | Admin User Management | Company Admin | hard | 225 | Reserved |
| 16 | `internal-api-exposure` | Internal API Exposure | Internal Services | hard | 250 | Reserved |
| 17 | `template-service-rendering` | Template Rendering | Internal Services | advanced | 275 | Reserved |
| 18 | `full-chain-compromise` | Full Chain: Company Compromise | Attack Chain | advanced | 400 | Reserved |

Total: 18 challenges (12 implemented and enabled, 1 deferred, 5 reserved).
Flag plaintext values live in `.env` (`FLAG_INFO_DISCLOSURE`,
`FLAG_SQL_INJECTION`, `FLAG_PATH_TRAVERSAL`, `FLAG_AUTH_BYPASS`, `FLAG_XSS`,
`FLAG_IDOR`, `FLAG_JWT`, `FLAG_BUSINESS_LOGIC`, `FLAG_CSRF`,
`FLAG_FILE_UPLOAD`, `FLAG_LFI`, `FLAG_ADVANCED_SQLI`) — the single source of
truth, read by both `ctf-platform` (hashed into `challenges.flag_hash` at
seed time) and `instant-web` (embedded at each vulnerable location).
Reserved/deferred challenges (12, 14-18) currently seed with no real flag
value.

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

**Known limitations:** This is a narrower LFI than a fully unbounded one deliberately — an unrestricted version would have been able to reach `/proc/self/environ` (which would leak every flag value and the live `COMPANY_DB_PASSWORD`/`COMPANY_API_JWT_SECRET`/session secrets in this container's environment, not just `FLAG_LFI`) and other genuinely sensitive in-container paths. Constraining reachable targets to `.txt`-suffixed files is what keeps this a clean, single-flag LFI challenge instead of a full environment-variable disclosure bug; see "12 — Command Injection (deferred)" below for the closely related finding that motivated being conservative here.

---

## 12 — Command Injection (deferred)

**Status: NOT implemented this phase.** No route, no flag, no schema
change. The placeholder challenge row (`employee-file-upload`, order_index
12) is unchanged from Phase 3/earlier and remains `enabled = false`.

**Why:** Before writing any code for this challenge, a preflight check was
run against the already-running `instant-web` container (no application
changes involved — this is the container as it already existed) to confirm
AWS instance metadata (IMDS) is not reachable, since granting real command
execution inside a container with a live path to IMDS would risk exposing
real AWS credentials through a training platform. The check found:

1. `GET http://169.254.169.254/latest/meta-data/` from inside the
   container returns a live HTTP 401 (IMDSv2 token required) — not a
   timeout or connection-refused, meaning the request reaches the
   metadata service.
2. The full IMDSv2 flow succeeds: `PUT /latest/api/token` returns a valid
   session token, and that token can be used for subsequent metadata
   queries.
3. `GET /latest/meta-data/iam/security-credentials/` with that token
   returned 404 — **this specific EC2 host currently has no IAM instance
   role attached**, so there are no instance-role credentials to steal
   today. That is incidental to the current AWS console configuration,
   not a control this platform (or Docker) enforces.

The standard mitigation — `--http-put-response-hop-limit 1` on the EC2
instance's metadata options, which causes the extra network hop through
Docker's bridge/NAT to drop the packet — is not set on this host. This is
an AWS/infrastructure-level setting, not something expressible in
`docker-compose.yml`, a `Dockerfile`, or application code in this repo.
Adding an in-container workaround (e.g. `iptables` rules blocking
169.254.169.254) would itself require the `NET_ADMIN` capability, which
would weaken this project's `cap_drop: [ALL]` posture to build a
"fix" for a problem that isn't this repo's to fix — a worse trade than
simply not implementing the challenge yet.

Per the explicit instruction to stop and report rather than silently work
around a finding in this category, challenge 12 was left unimplemented.
**This does not block challenges 11 or 13** — neither grants command
execution or any outbound-request capability, so neither has a path to
IMDS regardless of this finding.

**To unblock this challenge:** harden IMDS on the EC2 host (hop-limit 1,
and/or confirm no IAM role will ever be attached to an instance running
this platform), then implement a realistic diagnostic/lookup feature (a
webhook-hostname or DNS-check tool was the intended design — customer
portal, unauthenticated command building via `child_process.exec` with a
user-supplied hostname concatenated into a shell command) in a later
phase.

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
