#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
#
# Regression harness for the post-edge landing dispatches. The landing engine runs with the
# Actions GITHUB_TOKEN, so these calls must stay in the `gh workflow run` auth class used by the
# release workaround: actions:write in the caller, no PAT, and a pinned edge ref + landed SHA.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=.github/scripts/promote-land-dispatch.sh
source "${SCRIPT_DIR}/../promote-land-dispatch.sh"

CALL_LOG=$(mktemp)
ERROR_LOG=$(mktemp)
trap 'rm -f "$CALL_LOG" "$ERROR_LOG"' EXIT
REPO=aresrpg/aresrpg
MOCK_FAIL_WORKFLOW=

gh() {
  printf '%s\n' "$*" >> "$CALL_LOG"
  [ "$3" != "$MOCK_FAIL_WORKFLOW" ]
}

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

BEFORE=fedcba9876543210fedcba9876543210fedcba98
SHA=0123456789abcdef0123456789abcdef01234567
dispatch_edge_landing_automations "$BEFORE" "$SHA"
expect_equal \
  "the sweep receives the exact landed RANGE, the audit the landed tree" \
  "workflow run board-hygiene.yml --repo aresrpg/aresrpg --ref edge -f sha=$SHA -f base=$BEFORE
workflow run nuclear-audit.yml --repo aresrpg/aresrpg --ref edge -f sha=$SHA" \
  "$(cat "$CALL_LOG")"

: >"$CALL_LOG"
dispatch_edge_landing_automations "$SHA" "$SHA"
expect_equal \
  "an align push that moved nothing dispatches nothing" \
  "" \
  "$(cat "$CALL_LOG")"

: >"$CALL_LOG"
: >"$ERROR_LOG"
MOCK_FAIL_WORKFLOW=board-hygiene.yml
dispatch_edge_landing_automations "$BEFORE" "$SHA" 2>"$ERROR_LOG"
DISPATCH_RC=$?
expect_equal "a dispatch failure exits non-zero after the ff-push" "1" "$DISPATCH_RC"
expect_equal \
  "a dispatch failure emits a visible Actions error" \
  "::error::board-hygiene.yml dispatch failed for $SHA — edge already landed; re-run it manually" \
  "$(cat "$ERROR_LOG")"
expect_equal \
  "one failed dispatch does not starve the next automation" \
  "workflow run board-hygiene.yml --repo aresrpg/aresrpg --ref edge -f sha=$SHA -f base=$BEFORE
workflow run nuclear-audit.yml --repo aresrpg/aresrpg --ref edge -f sha=$SHA" \
  "$(cat "$CALL_LOG")"

echo
echo "post-landing dispatch: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
