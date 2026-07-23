# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# shellcheck shell=bash
#
# promote-green-eval.sh — the required-check-set green assert, split out of promote-land.sh so it
# is unit-testable in isolation (issue #695). Sourced-only (no shebang on purpose — it is never
# executed directly); the directive above tells shellcheck which dialect to lint it as.
#
# THE RACE IT CLOSES: promote-queue.yml triggers on `workflow_run: completed` for BOTH gate and
# checks (.github/workflows/promote-queue.yml:35). gate.yml is fast; checks.yml's `smoke` job is
# slow (Playwright + live network). When gate finishes first, the queue fires and calls
# promote-land.sh WHILE checks.yml — and therefore `smoke` — may not have registered a check-run
# on the SHA yet at all. The old assert only rejected check-runs that EXISTED and were non-green
# (`select(.conclusion != "success" and ...)`), so a required check that simply hadn't been
# CREATED yet was invisible to it and read as clean — a still-red landing could fast-forward.
#
# THE FIX: two independent gates, both must hold.
#   1. EXISTING — unchanged from the original assert: no check-run that exists on the SHA may be
#      non-green (a completed failure, or one still queued/in_progress, i.e. conclusion == null).
#   2. REQUIRED — every name in REQUIRED_CHECKS must have at least one check-run on the SHA that
#      is `status == completed` with a green conclusion. A name with ZERO matching check-runs
#      (never registered, or registered but not yet completed) is MISSING and fails closed — this
#      is the half that catches the race.
#   An empty check-runs response fails closed via gate 2: every required name is missing.
#
# Sourced by promote-land.sh (the real engine) and by test/promote-green-eval.test.sh (canned `gh
# api` JSON fixtures) — this file has no side effects of its own and is never executed directly.
#
# THE REQUIRED SET — every check-run NAME that gate.yml + checks.yml produce on a PR/push head
# (both trigger on `pull_request|push: branches: [edge, master]`, so the set is identical for
# either promotion base). Ground-truthed against a live commit, not guessed from the YAML: `gh api
# repos/aresrpg/aresrpg/commits/<edge-tip-sha>/check-runs --paginate --jq '.check_runs[].name'` on
# 2026-07-24 returned exactly these 14 names. Matrix jobs (checks.yml's `tests`) render as
# "<job> (<matrix-value>)"; `CodeQL` is NOT a job id in either workflow file — it is the separate
# check-run the codeql-action `analyze` step files under the github-advanced-security app,
# distinct from the `fp-codeql` job's own actions check-run. Severity-ratchet direction: keep this
# list in sync BY HAND when a job is renamed/added/removed — a stale entry shows up as a MISSING
# check on the real SHA and fails closed (blocks landing) rather than silently under-checking; the
# repo's ruleset required_status_checks was considered as a "queryable source of truth" instead of
# a hardcoded list but rejected — it lists only `gate` for edge and only `promoted` for master
# (the bot's own stamp), both far narrower than "every check from both workflows" and would have
# made the race WORSE, not fixed it.
REQUIRED_CHECKS=(
  # gate.yml
  gate
  api_image_smoke
  # checks.yml
  ladder
  smoke
  fp-codeql
  CodeQL
  "tests (fight)"
  "tests (sim)"
  "tests (world)"
  "tests (inventory)"
  "tests (party)"
  "tests (sdk)"
  "tests (engine)"
  "tests (frontend)"
)
REQUIRED_CHECKS_JSON=$(jq -n '$ARGS.positional' --args -- "${REQUIRED_CHECKS[@]}")

# evaluate_green <check_runs_json> [required_checks_json]
#   check_runs_json      = the raw JSON body of GET /repos/{repo}/commits/{sha}/check-runs — the
#                           `{"total_count":N,"check_runs":[...]}` envelope, or a bare `[...]`
#                           array of check-run objects — either shape is accepted.
#   required_checks_json = a JSON array of required check-run names; defaults to the real
#                           REQUIRED_CHECKS_JSON above. Tests pass a small custom set so fixtures
#                           stay short; promote-land.sh's call site always omits it (real set).
# Prints "green" or "not-green: <reason>" on stdout. Always returns 0 — a verdict is not a shell
# error; callers branch on the printed string, matching how the rest of promote-land.sh's asserts
# already convey their result via `emit` + a message, not via $?.
evaluate_green() {
  local check_runs_json="$1"
  local required_json="${2:-$REQUIRED_CHECKS_JSON}"
  local runs not_green_count missing_csv

  runs=$(jq -c 'if type == "array" then . else .check_runs end' <<<"$check_runs_json")

  not_green_count=$(jq '[.[] | select(.conclusion != "success" and .conclusion != "skipped" and .conclusion != "neutral")] | length' <<<"$runs")
  if [ "$not_green_count" != "0" ]; then
    echo "not-green: $not_green_count existing check(s) not green"
    return 0
  fi

  missing_csv=$(jq -r --argjson required "$required_json" '
      [.[] | select(.status == "completed" and (.conclusion == "success" or .conclusion == "skipped" or .conclusion == "neutral")) | .name] as $green
      | ($required - $green) | unique | join(", ")
    ' <<<"$runs")
  if [ -n "$missing_csv" ]; then
    echo "not-green: missing required check(s): $missing_csv"
    return 0
  fi

  echo green
}
