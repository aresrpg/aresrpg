// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// zero-drift-gate.mjs — THE FIGHT-PATH IDENTITY GATE (issue #914, owner law).
//
// "The simulator IS the fight engine running on mocked, seeded chain receipts — every other line of the fight
// path (fold, ingest, statuses, spell resolution, board projection, HUD composition) is THE SAME MODULES,
// imported, never copied. Any second implementation of any fight fact inside the simulator composition is a
// defect regardless of whether it currently agrees."
//
// The dependency-cruiser rules (.dependency-cruiser.cjs: `simulator-consumes-shared-only` /
// `simulator-no-reverse-leak`) fence WHICH DIRECTORIES the simulator may import from. They cannot express the
// law above, because it is not a property of one edge: it is a SET DIFFERENCE between two composition
// closures. That is this gate. It resolves both fight compositions from their roots — the world's and the
// simulator's — and asserts the difference is exactly the enumerated, classified manifest below. A module that
// enters one path and not the other reds the commit it appears in.
//
// ── THE THREE TEETH ─────────────────────────────────────────────────────────────────────────────────────────
//   1. FORK GUARD (hard, unmanifestable). The ONE sanctioned divergence is the receipt source. So inside
//      `packages/fight/src/**` — the headless core that owns every fight fact — the only modules the simulator
//      may reach that the world does not are the mock chain door (`sim_chain.js` + `sim_chain_events.js`).
//      Anything else there is a FORK of the core along the simulator's path and cannot be waved through with a
//      manifest row; the fix is to make both compositions import the same module.
//   2. SIM-ONLY RATCHET (exact set). Every other module the simulator's fight path reaches and the world's does
//      not is enumerated below with its class. A new row is a deliberate, reviewed decision; a vanished row
//      shrinks the manifest in the same commit that shrinks the divergence.
//   3. WORLD-ONLY RATCHET (exact set). The mirror: fight machinery the world mounts and the simulator does not.
//      It is ONE row — the chain entry — and it must stay one. This is the tooth that would have caught the
//      board fork: before #915 the simulator painted its own setup scene through a running fight and this list
//      held fifteen rows (the whole voxel_fight_adapter closure: vfx, sfx, the render queue, the seat rigs).
//
// Run: `bun scripts/zero-drift-gate.mjs` (wired into scripts/check-constraints.sh, so `bun run lint` and CI).
//      `bun scripts/zero-drift-gate.mjs --print` re-prints both live sets in manifest form after a deliberate
//      change, so a reviewed ratchet move is a paste, not a transcription.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repo_root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(repo_root)

// ── THE TWO COMPOSITION ROOTS ───────────────────────────────────────────────────────────────────────────────
// Roots are the ENTRY MODULES of each fight path, not its page shell: the page around a fight (the world's
// tabs, the simulator's roster editor) is not the fight, and dragging it in would drown the signal. Each list
// is the complete set of modules a fight is opened, folded, decided and drawn through on its side.

/** The world's fight: the chain entry, the receipt→core door, the run/dungeon stores, the 3D board, the HUD
 *  siblings GameWorldHud mounts inside `fight_layer_class` — `SpellBar` among them since #916 gave it a file
 *  (GameWorldHud.jsx:313,333). It is a root on BOTH sides now, exactly as this gate boarded it: the eight
 *  modules it reaches are shared, not sim-only, so the manifests below do not move. */
const WORLD_FIGHT_ROOTS = [
  'packages/frontend/src/world-shell/world_fight.js',
  'packages/frontend/src/world-shell/dungeon_fight_shim.js',
  'packages/frontend/src/world-shell/dungeon_run_store.js',
  'packages/frontend/src/world-shell/dungeon_store.js',
  'packages/frontend/src/world-shell/voxel_fight_adapter.js',
  'packages/frontend/src/game/screens/hud/world/DungeonBoard.jsx',
  'packages/frontend/src/game/screens/hud/FightPlacementBanner.jsx',
  'packages/frontend/src/game/screens/hud/TurnBanner.jsx',
  'packages/frontend/src/game/screens/hud/FightTimeline.jsx',
  'packages/frontend/src/game/screens/hud/EntityTooltip.jsx',
  'packages/frontend/src/game/screens/hud/FightResult.jsx',
  'packages/frontend/src/game/screens/hud/FightSummary.jsx',
  'packages/frontend/src/game/screens/hud/SpellBar.jsx',
]

/** The simulator's fight: the local-chain shim (the mock door), the start fold, the HUD binding, and the board
 *  viewport — which does not RENDER the fight, it hands its board handle to the world's adapter (mount.js
 *  `arm_fight`), so the adapter's whole closure is reached from here exactly as it is from the world. */
const SIM_FIGHT_ROOTS = [
  'packages/frontend/src/simulator/fight_shim.js',
  'packages/frontend/src/simulator/fight_start.js',
  'packages/frontend/src/simulator/FightHud.jsx',
  'packages/frontend/src/simulator/BoardPane.tsx',
  'packages/frontend/src/simulator/board_paint.ts',
  'packages/frontend/src/simulator/mount.js',
]

// ── TOOTH 1: the ONE door ───────────────────────────────────────────────────────────────────────────────────
/** The sanctioned mock: `create_sim_chain` and the receipt rows it emits. The whole law reduces to this list
 *  having exactly two entries — a third file here means the fight core grew a second simulator-only home. */
const SANCTIONED_MOCK_DOOR = ['packages/fight/src/sim_chain.js', 'packages/fight/src/sim_chain_events.js']

// ── TOOTH 2: the sim-only manifest ──────────────────────────────────────────────────────────────────────────
// Class legend:
//   MOCK      the sanctioned receipt source (tooth 1).
//   MOCK-MATH a shared @aresrpg/sim|sdk module that the CHAIN runs for the world and the mock must run locally.
//             The same module, on the local side of the one door — never a copy.
//   SETUP     the pre-fight roster/board editor. The world's equivalent of "setup" is the chain itself (you
//             build a character by playing), so these have no world twin BY CONSTRUCTION, not by divergence.
//   CORPUS    the published-content door (pages/encyclopedia + the shared entity/item cards it renders).
//             Where the world reads an owned chain object, the simulator reads the published template.
//   BOARD     the SETUP board viewport, and the seam that hands that same board handle to the world's adapter
//             when a fight opens (mount.js `arm_fight`). Not a second renderer: the adapter's entire closure
//             is shared, which is what the empty L4 class in WORLD_ONLY below proves.
//   LAYER     the simulator page's own placement CSS. It is a PAGE, not the world tab, so where the layer
//             sits is its own; every `.hud-*` rule inside it is the world's, imported.
//   SHARED    a shared home the world reaches through a root outside this gate's fight-path roots (the page
//             shell, the engine boot, GameWorldHud's own stylesheets). Not a divergence; a consequence of
//             rooting on the fight, not the page.
const SIM_ONLY = [
  ['packages/fight/src/sim_chain.js', 'MOCK'],
  ['packages/fight/src/sim_chain_events.js', 'MOCK'],

  ['packages/sim/src/board_gen.js', 'MOCK-MATH'],
  ['packages/sim/src/equipment_stats.js', 'MOCK-MATH'],
  ['packages/sim/src/mob_stats.js', 'MOCK-MATH'],
  ['packages/sim/src/recorder.js', 'MOCK-MATH'],
  ['packages/sim/src/world.js', 'MOCK-MATH'],
  ['packages/sdk/src/classes.json', 'MOCK-MATH'],

  ['packages/frontend/src/simulator/board.ts', 'SETUP'],
  ['packages/frontend/src/simulator/content.js', 'SETUP'],
  ['packages/frontend/src/simulator/fight_setup.js', 'SETUP'],
  ['packages/frontend/src/simulator/fight_shim.js', 'SETUP'],
  ['packages/frontend/src/simulator/fight_start.js', 'SETUP'],
  ['packages/frontend/src/simulator/persistence.ts', 'SETUP'],
  ['packages/frontend/src/simulator/reducer.ts', 'SETUP'],
  ['packages/frontend/src/simulator/store.ts', 'SETUP'],
  ['packages/frontend/src/simulator/trace_export.js', 'SETUP'],
  ['packages/frontend/src/simulator/CharacterPicker.tsx', 'SETUP'],
  ['packages/frontend/src/simulator/CharacterRow.tsx', 'SETUP'],
  ['packages/frontend/src/simulator/MobModal.tsx', 'SETUP'],
  ['packages/frontend/src/simulator/MobPicker.tsx', 'SETUP'],
  ['packages/frontend/src/game/screens/hud/simulator-equip.js', 'SETUP'],
  ['packages/frontend/src/data/jobs.json', 'SETUP'],

  ['packages/frontend/src/components/entity_display.tsx', 'CORPUS'],
  ['packages/frontend/src/components/entity_tooltip.tsx', 'CORPUS'],
  ['packages/frontend/src/components/mob_detail_view.tsx', 'CORPUS'],
  ['packages/frontend/src/components/modal_frame.tsx', 'CORPUS'],
  ['packages/frontend/src/components/search_picker_modal.tsx', 'CORPUS'],
  ['packages/frontend/src/pages/encyclopedia/encyclopedia_assets.ts', 'CORPUS'],
  ['packages/frontend/src/pages/encyclopedia/mob_image.tsx', 'CORPUS'],
  ['packages/frontend/src/pages/encyclopedia/mob_spells.ts', 'CORPUS'],
  ['packages/frontend/src/pages/encyclopedia/mob_spells_section.tsx', 'CORPUS'],
  ['packages/frontend/src/pages/encyclopedia/world_corpus.ts', 'CORPUS'],

  ['packages/frontend/src/simulator/BoardPane.tsx', 'BOARD'],
  ['packages/frontend/src/simulator/board_paint.ts', 'BOARD'],
  ['packages/frontend/src/simulator/mount.js', 'BOARD'],
  ['packages/engine/src/engine.js', 'BOARD'],

  ['packages/frontend/src/simulator/fight-hud.css', 'LAYER'],

  ['packages/frontend/src/simulator/FightHud.jsx', 'SHARED'],
  ['packages/frontend/src/game/screens/hud/mobile_layout.js', 'SHARED'],
  ['packages/frontend/src/game/screens/hud/world/quality_pref.js', 'SHARED'],
  ['packages/frontend/src/game/screens/hud/CharacterPortrait.jsx', 'SHARED'],
  ['packages/frontend/src/game/screens/sprite-preview.js', 'SHARED'],
  ['packages/frontend/src/game/screens/hud/hud.css', 'SHARED'],
  ['packages/frontend/src/game/screens/hud/mobile-fight-hud.css', 'SHARED'],
  ['packages/frontend/src/game/screens/hud/world/game-world-hud.css', 'SHARED'],
]

// ── TOOTH 3: the world-only manifest ────────────────────────────────────────────────────────────────────────
// ONE ROW. Post-#915 the simulator mounts the world's own board adapter over the same board handle, so every
// module the world's fight is drawn, paced and sounded through is on the simulator's path too. What is left is
// the receipt source itself — which is the whole of issue #914's law, stated as a set:
//
//   world fight path  \  simulator fight path  =  { the chain entry }
//
// Class legend:
//   CHAIN  the tx/read leg the mock replaces (create/join/engage on chain). The one legal divergence, mirrored
//          on this side of the diff by the MOCK rows above.
//
// A NEW row here is fight code the simulator will never run — a second fight-presentation path opening, which
// is how the pre-#915 board fork started. It is red on purpose, and the fix is to mount the same module.
const WORLD_ONLY = [['packages/frontend/src/world-shell/world_fight.js', 'CHAIN']]

// ── the walk ────────────────────────────────────────────────────────────────────────────────────────────────
// Resolved imports, not grep: enhanced-resolve with the repo's own `exports` conditions and
// tsPreCompilationDeps, so a re-export chain, a workspace symlink or a `.tsx` type-only edge cannot launder a
// divergence past it. Options mirror .dependency-cruiser.cjs — one home for the resolve contract.
const CRUISE_OPTIONS = {
  doNotFollow: { path: ['node_modules', '^packages/(sdk|sim|engine)/'] },
  exclude: { path: ['\\.test\\.[cm]?[jt]sx?$', '/test_helpers/', '\\.d\\.ts$'] },
  enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'default'] },
  moduleSystems: ['es6', 'cjs'],
  tsPreCompilationDeps: true,
  validate: false,
}

const red = (line) => console.log(`[31m${line}[0m`)
const grn = (line) => console.log(`[32m${line}[0m`)

/**
 * Every module reachable from `roots`, node_modules leaves dropped (third-party breadth is not a fight fact),
 * plus every import along the way that DID NOT RESOLVE.
 *
 * Unresolvable edges are collected, never skipped: an import that resolves to nothing is invisible to a set
 * difference — it would shrink a closure and paint the gate green over a path that throws at module load. That
 * is not hypothetical here (issue #802's walk caught exactly this shape in `fight_shim.js`), and it is how this
 * gate's own red-proof first slipped through.
 */
const closure = (modules, roots) => {
  const by_source = new Map(modules.map((module) => [module.source, module]))
  const seen = new Set()
  const unresolved = []
  const stack = [...roots]
  while (stack.length) {
    const current = stack.pop()
    if (seen.has(current)) continue
    seen.add(current)
    for (const dep of by_source.get(current)?.dependencies ?? []) {
      if (dep.coreModule) continue
      if (dep.couldNotResolve) unresolved.push(`${current} → ${dep.module}`)
      else stack.push(dep.resolved)
    }
  }
  return { set: new Set([...seen].filter((source) => !source.startsWith('node_modules'))), unresolved }
}

const cruise_module = await import('dependency-cruiser').catch(() => null)
if (!cruise_module) {
  console.log('== AresRPG zero-drift gate · world fight ≡ simulator fight (issue #914) ==')
  console.log('  SKIP: dependency-cruiser not installed (bun install)')
  process.exit(0)
}

console.log('== AresRPG zero-drift gate · world fight ≡ simulator fight (issue #914) ==')

// A root that no longer exists would silently shrink a closure and paint the gate green over a fight path that
// moved. Fail closed with the file named — the same discipline check-constraints.sh's collectors follow.
const missing_roots = [...WORLD_FIGHT_ROOTS, ...SIM_FIGHT_ROOTS].filter((root) => !fs.existsSync(root))
if (missing_roots.length) {
  red('  ✗ FAIL: composition root(s) gone — a fight path moved and this gate was not moved with it:')
  for (const root of missing_roots) red(`      ${root}`)
  red('    Re-point WORLD_FIGHT_ROOTS / SIM_FIGHT_ROOTS in scripts/zero-drift-gate.mjs.')
  process.exit(1)
}

const { output } = await cruise_module.cruise([...WORLD_FIGHT_ROOTS, ...SIM_FIGHT_ROOTS], CRUISE_OPTIONS)
const modules = output.modules ?? []

const { set: world, unresolved: world_unresolved } = closure(modules, WORLD_FIGHT_ROOTS)
const { set: sim, unresolved: sim_unresolved } = closure(modules, SIM_FIGHT_ROOTS)
const unresolved = [...new Set([...world_unresolved, ...sim_unresolved])].sort()
if (unresolved.length) {
  red(`  ✗ FAIL: ${unresolved.length} unresolvable import(s) on a fight path — the module would throw at load:`)
  for (const edge of unresolved) red(`      ${edge}`)
  process.exit(1)
}

const sim_only = [...sim].filter((source) => !world.has(source)).sort()
const world_only = [...world].filter((source) => !sim.has(source)).sort()

if (process.argv.includes('--print')) {
  const render = (rows, manifest) => {
    const classes = new Map(manifest)
    for (const source of rows) console.log(`  ['${source}', '${classes.get(source) ?? 'TODO-CLASSIFY'}'],`)
  }
  console.log(`\nSIM_ONLY (${sim_only.length}):`)
  render(sim_only, SIM_ONLY)
  console.log(`\nWORLD_ONLY (${world_only.length}):`)
  render(world_only, WORLD_ONLY)
  process.exit(0)
}

let failed = false
const diff_report = (label, live, manifest, hint) => {
  const declared = new Set(manifest.map(([source]) => source))
  const undeclared = live.filter((source) => !declared.has(source))
  const stale = [...declared].filter((source) => !live.includes(source)).sort()
  if (undeclared.length) {
    failed = true
    red(`  ✗ FAIL: ${undeclared.length} UNDECLARED ${label} module(s) — new fight-path divergence:`)
    for (const source of undeclared) red(`      ${source}`)
    red(`    ${hint}`)
  }
  if (stale.length) {
    failed = true
    red(`  ✗ FAIL: ${stale.length} STALE ${label} manifest row(s) — the divergence is gone, the row is not:`)
    for (const source of stale) red(`      ${source}`)
    red('    Delete them from scripts/zero-drift-gate.mjs (the ratchet only shrinks).')
  }
}

// TOOTH 1 — a fork of the headless fight core cannot be manifested away.
const core_forks = sim_only.filter(
  (source) => source.startsWith('packages/fight/src/') && !SANCTIONED_MOCK_DOOR.includes(source)
)
if (core_forks.length) {
  failed = true
  red(`  ✗ FAIL: ${core_forks.length} @aresrpg/fight module(s) on the simulator's fight path only —`)
  red('    the headless core is the SAME code on both sides; the ONE sanctioned divergence is the receipt')
  red(`    source (${SANCTIONED_MOCK_DOOR.join(' + ')}). Import the shared module on both paths.`)
  for (const source of core_forks) red(`      ${source}`)
}
const absent_door = SANCTIONED_MOCK_DOOR.filter((source) => !sim.has(source))
if (absent_door.length) {
  failed = true
  red('  ✗ FAIL: the sanctioned mock door is not on the simulator fight path — it moved, or a second one grew:')
  for (const source of absent_door) red(`      ${source}`)
}

// TOOTH 2 / TOOTH 3 — the enumerated ratchets.
diff_report(
  'SIM-ONLY',
  sim_only,
  SIM_ONLY,
  "Either import the world's module instead, or add a classified row to SIM_ONLY in this file."
)
diff_report(
  'WORLD-ONLY',
  world_only,
  WORLD_ONLY,
  'The simulator must mount the same fight machinery the world does; a new row here is fight code the' +
    ' simulator will never run.'
)

if (failed) {
  red('  ✗ zero-drift gate FAILED (issue #914: the only legal divergence is the receipt source)')
  process.exit(1)
}
grn(
  `  ✓ fight path identical: ${world.size} world · ${sim.size} simulator · ` +
    `${[...sim].filter((source) => world.has(source)).length} shared · ` +
    `${sim_only.length} sim-only + ${world_only.length} world-only, all enumerated`
)
