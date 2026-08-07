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
ROOT="$PWD"
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

# ①-④ The asset resolver (packages/sdk/src/jobs.js `assets_config`). components/item_hover_tooltip
# loads the REAL public/asset_manifest.json, warming the `spell_corpus` + `icon_slug_map` classes for the
# rest of the process; the game/data loaders' "absent blob → null → loud degrade" fixtures must stay cold.
# Guards reset_assets_for_test() staying wired into spell_corpus / icon_slug_map / pet_catalog.
run_combo "asset resolver — absent-blob loaders vs the warmed manifest" \
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

# ⑫ Shared frontend atoms: the weapon-lines suite opens a fight session before the simulator hand consumer,
# while the room transport suite begins from the presence atom's cold link state. Guards both consumers
# resetting BEFORE use; the reverse scheduling is the exact pair that reddened train T2 before the
# weapon-lines guard.
run_combo "fight + presence atoms — consumers self-reset behind a warmed session" \
  "$FE/world-shell/dungeon_fight_weapon_lines.test.js" \
  "$FE/simulator/fight_open_hand.test.js" \
  "packages/frontend/test/p2p/lobby-room.test.js"

# ⑬ react-i18next's module namespace. `spyOn(react_i18next, 'useTranslation')` mutates the PROCESS-GLOBAL
# module record, and WorldTravelModal's stub returns `{ t }` with no `i18n` — so every file loaded after an
# UNRESTORED spy dies on `i18n.resolvedLanguage` (classes_tab.tsx:130). Whether that happened depended purely
# on readdir order (macOS green, CI 16 reds). Guards WorldTravelModal.test.jsx's afterAll mockRestore: drop it
# and this pair reds instantly.
# ABSOLUTE paths on purpose: bun honours ARG order only for absolute paths — relative args are treated as
# filters over a directory scan, so the run order falls back to readdir (the exact nondeterminism this row
# exists to pin). A relative-path version of this row passes even with the restore deleted.
run_combo "react-i18next namespace spy — the travel modal restores what it replaced" \
  "$ROOT/$FE/game/screens/hud/world/WorldTravelModal.test.jsx" \
  "$ROOT/packages/frontend/test/tooltip-crit-rate.test.tsx"

# ⑭ The app-wide `use_dungeon` fight session. `create_fight_shim().start()` (src/simulator/fight_shim.js) sets
# `fight_id` on the singleton and its `dispose()` never clears it — it tears down the fight CORE only. A simulator
# suite that ran first therefore handed fight_entry a non-null prev_fight_id, so `entry_transition` read a fight
# SWAP instead of a fresh create and no cinematic fired. Guards fight_entry.test.js's RESET-BEFORE-USE beforeEach
# (the convention written in test_helpers/fight_core_harness.js); drop it and this pair reds instantly.
run_combo "dungeon fight session — the entry cinematic resets before use, behind a warmed sim fight" \
  "$ROOT/$FE/simulator/fight_terminal_gate.test.js" \
  "$ROOT/$FE/game/fight_entry.test.js"

# ⑮ Bun's `mock.module` registry again (⑩⑪'s class, two more modules). A PARTIAL replacement of game/store.js
# (day_cycle, HackRadioPlayer) and of @aresrpg/engine3/player (pet_companion_locomotion) made those modules
# unloadable for every file bun loaded afterwards — the #1993 board suite died on a missing `useFightVisibleMount`
# and a missing `topmost_solid_id`, hundreds of files later. There is no unmock, so a permanent replacement must
# (a) SPREAD a pre-registration SNAPSHOT of the real module so no export can go missing, and (b) stop lying once
# its own file is done (the `owned` flag flips in afterAll and the override delegates to the real export). This
# row runs all three poisoners ahead of the victim; drop either half of either rule and it reds.
run_combo "mock.module partial replacement — game/store.js stays whole and honest for later files" \
  "$ROOT/$FE/game/screens/hud/world/day_cycle.test.js" \
  "$ROOT/$FE/game/screens/hud/world/HackRadioPlayer.test.jsx" \
  "$ROOT/packages/frontend/test/game/screens/hud/world/dungeon_board_turn_arming.test.jsx"
# The engine3/player half needs its own pair: pet_companion's partial replacement only bites once ANOTHER file
# has pulled the real character_controller graph in (embed_voxel_dev is the first that does), which is why the
# poisoner looked innocent one-on-one and reddened 145 files later.
run_combo "mock.module partial replacement — @aresrpg/engine3/player keeps its full export surface" \
  "$ROOT/packages/frontend/test/game/pet_companion_locomotion.test.js" \
  "$ROOT/packages/frontend/test/game/embed_voxel_dev.world_fight_roster.test.js" \
  "$ROOT/packages/frontend/test/game/screens/hud/world/dungeon_board_turn_arming.test.jsx"

if [ "$FAIL" -ne 0 ]; then
  echo "ORDER-INDEPENDENCE GATE FAILED — a reintroduced module-global leak broke a cold-state fixture."
  exit 1
fi
echo "ORDER-INDEPENDENCE GATE PASSED."
