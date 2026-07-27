#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# depcruise-gate.sh — the IMPORT-GRAPH half of the arch gate (docs/CODE_LAW.md "Arch gates").
# Rules live in .dependency-cruiser.cjs: fight-core-hermetic (generalizes `ares test fightcore`
# gate a to a resolved allowlist) · engine-quarantine (engine3 only under game/ + world-shell/) ·
# no-circular (hard-zero after issue #95 burned the census debt down; any cycle is red).
#
# Ratchet: no baseline file means zero known violations after issue #95's burn-down; both boundary
# rules were already clean. The write-baseline mode exists for deliberate ratchet maintenance,
# never to absorb a new violation without review.
#
# Runs under bun (node 25 is outside dependency-cruiser's support matrix; bun's node-compat
# version passes). dependency-cruiser is a root devDep. A missing dependency-cruiser or bun means
# FAIL: there is no graph verdict.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

echo "== AresRPG arch gate · dependency-cruiser (fight hermetic / engine quarantine / no new cycles) =="
depcruise="node_modules/.bin/depcruise"
if [ ! -x "$depcruise" ]; then
  echo "  FAIL: dependency-cruiser not installed (bun install)"
  exit 1
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "  FAIL: bun not available (this bun-first repo runs depcruise under bun — node 25 is outside its support matrix)"
  exit 1
fi

if [ "${1:-}" = "--write-baseline" ]; then
  baseline=".dependency-cruiser-known-violations.json"
  if ! baseline_tmp_dir="$(mktemp -d "${baseline}.tmp.XXXXXX")"; then
    echo "  FAIL: could not create a temporary baseline"
    exit 1
  fi
  baseline_tmp="$baseline_tmp_dir/$baseline"
  trap 'rm -rf "$baseline_tmp_dir"' EXIT
  if ! bun "$depcruise" --config .dependency-cruiser.cjs \
    --output-type baseline --output-to "$baseline_tmp" \
    packages/frontend/src packages/fight/src packages/party/src packages/inventory/src packages/world/src; then
    echo "  FAIL: dependency-cruiser could not generate the baseline"
    exit 1
  fi
  if [ ! -x node_modules/.bin/prettier ]; then
    echo "  FAIL: prettier not installed (bun install)"
    exit 1
  fi
  if ! node_modules/.bin/prettier --write --log-level silent "$baseline_tmp"; then
    echo "  FAIL: prettier could not format the baseline"
    exit 1
  fi
  if ! mv "$baseline_tmp" "$baseline"; then
    echo "  FAIL: could not replace the baseline"
    exit 1
  fi
  echo "  baseline written: $baseline"
  exit 0
fi

# A missing baseline is the hard-zero floor: omit --ignore-known so every violation is new and red.
# A reviewed baseline, when present, is the only source of known violations.
# The whole argv lives in the array — never just the optional flag — so it is never empty: bash 3.2
# (macOS /bin/bash) aborts on an empty-array expansion under `set -u`, bash 5 does not (issue #824).
# --ignore-known takes an OPTIONAL argument: it stays followed by --output-type, never adjacent to a
# positional, or it swallows packages/frontend/src as its baseline path (EISDIR).
CRUISE_ARGS=(--config .dependency-cruiser.cjs)
[ -f .dependency-cruiser-known-violations.json ] && CRUISE_ARGS+=(--ignore-known)
CRUISE_ARGS+=(--output-type err)
bun "$depcruise" "${CRUISE_ARGS[@]}" \
  packages/frontend/src packages/fight/src packages/party/src packages/inventory/src packages/world/src
