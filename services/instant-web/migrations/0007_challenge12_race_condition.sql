-- Challenge 12 (Race Condition): one-time welcome bonus claim count.
-- Intended business rule: claimable exactly once per account (0 or 1).
-- Nothing in the application other than POST /rewards/claim-bonus
-- increments this column - POST /rewards/reset-bonus only ever resets it
-- back to 0 for the requesting account's own testing/retry.
ALTER TABLE company_users ADD COLUMN IF NOT EXISTS welcome_bonus_claims INTEGER NOT NULL DEFAULT 0;
