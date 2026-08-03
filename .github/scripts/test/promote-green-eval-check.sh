#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
#
# promote-green-eval-check.sh — pure-function test harness for evaluate_green() (issue #695: the
# promotion engine raced a still-red landing past a required check that hadn't registered on the
# sha yet) AND for derive_required_checks() (issue #725: the hand-kept REQUIRED_CHECKS array
# drifted the first time a job was added — cases 11-13 below prove the derived replacement both
# closes that exact regression and auto-joins a job it has never seen). No bats in this repo, so
# this is a plain-bash runner in the same idiom as the scripts it tests — canned `gh api
# check-runs` JSON (and, for the new cases, a fixture workflow YAML) in, a PASS/FAIL line + a
# summary out.
#
# Run: bash .github/scripts/test/promote-green-eval-check.sh
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

# expect_prefix <case-name> <expected-prefix> <check_runs_json> [required_checks_json] [provenance_json]
# Asserts evaluate_green()'s output starts with expected-prefix ("green" is also a valid, exact,
# one-word prefix of itself — startswith works for both verdicts).
expect_prefix() {
  local case_name="$1" expected_prefix="$2" check_runs_json="$3" required_json="${4:-}" provenance_json="${5:-}"
  local actual
  if [ -n "$provenance_json" ]; then
    actual=$(evaluate_green "$check_runs_json" "$required_json" "$provenance_json")
  elif [ -n "$required_json" ]; then
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

# ── 6. issue #2011, the exact no-issue queue wedge: checks.yml re-runs on one head, so the API
#      keeps an older failure beside a newer success under the SAME name. The replacement run is
#      the name's verdict; the stale failure must not strand the PR. The fixture records the two
#      live reproductions and carries ids/times so "latest" is data, never array-order folklore. ─
SAME_NAME_RERUN=$(cat "${SCRIPT_DIR}/fixtures/two-same-named-runs.check-runs.json")
expect_prefix "newer-same-named-success-replaces-stale-failure" green "$SAME_NAME_RERUN" "$(jq -nc '["smoke"]')"
# API ordering is not part of the evaluator's contract: the run id still identifies the newer row.
expect_prefix "same-named-selection-is-order-independent" green \
  "$(jq -c '.check_runs |= reverse' <<<"$SAME_NAME_RERUN")" "$(jq -nc '["smoke"]')"

# ── 7. skipped/neutral count as green (parity with the original assert's allowance) → green ─
RUNS=$(runs_array \
  "$(check_run build completed skipped)" \
  "$(check_run smoke completed neutral)")
expect_prefix "skipped-and-neutral-are-green" green "$RUNS" "$(jq -nc '["build", "smoke"]')"

# ── 8. the full API envelope shape ({"check_runs":[...]}), not just a bare array → accepted ─
ENVELOPE=$(jq -nc --argjson runs "$(runs_array "$(check_run build completed success)")" \
  '{total_count: 1, check_runs: $runs}')
expect_prefix "envelope-shape-accepted" green "$ENVELOPE" "$(jq -nc '["build"]')"

# ── 9. the REAL production REQUIRED_CHECKS, entire derived set present + green → green ─────
# Regression guard on the dynamically derived production set (promote-green-eval.sh) — every
# derived name must be accepted when its check-run is present and green.
ALL_REAL_RUNS_JSON=$(jq -c '.[]' <<<"$REQUIRED_CHECKS_JSON" | while IFS= read -r name_json; do
  check_run "$(jq -r . <<<"$name_json")" completed success
done | jq -s '.')
expect_prefix "production-set-all-green" green "$ALL_REAL_RUNS_JSON" # default (real) required set

# ── 10. the REPORTED bug, reproduced exactly: every real check except `smoke` green, `smoke` never
#       registered on the sha (checks.yml's slow leg hasn't reported in yet) → not, names smoke ─
REAL_MINUS_SMOKE_RUNS_JSON=$(jq -c '.[]' <<<"$REQUIRED_CHECKS_JSON" | while IFS= read -r name_json; do
  name=$(jq -r . <<<"$name_json")
  [ "$name" = smoke ] && continue
  check_run "$name" completed success
done | jq -s '.')
expect_contains "reported-bug-reproduced-smoke-missing" smoke "$REAL_MINUS_SMOKE_RUNS_JSON" # default (real) required set

# expect_array_contains <case-name> <needle> <json_array>
# Asserts a bare JSON array (e.g. derive_required_checks()'s own output) contains needle exactly —
# for checks on the derived SET itself, as opposed to expect_contains() above which checks
# evaluate_green()'s "not-green: ..." diagnostic string.
expect_array_contains() {
  local case_name="$1" needle="$2" json_array="$3"
  if jq -e --arg needle "$needle" 'any(.[]; . == $needle)' <<<"$json_array" >/dev/null; then
    echo "PASS  $case_name  →  contains [$needle]"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $case_name  →  $json_array does not contain [$needle]"
    FAIL=$((FAIL + 1))
  fi
}

# ── 11. issue #725 regression guard: `tests (api)` — the job f6c7686b added to gate.yml one
#       commit after the old hand-kept REQUIRED_CHECKS array was created, without updating it — is
#       present in the DERIVED production set (sourced from the real gate.yml, not remembered) ──
expect_array_contains "tests-api-in-derived-set" "tests (api)" "$REQUIRED_CHECKS_JSON"

# ── 12. issue #725's reported bug, reproduced exactly with the OLD failure mode: every real check
#       green EXCEPT tests (api), which never registered on the sha. Under the old hand-kept array
#       (which never listed "tests (api)" — that's the bug) this exact input evaluated `green`; a
#       still-red tests(api) run could have fast-forwarded onto edge. It now fails closed, naming
#       it — the same shape as case 10's smoke proof, for the check that actually regressed. ────
REAL_MINUS_TESTS_API_RUNS_JSON=$(jq -c '.[]' <<<"$REQUIRED_CHECKS_JSON" | while IFS= read -r name_json; do
  name=$(jq -r . <<<"$name_json")
  [ "$name" = "tests (api)" ] && continue
  check_run "$name" completed success
done | jq -s '.')
expect_contains "tests-api-reported-bug-reproduced" "tests (api)" "$REAL_MINUS_TESTS_API_RUNS_JSON"

# ── 13. auto-join proof (issue #725's actual fix): derive_required_checks() called directly on a
#       FIXTURE workflow whose job ids/names exist NOWHERE in this file, promote-green-eval.sh, or
#       the real gate.yml/checks.yml. A plain job, a `name:` override, a matrix leg, and a
#       codeql-action/analyze step all join the derived set with zero code change — proving the
#       MECHANISM does the work, not a list someone remembered to update. ─────────────────────────
FIXTURE_YML=$(mktemp)
trap 'rm -f "$FIXTURE_YML"' EXIT
cat >"$FIXTURE_YML" <<'YAML'
name: fixture
on: push
jobs:
  totally_new_job:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
  matrix_job:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        leg: [alpha, beta]
    steps:
      - run: echo hi
  overridden_name_job:
    name: custom display name (v2)
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
  codeql_job:
    runs-on: ubuntu-latest
    steps:
      - uses: github/codeql-action/analyze@v3
YAML
FIXTURE_DERIVED_JSON=$(derive_required_checks "$FIXTURE_YML")
expect_array_contains "fixture-plain-job-auto-joins" "totally_new_job" "$FIXTURE_DERIVED_JSON"
expect_array_contains "fixture-matrix-leg-auto-joins" "matrix_job (alpha)" "$FIXTURE_DERIVED_JSON"
expect_array_contains "fixture-name-override-auto-joins" "custom display name (v2)" "$FIXTURE_DERIVED_JSON"
# A job that runs codeql-action/analyze joins under its OWN Actions check-run name and nothing else
# (issue #1789 — see cases 18-19): the separate "CodeQL" row that GitHub's default code-scanning
# setup files belongs to another app and can never be provenance-eligible evidence here.
expect_array_contains "fixture-codeql-job-joins-under-its-own-name" "codeql_job" "$FIXTURE_DERIVED_JSON"

# expect_array_lacks <case-name> <needle> <json_array>
# The mirror of expect_array_contains: asserts a derived set does NOT carry a name. Absence is the
# assertion for #1789 — a required name nothing can produce wedges every landing forever.
expect_array_lacks() {
  local case_name="$1" needle="$2" json_array="$3"
  if jq -e --arg needle "$needle" 'any(.[]; . == $needle)' <<<"$json_array" >/dev/null; then
    echo "FAIL  $case_name  →  $json_array must not contain [$needle]"
    FAIL=$((FAIL + 1))
  else
    echo "PASS  $case_name  →  lacks [$needle]"
    PASS=$((PASS + 1))
  fi
}

# ── 18. issue #1789 regression guard: the derived PRODUCTION set (real gate.yml + checks.yml) must
#       carry `fp-codeql` — the Actions job that actually runs the FP query pack, under the name
#       its own check-run carries — and must NOT carry the literal "CodeQL". No github-actions
#       workflow files a check-run by that name; only GitHub's default code-scanning setup does,
#       under the github-advanced-security app, which the #1305 provenance filter correctly refuses
#       as non-evidence. Requiring it made every landing refuse with "missing required check(s):
#       CodeQL" forever — a total, self-inflicted wedge. ───────────────────────────────────────────
expect_array_contains "fp-codeql-in-derived-production-set" "fp-codeql" "$REQUIRED_CHECKS_JSON"
expect_array_lacks "manufactured-codeql-not-in-derived-production-set" "CodeQL" "$REQUIRED_CHECKS_JSON"

# ── 19. THE CLASS GATE for #1789: every name in the derived set must be one the parsed workflows
#       can actually produce. A check-run's name is a job's display name (`name:` override, else the
#       job id) or, for a matrix job, that display name with a "(legs)" suffix — nothing else. This
#       is computed straight from the YAML, independently of derive_required_checks()'s own
#       expansion, so any future clause that MANUFACTURES a name (rather than reading one off a job)
#       fails here regardless of which name it invents. derived ⊆ producible, forever. ─────────────
# unproducible_names <derived_json> <workflow.yml...> — prints, one per line, every derived name no
# job in the given workflow files could file a check-run under. Empty output = the class holds.
unproducible_names() {
  local derived_json="$1"
  shift
  local jobs_json file
  jobs_json=$(
    for file in "$@"; do yq -o=json eval '.' "$file"; done |
      jq -s -c '[.[] | (.jobs // {}) | to_entries[] |
        {base: (.value.name // .key), matrix: (.value.strategy.matrix != null)}]'
  )
  jq -r --argjson jobs "$jobs_json" '
    .[] | . as $name
    | select(
        [$jobs[] | . as $job | select(
          $name == $job.base
          or ($job.matrix and ($name | startswith($job.base + " (")) and ($name | endswith(")")))
        )] | length == 0
      )
  ' <<<"$derived_json" || echo "unproducible_names: jq failed (see stderr) — treat as unproducible"
}

SCRIPT_WORKFLOWS_DIR="${SCRIPT_DIR}/../../workflows"
UNPRODUCIBLE=$(unproducible_names "$REQUIRED_CHECKS_JSON" \
  "${SCRIPT_WORKFLOWS_DIR}/gate.yml" "${SCRIPT_WORKFLOWS_DIR}/checks.yml")
if [ -z "$UNPRODUCIBLE" ]; then
  echo "PASS  derived-set-is-producible  →  every required name maps to a real job"
  PASS=$((PASS + 1))
else
  echo "FAIL  derived-set-is-producible  →  no workflow job can produce: $(tr '\n' ' ' <<<"$UNPRODUCIBLE")"
  FAIL=$((FAIL + 1))
fi

# The same invariant on the fixture — proves the check has teeth on a set it has never seen, and
# that a matrix leg (a legitimately synthesised name) is correctly accepted as producible.
UNPRODUCIBLE_FIXTURE=$(unproducible_names "$FIXTURE_DERIVED_JSON" "$FIXTURE_YML")
if [ -z "$UNPRODUCIBLE_FIXTURE" ]; then
  echo "PASS  fixture-derived-set-is-producible  →  every derived name maps to a fixture job"
  PASS=$((PASS + 1))
else
  echo "FAIL  fixture-derived-set-is-producible  →  no fixture job can produce: $(tr '\n' ' ' <<<"$UNPRODUCIBLE_FIXTURE")"
  FAIL=$((FAIL + 1))
fi

# ── 14-17. PROVENANCE + the republish window (#1305 review, CRITICAL) ────────────────────────
# The reported hole: `commits/{sha}/check-runs` returns every row any app ever attached to that
# commit, and the required-set gate matched them by NAME alone — so a complete set of green rows
# belonging to a DIFFERENT context satisfied a master promotion. These fixtures carry the full
# shape (app + check_suite + pull_requests) the real API returns.
prov_run() { # <name> <head_branch> <pr-number|null>
  jq -nc --arg n "$1" --arg b "$2" --argjson pr "$3" \
    '{name:$n, status:"completed", conclusion:"success", app:{slug:"github-actions"},
      check_suite:{head_branch:$b},
      pull_requests: (if $pr == null then [] else [{number:$pr}] end)}'
}
TARGET_PROV=$(jq -nc '{pr: 999, head_ref: "edge", app: "github-actions"}')

# 14. THE REPRO: green rows from a lane-branch suite, evaluated for master-bound PR #999.
FOREIGN_RUNS=$(runs_array \
  "$(prov_run build "lane/whatever" 1234)" \
  "$(prov_run smoke "lane/whatever" 1234)" \
  "$(prov_run lint  "lane/whatever" 1234)")
expect_prefix "foreign-context-green-rejected" not-green "$FOREIGN_RUNS" "$SMALL_SET" "$TARGET_PROV"
# and the same rows still read green with no provenance supplied — the bug, pinned.
expect_prefix "foreign-context-green-was-accepted-before" green "$FOREIGN_RUNS" "$SMALL_SET"

# 15. The genuine article: push-triggered suites on the PR's own head ref, plus a PR-associated row.
GENUINE_RUNS=$(runs_array \
  "$(prov_run build "edge" null)" \
  "$(prov_run smoke "edge" null)" \
  "$(prov_run lint  "edge" 999)")
expect_prefix "master-bound-rows-accepted" green "$GENUINE_RUNS" "$SMALL_SET" "$TARGET_PROV"

# 16. A foreign app cannot vouch for anything, whatever the branch says.
OTHER_APP=$(jq -nc '[{name:"build", status:"completed", conclusion:"success", app:{slug:"some-bot"}, check_suite:{head_branch:"edge"}, pull_requests:[]}]')
expect_prefix "foreign-app-not-evidence" not-green "$OTHER_APP" "$(jq -nc '["build"]')" "$TARGET_PROV"

# 17. The republish window is refused on master, and only on master.
expect_window() { # <case> <expected-prefix> <base> <marker-present>
  local actual; actual=$(evaluate_republish_window "$3" "$4")
  case "$actual" in
    "$2"*) echo "PASS  $1  →  $actual"; PASS=$((PASS + 1)) ;;
    *) echo "FAIL  $1  →  got [$actual], expected prefix [$2]"; FAIL=$((FAIL + 1)) ;;
  esac
}
expect_window "window-refused-on-master"   refused master yes
expect_window "window-allowed-on-edge"     ok      edge   yes
expect_window "no-window-master-unaffected" ok     master no

# ── 18-22. THE RANGE, NOT ONLY THE HEAD (#1002) ─────────────────────────────────────────────
# These cases feed REAL check-run payloads captured from this repo's own CI, not synthetic
# verdicts — which is precisely how the parked #1852 rule passed its unit test while being
# unsatisfiable in production (it asserted a synthetic interior red as not-green, never noticing
# that a real interior commit carries no runs at all and so read not-green forever).
#
#   fixtures/interior-red-163b3345.check-runs.json  — the two `failure` rows still attached to
#     163b3345, the commit #1002 convicted: `gate` and `tests (fight)`, both completed failure,
#     both with head_branch null and pull_requests [] because the lane branch was deleted at
#     landing. Captured 2026-08-02 from GET /repos/aresrpg/aresrpg/commits/163b3345/check-runs,
#     field-projected (never edited) for the reason its own _provenance records.
#   fixtures/interior-clean-d18614db.check-runs.json — the UNPROJECTED envelope for a real interior
#     commit of train-39's landing range: total_count 0. Captured the same day, same endpoint.
#     This is the shape the parked rule read as "missing required checks" on every train.
INTERIOR_RED=$(cat "${SCRIPT_DIR}/fixtures/interior-red-163b3345.check-runs.json")
INTERIOR_CLEAN=$(cat "${SCRIPT_DIR}/fixtures/interior-clean-d18614db.check-runs.json")

expect_range() { # <case-name> <expected-prefix> <interior_json>
  local actual; actual=$(evaluate_range_green "$3")
  case "$actual" in
    "$2"*) echo "PASS  $1  →  $actual"; PASS=$((PASS + 1)) ;;
    *) echo "FAIL  $1  →  got [$actual], expected prefix [$2]"; FAIL=$((FAIL + 1)) ;;
  esac
}

# 18. THE REGRESSION THAT WEDGED #1852: a real multi-commit train. Every interior commit carries
#     the real zero-run payload. This MUST land — anything else refuses every train in the repo.
REAL_TRAIN_RANGE=$(jq -nc --argjson clean "$INTERIOR_CLEAN" '
  [ {sha: "d18614db08621b3cf0e70c1f4c1100284df5aa01", check_runs: $clean},
    {sha: "ebf431e1465515f997728792dd0386fb0ee9ae23", check_runs: $clean},
    {sha: "9b9b4c8a316e89427e07f61c70ce5103fa148ae6", check_runs: $clean} ]')
expect_range "real-train-interior-lands" green "$REAL_TRAIN_RANGE"

# 19. THE DEFECT #1002 REPORTED: the real red commit sitting inside an otherwise-green range.
REAL_POISONED_RANGE=$(jq -nc --argjson red "$INTERIOR_RED" --argjson clean "$INTERIOR_CLEAN" '
  [ {sha: "163b33450000000000000000000000000000beef", check_runs: $red},
    {sha: "d18614db08621b3cf0e70c1f4c1100284df5aa01", check_runs: $clean} ]')
expect_range "real-interior-red-refused" not-green "$REAL_POISONED_RANGE"

# 20. …and the refusal names the sha AND the checks, so the author knows what to re-cut.
ACTUAL=$(evaluate_range_green "$REAL_POISONED_RANGE")
case "$ACTUAL" in
  *163b33450000*"gate"*"tests (fight)"*) echo "PASS  poisoned-refusal-names-sha-and-checks  →  $ACTUAL"; PASS=$((PASS + 1)) ;;
  *) echo "FAIL  poisoned-refusal-names-sha-and-checks  →  got [$ACTUAL]"; FAIL=$((FAIL + 1)) ;;
esac

# 21. An empty range (a single-commit PR: the head is the whole landing) is green by construction.
expect_range "single-commit-pr-has-no-interior" green '[]'

# 22. A foreign app cannot poison the queue any more than it can vouch for it (case 16's mirror).
FOREIGN_RED=$(jq -nc '[{sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  check_runs: [{name: "vercel", status: "completed", conclusion: "failure", app: {slug: "vercel"}}]}]')
expect_range "foreign-app-cannot-poison" green "$FOREIGN_RED"

# ── 23-26. AN UNREAD RANGE IS NOT A CLEAN ONE (lead review of 317cc1cf8) ─────────────────────
# What is injected here is the FETCH failing, never a verdict: the stub fetchers below replay the
# captured payload for every sha they can read, and simply fail for the one they cannot. That is
# the real hazard — `gh api` dying on a rate limit or a 5xx while the range still evaluates green.
RANGE_SHAS="d18614db08621b3cf0e70c1f4c1100284df5aa01 ebf431e1465515f997728792dd0386fb0ee9ae23"

# Reads succeed for every sha, replaying the captured zero-run envelope.
stub_fetch_ok() { cat "${SCRIPT_DIR}/fixtures/interior-clean-d18614db.check-runs.json"; }
# The second sha is unreadable — the shape of a rate limit mid-range.
stub_fetch_rate_limited() {
  if [ "$1" = "ebf431e1465515f997728792dd0386fb0ee9ae23" ]; then echo "gh: API rate limit exceeded" >&2; return 1; fi
  cat "${SCRIPT_DIR}/fixtures/interior-clean-d18614db.check-runs.json"
}
# The pathology the first cut had: the read "succeeds" but writes nothing, and empty slurps to [].
stub_fetch_silent() { return 0; }

expect_collect() { # <case-name> <ok|refused> <fetch_fn>
  local actual status
  actual=$(collect_interior_check_runs "$RANGE_SHAS" "$3") && status=ok || status=refused
  if [ "$status" = "$2" ]; then
    echo "PASS  $1  →  $status${actual:+ }${actual}"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $1  →  got [$status], expected [$2]"
    FAIL=$((FAIL + 1))
  fi
}

# 23. The happy path still collects, and what it collects still evaluates green.
expect_collect "readable-range-collects" ok stub_fetch_ok
COLLECTED=$(collect_interior_check_runs "$RANGE_SHAS" stub_fetch_ok)
expect_range "collected-range-evaluates" green "$COLLECTED"

# 24. THE HOLE: one unreadable sha refuses the whole range rather than reading it as covered.
expect_collect "unreadable-sha-refuses" refused stub_fetch_rate_limited

# 25. A fetcher that exits 0 having printed nothing is refused too — success is not a payload.
expect_collect "silent-success-refuses" refused stub_fetch_silent

# 25b. A LARGE readable payload still collects. A head-adjacent commit carries dozens of check-runs.
#      Linux caps a SINGLE argv item at MAX_ARG_STRLEN (128KB) however roomy ARG_MAX is, and macOS
#      caps the whole argv+env block near 1MB — so a collector that hands the payload to jq as a
#      COMMAND-LINE ARGUMENT dies with "Argument list too long" on exactly the ranges a real
#      promotion has. That is a READ THAT SUCCEEDED being reported as a range this run could not
#      read: the #1002 tooth firing on a healthy range and stranding the release.
#      The payload here is sized past both ceilings so the case is portable, and its verdict is
#      asserted without echoing it — the point is that it collects at all.
stub_fetch_large() {
  jq -nc '[range(4000) | {name: "check-\(.)", status: "completed", conclusion: "success",
    output: {summary: ("x" * 500)}}]'
}
LARGE_STATUS=ok
collect_interior_check_runs "$RANGE_SHAS" stub_fetch_large >/dev/null 2>&1 || LARGE_STATUS=refused
if [ "$LARGE_STATUS" = ok ]; then
  echo "PASS  large-payload-collects  →  ok (payload not echoed)"
  PASS=$((PASS + 1))
else
  echo "FAIL  large-payload-collects  →  got [refused], expected [ok] — argv overflow"
  FAIL=$((FAIL + 1))
fi

# 26. And the collector never hands a partial range to the evaluator: a refusal prints nothing, so
#     there is no truncated payload for a caller to mistake for a clean one.
PARTIAL=$(collect_interior_check_runs "$RANGE_SHAS" stub_fetch_rate_limited || true)
if [ -z "$PARTIAL" ]; then
  echo "PASS  refusal-emits-no-partial-range"
  PASS=$((PASS + 1))
else
  echo "FAIL  refusal-emits-no-partial-range  →  emitted [$PARTIAL]"
  FAIL=$((FAIL + 1))
fi

echo
echo "── ${PASS} passed, ${FAIL} failed ──"
[ "$FAIL" -eq 0 ]
