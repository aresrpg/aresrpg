#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# single-home-gate.sh — the DUAL-HOME class gate (CLAUDE.md "One home per fact", docs/REGISTRY.md).
#
# The sim-constants gate (#1603) protects a HAND-LISTED family of protocol numbers. This one is its
# generalization: it needs no kill-list, because it derives what to protect from the repo itself —
# the exported vocabulary and docs/REGISTRY.md. Six lanes, all repo-bytes only (no chain, no
# network, no analyzer binary — it cannot flake):
#
#   duplicate-export  one exported name declared in two files (#1536 manhattan/BFS, #1706 generateGrid)
#   registry-fact     a REGISTRY-owned name declared outside its home, exported or laundered local
#   registry-anchor   a REGISTRY row whose `path:line` declares nothing — the registry itself drifted
#   registry-surface  a REGISTRY fact RE-EXPORTED off-home: a second importable surface (#2222)
#   registry-importer a consumer binding a REGISTRY fact from a module that is not its home (#2222)
#   store-writers     one store field written by two modules (#1034, #1687)
#
# The last two are the GENERATED fence (#2222): one import rule per registry row whose anchor is an
# importable JS module, derived at check time from docs/REGISTRY.md itself. The registry is the
# manifest — there is no second file listing what is protected — and rows whose home is not an
# importable module (Move sources, prose facts) generate nothing and are REPORTED as unfenceable, so
# the gate never claims coverage it does not have.
#
# What runs, in order:
#   1. fence positive control — a synthetic row is planted in a COPY of the real registry and the
#      derived rule list must gain a rule for it (and must not carry that rule without the row). A
#      parser that stopped reading the registry fails HERE, before any lane can print a green.
#   2. fixture self-test — scripts/arch/fixtures/single_home/{red,green} scanned with the SAME
#      scanner the tree gets, compared against fixtures/expected.json (exact counts). A lane that
#      stops matching, or starts over-matching, fails HERE.
#   3. the real tree, ratcheted against scripts/arch/single_home.baseline.json. Census-day debt is
#      baselined; ANY new key is red. `--write-baseline` only ever LOWERS the floor.
#   4. `--negative-control` (not part of the normal run): writes FRESH violations — dual homes that
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

# ── 4 — negative control ────────────────────────────────────────────────────────────────────────
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
  # Six fresh violations, one per lane: a name exported from two packages, a REGISTRY-owned constant
  # re-declared away from its home, a REGISTRY fact re-exported under a second name, the same fact
  # bound from a module that is not its home, a store field written from two modules, and a registry
  # row whose anchor points at a line that declares nothing.
  cat >"$A" <<'PROBE'
// Negative control — deleted by scripts/single-home-gate.sh --negative-control.
import { STATUS_OPEN } from './project.js'

export { STATUS_OPEN as NEGATIVE_CONTROL_STATUS } from './board_state.js'
export const negative_control_fact = 41
export const negative_control_seen = STATUS_OPEN
export const arm_probe = (use_dungeon) =>
  use_dungeon.setState({ dungeon: { negative_control_status: 'armed', only_a: true } })
PROBE
  cat >"$B" <<'PROBE'
// Negative control — deleted by scripts/single-home-gate.sh --negative-control.
export const negative_control_fact = 41
const MIST_PER_SUI = 1_000_000_000n
export const disarm_probe = (use_dungeon) =>
  use_dungeon.setState(() => ({
    dungeon: { negative_control_status: MIST_PER_SUI + negative_control_fact },
  }))
PROBE
  printf '| Negative control fact | `%s:1` — a comment line, so the row protects nothing. |\n' "$A" >>docs/REGISTRY.md
  out="$(run_tree --baseline "$BASELINE" 2>&1)"
  code=$?
  echo "$out" | sed 's/^/    /'
  if [ "$code" -eq 0 ]; then
    echo "  FAIL: the gate stayed GREEN on six fresh dual homes — it measures nothing."
    exit 1
  fi
  missing=0
  for lane in \
    'duplicate-export · negative_control_fact · packages/fight/src/negative_control_single_home.js' \
    'duplicate-export · negative_control_fact · packages/world/src/negative_control_single_home.js' \
    'registry-fact · MIST_PER_SUI' \
    'registry-surface · STATUS_OPEN (Projected dungeon/fight-view lifecycle) · packages/fight/src/negative_control_single_home.js' \
    'registry-importer · STATUS_OPEN (Projected dungeon/fight-view lifecycle) · packages/fight/src/negative_control_single_home.js' \
    'store-writers · use_dungeon.dungeon.negative_control_status · packages/fight/src/negative_control_single_home.js' \
    'store-writers · use_dungeon.dungeon.negative_control_status · packages/world/src/negative_control_single_home.js' \
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
  echo "  NEGATIVE CONTROL PASSED: red on six fresh dual homes (every lane), green the moment they are gone."
  exit 0
fi

echo "== AresRPG single-home gate (one fact, one home — duplicate exports / registry facts + generated import fence / store writers) =="
if ! command -v node >/dev/null 2>&1; then
  echo "  FAIL: node not available — a machine without the scanner has no verdict"
  exit 1
fi

# ── 1 — fence positive control (#2222) ──────────────────────────────────────────────────────────
# The fence is only as real as the parser that derives it. Plant a row the registry does NOT carry
# into a COPY of it, and the derived rule list must gain a rule for that row — with the blind guard
# that the untouched registry does not already carry it (an assertion that passes either way proves
# nothing). The row anchors a gate fixture, whose lines are already pinned by the self-test below.
CONTROL_ANCHOR="$FIXTURES/green/packages/alpha/src/protocol.js:5"
if ! CONTROL_REGISTRY="$(mktemp)"; then
  echo "  FAIL: could not create the fence control registry"
  exit 1
fi
trap 'rm -f "$CONTROL_REGISTRY"' EXIT
cp docs/REGISTRY.md "$CONTROL_REGISTRY" || exit 1
printf '| Fence positive control | `%s` — the gate fixture'"'"'s exported constant. |\n' "$CONTROL_ANCHOR" >>"$CONTROL_REGISTRY"
if node "$VERDICT" --root . --registry docs/REGISTRY.md --fences | grep -q '^fence · K_TEST ·'; then
  echo "  FAIL: the real registry already fences K_TEST — the fence control asserts nothing"
  exit 1
fi
control_fences="$(node "$VERDICT" --root . --registry "$CONTROL_REGISTRY" --fences)" || exit 1
if ! echo "$control_fences" | grep -q "^fence · K_TEST · $CONTROL_ANCHOR · Fence positive control$"; then
  echo "  FAIL: a planted registry row generated NO fence — the gate no longer reads docs/REGISTRY.md"
  exit 1
fi
echo "  fence control: a planted registry row generated its rule ($(echo "$control_fences" | grep -c '^fence · ') rules from the control registry)"

# ── 2 — fixture self-test ───────────────────────────────────────────────────────────────────────
for case_name in red green; do
  node "$VERDICT" --root "$FIXTURES/$case_name" --scan packages --registry docs/REGISTRY.md \
    --expect "$FIXTURES/expected.json" --case "$case_name" || exit 1
done

# ── 3 — the real tree, ratcheted ────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--write-baseline" ]; then
  run_tree --baseline "$BASELINE" --write
  exit $?
fi
run_tree --baseline "$BASELINE"
