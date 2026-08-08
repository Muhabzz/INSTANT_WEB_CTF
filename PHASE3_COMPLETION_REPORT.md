# INSTANT WEB CTF — Phase 3 Completion Report

**Scope:** Challenges 06–10 (IDOR, JWT Authentication Weakness, Business Logic Flaw, CSRF,
Unrestricted File Upload). Challenges 11–18 were explicitly out of scope and were not touched.

**Status:** Complete. All changes are currently uncommitted in the working tree (no git commit
was made — this is a working-tree diff only).

---

## 1. Challenge status

| # | Challenge | Status | Verified |
|---|---|---|---|
| 06 | IDOR (invoice access) | Implemented, enabled, tested | Flag retrieved by requesting another customer's invoice by id |
| 07 | JWT Authentication Weakness | Implemented, enabled, tested | Legit token correctly denied elevated scope; forged `alg:none` token retrieved flag |
| 08 | Business Logic Flaw | Implemented, enabled, tested | Negative-points redemption inflated balance past threshold, flag retrieved; legitimate redemption and over-balance rejection both still enforce the intended rule |
| 09 | CSRF | Implemented, enabled, tested | Unprotected GET link changed account state without a token; flag revealed |
| 10 | Unrestricted File Upload | Implemented, enabled, tested | Spoofed `Content-Type` on a non-image file bypassed the allowlist; magic-byte scanner caught it and revealed the flag; real PNG upload does **not** flag; honestly-declared non-image upload is correctly rejected (400) |

## 2. Bug found and fixed during testing

`middleware/portalAuth.js`'s shared `attachUser` query never selected the new `company_users`
columns (`loyalty_points`, `email_notifications_enabled`, `notification_pref_source`,
`avatar_filename`, `avatar_flagged`), causing a 500 error on `/rewards`
(`Cannot read properties of undefined`). Fixed by adding those columns to the `SELECT`. Caught
and corrected during testing, before finalizing — not a security issue, a straightforward
oversight.

## 3. Routes added

- `GET /company/portal/invoices/:id` (06)
- `GET /company/portal/api-tokens`, `POST /company/portal/api-tokens/generate` (07 — token issuance UI)
- `GET /company/api/account`, `GET /company/api/internal/diagnostics` (07 — new router `routes/api.js`, mounted at `/company/api`)
- `GET /company/portal/rewards`, `POST /company/portal/rewards/redeem` (08)
- `POST /company/portal/settings/notifications` (protected), `GET /company/portal/settings/quick-unsubscribe` (unprotected, intentional) (09)
- `POST /company/portal/profile/avatar`, `GET /company/portal/uploads/:filename` (10)

## 4. Flags created

`FLAG_IDOR`, `FLAG_JWT`, `FLAG_BUSINESS_LOGIC`, `FLAG_CSRF`, `FLAG_FILE_UPLOAD` — wired through
`.env` / `.env.example` → `docker-compose.yml` → both services' `config.js` → `ctf-platform`'s
seed (hashed into `challenges.flag_hash`) and `instant-web`'s vulnerable sinks, matching the
existing architecture exactly. None are hardcoded in frontend JS, public HTML, or docs — each
flag only renders after its specific server-side condition is met.

## 5. Database changes

New migration `services/instant-web/migrations/0004_phase3_challenge_data.sql`:
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on `invoices` (`internal_memo`) and `company_users`
(`loyalty_points`, `email_notifications_enabled`, `notification_pref_source`, `avatar_filename`,
`avatar_flagged`). No new tables, no role/grant changes. `db/init/01-create-app-roles.sh`
untouched. Confirmed by direct query: `company_app` still cannot `SELECT` from `players`, and
`platform_app` still cannot `SELECT` from `company_users`.

`ctf-platform/src/seed.js`'s challenge list was updated for order_index 6–10 (new
slugs/titles/points, `enabled: true`), superseding the Phase 2 placeholder rows for those slots
(documented in code comments and `docs/CHALLENGES.md`, matching the precedent already set for
the Phase 1→2 upgrade). **Note:** because this is an upgrade of an already-seeded deployment, the
old placeholder rows (`public-blog-metadata`, `customer-order-access`, etc.) now exist as
harmless orphaned rows — still `enabled = false`, hidden from players. `scripts/reset.sh` will
clean these up if a fully pruned challenge table is wanted; it was not run since it is
destructive to player accounts/scores and wasn't explicitly requested.

## 6. Authentication changes

None to `ctf-platform` or to the customer/employee/admin session model. Challenge 07 adds a
**new, separate** bearer-token auth surface (`COMPANY_API_JWT_SECRET`) scoped entirely to
`instant-web`'s own `/company/api/*`; it shares no code, secret, or session store with any
cookie-based login.

## 7. Docker/network changes

Only additive environment variables in `docker-compose.yml` (the 5 new flags +
`COMPANY_API_JWT_SECRET` on `ctf-platform`/`instant-web`) — confirmed via diff. No changes to
`cap_drop`, `privileged`, `volumes`, `ports`, or `networks` on any service.

## 8. Tests performed

All 10 items from the requested testing checklist, for all 5 new challenges: discovery path,
exploit, correct flag, duplicate-submission dedup (verified via `solves` table — exactly one row
per challenge, 600 total points, no double-award), unrelated-flag rejection (wrong flag against
`jwt-auth-weakness` → "Incorrect"), normal functionality (legit avatar upload, legit reward
redemption, over-balance rejection, settings form), Docker/network isolation, restart survival
(`docker compose restart`, not recreate — session, rewards balance, notification flag, and the
uploaded avatar file itself all persisted), and regression-tested all of challenges 01–05 (all
still pass) plus confirmed 11–18 return 404 for players.

## 9. Isolation verification

- `company_app` / `platform_app` cross-table access: still denied (tested live)
- Only `nginx` has published ports (`docker compose ps` confirmed 80/443 only)
- No privileged containers, `cap_drop: [ALL]` intact everywhere, no Docker socket, no host
  filesystem/root mounts (docker-compose.yml diff confirms no new volumes)
- Postgres not publicly exposed
- Challenge 10's uploads directory is container-local (`challenge-data/uploads/`), created at
  startup, never a host bind mount; no code execution occurs anywhere in the upload path
- Challenge 07's JWT surface cannot reach `ctf-platform`, Postgres directly, or any other
  container

## 10. Known limitations

1. **Multer 1.x deprecation warning** — `npm install` flagged `multer@1.4.5-lts.2` as having
   known (DoS-class) vulnerabilities patched in multer 2.x. Not upgraded during this pass since
   2.x has API differences that weren't validated against this route; flagging for a follow-up
   rather than silently swapping it. This is not a host-escape/credential/CTF-platform-compromise
   issue, so it did not trigger a stop condition.
2. Challenge 09's flag is awarded on evidence the unprotected `GET` path was used (no live
   second-browser victim exists in this environment to demonstrate true cross-site forgery) —
   same honestly-documented constraint the project already uses for challenge 05.
3. Uploaded avatars (challenge 10) live on the container's writable layer, not a volume — they
   survive `docker compose restart` (tested) but would be lost on a full container
   recreate/rebuild, same as challenge 03's flag file would be if it weren't rewritten from
   `.env` at every startup. Consistent with the architecture's "no host mounts" design and not a
   security issue.
4. Orphaned Phase 2 placeholder rows for slugs 06–10 remain in the DB as disabled/inert —
   cosmetic only, cleanup available via `scripts/reset.sh` at your discretion.

## 11. Confirmations

- Challenges 01–05 remain enabled and working
- Challenges 06–10 are enabled and working
- Challenges 11–18 remain disabled (verified via DB query and player-facing 404s)
- Only nginx is publicly exposed
- No host filesystem is exposed
- No Docker socket is mounted
- No privileged container exists

No stop-condition issues (host escape, Docker escape, AWS metadata, real credential exposure,
cross-application auth, CTF-platform compromise, or Postgres privilege escalation) were
encountered.

**Challenges 11–18 were not implemented, as scoped.**
