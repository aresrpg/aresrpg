#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
#
# promote-split-check.sh — the static tooth of the STAMPER SPLIT (seat ruling 2026-07-29, #1573).
#
# One law, mechanically: the unattended landing engine cannot mint the `promoted` status that
# master's ruleset requires. Two surfaces carry it, so both are asserted here —
#   • promote-queue.yml (runs on every CI completion, no human in the loop) grants NO statuses:write
#   • promote-land.sh   (the shared engine both triggers execute) makes NO commit-status API call
# while promote.yml — master-pinned, owner-identity gated — keeps both, and is the POSITIVE CONTROL:
# a parser that quietly matched nothing would pass every prohibition above, so each parser must
# first be caught seeing the legitimate mint it is meant to forbid elsewhere.
#
# Run: bash .github/scripts/test/promote-split-check.sh
# Exit: 0 all passed, 1 any failed.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GITHUB_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

PASS=0
FAIL=0

expect_equal() {
  local case_name="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "PASS  $case_name"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $case_name  →  got [$actual], expected [$expected]"
    FAIL=$((FAIL + 1))
  fi
}

# workflow_permissions <workflow.yml> — the keys granted by the WORKFLOW-level `permissions:` block,
# one per line. Job-level blocks are indented deeper and never match; comment lines inside the block
# start with `#` after their indent and are skipped by the key pattern.
workflow_permissions() {
  awk '
    /^permissions:/ { in_block = 1; next }
    in_block && /^[^ ]/ { in_block = 0 }
    in_block && /^  [a-z-]+:/ { sub(/:.*/, ""); gsub(/ /, ""); print }
  ' "${GITHUB_DIR}/workflows/$1"
}

# status_mints <path> — how many commit-status writes the file makes. The `promoted` stamp has
# exactly one API shape (POST repos/<repo>/statuses/<sha>), and that is what is counted.
status_mints() {
  grep -c 'repos/[^ ]*/statuses/' "$1" 2>/dev/null || true
}

# ── positive controls: both parsers must be caught seeing the legitimate stamper ──────────────
expect_equal \
  "positive control — the permissions parser sees promote.yml's statuses grant" \
  "statuses" \
  "$(workflow_permissions promote.yml | grep -Fx statuses)"
expect_equal \
  "positive control — the mint parser sees promote.yml's legitimate 'promoted' mint" \
  "1" \
  "$(status_mints "${GITHUB_DIR}/workflows/promote.yml")"
expect_equal \
  "positive control — the permissions parser reads promote-queue.yml's real grants" \
  "actions contents pull-requests" \
  "$(workflow_permissions promote-queue.yml | sort | tr '\n' ' ' | sed 's/ $//')"

# ── the law ───────────────────────────────────────────────────────────────────────────────────
expect_equal \
  "the unattended queue holds NO statuses:write — it can never mint its own 'promoted'" \
  "" \
  "$(workflow_permissions promote-queue.yml | grep -Fx statuses)"
expect_equal \
  "the shared landing engine makes NO commit-status call" \
  "0" \
  "$(status_mints "${GITHUB_DIR}/scripts/promote-land.sh")"

# The engine is a directory, not a file: a mint that moved into a sibling helper would satisfy the
# assert above while restoring the hole. Census every script the engine can source.
MINTS_IN_SCRIPTS=0
for SCRIPT in "${GITHUB_DIR}"/scripts/*.sh; do
  MINTS_IN_SCRIPTS=$((MINTS_IN_SCRIPTS + $(status_mints "$SCRIPT")))
done
expect_equal "no script under .github/scripts mints a commit status" "0" "$MINTS_IN_SCRIPTS"

echo
echo "stamper split: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
