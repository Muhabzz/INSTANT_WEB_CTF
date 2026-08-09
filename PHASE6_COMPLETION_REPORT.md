# INSTANT WEB CTF — Phase 6 Completion Report

**Scope:** Replace Challenge 12 (previously disabled, originally reserved for Command Injection,
never implemented) with a genuine Race Condition challenge, per the approved design.

**Status:** Complete. Challenge 12 is implemented, tested end-to-end (sequential, concurrent, and
reset behavior all independently verified), and only enabled after that testing finished. All 18
challenges (01–18) are now implemented and enabled.

---

## Exact route and vulnerable code flow

**Route:** `POST /company/portal/rewards/claim-bonus` (customer-portal, session-authenticated)

```
1. SELECT welcome_bonus_claims FROM company_users WHERE id = $1      -- the check
2. await sleep(400ms)                                                -- widens the race window
3. if (claims from step 1 > 0): reject with "already claimed"
   else: UPDATE company_users
         SET loyalty_points = loyalty_points + 500,
             welcome_bonus_claims = welcome_bonus_claims + 1
         WHERE id = $1                                                -- the act
```

The check and the act are two independent round-trips with **no transaction**, **no row lock**
(`SELECT ... FOR UPDATE`), and the `UPDATE` is **unconditional** rather than an atomic
compare-and-swap (`... WHERE welcome_bonus_claims = 0`). Any number of concurrent requests that
arrive during the 400ms window all read the same pre-write `claims = 0` and all proceed to
increment.

## Discovery path

Existing Rewards page (challenge 08's page) gains a new "Welcome Bonus" card: a plainly visible
one-time-claim button ("New accounts can claim a one-time 500 point welcome bonus"). The
"one-time" framing on an ordinary claim button is the standard trigger for testing
concurrent/rapid submission — no hidden parameters, no undocumented endpoints.

## Reproducible exploitation steps

1. Register a customer account (self-service, free).
2. Load `/company/portal/rewards`, capture the session cookie and CSRF token.
3. Fire N requests to `POST /company/portal/rewards/claim-bonus` **simultaneously** (backgrounded
   `curl` processes, or any tool that sends requests in parallel — e.g. Burp Turbo Intruder) using
   the same session/CSRF token.
4. Inspect the account's `welcome_bonus_claims` — a successful race produces a value ≥ 2.

## Expected sequential behavior — verified live

- First claim (fresh account): succeeds, `welcome_bonus_claims = 1`, balance +500, no flag.
- Second claim sent immediately after (fully sequential, not concurrent): correctly rejected
  ("You have already claimed your welcome bonus"), state unchanged at `claims = 1` — confirmed via
  direct DB read before and after.
- Sequential requests never produce `claims > 1` under any tested repetition.

## Expected concurrent behavior — verified live, genuine (not simulated)

- 15 truly concurrent requests (backgrounded, fired simultaneously, single shared session) against
  a fresh account produced `welcome_bonus_claims = 15`, `loyalty_points = 7500` — confirmed via
  direct DB read. 14 of the 15 individual HTTP responses independently showed the flag inline.
- Repeated after a reset: 8 concurrent requests produced `welcome_bonus_claims = 8` — confirms the
  outcome is reliably reproducible, not a one-off fluke.
- This is real concurrency: Node's event loop genuinely interleaves the awaited DB round-trips of
  distinct in-flight requests (confirmed the connection pool (`pg.Pool`, `max: 10`) permits true
  parallel DB round-trips, not a single serialized client) — no code path "pretends" a race by
  just accepting repeated sequential calls.

## Flag condition

Included in the response, and on the Rewards page, only when `welcome_bonus_claims >= 2` — direct,
unambiguous proof multiple increments landed on one account, which is reachable **only** via the
race (no sequential-use path can produce it, verified above). No other route in the application
increments this column — confirmed by grep across the codebase.

**Verified the flag is absent before the race succeeds:** checked the Rewards page immediately
after registration (0 flag occurrences) and again after exactly one successful sequential claim
(0 flag occurrences, `claims = 1`) — the flag only ever appeared after a run that produced
`claims >= 2`.

## Reset/retry behavior

`POST /company/portal/rewards/reset-bonus` resets the **requesting account's own**
`welcome_bonus_claims` to 0 and reverses the associated points. Confirmed live it is **not**
referenced anywhere in the rendered Rewards page HTML (grep for the route name in the page output
returned zero matches) — not a prominent UI control, per your adjustment. It's documented in
`docs/CHALLENGES.md` (admin-only) as an intentional testing/retry mechanism. Using it and then
re-running the concurrent test reproduced the race successfully a second time on the same account,
confirming deterministic retry works.

## Isolation verification

- No shell execution, no `child_process`/`exec`/`spawn` anywhere in the new code (grep-confirmed).
- No outbound network requests from this feature — pure DB read/write via the existing
  `company_app` role on the existing `company_users` table (one new column, no new tables, no
  grant changes).
- `docker-compose.yml` diff for this change is exactly one additive line
  (`FLAG_RACE_CONDITION: ${FLAG_RACE_CONDITION}` on `instant-web` and `ctf-platform`) — no `ports`,
  `volumes`, `cap_drop`, `privileged`, or `networks` changes.
- Published ports unchanged (only `nginx` exposes 80/443, confirmed via `docker compose ps`).
- `company_app` / `platform_app` Postgres role isolation re-verified live (both directions still
  return "permission denied").
- No AWS metadata path touched anywhere in this feature.

## Regression test results

| # | Challenge | Result |
|---|---|---|
| 01 | Information Disclosure | Pass |
| 02 | SQL Injection | Pass |
| 03 | Path Traversal | Pass |
| 06 | IDOR | Pass |
| **08** | **Business Logic (shares the Rewards page template)** | **Pass — explicitly re-verified with a fresh account: negative-points redemption still unlocks "Platinum Concierge" exactly as before. `/rewards/redeem`'s route code is byte-for-byte unchanged.** |
| 09 | CSRF | Page loads correctly |
| 10 | Unrestricted File Upload | Page loads correctly |
| 11 | LFI | Pass (tested on a fresh account's own invoice, no challenge 06 dependency) |
| 13 | Advanced SQL Injection | Pass |
| 14 | SSRF | Pass |
| 15 | Open Redirect | Pass |
| 16 | CORS Misconfiguration | Pass |
| 17 | RFI | Pass |
| 18 | Chained Attack | Pass |
| — | Flag submission (ch12) | Correct flag accepted (+200), duplicate submission correctly deduped, cross-challenge flag correctly rejected |
| — | Player-facing challenge count | Exactly 18 |
| — | Restart survival | `docker compose restart` (not recreate) on `instant-web`/`ctf-platform` — race-account state (`claims=8`, `points=4000`) and the ch12 solve record both persisted exactly, no duplication |

No regressions found anywhere.

## Known limitations

None beyond the deliberate scope of the challenge. The reset endpoint requires a CSRF token like
every other state-changing route in the app; since it isn't linked in the UI, a player using it
would grab a token from any other page load in the same session first (standard, no special
knowledge needed).

---

**Challenge 12 is now enabled. All 18 challenges (01–18) are implemented and enabled.** No changes
were made to Challenge 08's route or vulnerability. Command Injection was not implemented anywhere
in this project. STOP.
