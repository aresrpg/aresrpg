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

# A workflow_dispatch carrying an input the target workflow does not declare is REJECTED, and the
# rejection is invisible from here — the landing already happened, so the sweep simply never runs.
# Assert every `-f key=` the helper sends against the receiving workflow's declared inputs.
declared_inputs() {
  awk '
    /^  workflow_dispatch:/ { in_dispatch = 1; next }
    in_dispatch && /^  [^ ]/ { in_dispatch = 0 }
    in_dispatch && /^    inputs:/ { in_inputs = 1; next }
    in_inputs && /^      [a-z_]+:[[:space:]]*$/ { gsub(/[ :]/, ""); print }
    in_inputs && /^    [^ ]/ { in_inputs = 0 }
  ' "${SCRIPT_DIR}/../../workflows/$1"
}
# Positive control: a parser that silently returns nothing would pass every assertion below.
expect_equal "the input parser reads board-hygiene's declarations" "base sha" "$(declared_inputs board-hygiene.yml | tr '\n' ' ' | sed 's/ $//')"

: >"$CALL_LOG"
MOCK_FAIL_WORKFLOW=
dispatch_edge_landing_automations "$BEFORE" "$SHA" >/dev/null
while IFS= read -r CALL; do
  WORKFLOW=$(printf '%s\n' "$CALL" | awk '{print $3}')
  DECLARED=$(declared_inputs "$WORKFLOW")
  for KEY in $(printf '%s\n' "$CALL" | grep -o '\-f [a-z_]*=' | cut -d' ' -f2 | tr -d '='); do
    expect_equal "$WORKFLOW declares the dispatched input '$KEY'" "$KEY" "$(printf '%s\n' "$DECLARED" | grep -Fx "$KEY")"
  done
done < "$CALL_LOG"

echo
echo "post-landing dispatch: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
