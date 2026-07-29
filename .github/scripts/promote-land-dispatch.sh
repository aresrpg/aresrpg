#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
#
# Sourceable post-edge landing tail. GITHUB_TOKEN pushes do not create push-triggered workflow
# runs, so the promotion engine explicitly dispatches every landing automation with the exact SHA
# it fast-forwarded. The callers already grant actions:write and expose github.token as GH_TOKEN.

EDGE_LANDING_WORKFLOWS=(board-hygiene.yml nuclear-audit.yml)

dispatch_edge_landing_automations() {
  local sha="${1:?landed sha required}" workflow failed=0
  for workflow in "${EDGE_LANDING_WORKFLOWS[@]}"; do
    if gh workflow run "$workflow" --repo "${REPO:?GITHUB_REPOSITORY required}" --ref edge -f "sha=$sha"; then
      echo "dispatched $workflow for edge landing $sha"
    else
      echo "::error::$workflow dispatch failed for $sha — edge already landed; re-run it manually" >&2
      failed=1
    fi
  done
  return "$failed"
}
