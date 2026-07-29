#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
#
# Sourceable post-edge landing tail. GITHUB_TOKEN pushes do not create push-triggered workflow
# runs, so the promotion engine explicitly dispatches every landing automation with the exact SHA
# it fast-forwarded. The callers already grant actions:write and expose github.token as GH_TOKEN.
#
# The two automations ask different questions, so they receive different inputs. The board sweep
# reads the landed COMMIT RANGE — a fast-forward carries every commit of the pull request, and
# resolving `head^` would silently inspect the tip alone (the trap scripts/board_hygiene.mjs
# documents at resolve_landing_range, and the reason the push path reads the event's before..after
# rather than the checkout). The nuclear audit scans the new TREE at one point. A workflow_dispatch
# carrying an input the workflow does not declare is rejected, so the range goes only where it is
# declared.

dispatch_landing_workflow() {
  local workflow="$1" sha="$2"
  shift 2
  if gh workflow run "$workflow" --repo "${REPO:?GITHUB_REPOSITORY required}" --ref edge -f "sha=$sha" "$@"; then
    echo "dispatched $workflow for edge landing $sha"
  else
    echo "::error::$workflow dispatch failed for $sha — edge already landed; re-run it manually" >&2
    return 1
  fi
}

dispatch_edge_landing_automations() {
  local before="${1:?pre-landing edge tip required}" after="${2:?landed sha required}" failed=0
  # An align push that moved nothing has no landed range: the sweep would refuse an empty
  # before..after, and the audit already ran when those commits landed on edge.
  if [ "$before" = "$after" ]; then
    echo "edge tip unchanged at $after — no landed commits to sweep"
    return 0
  fi
  dispatch_landing_workflow board-hygiene.yml "$after" -f "base=$before" || failed=1
  dispatch_landing_workflow nuclear-audit.yml "$after" || failed=1
  return "$failed"
}
