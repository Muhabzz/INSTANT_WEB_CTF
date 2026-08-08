# INSTANT WEB CTF — Discoverability Remediation Report

Scope: fix the open discoverability/structural findings from the player-path audit for
challenges 01, 03, 04, 06, 07, and 11. No new vulnerabilities added, no existing vulnerability
mechanics changed, challenges 12 and 14–18 untouched and still disabled.

---

## 1. Files changed

| File | Change |
|---|---|
| `services/instant-web/src/routes/public.js` | `robots.txt` now lists the exact debug endpoint path (ch01) and a new hint path for the path-traversal target (ch03) |
| `services/instant-web/src/seed.js` | New blog post seeded — a customer-spotlight guest post naming the ch04 victim account's exact email |
| `services/instant-web/src/routes/portal.js` | `POST /register` now creates a starter order + invoice for every new customer (ch06/ch11 reachability) |
| `services/instant-web/src/views/portal/api_tokens.ejs` | New "API reference" table listing both API endpoints, including the ch07 diagnostics target |

No migration was needed (all changes use existing tables/columns). No changes to
`docker-compose.yml`, any `Dockerfile`, `db/init/`, session/auth middleware, or any vulnerability's
actual mechanics.

---

## 2. What was fixed, per challenge

**01 — Information Disclosure.** `robots.txt`'s `Disallow` line changed from the directory
prefix `/debug/` to the exact path `/debug/deploy-status-8f3a`. The vulnerable endpoint itself is
byte-for-byte unchanged — only the breadcrumb now names it directly, the same way challenges 04
and 09 already did.

**03 — Path Traversal.** Added `Disallow: /portal/documents/protected/flag.txt` to `robots.txt`.
This names the sibling directory and filename the off-by-one containment bug allows reaching,
without printing the flag's contents. The traversal boundary logic in
`documents/download` is completely unchanged.

**04 — Authentication Bypass.** Added a new blog post (`customer-spotlight-meridian-capital`,
seeded via `seedBlogPosts`) — a realistic customer-spotlight/guest-post pattern common to B2B SaaS
marketing, authored by "Alexandra Chen, Meridian Capital," with a pull-quote ending in her exact
contact email. This is the exact string the `legacy-login` comment-bypass needs to target to land
on the flagged account, closing the gap the audit found (a generic, untargeted bypass reliably
fails — verified previously). The vulnerable query and the account's seeded data are unchanged.

**06 — IDOR.** `POST /company/portal/register` now creates one starter order (`Instant Starter`
plan, `$29.00`, `paid`) and its invoice for every newly registered customer, with no
`internal_memo` set. This gives every player a real, clickable `/invoices/:id` link on their own
Invoices page — closing the "empty list, no visible URL pattern" gap. The vulnerable query
(`WHERE i.id = $1`, no ownership join) is unchanged, and Morgan Reyes's seeded invoice (the actual
IDOR target, `internal_memo` set) is untouched — the IDOR is still fully exploitable against it.

**07 — JWT Authentication Weakness.** Added an "API reference" table to the API Tokens page
listing both `GET /company/api/account` (`account:read`) and
`GET /company/api/internal/diagnostics` (`admin:internal`, noted as "ops/on-call use only"). This
is exactly the kind of accidental internal-endpoint-in-public-docs mistake real API references
make. The `alg:none` verification bypass and the scope check are both unchanged.

**11 — Local File Inclusion (highest priority).** Solved entirely as a side effect of the
challenge 06 fix, by design: since every new player now legitimately owns an invoice, they can
reach `GET /company/portal/invoices/:id/receipt` for **their own** invoice directly — this route's
ownership check (correctly implemented, unlike challenge 06) now passes for a real player account,
with zero dependency on first exploiting challenge 06's IDOR. The `path.resolve()` absolute-path
bypass, the `.txt`-suffix safety constraint, and the denylist are all completely unchanged.

**Preserved as required:** no vulnerability mechanics were touched anywhere; no flag value is
printed or made directly accessible by any of these changes (the blog post names an *email*, not
a flag; `robots.txt` names *paths*, not flag contents; the API docs table names *endpoints*, not
the scope-forgery technique or the flag); Docker/network isolation, `cap_drop`, absence of a
Docker socket, absence of host mounts, and PostgreSQL's private-only exposure are all untouched
(confirmed via `docker-compose.yml` diff and live port inspection); challenges 12 and 14–18 remain
`enabled = false` in the database, confirmed unchanged.

---

## 3. Clean-player attack path (verified live, fresh account, zero prior state)

A new account was registered (`clean.player.remediation@example.com`) with no pre-existing
session, invoices, or special knowledge, and used for every step below.

**01 — Information Disclosure**
Discovery: `GET /company/robots.txt` → Breadcrumb: `Disallow: /debug/deploy-status-8f3a` (exact
path) → Vulnerable functionality: `GET /company/debug/deploy-status-8f3a` → Exploitation: direct
request, no auth → Flag condition: present in every response's `notes` field. **Verified: flag
retrieved on first request.**

**03 — Path Traversal**
Discovery: `GET /company/robots.txt` → Breadcrumb: `Disallow: /portal/documents/protected/flag.txt`
→ Vulnerable functionality: `GET /company/portal/documents/download?file=` → Exploitation:
`?file=../protected/flag.txt` → Flag condition: always present in that file. **Verified: HTTP
200, flag retrieved.**

**04 — Authentication Bypass**
Discovery: `GET /company/blog` → Breadcrumb: "Customer Spotlight: How Meridian Capital Scaled
Their Back Office" post, ending in the victim's exact email → Vulnerable functionality:
`POST /company/portal/legacy-login` → Exploitation:
`email=alexandra.chen@meridiancapital.example' -- `, any password → Flag condition: present only
on that account's own dashboard, "Account Notes" card. **Verified: bypass succeeds, Account Notes
card present.**

**06 — IDOR**
Discovery: Customer Portal → Invoices, now shows the player's own starter invoice as a real link
→ Breadcrumb: the `/company/portal/invoices/:id` URL pattern is now directly observed, not
inferred → Vulnerable functionality: `GET /company/portal/invoices/:id`, no ownership check →
Exploitation: request a different small integer id (`4`, Morgan Reyes's seeded invoice) → Flag
condition: present when the target invoice has a non-null memo. **Verified: player's own invoice
is `id=5`; requesting `id=4` returns Morgan Reyes's invoice with its memo visible.**

**07 — JWT Authentication Weakness**
Discovery: Customer Portal → API Tokens → Breadcrumb: new "API reference" table names
`GET /company/api/internal/diagnostics` and its `admin:internal` scope requirement →
Vulnerable functionality: `verifyApiToken`'s `alg:"none"` bypass in `routes/api.js` →
Exploitation: generate a legitimate token, decode it, re-encode with header `{"alg":"none"}` and
payload `scope:"admin:internal"`, submit to the now-known endpoint → Flag condition: scope check
passes. **Verified: forged token against the documented endpoint returns the flag.**

**11 — Local File Inclusion**
Discovery: the player's own invoice detail page (`/company/portal/invoices/5`, reachable directly
— no IDOR needed) → Breadcrumb: three receipt-style links, each showing `?template=` in the URL
→ Vulnerable functionality: `path.resolve(receiptTemplatesDir, template)`, no containment check
→ Exploitation: `?template=../internal-billing/notes.txt` (or the absolute-path equivalent) →
Flag condition: always present in that file. **Verified: normal receipt renders correctly first
(confirming legitimate use); traversal payload against the player's own invoice returns the flag,
with no prior interaction with challenge 06 at all.**

---

## 4. Regression results

All re-tested live with the same fresh account (or a fresh second account, where noted) after the
fixes were deployed:

| # | Challenge | Result |
|---|---|---|
| 02 | SQL Injection | Pass — UNION payload against `internal_notes` still returns the flag |
| 05 | Stored XSS | Pass — `<script` ticket still flags and shows the flag on the submitter's own ticket list |
| 08 | Business Logic | Pass — negative-points redemption still inflates balance past threshold |
| 09 | CSRF | Pass — unprotected `GET` quick-unsubscribe still sets the flag condition |
| 10 | Unrestricted File Upload | Pass — spoofed `Content-Type` on a non-image file still triggers the scanner flag; a second, independent fresh-account check confirmed no interference from the ch06/11 registration change |
| 13 | Advanced SQL Injection | Pass — boolean oracle (`OR 1=1 --` / `OR 1=2 --`) still returns correct true/false |
| — | Normal functionality | Pass — dashboard now correctly shows "1 Total orders" for a new account; Invoices page renders the new starter invoice (`INV-2026-0005`, status `paid`) correctly; a second fresh registration independently received its own distinct invoice (`id=6`) with no unique-constraint conflicts |
| 12, 14–18 | Disabled challenges | Confirmed still `enabled = false` in the database, unchanged |
| — | Isolation | Confirmed unchanged: only `nginx` publishes ports; `docker-compose.yml` diff for this session shows zero changes (this remediation touched no compose/Dockerfile/network/capability configuration at all) |

No regressions found.

---

## 5. Remaining discoverability issues

None outstanding for challenges 01, 03, 04, 06, 07, or 11 — all six were verified end-to-end with
a clean, zero-prior-state player account.

Two points worth flagging for awareness, not action:

- **Challenge 03** is now fully discoverable (exact path in `robots.txt`), which is a stronger fix
  than the audit strictly required (it had rated this a "soft" finding since "protected/flag.txt"
  is a conventional guess). No downside — just noting the fix is more complete than the minimum.
- **Challenge 09**'s existing dual breadcrumb (`robots.txt` + Settings-page text) already covered
  it; no change was needed or made there.

Challenges 12 and 14–18 remain unimplemented/disabled, as instructed. No new vulnerabilities were
introduced anywhere in this pass.
