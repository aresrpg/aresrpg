#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# single-home-gate.sh — the DUAL-HOME class gate (CLAUDE.md "One home per fact", docs/REGISTRY.md).
#
# The sim-constants gate (#1603) protects a HAND-LISTED family of protocol numbers. This one is its
# generalization: it needs no kill-list, because it derives what to protect from the repo itself —
# the exported vocabulary and docs/REGISTRY.md. Four lanes, all repo-bytes only (no chain, no
# network, no analyzer binary — it cannot flake):
#
#   duplicate-export  one exported name declared in two files (#1536 manhattan/BFS, #1706 generateGrid)
#   registry-fact     a REGISTRY-owned name declared outside its home, exported or laundered local
#   registry-anchor   a REGISTRY row whose `path:line` declares nothing — the registry itself drifted
#   store-writers     one store field written by two modules (#1034, #1687)
#
# What runs, in order:
#   1. fixture self-test — scripts/arch/fixtures/single_home/{red,green} scanned with the SAME
#      scanner the tree gets, compared against fixtures/expected.json (exact counts). A lane that
#      stops matching, or starts over-matching, fails HERE.
#   2. the real tree, ratcheted against scripts/arch/single_home.baseline.json. Census-day debt is
#      baselined; ANY new key is red. `--write-baseline` only ever LOWERS the floor.
#   3. `--negative-control` (not part of the normal run): writes FRESH violations — dual homes that
#      do not exist in this codebase — into real scanned packages, proves the real gate goes red on
#      each lane, removes them, and proves it goes green again. A gate that only reds on history is
#      a regression suite wearing a gate's name.
#
# Known baseline noise, deliberately absorbed rather than special-cased: two Move modules may declare
# the same const for two different facts (`MAX_LEVEL` in character_xp and job_xp). Name-only
# detection cannot tell that from a copy — the ratchet holds it at its measured count instead.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

VERDICT="scripts/arch/single_home_verdict.mjs"
FIXTURES="scripts/arch/fixtures/single_home"
BASELINE="scripts/arch/single_home.baseline.json"
SCAN_DIRS="packages,api"

run_tree() { node "$VERDICT" --root . --scan "$SCAN_DIRS" --registry docs/REGISTRY.md "$@"; }

# ── 3 — negative control ────────────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--negative-control" ]; then
  echo "== AresRPG single-home gate · NEGATIVE CONTROL (fresh violations, real gate) =="
  A="packages/fight/src/negative_control_single_home.js"
  B="packages/world/src/negative_control_single_home.js"
  for probe in "$A" "$B"; do
    if [ -e "$probe" ]; then
      echo "  FAIL: $probe already exists — refusing to overwrite a real file"
      exit 1
    fi
  done
  BACKUP="$(mktemp)" || exit 1
  cp docs/REGISTRY.md "$BACKUP" || exit 1
  # Byte-exact restore of the registry, whatever happens below — the control is allowed to break the
  # tree for one gate run, never to leave it broken.
  trap 'rm -f "$A" "$B"; cp "$BACKUP" docs/REGISTRY.md; rm -f "$BACKUP"' EXIT
  # Four fresh violations, one per lane: a name exported from two packages, a REGISTRY-owned constant
  # re-declared away from its home, a store field written from two modules, and a registry row whose
  # anchor points at a line that declares nothing.
  cat >"$A" <<'PROBE'
// Negative control — deleted by scripts/single-home-gate.sh --negative-control.
export const negative_control_fact = 41
export const arm_probe = (use_dungeon) => use_dungeon.setState({ negative_control_phase: 'armed' })
PROBE
  cat >"$B" <<'PROBE'
// Negative control — deleted by scripts/single-home-gate.sh --negative-control.
export const negative_control_fact = 41
const MIST_PER_SUI = 1_000_000_000n
export const disarm_probe = (use_dungeon) =>
  use_dungeon.setState({ negative_control_phase: MIST_PER_SUI + negative_control_fact })
PROBE
  printf '| Negative control fact | `%s:1` — a comment line, so the row protects nothing. |\n' "$A" >>docs/REGISTRY.md
  out="$(run_tree --baseline "$BASELINE" 2>&1)"
  code=$?
  echo "$out" | sed 's/^/    /'
  if [ "$code" -eq 0 ]; then
    echo "  FAIL: the gate stayed GREEN on four fresh dual homes — it measures nothing."
    exit 1
  fi
  missing=0
  for lane in \
    'duplicate-export · negative_control_fact · packages/fight/src/negative_control_single_home.js' \
    'duplicate-export · negative_control_fact · packages/world/src/negative_control_single_home.js' \
    'registry-fact · MIST_PER_SUI' \
    'store-writers · use_dungeon.negative_control_phase' \
    'registry-anchor · Negative control fact'; do
    if ! echo "$out" | grep -qF -- "$lane"; then
      echo "  FAIL: no finding for: $lane"
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 1
  rm -f "$A" "$B"
  cp "$BACKUP" docs/REGISTRY.md
  if ! run_tree --baseline "$BASELINE" >/dev/null; then
    echo "  FAIL: the gate stayed RED after the probes were removed — the verdict is not reversible."
    exit 1
  fi
  echo "  NEGATIVE CONTROL PASSED: red on four fresh dual homes (every lane), green the moment they are gone."
  exit 0
fi

echo "== AresRPG single-home gate (one fact, one home — duplicate exports / registry facts / store writers) =="
if ! command -v node >/dev/null 2>&1; then
  echo "  FAIL: node not available — a machine without the scanner has no verdict"
  exit 1
fi

# ── 1 — fixture self-test ───────────────────────────────────────────────────────────────────────
for case_name in red green; do
  node "$VERDICT" --root "$FIXTURES/$case_name" --scan packages --registry docs/REGISTRY.md \
    --expect "$FIXTURES/expected.json" --case "$case_name" || exit 1
done

# ── 2 — the real tree, ratcheted ────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--write-baseline" ]; then
  run_tree --baseline "$BASELINE" --write
  exit $?
fi
run_tree --baseline "$BASELINE"
