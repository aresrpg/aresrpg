#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# #1603 — consumer packages may import the sim's protocol constants, never re-declare their numbers.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

SEMGREP="$(command -v semgrep || true)"
RULESET="scripts/arch/sim_protocol_constants.yml"
BASELINE="scripts/arch/sim_protocol_constants.baseline.json"

echo "== AresRPG sim protocol constants gate (#1603: no consumer-side numeric re-declarations) =="
if [ -z "$SEMGREP" ]; then
  echo "  FAIL: semgrep not installed (uv tool install semgrep | brew install semgrep | pipx install semgrep)"
  exit 1
fi
# Every rule starts at the maximum severity. Keep rule count and ERROR count locked together so a
# config edit cannot silently downgrade a protected family while leaving the finding counts unchanged.
rule_count="$(grep -c '^  - id: sim-protocol-' "$RULESET")"
error_count="$(grep -c '^    severity: ERROR$' "$RULESET")"
if [ "$rule_count" -eq 0 ] || [ "$rule_count" -ne "$error_count" ]; then
  echo "  FAIL: every sim-protocol rule must remain ERROR severity (rules=$rule_count errors=$error_count)"
  exit 1
fi

OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"' EXIT
export SEMGREP_LOG_FILE="$OUT_DIR/semgrep.log"
if [ -z "${SSL_CERT_FILE:-}" ] && [ -r /etc/ssl/cert.pem ]; then
  export SSL_CERT_FILE=/etc/ssl/cert.pem
fi

TARGETS=(
  packages/fight/src
  packages/frontend/src
  packages/inventory/src
  packages/party/src
  packages/world/src
  packages/rpc/api
)
for target in "${TARGETS[@]}"; do
  if [ ! -d "$target" ]; then
    echo "  FAIL: scan target missing: $target"
    exit 1
  fi
done

"$SEMGREP" scan --config "$RULESET" \
  --json --metrics=off --disable-version-check --quiet \
  "${TARGETS[@]}" >"$OUT_DIR/tree.json" 2>"$OUT_DIR/err.log"
code=$?
if [ "$code" -gt 1 ]; then
  echo "  semgrep failed (exit $code):"
  sed 's/^/    /' "$OUT_DIR/err.log" | head -20
  exit 1
fi

if [ "${1:-}" = "--write-baseline" ]; then
  node scripts/arch/sim_constants_verdict.mjs --write-baseline "$BASELINE" "$OUT_DIR/tree.json"
else
  node scripts/arch/sim_constants_verdict.mjs --baseline "$BASELINE" "$OUT_DIR/tree.json"
fi
