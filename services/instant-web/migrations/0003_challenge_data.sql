-- Phase 2 (challenges 01-05) schema additions.

-- Challenge 04 (Authentication Bypass): optional free-text notes shown on
-- an account's own dashboard. Only the seeded VIP account has this
-- populated; ordinary customers never see this section on their dashboard.
ALTER TABLE company_users ADD COLUMN IF NOT EXISTS notes TEXT;

-- Challenge 05 (XSS): marks a ticket as flagged by the automated content
-- scanner (see routes/portal.js) - set at creation time if the submitted
-- subject/message contains an actual <script> tag, i.e. exactly the shape
-- of payload that would execute given this app's unescaped ticket rendering.
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT FALSE;

-- Challenge 02 (SQL Injection): a realistic-looking internal memos table,
-- never read by any normal application feature - reachable only via the
-- UNION-based SQL injection in the product search endpoint. Column shapes
-- deliberately align with the vulnerable SELECT's column list/types.
CREATE TABLE IF NOT EXISTS internal_notes (
    id         SERIAL PRIMARY KEY,
    title      VARCHAR(160) NOT NULL,
    reference  VARCHAR(64) NOT NULL,
    content    TEXT NOT NULL,
    priority   INTEGER NOT NULL DEFAULT 0,
    tag        VARCHAR(32) NOT NULL DEFAULT 'internal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
