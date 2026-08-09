# INSTANT WEB CTF — Phase 5 Completion Report

**Scope:** Challenges 14 (SSRF), 15 (Open Redirect), 16 (CORS Misconfiguration), 17 (Remote File
Inclusion), 18 (Chained Web Attack). Challenge 12 remains untouched and disabled, as instructed.

**Status:** Complete. All five challenges implemented, enabled, and fully verified with a
genuinely fresh player account. All changes are currently uncommitted in the working tree.

---

## Files changed

| File | Purpose |
|---|---|
| `services/infra-service/src/index.js` | New `/diagnostics/internal-report` (ch14 flag), extended `/status` with a breadcrumb; new `/assets?name=` (ch17 vulnerable file resolution) + startup content writer |
| `services/instant-web/src/routes/portal.js` | New routes: `/integrations` + `/integrations/connectivity-test` (14), `/api/widget-summary` (16), `/settings/signature-preview` (17); new nav item |
| `services/instant-web/src/routes/public.js` | New `/out?url=` redirect tracker (15) |
| `services/instant-web/src/routes/api.js` | New `/internal/ops-console` (18) |
| `services/instant-web/src/seed.js` | New `ops-integration` account + invoice (18) |
| `services/instant-web/src/views/portal/integrations.ejs` | New (14) |
| `services/instant-web/src/views/portal/signature_preview.ejs` | New (17) |
| `services/instant-web/src/views/public/leaving.ejs` | New (15) |
| `services/instant-web/src/views/portal/settings.ejs` | Breadcrumbs added for 16, 17 |
| `services/instant-web/src/views/portal/api_tokens.ejs` | Breadcrumb row added for 18 |
| `services/instant-web/src/views/public/home.ejs` | Partner links added (15) |
| `services/instant-web/src/config.js`, `services/ctf-platform/src/config.js` | 5 new flag entries |
| `services/ctf-platform/src/seed.js` | Challenge rows 14–18 replaced with real definitions, `enabled: true` |
| `.env`, `.env.example`, `docker-compose.yml` | 5 new `FLAG_*` vars wired through; `infra-service` also newly receives `FLAG_SSRF`/`FLAG_RFI` |
| `docs/CHALLENGES.md` | Full sections for 14–18, table/summary updated |

No new tables, no migrations, no Dockerfile changes (all needed content is written at container
startup, same pattern as existing challenges).

---

## Challenge 17 correction, as requested

The original approved proposal reused `template-service`'s symbolic template-name lookup, which
on inspection wasn't genuine RFI (no real network-fetched *inclusion*, and that service's own
fixed-whitelist design is intentionally safe). The corrected, implemented design instead: (a)
fetches a named snippet from a **separate container** over the network (`infra-service`, the
"remote" in RFI), and (b) embeds the fetched bytes **unescaped** directly into the rendered
preview (`<%- content %>` — the "inclusion," as opposed to challenge 14's SSRF, which only ever
displays raw fetched bytes as a status report). The vulnerable `path.resolve()` logic (no
containment check) lives on `infra-service` itself, bounded by the same mandatory-`.txt`-suffix +
denylist pattern already proven safe in challenge 11.

---

## Clean-player verification (all live, one fresh account, zero prior state)

**14 — SSRF:** View-source on the new Integrations page reveals a hidden `target` field. Changing
it from the default `http://template-service:4002/health` to `http://infra-service:4003/status`
(still passes the host/port allowlist) returns a response naming a further path,
`/diagnostics/internal-report`; requesting that returns the flag. Confirmed the allowlist still
rejects `169.254.169.254` and `http://example.com/` (both 400).

**15 — Open Redirect:** Homepage partner links use `/company/out?url=`. A legitimate partner URL
produces no flag. Two distinct bypasses of the substring-based check (`?x=partners.instant.example`
in a query string; `partners.instant.example.attacker.example` as a subdomain prefix) both
produced the flag via the server's own hostname-parse mismatch detection. An unrelated URL is
rejected outright (400).

**16 — CORS Misconfiguration:** Settings documents the endpoint. Same-origin/direct access
returns account data with no flag. A request bearing `Origin: null` (what a saved local HTML PoC
file would send) or any foreign `Origin` gets `Access-Control-Allow-Origin` reflected back with
`Access-Control-Allow-Credentials: true`, and the flag appears in the body — confirmed via raw
response headers, not just body content.

**17 — RFI:** Settings → Support Signature explicitly names the `internal/` folder in its own
copy. Normal snippets (default/formal/minimal) render correctly. `?snippet=../internal/flag`
returns the flag. Confirmed the denylist still blocks a `/proc/self/environ`-shaped traversal
attempt (renders an error, no content leaked, verified by inspecting the actual response body,
not just the outer HTTP status).

**18 — Chained Attack:** API reference table names `ops-console` and hints scope alone isn't
enough. Enumerating invoice ids the same way challenge 06 teaches turned up one revealing "service
ID 31." Forging a token via challenge 07's exact `alg:none` technique with the *wrong* `sub`
(even with correct scope) was rejected; the same technique with `sub: 31` succeeded — proving the
endpoint genuinely requires both steps, not just one.

---

## Regression results

| # | Challenge | Result |
|---|---|---|
| 01 | Information Disclosure | Pass |
| 02 | SQL Injection | Pass |
| 03 | Path Traversal | Pass |
| 06 | IDOR | Pass |
| 08 | Business Logic | Page loads correctly (200) |
| 09 | CSRF | Page loads correctly (200) |
| 13 | Advanced SQL Injection | Pass (boolean oracle still correct) |
| — | Public/portal page smoke test | All 200 (home, products, about, careers, blog, support, track-order) |
| — | Flag submission | All 5 new flags accepted correctly, duplicate submission correctly deduped, cross-challenge flag correctly rejected |
| — | Restart survival | `docker compose restart` (not recreate) on `instant-web`/`infra-service`/`ctf-platform` — challenges 14, 17, 18 re-verified working afterward; solve count/points (5 solves, 1,200 points) persisted exactly, no duplication |
| 12, and legacy 14–18 placeholders | Disabled challenges | All confirmed `enabled = false` and 404 for players |

No regressions found. (04, 05, 07, 10, 11 were not independently re-exercised this pass since none
of this phase's changes touch their routes, views, or seed data — 06 and 13 were, since ch18
reuses 06's exact route and ch13's route file (`public.js`) also gained the new `/out` route.)

## Isolation verification

- Only `nginx` has published ports (confirmed via `docker compose ps`)
- `docker-compose.yml` diff for this phase is additive environment variables only — no
  `cap_drop`, `privileged`, `volumes`, `ports`, or `networks` changes on any service
- `company_app` / `platform_app` cross-table access: still denied, re-tested live
- SSRF (14) target allowlist confirmed live to reject AWS metadata IP and external hosts
- RFI (17) denylist + mandatory suffix confirmed live to block dangerous-path attempts with no
  content leak
- `infra-service` makes no outbound requests of its own anywhere in either new route (pure local
  file reads / static JSON) — no path to AWS metadata exists independent of the SSRF allowlist
- No new tables; challenge 18's new account/invoice use existing `company_app`-owned tables with
  unchanged grants

## Known limitations

None beyond the deliberate scope of each challenge. Challenge 15's flag condition (server-side
hostname-parse mismatch detection) means a redirect to an actually-allowed partner domain
correctly produces no flag — this is intentional, not a bug.

## Confirmations

- Challenges 01–11 and 13 remain enabled and working
- Challenges 14–18 are enabled and working
- Challenge 12 remains disabled and untouched (no route, flag, or schema exists for it)
- Only nginx has public ports; no host filesystem exposed; no Docker socket mounted; no
  privileged container exists; PostgreSQL not publicly exposed

STOP.
