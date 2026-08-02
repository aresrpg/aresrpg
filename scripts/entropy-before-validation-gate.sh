#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# #1841 — deterministic input validation precedes the first &Random borrow in public/entry Move functions.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

SEMGREP="$(command -v semgrep || true)"
RULESET="scripts/arch/entropy_before_validation.yml"
BASELINE="scripts/arch/entropy_before_validation.baseline.json"

echo "== AresRPG entropy-before-validation gate (#1841: validate input before &Random) =="
if [ -z "$SEMGREP" ]; then
  echo "  FAIL: semgrep not installed (uv tool install semgrep | brew install semgrep | pipx install semgrep)"
  exit 1
fi
# The static property is clean today, so its one rule starts and stays at maximum severity.
rule_count="$(grep -c '^  - id: move-entropy-' "$RULESET")"
error_count="$(grep -c '^    severity: ERROR$' "$RULESET")"
if [ "$rule_count" -eq 0 ] || [ "$rule_count" -ne "$error_count" ]; then
  echo "  FAIL: every move-entropy rule must remain ERROR severity (rules=$rule_count errors=$error_count)"
  exit 1
fi

OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"' EXIT
export SEMGREP_LOG_FILE="$OUT_DIR/semgrep.log"
if [ -z "${SSL_CERT_FILE:-}" ] && [ -r /etc/ssl/cert.pem ]; then
  export SSL_CERT_FILE=/etc/ssl/cert.pem
fi

SCAN=("$SEMGREP" scan --jobs 1 --config "$RULESET" --json --metrics=off --disable-version-check --quiet)
scan_into() {
  local out="$1"
  shift
  "${SCAN[@]}" "$@" >"$out" 2>"$OUT_DIR/err.log"
  local code=$?
  if [ "$code" -gt 1 ]; then
    echo "  semgrep failed (exit $code) on $*:"
    sed 's/^/    /' "$OUT_DIR/err.log" | head -20
    return 1
  fi
}

# Committed sibling controls are the matcher blind guard: exact red and green counts are pinned.
FIXTURE_ROOT="scripts/arch/fixtures/entropy_before_validation"
scan_into "$OUT_DIR/red.json" "$FIXTURE_ROOT/red" || exit 1
scan_into "$OUT_DIR/green.json" "$FIXTURE_ROOT/green" || exit 1
node scripts/arch/entropy_before_validation_verdict.mjs \
  --expect "$FIXTURE_ROOT/expected.json" red "$OUT_DIR/red.json" || exit 1
node scripts/arch/entropy_before_validation_verdict.mjs \
  --expect "$FIXTURE_ROOT/expected.json" green "$OUT_DIR/green.json" || exit 1

# Semgrep 1.170's Move parser crashes when these packages are scanned concurrently and emits
# partial-parse noise in unrelated files. Serially scan the complete source-file subset that can
# carry the ruled parameter; the committed control above proves the same matcher still fires.
MOVE_TARGETS=()
while IFS= read -r file; do
  if grep -Eq ':[[:space:]]*&Random([^A-Za-z0-9_]|$)' "$file"; then
    MOVE_TARGETS+=("$file")
  fi
done < <(find packages/move -path '*/sources/*.move' -type f -print | LC_ALL=C sort)
if [ "${#MOVE_TARGETS[@]}" -eq 0 ]; then
  echo "  FAIL: no Move source declaring an &Random parameter was collected"
  exit 1
fi

scan_into "$OUT_DIR/tree.json" "${MOVE_TARGETS[@]}" || exit 1
if [ "${1:-}" = "--write-baseline" ]; then
  # #2016 — a semgrep count that feeds a FLOOR is max-of-3: under CPU load the scanner silently drops
  # the findings of files it could not finish. The verdict refuses fewer than 3 runs.
  scan_into "$OUT_DIR/tree2.json" "${MOVE_TARGETS[@]}" || exit 1
  scan_into "$OUT_DIR/tree3.json" "${MOVE_TARGETS[@]}" || exit 1
  node scripts/arch/entropy_before_validation_verdict.mjs --write-baseline "$BASELINE" \
    "$OUT_DIR/tree.json" "$OUT_DIR/tree2.json" "$OUT_DIR/tree3.json"
else
  node scripts/arch/entropy_before_validation_verdict.mjs --baseline "$BASELINE" "$OUT_DIR/tree.json"
fi
