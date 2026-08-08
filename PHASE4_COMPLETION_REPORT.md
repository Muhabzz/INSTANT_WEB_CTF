# INSTANT WEB CTF — Phase 4 Completion Report

**Scope:** Challenges 11 (LFI) and 13 (Advanced SQL Injection). Challenge 12 (Command Injection)
was deliberately **not** implemented this phase — see section 3. Challenges 14–18 were out of
scope and were not touched.

**Status:** Complete for 11 and 13; 12 deferred pending a decision outside this repo. All changes
are currently uncommitted in the working tree (no git commit was made).

---

## 1. Challenge 11 — Local File Inclusion

**Status: Implemented, enabled, tested.**

- **Route:** `GET /company/portal/invoices/:id/receipt?template=`
- **Feature:** Invoice receipts can be previewed in three styles (Standard/Detailed/Minimal),
  linked from each invoice's detail page.
- **Bug:** `path.resolve(receiptTemplatesDir, requestedPath)` with no containment check. Two
  independent bypasses work: relative `../` traversal, and an absolute-path argument, which
  `path.resolve()` treats as an anchor that **discards the base directory entirely** (a
  well-known Node.js footgun). A narrow denylist blocks a few named dangerous substrings
  (`/proc/`, `/etc/shadow`, `.ssh/`, `docker.sock`) but doesn't address the missing containment
  check itself.
- **Safety property:** a mandatory `.txt` suffix is appended whenever the input doesn't already
  end in `.txt`. This is load-bearing, not cosmetic — it's what keeps the bug from reaching
  `/proc/self/environ`, `/etc/shadow`, SSH keys, or any Docker-socket-shaped path, since none of
  those end in `.txt`.
- **Flag target:** `challenge-data/internal-billing/notes.txt`, written at container startup from
  `FLAG_LFI`, sibling to (not inside) the templates directory.
- **Tested:** normal receipt rendering (all 3 styles) works; relative-traversal payload and
  absolute-path payload both retrieve `FLAG_LFI`; denylist correctly blocks `/etc/shadow.txt` and
  `/proc/self/environ.txt`-shaped attempts (400); invoice ownership is correctly enforced (a
  non-owner gets 404 — this route is not also an IDOR).

## 2. Challenge 13 — Advanced SQL Injection

**Status: Implemented, enabled, tested.**

- **Route:** `POST /company/track-order` (public, unauthenticated — a standard "track my order"
  feature).
- **Technique:** Boolean-based blind SQL injection in a **numeric** (unquoted) context —
  deliberately different from challenge 02 (string-context, UNION-based). `order_id` is
  concatenated with no quoting; the response only ever reveals found/not-found, never row data,
  so UNION extraction has nothing to attach to.
- **Exploit shape:** `order_id = 0 OR (<boolean subquery>) -- ` (comment-bypass, same idea as
  challenge 04) turns the found/not-found response into one bit of a larger extraction.
- **Flag target:** a new table, `support_escalations.escalation_note`, seeded once, never read by
  any legitimate route.
- **Tested end-to-end with a real blind-extraction script** (not just a DB read) — wrote a
  Python script that only talks to the HTTP endpoint and performs binary search over
  `ascii(substring(...))` per character, exactly as a player/`sqlmap` would. It correctly
  recovered the full string purely from the boolean oracle:
  `Meridian Capital renewal escalation - executive sponsor requested a same-day callback.
  Internal tracking ref: INSTANT{bl1nd_b00l34n_3xtr4ct10n}` — confirming the flag is `INSTANT{bl1nd_b00l34n_3xtr4ct10n}`.
- **Isolation tested directly:** queried `support_escalations` via `company_app` for the flag
  (works — it owns that table); then via `psql -U company_app` ran the literal injected SQL
  shape against `players`, which returned `ERROR: permission denied for table players`. The
  application's `catch` block folds that Postgres error into the same "not found" response as a
  genuine non-match, so the boolean oracle simply doesn't function against platform-owned tables
  — verified live, not just by code inspection.

## 3. Challenge 12 — Command Injection: deferred, not implemented

**Finding:** Before writing any code, I ran a preflight check on the already-running
`instant-web` container (no code changes of mine involved) for two things needed to safely build
this challenge: available diagnostic tooling, and whether AWS instance metadata (IMDS) is
reachable.

- Tooling check was fine — `ping`, `nslookup`, `getent`, `wget` are already present in the base
  Alpine image.
- IMDS check was **not** fine:
  1. `GET http://169.254.169.254/latest/meta-data/` from inside the container returned a live
     HTTP 401 (IMDSv2 token required) — reachable, not blocked.
  2. The full IMDSv2 token flow succeeded: `PUT /latest/api/token` returned a valid session
     token.
  3. Querying `/latest/meta-data/iam/security-credentials/` with that token returned 404 — **no
     IAM role is currently attached to this EC2 instance**, so there's nothing to steal today,
     but that's incidental AWS console state, not a control this platform enforces.

Granting genuine command execution inside a container on this host (which the spec explicitly
required — "demonstrate command execution... retrieve FLAG_COMMAND_INJECTION") would have a live
path to IMDS. The standard fix (`--http-put-response-hop-limit 1` on the EC2 instance metadata
options) is an AWS-side setting, not expressible in this repo's `docker-compose.yml`/Dockerfiles.
An in-container workaround (iptables blocking 169.254.169.254) would itself require `NET_ADMIN`,
weakening `cap_drop: [ALL]` to build a fix for a problem outside this repo's scope.

**I stopped and reported this to you before writing any Challenge 12 code**, per the explicit
instruction to do so for AWS metadata access findings. You chose "skip Ch.12 for now, implement
11 & 13 only." No route, flag, schema change, or Dockerfile change was made for challenge 12; its
placeholder row (`employee-file-upload`, order_index 12) is untouched and remains
`enabled = false`.

I also corrected a factual error this finding exposed in the existing challenge 10 documentation,
which had claimed "no AWS metadata endpoint reachable from instant-web's network" — that was
wrong and is now corrected in `docs/CHALLENGES.md` (challenge 10's exposure to this is nil either
way, since it grants no command execution or outbound-request capability — only the doc's claim
was inaccurate).

## 4. Routes added/modified

- `GET /company/portal/invoices/:id/receipt` (11)
- `GET /company/track-order`, `POST /company/track-order` (13, `routes/public.js`)
- `invoice_detail.ejs` updated with three receipt-style links
- Nav updated: "Track Order" added to the public site nav

## 5. Flags created

`FLAG_LFI`, `FLAG_ADVANCED_SQLI` — wired through `.env`/`.env.example` → `docker-compose.yml` →
both services' `config.js` → `ctf-platform`'s seed (hashed into `challenges.flag_hash`) →
`instant-web`'s vulnerable sinks, matching the existing architecture. Neither is hardcoded in
frontend JS, public HTML, or docs. `FLAG_COMMAND_INJECTION` was **not** created (challenge 12 not
implemented).

## 6. Database changes

New migration `services/instant-web/migrations/0005_phase4_challenge_data.sql`: one new table,
`support_escalations` (challenge 13), owned by `company_app` (created by `instant-web`'s
migration runner, which connects as `company_app`). No changes to `db/init/01-create-app-roles.sh`,
no new grants, no role changes. Confirmed live: `company_app` still cannot read `solves`;
`platform_app` still cannot read `support_escalations`.

`ctf-platform/src/seed.js`'s challenge list was updated for order_index 11 and 13 (new
slugs/titles/points, `enabled: true`), superseding the Phase-3-era placeholder rows for those two
slots specifically (order_index 12's placeholder is untouched). Documented in code comments and
`docs/CHALLENGES.md`, matching the precedent from the Phase 2→3 upgrade. As before, this leaves
the old placeholder rows (`employee-documents`, `employee-analytics`) as harmless orphaned,
disabled rows — `scripts/reset.sh` will prune them if wanted; not run since it's destructive to
player data and wasn't requested.

## 7. Authentication changes

None. Both new challenges use existing auth: challenge 11 is behind `customerAuth.requireAuth`
(with a correctly-enforced ownership check on top); challenge 13 is intentionally unauthenticated,
matching a real "track your order" feature.

## 8. Docker/network changes

Only additive environment variables in `docker-compose.yml` (`FLAG_LFI`, `FLAG_ADVANCED_SQLI` on
both `ctf-platform` and `instant-web`) — confirmed via diff. No changes to `cap_drop`,
`privileged`, `volumes`, `ports`, or `networks` on any service. No Dockerfile changes were needed
(all required tooling was already present in the base image).

## 9. Tests performed

For both challenges: normal functionality, discovery path, exploitation, correct flag obtained,
duplicate-submission dedup (verified via `solves` table), cross-challenge flag rejection (ch11's
flag submitted against ch13 → "Incorrect"), host/Docker-socket/AWS-metadata inaccessibility (no
code execution exists in either challenge, so neither has any such path by construction),
PostgreSQL isolation (tested live, not just inspected), restart survival (`docker compose
restart`, not recreate — both exploits and the CTF-platform solve records persisted), regression
of challenges 01–10 (all still pass), and confirmation that 12 and 14–18 return 404 for players
and remain `enabled = false` in the database.

## 10. Isolation verification

- Only `nginx` has published ports (`docker compose ps` confirmed 80/443 only; every other
  service, including the two touched here, shows no host port mapping)
- `cap_drop: [ALL]`, non-root, no privileged mode, no Docker socket, no host mounts — all
  unchanged (diff-confirmed)
- PostgreSQL not publicly exposed (`5432/tcp` with no host binding)
- `company_app` / `platform_app` cross-table access: still denied, tested live against the new
  table and against `solves`
- Challenge 11 stays entirely within `instant-web`'s own container filesystem — no host bind
  mounts exist anywhere in the service's definition
- Challenge 13 grants no code execution, no file access, no outbound request capability — a pure
  SQL boolean oracle bounded by Postgres's own role-based grants

## 11. Known limitations

1. **Challenge 12 is not implemented.** See section 3. Revisit once IMDS hop-limit is hardened at
   the AWS/EC2 level (or the "accept the risk" / "implement without real command execution"
   trade-off is explicitly decided).
2. Challenge 11's LFI is deliberately narrower than a fully unbounded one — bounded to
   `.txt`-suffixed targets specifically to avoid `/proc/self/environ` (which would leak every
   flag and the live DB/JWT secrets in this container's environment, not just `FLAG_LFI`). This
   is a design choice, documented in `docs/CHALLENGES.md`, not an accidental gap.
3. Challenge 13's flag is realistically tedious to extract by hand, as with any real blind SQLi —
   intended to be solved with a short scripted loop (e.g. `sqlmap --technique=B`), which is
   standard for this difficulty tier and was exactly how I validated it.
4. A pre-existing documentation error (challenge 10 claiming AWS metadata was unreachable) was
   found and corrected as a side effect of the challenge-12 preflight check.

## 12. Confirmations

- Challenges 01–10 remain enabled and working (regression-tested)
- Challenges 11 and 13 are enabled and working
- Challenge 12 remains disabled (deferred, not a silent skip — see section 3)
- Challenges 14–18 remain disabled
- Only nginx has public ports
- No host filesystem is exposed
- No Docker socket is mounted
- No privileged container exists
- PostgreSQL is not publicly exposed

**Challenges 14–18 were not implemented, as scoped. Challenge 12 was intentionally deferred per
your decision. STOP — waiting for further instructions.**
