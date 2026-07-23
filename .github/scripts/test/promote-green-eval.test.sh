#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
#
# promote-green-eval.test.sh — pure-function test harness for evaluate_green() (issue #695: the
# promotion engine raced a still-red landing past a required check that hadn't registered on the
# sha yet). No bats in this repo, so this is a plain-bash runner in the same idiom as the scripts
# it tests — canned `gh api check-runs` JSON in, a PASS/FAIL line + a summary out.
#
# Run: bash .github/scripts/test/promote-green-eval.test.sh
# Exit: 0 all passed, 1 any failed.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=.github/scripts/promote-green-eval.sh
source "${SCRIPT_DIR}/../promote-green-eval.sh"

PASS=0
FAIL=0

# check_run <name> <status> <conclusion-or-null> — one check-run object as a JSON line.
check_run() {
  local name="$1" status="$2" conclusion="$3"
  if [ "$conclusion" = null ]; then
    jq -nc --arg name "$name" --arg status "$status" '{name: $name, status: $status, conclusion: null}'
  else
    jq -nc --arg name "$name" --arg status "$status" --arg conclusion "$conclusion" \
      '{name: $name, status: $status, conclusion: $conclusion}'
  fi
}

# runs_array <check_run_json...> — wrap N check-run objects into a bare JSON array (one shape
# evaluate_green() must accept).
runs_array() { printf '%s\n' "$@" | jq -s '.'; }

# expect_prefix <case-name> <expected-prefix> <check_runs_json> [required_checks_json]
# Asserts evaluate_green()'s output starts with expected-prefix ("green" is also a valid, exact,
# one-word prefix of itself — startswith works for both verdicts).
expect_prefix() {
  local case_name="$1" expected_prefix="$2" check_runs_json="$3" required_json="${4:-}"
  local actual
  if [ -n "$required_json" ]; then
    actual=$(evaluate_green "$check_runs_json" "$required_json")
  else
    actual=$(evaluate_green "$check_runs_json")
  fi
  case "$actual" in
    "$expected_prefix"*)
      echo "PASS  $case_name  →  $actual"
      PASS=$((PASS + 1))
      ;;
    *)
      echo "FAIL  $case_name  →  got [$actual], expected prefix [$expected_prefix]"
      FAIL=$((FAIL + 1))
      ;;
  esac
}

# expect_contains <case-name> <needle> <check_runs_json> [required_checks_json]
# Asserts evaluate_green()'s output is not-green AND names the given needle (e.g. the missing
# check's name) — proves the diagnostic is actually useful, not just correctly signed not-green.
expect_contains() {
  local case_name="$1" needle="$2" check_runs_json="$3" required_json="${4:-}"
  local actual
  if [ -n "$required_json" ]; then
    actual=$(evaluate_green "$check_runs_json" "$required_json")
  else
    actual=$(evaluate_green "$check_runs_json")
  fi
  case "$actual" in
    not-green*"$needle"*)
      echo "PASS  $case_name  →  $actual"
      PASS=$((PASS + 1))
      ;;
    *)
      echo "FAIL  $case_name  →  got [$actual], expected not-green mentioning [$needle]"
      FAIL=$((FAIL + 1))
      ;;
  esac
}

SMALL_SET=$(jq -nc '["build", "smoke", "lint"]')

# ── 1. all-green → eligible ─────────────────────────────────────────────────────────────────
RUNS=$(runs_array \
  "$(check_run build completed success)" \
  "$(check_run smoke completed success)" \
  "$(check_run lint completed success)")
expect_prefix "all-green" green "$RUNS" "$SMALL_SET"

# ── 2. one-pending (still in_progress, conclusion null) → not ──────────────────────────────
RUNS=$(runs_array \
  "$(check_run build completed success)" \
  "$(check_run smoke in_progress null)" \
  "$(check_run lint completed success)")
expect_prefix "one-pending" not-green "$RUNS" "$SMALL_SET"

# ── 3. one-failed → not ─────────────────────────────────────────────────────────────────────
RUNS=$(runs_array \
  "$(check_run build completed success)" \
  "$(check_run smoke completed failure)" \
  "$(check_run lint completed success)")
expect_prefix "one-failed" not-green "$RUNS" "$SMALL_SET"

# ── 4. missing-smoke (required name has ZERO check-runs — the race itself) → not ───────────
RUNS=$(runs_array \
  "$(check_run build completed success)" \
  "$(check_run lint completed success)")
expect_contains "missing-smoke" smoke "$RUNS" "$SMALL_SET"

# ── 5. empty (zero check-runs at all) → not, fail-closed, names everything missing ─────────
RUNS='[]'
expect_contains "empty-fails-closed" "build, lint, smoke" "$RUNS" "$SMALL_SET"

# ── 6. stale failed + fresh success under the SAME name → not (a re-run must not shadow the
#      leftover failed run; gate 1 scans ALL existing check-runs, not just the newest per name) ─
RUNS=$(runs_array \
  "$(check_run build completed failure)" \
  "$(check_run build completed success)")
expect_prefix "stale-failure-not-shadowed" not-green "$RUNS" "$(jq -nc '["build"]')"

# ── 7. skipped/neutral count as green (parity with the original assert's allowance) → green ─
RUNS=$(runs_array \
  "$(check_run build completed skipped)" \
  "$(check_run smoke completed neutral)")
expect_prefix "skipped-and-neutral-are-green" green "$RUNS" "$(jq -nc '["build", "smoke"]')"

# ── 8. the full API envelope shape ({"check_runs":[...]}), not just a bare array → accepted ─
ENVELOPE=$(jq -nc --argjson runs "$(runs_array "$(check_run build completed success)")" \
  '{total_count: 1, check_runs: $runs}')
expect_prefix "envelope-shape-accepted" green "$ENVELOPE" "$(jq -nc '["build"]')"

# ── 9. the REAL production REQUIRED_CHECKS, all 14 present + green → green ─────────────────
# Regression guard on the hand-maintained array itself (promote-green-eval.sh) — a typo'd name
# here would show up as a permanently-missing check in production; this locks the list's names.
ALL_REAL_RUNS_JSON=$(jq -c '.[]' <<<"$REQUIRED_CHECKS_JSON" | while IFS= read -r name_json; do
  check_run "$(jq -r . <<<"$name_json")" completed success
done | jq -s '.')
expect_prefix "production-set-all-green" green "$ALL_REAL_RUNS_JSON" # default (real) required set

# ── 10. the REPORTED bug, reproduced exactly: 13/14 real checks green, `smoke` never
#       registered on the sha (checks.yml's slow leg hasn't reported in yet) → not, names smoke ─
REAL_MINUS_SMOKE_RUNS_JSON=$(jq -c '.[]' <<<"$REQUIRED_CHECKS_JSON" | while IFS= read -r name_json; do
  name=$(jq -r . <<<"$name_json")
  [ "$name" = smoke ] && continue
  check_run "$name" completed success
done | jq -s '.')
expect_contains "reported-bug-reproduced-smoke-missing" smoke "$REAL_MINUS_SMOKE_RUNS_JSON" # default (real) required set

echo
echo "── ${PASS} passed, ${FAIL} failed ──"
[ "$FAIL" -eq 0 ]
