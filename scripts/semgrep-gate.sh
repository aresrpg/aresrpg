#!/usr/bin/env bash
# semgrep-gate.sh — the DATAFLOW half of the arch gate (docs/CODE_LAW.md "Arch gates").
#
# What runs, in order:
#   1. fixture self-test — scripts/arch/fixtures/{red,green} scanned and compared against
#      fixtures/expected.json (exact counts). The rules' own regression test: a semgrep upgrade or
#      rule edit that changes matching behavior fails HERE, not silently on the tree.
#   2. real tree — packages/frontend/src scanned; scripts/arch/semgrep_verdict.mjs joins the
#      laundered-write extraction pair and ratchets everything against scripts/arch/semgrep_baseline.json.
#      Findings at/below the baseline = green (census debt, burn down); ANY new finding = red.
#
# Ratchet operation: fix a finding → the gate prints a tighten hint → `--write-baseline` lowers the
# floor. A cleaned rule (empty baseline entry) can then never regress. Never regenerate the floor to
# ABSORB a new finding unless the debt is deliberate and reviewed.
#
# semgrep is a system binary, not a devDep. Install: `uv tool install semgrep` (used on the dev Mac,
# ~/.local/bin) | `brew install semgrep` | `pipx install semgrep`. When absent the gate SKIPS green
# (exit 0) so composite lint never reds on a missing tool — the arch net is simply off on that machine.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

SEMGREP="${SEMGREP_BIN:-}"
if [ -z "$SEMGREP" ]; then
  for candidate in semgrep "$HOME/.local/bin/semgrep" /opt/homebrew/bin/semgrep; do
    if command -v "$candidate" >/dev/null 2>&1; then
      SEMGREP="$candidate"
      break
    fi
  done
fi

echo "== AresRPG arch gate · semgrep (dataflow: laundered writes, fight effect-freedom, functor purity) =="
if [ -z "$SEMGREP" ]; then
  echo "  SKIP: semgrep not installed (uv tool install semgrep | brew install semgrep | pipx install semgrep)"
  exit 0
fi

SCAN=("$SEMGREP" scan --config scripts/arch/arch_law.yml --config scripts/arch/laundered_extract.yml
  --json --metrics=off --disable-version-check --quiet)
OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"' EXIT

scan_into() { # scan_into <out.json> <target…>  (semgrep exits 0/1 for clean/findings; >1 = real error)
  local out="$1"
  shift
  "${SCAN[@]}" "$@" >"$out" 2>"$OUT_DIR/err.log"
  local code=$?
  if [ "$code" -gt 1 ]; then
    echo "  semgrep failed (exit $code) on $*:"
    sed 's/^/    /' "$OUT_DIR/err.log" | head -20
    return 1
  fi
}

# 1 — fixture self-test
scan_into "$OUT_DIR/red.json" scripts/arch/fixtures/red || exit 1
scan_into "$OUT_DIR/green.json" scripts/arch/fixtures/green || exit 1
node scripts/arch/semgrep_verdict.mjs --expect scripts/arch/fixtures/expected.json red "$OUT_DIR/red.json" || exit 1
node scripts/arch/semgrep_verdict.mjs --expect scripts/arch/fixtures/expected.json green "$OUT_DIR/green.json" || exit 1

# 2 — the real tree, ratcheted (or --write-baseline to regenerate the floor). The promoted domain
# cores ride along — fight (M1a), party + inventory (M2), world (D770a): files that left frontend for
# a package must never leave the dataflow net.
scan_into "$OUT_DIR/tree.json" packages/frontend/src packages/fight/src packages/party/src packages/inventory/src packages/world/src || exit 1
if [ "${1:-}" = "--write-baseline" ]; then
  node scripts/arch/semgrep_verdict.mjs --write-baseline scripts/arch/semgrep_baseline.json "$OUT_DIR/tree.json"
  exit $?
fi
node scripts/arch/semgrep_verdict.mjs --baseline scripts/arch/semgrep_baseline.json "$OUT_DIR/tree.json"
