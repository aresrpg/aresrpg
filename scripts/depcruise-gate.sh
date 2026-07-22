#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# depcruise-gate.sh — the IMPORT-GRAPH half of the arch gate (docs/CODE_LAW.md "Arch gates").
# Rules live in .dependency-cruiser.cjs: fight-core-hermetic (generalizes `ares test fightcore`
# gate a to a resolved allowlist) · engine-quarantine (engine3 only under game/ + world-shell/) ·
# no-circular (hard-zero after issue #95 burned the census debt down; any cycle is red).
#
# Ratchet: .dependency-cruiser-known-violations.json is [] after issue #95's burn-down; both boundary
# rules were already clean. `--ignore-known` therefore accepts ZERO violations. The write-baseline mode
# exists for deliberate ratchet maintenance, never to absorb a new violation without review.
#
# Runs under bun (node 25 is outside dependency-cruiser's support matrix; bun's node-compat
# version passes). dependency-cruiser is a root devDep — absent = SKIP green so the composite
# never reds on a missing tool (bun install restores it).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

echo "== AresRPG arch gate · dependency-cruiser (fight hermetic / engine quarantine / no new cycles) =="
if [ ! -e node_modules/.bin/depcruise ]; then
  echo "  SKIP: dependency-cruiser not installed (bun install)"
  exit 0
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "  SKIP: bun not available (this bun-first repo runs depcruise under bun — node 25 is outside its support matrix)"
  exit 0
fi

if [ "${1:-}" = "--write-baseline" ]; then
  bun node_modules/.bin/depcruise --config .dependency-cruiser.cjs \
    --output-type baseline --output-to .dependency-cruiser-known-violations.json \
    packages/frontend/src packages/fight/src packages/party/src packages/inventory/src packages/world/src
  node_modules/.bin/prettier --write --log-level silent .dependency-cruiser-known-violations.json
  echo "  baseline written: .dependency-cruiser-known-violations.json"
  exit 0
fi

# --ignore-known requires the baseline file; without one (fresh clone pre-census) run bare so the
# gate still guards — it will list every violation.
IGNORE_KNOWN=()
[ -f .dependency-cruiser-known-violations.json ] && IGNORE_KNOWN=(--ignore-known)
bun node_modules/.bin/depcruise --config .dependency-cruiser.cjs "${IGNORE_KNOWN[@]}" \
  --output-type err packages/frontend/src packages/fight/src packages/party/src packages/inventory/src packages/world/src
