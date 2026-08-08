#!/usr/bin/env bash
# DESTRUCTIVE: wipes ALL players, company users, orders, invoices, tickets,
# documents, and sessions, then re-seeds from scratch. Use between CTF
# events/cohorts, not casually. See docs/ADMIN_GUIDE.md.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ "${1:-}" != "--yes" ]; then
  read -r -p "This will WIPE all players, solves, and company data. Type RESET to continue: " CONFIRM
  if [ "$CONFIRM" != "RESET" ]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "==> Resetting ctf-platform"
docker compose exec -T ctf-platform node src/reset.js

echo "==> Resetting instant-web"
docker compose exec -T instant-web node src/reset.js

echo "==> Reset complete"
