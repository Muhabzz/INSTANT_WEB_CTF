#!/usr/bin/env bash
# First-time deployment: build images, start the stack, wait for health,
# then seed baseline data. Safe to re-run.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo "==> No .env found, copying .env.example -> .env"
  cp .env.example .env
  echo "    Edit .env and set real secrets before deploying to a shared/public host."
fi

echo "==> Building images"
docker compose build

echo "==> Starting stack"
docker compose up -d

echo "==> Waiting for services to become healthy"
ATTEMPTS=0
MAX_ATTEMPTS=30
until [ "$(docker compose ps --format '{{.Health}}' ctf-platform 2>/dev/null)" = "healthy" ] && \
      [ "$(docker compose ps --format '{{.Health}}' instant-web 2>/dev/null)" = "healthy" ] && \
      [ "$(docker compose ps --format '{{.Health}}' nginx 2>/dev/null)" = "healthy" ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    echo "!! Services did not become healthy in time. Run 'docker compose ps' and 'docker compose logs' to investigate."
    exit 1
  fi
  sleep 2
done

echo "==> Seeding baseline data"
"$ROOT_DIR/scripts/seed.sh"

echo "==> Done. Visit http://localhost/ (CTF platform) and http://localhost/company/ (Instant company site)."
