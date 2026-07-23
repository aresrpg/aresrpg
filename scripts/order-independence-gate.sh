#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# order-independence-gate.sh — THE TOOTH for the module-global test-flake CLASS.
#
# bun test runs every file of a suite in ONE process, so module-global state (asset caches, dedup
# registries, warmed manifests, durability probes) survives from file to file. A seam warmed by one suite
# used to defeat a later suite's cold-state fixture — an order-dependent flake that passed in isolation and
# reddened only in a combined run. Each such seam now carries ONE exported test-reset hook, called by its
# consumer suites (never per-test monkey-patching). This gate re-runs the exact COMBINATIONS that reproduced
# the order-dependence, so a regression — a dropped reset call, a re-warmed global, a new unreset seam — reds
# HERE instead of intermittently flaking a full-suite sweep.
#
# Each combination runs as its OWN bun process: module state must not carry between combinations, or one
# combination's reset could mask another's regression. Do NOT "fix" a red here by reordering files — that
# hides the leak. Fix the seam (add/-call its reset hook). Green = every combination's fixtures held cold.
set -uo pipefail

cd "$(dirname "$0")/.."
FE=packages/frontend/src
FAIL=0

run_combo() {
  local label="$1"
  shift
  echo "── $label ──"
  if bun test "$@"; then
    echo "  ✓ $label"
  else
    echo "  ✗ $label — ORDER-DEPENDENCE REGRESSED: a module-global seam leaked across files."
    FAIL=1
  fi
}

# ①-④ The Walrus asset resolver (packages/sdk/src/jobs.js `walrus_assets`). components/item_hover_tooltip
# loads the REAL public/asset_manifest.json, warming the `spell_corpus` + `icon_slug_map` classes for the
# rest of the process; the game/data loaders' "absent blob → null → loud degrade" fixtures must stay cold.
# Guards reset_walrus_assets_for_test() staying wired into spell_corpus / icon_slug_map / pet_catalog.
run_combo "walrus asset resolver — absent-blob loaders vs the warmed manifest" \
  packages/fight/ "$FE/game/data/" "$FE/components/"

# ⑥ The lootbox executed-failure durability probe reads globalThis.localStorage; an earlier file's inert
# stub (setItem no-op, getItem → null) makes the read-back mismatch and silently downgrades latch_durability
# to 'unconfirmed', emptying sweep_eligible_claims. Guards the durability-sensitive describes pinning a
# functional localStorage.
run_combo "lootbox executed-failure durability — the hud suite" \
  "$FE/game/screens/hud/"

# ⑧⑨ ambient_music.js's stream state (user_muted / started / current_biome / combat). A prior file that
# armed a zone, entered combat or muted leaks that state, so the lifecycle suite's set_zone_music starts
# zero streams. Guards reset_ambient_music_for_test() staying wired into the lifecycle beforeEach.
run_combo "ambient music stream lifecycle — the game suite" \
  "$FE/game/"

# ⑩⑪ Bun's mock.module registry is process-global and has no unmock operation. The crush menu suite used to
# replace the whole crush_actions module, so the action suite later exercised that fake and lost timing.digest.
# world_checkpoint also replaced @aresrpg/sdk/game with a partial export set, making the real action module
# unloadable once the menu stopped masking it. Both suites now use per-test injected mocks/spies with lifecycle
# cleanup; these exact pairs pin the two shared-process regressions from #569.
run_combo "crush action seam — menu and action suites share no module replacement" \
  "$FE/components/crush_menu.test.tsx" "$FE/world-shell/crush_actions.test.js"
run_combo "crush SDK exports — checkpoint and action suites share the real module" \
  "$FE/world-shell/world_checkpoint.test.js" "$FE/world-shell/crush_actions.test.js"

if [ "$FAIL" -ne 0 ]; then
  echo "ORDER-INDEPENDENCE GATE FAILED — a reintroduced module-global leak broke a cold-state fixture."
  exit 1
fi
echo "ORDER-INDEPENDENCE GATE PASSED."
