-- Phase 4 (challenges 11 and 13) schema additions.
-- Challenge 12 (Command Injection) was NOT implemented this phase - see
-- docs/CHALLENGES.md "12 - Command Injection (deferred)" for why - so
-- there is no schema change for it here.

-- Challenge 13 (Advanced SQL Injection): a realistic-looking priority
-- support escalation queue, never read by any legitimate application
-- feature - reachable only via the boolean-blind SQL injection in the
-- public order-tracking lookup. Distinct table from challenge 02's
-- internal_notes (different flag, different injection technique/context).
CREATE TABLE IF NOT EXISTS support_escalations (
    id              SERIAL PRIMARY KEY,
    reference       VARCHAR(64) NOT NULL,
    escalation_note TEXT NOT NULL,
    priority        INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
