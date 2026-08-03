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
# THE FIX: select the latest check-run per NAME, then apply two independent gates; both must hold.
#   1. EXISTING — no latest check-run may be non-green (a completed failure, or one still
#      queued/in_progress, i.e. conclusion == null). An older attempt of that same named check is
#      history, not a second verdict: `no-issue` legitimately re-fires checks.yml on one head.
#   2. REQUIRED — every name in REQUIRED_CHECKS must have a latest check-run on the SHA that is
#      `status == completed` with a green conclusion. A name with ZERO matching check-runs (never
#      registered) is MISSING and fails closed — this is the half that catches the original race.
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
# `combinations`), skipping the matrix's own `include`/`exclude` keys.
#
# MANUFACTURED NAMES ARE BANNED (issue #1789): the set carries only names read off a parsed job —
# never one this function invents. A clause here used to append the literal "CodeQL" whenever a job
# ran `github/codeql-action/analyze`, but no github-actions workflow files a check-run under that
# name; only GitHub's default code-scanning setup does, under the github-advanced-security app,
# which the provenance filter below correctly refuses as non-evidence. A required name that no
# provenance-eligible row can ever carry is a PERMANENT wedge — every landing refused with "missing
# required check(s): CodeQL". The `fp-codeql` job keeps the FP query pack on the bar under its own
# producible Actions name via the enumeration above; default-setup CodeQL stays defense-in-depth at
# the GitHub level, outside this queue's bar. The class is sealed by a test asserting derived ⊆
# producible (test/promote-green-eval-check.sh case 19).

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
    ] | unique
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
  # A check-run id is minted for each attempt, so the greatest id is the replacement verdict for
  # that name. started_at and input position keep short synthetic fixtures deterministic when they
  # omit ids; production API rows always carry one. Collapse AFTER provenance filtering so a
  # foreign app/context can neither satisfy a name nor shadow its genuine run.
  runs=$(jq -c '
      to_entries
      | sort_by(.value.name, (.value.id // 0), (.value.started_at // ""), .key)
      | group_by(.value.name)
      | map(last.value)
    ' <<<"$runs")

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

# ── THE RANGE, NOT ONLY THE HEAD (#1002) ────────────────────────────────────────────────────────
# The assert above reads ONE sha; the push below it fast-forwards a RANGE. A branch of N commits was
# admitted on the strength of commit N, and it already put a commit whose own `gate` and
# `tests (fight)` read failure into edge's history (163b3345, PR #979) — pinned as a fixture in
# test/fixtures/interior-red-163b3345.check-runs.json.
#
# THE RULE THIS IS NOT (#1852, parked by the operator): "every sha in origin/base..head carries a
# completed green REQUIRED check-run". That rule refuses EVERY landing in this repo. gate.yml and
# checks.yml trigger on `pull_request` plus `push` to edge/master, so CI produces check-runs for a
# branch's HEAD and for nothing else. Measured on train-39's real landing range: the three interior
# commits carry 0, 0 and 0 check-runs; the head carries 49. Its unit test never caught that because
# it fed the interior SYNTHETIC red verdicts and asserted not-green — correct for a real red, and
# simultaneously indistinguishable from the permanent state of every interior commit in reality.
#
# THE RULE THAT IS THE QUEUE'S ACTUAL CONTRACT: the head's gate run covers the range's resulting
# tree, so an interior commit with NO run of its own is covered, not unproven — that is what CI
# offers and the head assert already reads it. What the head can never cover is an interior commit
# that WAS gated and came back RED: that verdict is a fact about that sha's own tree, it survives in
# history as a legitimate checkout and bisect target, and no amount of green at the tip retracts it.
# So a completed red anywhere in the range POISONS the landing, and the only way forward is a fresh
# commit — a rebase mints new shas and a clean range; a re-run cannot unsay a red.
#
# PROVENANCE IS DELIBERATELY NOT APPLIED HERE, and the fixture is why: 163b3345's two red rows carry
# `check_suite.head_branch: null` and `pull_requests: []` — the lane branch was deleted at landing,
# so the metadata the head's provenance filter needs is simply gone. Filtering the interior the same
# way would discard the exact evidence this gate exists to read. The app slug still binds (a foreign
# app cannot wedge the queue); the branch a red came from does not change what it says about the sha.
#
# evaluate_range_green <interior_json> [app_slug]
#   interior_json = [{sha, check_runs: [...]}, ...] — one entry per commit in origin/base..head
#                   EXCLUDING the head, which the assert above judges on its own, in full.
#                   check_runs takes either payload shape, exactly like evaluate_green.
# Prints "green" or "not-green: <reason>" naming the offending sha and checks. Always returns 0.
evaluate_range_green() {
  local interior_json="$1" app_slug="${2:-github-actions}" poisoned
  poisoned=$(jq -r --arg app "$app_slug" '
      [ .[]
        | . as $commit
        | ((.check_runs // []) | if type == "array" then . else .check_runs end) as $runs
        | [ $runs[]
            | select((.app.slug // $app) == $app)
            | select(.status == "completed")
            | select(.conclusion != "success" and .conclusion != "skipped" and .conclusion != "neutral")
            | .name ] as $red
        | select(($red | length) > 0)
        | "\($commit.sha[0:12]) (\($red | unique | join(", ")))" ]
      | join("; ")
    ' <<<"$interior_json")
  if [ -n "$poisoned" ]; then
    echo "not-green: red interior commit(s) in this range: $poisoned — a red sha stays poisoned; rebase to re-cut it, a re-run cannot unsay it"
    return 0
  fi
  echo green
}

# AN UNREAD RANGE IS NOT A CLEAN ONE — the fail-closed collector (lead review of 317cc1cf8).
# The first cut of the caller built the interior payload with
#   runs=$(gh api --paginate ".../check-runs" --jq '.check_runs[]' | jq -s '.')
# and that fails OPEN, which is the one thing a gate may never do: when `gh api` dies on a rate
# limit or a 5xx it writes nothing, `jq -s` slurps empty stdin to `[]`, and `[]` is BYTE-IDENTICAL
# to the payload of a commit CI never gated — so an unreadable range evaluates "covered" and lands.
#
# `set -euo pipefail` does NOT save it, measured rather than assumed: with both flags in force, that
# assignment sitting inside a command substitution (exactly how the caller builds its payload) does
# not abort the script — the loop runs to completion and hands on `check_runs: []` with exit 0. A
# gate whose arming depends on an ambient shell flag is prose; this one refuses explicitly.
#
# collect_interior_check_runs <sha-list> <fetch_fn>
#   sha-list  = whitespace-separated interior shas.
#   fetch_fn  = name of a function taking one sha and PRINTING its check-run payload (array or the
#               `{check_runs: [...]}` envelope), returning non-zero if the read itself failed. The
#               distinction that matters is the whole point: a successful read of ZERO runs is `[]`
#               and means covered; a FAILED read is non-zero and means unknown.
# Prints the interior JSON evaluate_range_green consumes, or nothing and returns 1 if ANY sha could
# not be read. The caller must treat that as not-green and leave the pull request queued — a refusal
# costs one queue tick, and the queue re-runs on its own.
collect_interior_check_runs() {
  local shas="$1" fetch="${2:-}" sha runs acc='[]' tmpdir runs_file acc_file acc_next
  if [ -z "$fetch" ]; then echo "collect_interior_check_runs: a fetch function name is required" >&2; return 1; fi
  tmpdir=$(mktemp -d) || return 1
  trap 'rm -rf "$tmpdir"' RETURN
  runs_file="$tmpdir/runs.json"; acc_file="$tmpdir/acc.json"; acc_next="$tmpdir/acc.next.json"
  printf '%s' "$acc" > "$acc_file" || return 1
  for sha in $shas; do
    runs=$("$fetch" "$sha") || return 1
    # Also the empty-payload tooth: jq exits 4 on empty stdin, so a fetcher that returned success
    # while printing nothing is refused here rather than read as an ungated commit.
    runs=$(jq -ce 'if type == "array" then . else .check_runs end' <<<"$runs") || return 1
    # ARGV IS NOT A TRANSPORT (#1002's tooth must fire on unread ranges, never on unREADABLE ones).
    # `--argjson runs "$runs"` hands the whole payload to execve as ONE argument: Linux caps a single
    # argv item at MAX_ARG_STRLEN (128KB) whatever ARG_MAX is, and a head-adjacent commit's check-runs
    # blow past it. jq then dies "Argument list too long", the collector returns 1, and a range this
    # run READ PERFECTLY WELL is refused as unreadable — the release stalls on a healthy history.
    # Both large values therefore travel by file/stdin, where no such ceiling exists.
    printf '%s' "$runs" > "$runs_file" || return 1
    jq -c --arg sha "$sha" --slurpfile runs "$runs_file" '. + [{sha: $sha, check_runs: $runs[0]}]' \
      <<<"$acc" > "$acc_next" || return 1
    mv -f "$acc_next" "$acc_file" || return 1
    acc=$(cat "$acc_file") || return 1
  done
  printf '%s' "$acc"
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
