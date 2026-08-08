#!/usr/bin/env bash
# Idempotent: upserts challenges/products/blog posts, ensures demo accounts
# exist. Safe to re-run at any time; will not duplicate data or reset scores.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Seeding ctf-platform"
docker compose exec -T ctf-platform node src/seed.js

echo "==> Seeding instant-web"
docker compose exec -T instant-web node src/seed.js

echo "==> Seed complete"
