-- Phase 3 (challenges 06-10) schema additions.

-- Challenge 06 (IDOR): free-text memo on an invoice, set only on the
-- seeded IDOR-target customer's invoice (see seed.js). Ordinary invoices
-- never have this populated - mirrors the company_users.notes pattern used
-- by challenge 04.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS internal_memo TEXT;

-- Challenge 08 (Business Logic): loyalty point balance used by the rewards
-- redemption flow (see routes/portal.js).
ALTER TABLE company_users ADD COLUMN IF NOT EXISTS loyalty_points INTEGER NOT NULL DEFAULT 0;

-- Challenge 09 (CSRF): email notification preference, plus which code path
-- last changed it - the CSRF-protected settings form ('settings_form') or
-- the legacy one-click link ('email_link') that has no CSRF protection.
ALTER TABLE company_users ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE company_users ADD COLUMN IF NOT EXISTS notification_pref_source VARCHAR(20);

-- Challenge 10 (Unrestricted File Upload): stored avatar filename and
-- whether the automated content scanner flagged it (declared image
-- mimetype did not match the uploaded file's actual content).
ALTER TABLE company_users ADD COLUMN IF NOT EXISTS avatar_filename TEXT;
ALTER TABLE company_users ADD COLUMN IF NOT EXISTS avatar_flagged BOOLEAN NOT NULL DEFAULT FALSE;
