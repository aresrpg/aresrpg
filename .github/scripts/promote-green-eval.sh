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
# Sourced by promote-land.sh (the real engine) and by test/promote-green-eval-check.sh (canned `gh
# api` JSON fixtures, plus direct calls into derive_required_checks() against fixture YAML) — this
# file has no side effects of its own and is never executed directly.
#
# THE REQUIRED SET IS DERIVED, NOT HAND-KEPT (issue #725): a hand-maintained REQUIRED_CHECKS array
# went stale ONE commit after its own creation — f6c7686b added the `tests (api)` job to gate.yml
# without updating the array, so the newest required job was invisible to gate 2 above, reopening
# the #695 race for exactly that job. A hand-kept list WILL drift every time a job is added or
# renamed; derive_required_checks() below reads the set from the thing that actually creates the
# check-runs — gate.yml + checks.yml themselves — so a new job or matrix leg auto-joins the bar
# the next time this file is sourced. Removing a job still needs a real YAML edit; the bar only
# grows by accident, never shrinks.
#
# The repo's branch-protection ruleset was considered as a queryable API alternative to parsing
# YAML, and rejected: `gh api repos/aresrpg/aresrpg/rulesets/<id>` requires only `gate` on edge and
# only `promoted` (the bot's own landing stamp) on master — both far narrower than "every check
# both workflows produce" and would make the #695 race WORSE, not fix it.
#
# HOW: yq (mikefarah — confirmed preinstalled on GitHub's ubuntu-latest hosted runner image per
# actions/runner-images's tool inventory, present locally too) turns each workflow file into JSON;
# jq then reads `.jobs`. A job's check-run name is its `name:` override if it has one, else its
# job id verbatim — this is exactly the regression: `tests_api`'s id is `tests_api`, its real
# check-run name (the override) is `tests (api)`. A `strategy.matrix` leg renders the way GitHub
# renders it: "<name> (<axis-value>[, <axis-value>...])", cartesian across every axis (jq's
# `combinations`), skipping the matrix's own `include`/`exclude` keys. `CodeQL` is the one name
# that can never come from a job/matrix name at all: `github/codeql-action/analyze` (the
# `fp-codeql` job's own step) files a SEPARATE check-run literally named "CodeQL" under the
# github-advanced-security app, distinct from `fp-codeql`'s own Actions check-run — any job with
# an `analyze` step contributes that literal name once.

# derive_required_checks <workflow.yml> [<workflow.yml>...] — prints a JSON array of every
# check-run NAME the given workflow file(s) produce on a PR/push head (see HOW above). Deduped +
# sorted (jq `unique`) for a stable, diffable set. Takes explicit file args (never a hardcoded
# path) so tests can point it at fixture YAML instead of the real workflows.
derive_required_checks() {
  command -v yq >/dev/null || { echo "derive_required_checks: yq not found (needed to parse workflow YAML)" >&2; return 1; }
  local docs
  docs=$(
    local file
    for file in "$@"; do yq -o=json eval '.' "$file"; done | jq -s '.'
  )
  jq -c '
    [
      .[] | (.jobs // {}) | to_entries[] |
      (.value.name // .key) as $base |
      (.value.strategy.matrix // null) as $matrix |
      if $matrix == null then
        $base
      else
        ($matrix | to_entries | map(select(.key != "include" and .key != "exclude")) | map(.value)) as $lists |
        if ($lists | length) == 0 then
          $base
        else
          [$lists | combinations] | .[] | $base + " (" + (map(tostring) | join(", ")) + ")"
        end
      end
    ] + (
      [.[] | (.jobs // {})[] | .steps // [] | .[] | select(.uses? // "" | startswith("github/codeql-action/analyze"))]
      | if length > 0 then ["CodeQL"] else [] end
    ) | unique
  ' <<<"$docs"
}

# The real production set: gate.yml + checks.yml resolved relative to THIS file's own location
# (BASH_SOURCE[0] of the currently-executing sourced file, not the caller's cwd) inside a subshell
# so the path-resolution scratch var never leaks into the sourcing script's namespace.
REQUIRED_CHECKS_JSON=$(
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  derive_required_checks "${dir}/../workflows/gate.yml" "${dir}/../workflows/checks.yml"
)

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
#
# PROVENANCE (#1305 review, CRITICAL): the gates above judge check-runs by NAME. Nothing tied a
# green row to the promotion being evaluated, and `commits/{sha}/check-runs` returns every run any
# app ever attached to that commit — so a set of green rows created in another context, or by
# another app, satisfied a master promotion. A reviewer's synthetic edge-context result evaluated
# green. A check-run is now evidence only when it was produced by the expected app AND belongs to
# THIS pull request: either its `pull_requests` names that PR, or — for the push-triggered suites a
# release PR normally rides — its check-suite is on the PR's own head branch. Rows that fail
# provenance are not counted green and, deliberately, are not counted red either: they are not
# evidence at all, so a foreign row can neither satisfy nor wedge the queue.
#
# The filter engages ONLY when a provenance object is supplied (the real engine always supplies
# one). Fixtures that omit it exercise the name-level gates exactly as before.
evaluate_green() {
  local check_runs_json="$1"
  local required_json="${2:-$REQUIRED_CHECKS_JSON}"
  local provenance_json="${3:-null}"
  local runs not_green_count missing_csv

  runs=$(jq -c 'if type == "array" then . else .check_runs end' <<<"$check_runs_json")
  runs=$(jq -c --argjson p "$provenance_json" '
      if $p == null then .
      else [ .[] | select(
          (.app.slug // "github-actions") == ($p.app // "github-actions")
          and (
            if ((.pull_requests // []) | length) == 0
            then (.check_suite.head_branch // "") == ($p.head_ref // "")
            else ([.pull_requests[].number] | index($p.pr)) != null
            end
          )
        ) ]
      end' <<<"$runs")

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

# ── THE REPUBLISH WINDOW NEVER REACHES PRODUCTION (#1305 review, CRITICAL) ──────────────────────
# packages/move/REPUBLISH_WINDOW suspends the ceremony preflight's compatibility assertions while a
# fresh lineage is published. The preflight refuses the marker on a master-bound run, but that
# refusal is a CHECK — and a check is only as trustworthy as the provenance of the row reporting
# it. This engine therefore asserts the marker independently, from the tree at the exact SHA it is
# about to fast-forward onto master, trusting no check-run at all. Pure: the caller reads the blob.
#   evaluate_republish_window <base_ref> <marker_present: yes|no>
# Prints "ok" or "refused: <reason>"; always returns 0 (verdict, not shell error — house idiom).
evaluate_republish_window() {
  local base="$1" marker_present="$2"
  if [ "$base" = master ] && [ "$marker_present" = yes ]; then
    echo "refused: packages/move/REPUBLISH_WINDOW is present at this SHA — the republish window lives on edge and may never be promoted to production"
    return 0
  fi
  echo ok
}
