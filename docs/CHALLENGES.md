# Challenges

## Phase 1 status

The challenge/flag **framework** is fully built and tested: 18 challenge
rows exist in the database, flags follow the `INSTANT{...}` format and are
stored only as sha256 hashes, solves are deduplicated per player, and the
scoreboard/admin panel both work end-to-end.

**Only one challenge is actually enabled and solvable right now:
`getting-started`.** It exists purely to validate the framework (dashboard,
submission, scoreboard, duplicate-solve prevention) without any real
vulnerability. The remaining 17 rows are **placeholders**: their slug,
title, category, difficulty, and point value are reserved, but they are
`enabled = false` and have no real vulnerable implementation yet. That
arrives in later build phases, one category at a time, per the project's
phased build plan (Phase 1 explicitly excludes SQLi, XSS, IDOR, JWT issues,
CSRF, path traversal, upload vulnerabilities, LFI/RFI, command injection,
SSRF, DOM XSS, race conditions, and RCE).

An admin can enable/disable any challenge from **Admin → Challenges** in the
CTF platform at any time; disabled challenges are hidden from players.

## Challenge list

| # | Slug | Title | Category | Difficulty | Points | Status |
|---|---|---|---|---|---|---|
| 1 | `getting-started` | Getting Started | Getting Started | beginner | 10 | **Enabled** |
| 2 | `public-product-catalog` | Product Catalog Recon | Public Website | beginner | 50 | Reserved |
| 3 | `public-blog-metadata` | Blog Metadata Exposure | Public Website | beginner | 50 | Reserved |
| 4 | `customer-auth` | Customer Portal Authentication | Customer Portal | easy | 100 | Reserved |
| 5 | `customer-order-access` | Order Access Control | Customer Portal | easy | 125 | Reserved |
| 6 | `customer-invoice-handling` | Invoice Handling | Customer Portal | medium | 150 | Reserved |
| 7 | `customer-support-tickets` | Support Ticket Exposure | Customer Portal | medium | 150 | Reserved |
| 8 | `employee-auth` | Employee Portal Authentication | Employee Portal | easy | 125 | Reserved |
| 9 | `employee-directory` | Employee Directory Exposure | Employee Portal | medium | 150 | Reserved |
| 10 | `employee-documents` | Document Handling | Employee Portal | medium | 175 | Reserved |
| 11 | `employee-file-upload` | File Upload Handling | Employee Portal | hard | 200 | Reserved |
| 12 | `employee-analytics` | Analytics Dashboard | Employee Portal | medium | 150 | Reserved |
| 13 | `company-admin-access` | Company Admin Access Control | Company Admin | hard | 225 | Reserved |
| 14 | `company-admin-users` | Admin User Management | Company Admin | hard | 225 | Reserved |
| 15 | `internal-api-exposure` | Internal API Exposure | Internal Services | hard | 250 | Reserved |
| 16 | `template-service-rendering` | Template Rendering | Internal Services | advanced | 275 | Reserved |
| 17 | `infra-service-recon` | Infrastructure Service Recon | Internal Services | advanced | 275 | Reserved |
| 18 | `full-chain-compromise` | Full Chain: Company Compromise | Attack Chain | advanced | 400 | Reserved |

Total: 18 challenges, 18 unique flags (see `services/ctf-platform/src/seed.js`
for the current placeholder flag values — all placeholders follow
`INSTANT{placeholder_<slug>}` except `getting-started`, whose real flag is
shown directly on the challenge page).

## Progression model (planned)

- **Categories 1-2** (Public Website): no authentication required, pure
  reconnaissance.
- **Categories 3-4** (Customer / Employee Portal): independent tracks, each
  gated by that portal's own authentication challenge.
- **Category 5** (Company Admin): builds on access gained via customer or
  employee footholds.
- **Category 6** (Internal Services): requires a foothold in `instant-web`
  first, since internal services aren't reachable from outside its network.
- **Challenge 18** (Full Chain): ties multiple earlier footholds together
  into one end-to-end compromise. Uses `prerequisite_id` (already present in
  the schema, unused by any Phase 1 challenge) once later phases need
  hard-gating.

This is a hybrid design: most challenges are independently solvable, but a
few (internal services, the full chain) are naturally sequenced by what
access they require.

## Flag format

All flags: `INSTANT{...}`. Never exposed via frontend source, API
responses, JS bundles, public config, or environment variables visible to
the browser — see `docs/SECURITY.md`.
