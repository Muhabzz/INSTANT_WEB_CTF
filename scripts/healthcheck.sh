#!/usr/bin/env bash
# Checks every service's health endpoint through the public reverse proxy,
# plus each container's Docker-reported health status.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HOST="${1:-http://localhost}"
FAIL=0

check() {
  local name="$1" url="$2"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || echo "000")"
  if [ "$code" = "200" ]; then
    echo "OK   $name ($url) -> $code"
  else
    echo "FAIL $name ($url) -> $code"
    FAIL=1
  fi
}

echo "==> HTTP health checks (via nginx, the only public entrypoint)"
check "nginx"        "$HOST/nginx-health"
check "ctf-platform" "$HOST/health"
check "instant-web"  "$HOST/company/health"

echo
echo "==> Container health status (docker compose)"
docker compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Health}}'

echo
echo "==> Published host ports (should be nginx only: 80, 443)"
docker compose ps --format '{{.Name}}: {{.Ports}}'

exit $FAIL
