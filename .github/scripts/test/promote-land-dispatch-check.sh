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
trap 'rm -f "$CALL_LOG"' EXIT
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

SHA=0123456789abcdef0123456789abcdef01234567
dispatch_edge_landing_automations "$SHA"
expect_equal \
  "both landing automations receive the landed sha on edge" \
  "workflow run board-hygiene.yml --repo aresrpg/aresrpg --ref edge -f sha=$SHA
workflow run nuclear-audit.yml --repo aresrpg/aresrpg --ref edge -f sha=$SHA" \
  "$(cat "$CALL_LOG")"

: >"$CALL_LOG"
MOCK_FAIL_WORKFLOW=board-hygiene.yml
dispatch_edge_landing_automations "$SHA"
expect_equal "a dispatch failure stays non-fatal after the ff-push" "0" "$?"
expect_equal \
  "one failed dispatch does not starve the next automation" \
  "workflow run board-hygiene.yml --repo aresrpg/aresrpg --ref edge -f sha=$SHA
workflow run nuclear-audit.yml --repo aresrpg/aresrpg --ref edge -f sha=$SHA" \
  "$(cat "$CALL_LOG")"

echo
echo "post-landing dispatch: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
