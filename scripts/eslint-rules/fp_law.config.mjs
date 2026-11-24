// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// scripts/eslint-rules/fp_law.config.mjs — THE FP-LAW LAYER (AGENTS.md).
//
// Importable flat-config layer, spread into eslint.config.js after the base blocks. Severity design
// (census 2026-07-17, 7559 findings measured before wiring): ERROR where the repo is already clean
// (a free ratchet), WARN where violations are mass (a burn-down, not an unrunnable red gate).
// Every rule id maps to a row in AGENTS.md; the census + ranked worklist live in the
// FP_LAW lane report.
//
// Tiers:
//   T1 base      — every linted .js/.ts file: naming, no-classes, size/complexity ceilings, ratchets
//   T2 product   — packages/**: the mutation family + module-load purity
//   T4 engine    — perf-sacred mutable core (Three.js scene graph, voxel hot paths): mutation family off
//   T5 tests     — tests/benches/e2e choreograph state by design: mutation family + purity off
import functional from 'eslint-plugin-functional'
import sonarjs from 'eslint-plugin-sonarjs'

import fp_law from './fp_law.mjs'

// Files that held a function above the 15/12 complexity ceilings when the stock rules replaced the
// baseline (2026-11-23). A file leaves this list when its hotspots are reduced; no file is ever added:
// a new hotspot is fixed, not listed. scripts/test/lint_rules.test.mjs enforces both directions.
export const INHERITED_COMPLEXITY_FILES = Object.freeze([
  'packages/engine/src/entities.ts',
  'packages/engine/src/far_worker.ts',
  'packages/engine/src/fight_blobs.ts',
  'packages/engine/src/fight_board.ts',
  'packages/engine/src/fight_board_surface.ts',
  'packages/engine/src/fight_presentation.ts',
  'packages/engine/src/frame_renderer.ts',
  'packages/engine/src/greedy_mesher.ts',
  'packages/engine/src/locomotion/collision.ts',
  'packages/engine/src/locomotion/controller.ts',
  'packages/engine/src/scatter.ts',
  'packages/engine/src/sky/night_sky.ts',
  'packages/engine/src/voxel_data.ts',
  'packages/engine/src/webgpu_backend.ts',
  'packages/engine/src/world_recipe.ts',
  'packages/fight/src/board_gen.ts',
  'packages/fight/src/combat_grid.ts',
  'packages/fight/src/commands.ts',
  'packages/fight/src/damage.ts',
  'packages/fight/src/effects.ts',
  'packages/fight/src/fight.ts',
  'packages/fight/src/movement.ts',
  'packages/fight/src/normalize.ts',
  'packages/fight/src/turns.ts',
  'packages/frontend/src/PlayerRuntime.tsx',
  'packages/frontend/src/components/DungeonLobby.tsx',
  'packages/frontend/src/components/FightPrompt.tsx',
  'packages/frontend/src/components/SearchPickerModal.tsx',
  'packages/frontend/src/components/SendSuiModal.tsx',
  'packages/frontend/src/components/SpawnNametag.tsx',
  'packages/frontend/src/demo/BoardGallery.tsx',
  'packages/frontend/src/editor/BiomePage.tsx',
  'packages/frontend/src/editor/ContentPage.tsx',
  'packages/frontend/src/editor/ItemReferencePicker.tsx',
  'packages/frontend/src/editor/JsonEditor.tsx',
  'packages/frontend/src/editor/MobContentEditor.tsx',
  'packages/frontend/src/editor/MobReferencePicker.tsx',
  'packages/frontend/src/editor/board_editor.ts',
  'packages/frontend/src/editor/mob_power.ts',
  'packages/frontend/src/editor/seed_editor.ts',
  'packages/frontend/src/encyclopedia/SpellCardEffects.tsx',
  'packages/frontend/src/env.ts',
  'packages/frontend/src/game/core/cameras.ts',
  'packages/frontend/src/game/core/pet_follow.ts',
  'packages/frontend/src/game/core/settings.ts',
  'packages/frontend/src/game/core/world.ts',
  'packages/frontend/src/game/fight/FightHud.tsx',
  'packages/frontend/src/game/fight/FightLayer.tsx',
  'packages/frontend/src/game/fight/FightResultCard.tsx',
  'packages/frontend/src/game/fight/fight_chat_lines.ts',
  'packages/frontend/src/game/fight/fight_cues.ts',
  'packages/frontend/src/game/fight/fight_overlays.ts',
  'packages/frontend/src/game/fight/fight_projection.ts',
  'packages/frontend/src/game/hud/CompassStrip.tsx',
  'packages/frontend/src/game/hud/compass_math.ts',
  'packages/frontend/src/game/presence_entities.ts',
  'packages/frontend/src/game/spawn_entities.ts',
  'packages/frontend/src/modules/dungeon.ts',
  'packages/frontend/src/modules/editor.ts',
  'packages/frontend/src/modules/engine.ts',
  'packages/frontend/src/modules/fight.ts',
  'packages/frontend/src/modules/fight_chain.ts',
  'packages/frontend/src/modules/fight_observer.ts',
  'packages/frontend/src/modules/fight_result.ts',
  'packages/frontend/src/modules/session.ts',
  'packages/frontend/src/modules/simulator.ts',
  'packages/frontend/src/modules/world.ts',
  'packages/frontend/src/modules/world_gather.ts',
  'packages/protocol/src/packets.ts',
  'packages/protocol/src/request_limiter.ts',
  'packages/sdk/src/client.ts',
  'packages/sdk/src/marketplace.ts',
  'packages/sdk/src/ptb.ts',
  'packages/sdk/src/seed_admin.ts',
  'packages/server/src/modules/player_world.ts',
  'scripts/eslint-rules/no_silent_failures.mjs',
  'scripts/eslint-rules/one_pipeline.mjs',
  'scripts/validate_seed.mjs',
])

// Module-load effect edges: entry files, workers (a worker IS its thread's entry), demos, benches,
// dev/build tooling, CLI scripts. Everything else must be pure to import (L-P3).
const EFFECT_EDGES = [
  '/main.',
  '_main.',
  '_worker.',
  '/demo/',
  '/bench/',
  '/dev/',
  '/e2e/',
  '/scripts/',
  'vite.config',
  'generate-config',
  'packages/server/src/index.', // the server's boot edge — Bun.serve + the cluster heartbeat
]

const mutation_family_off = {
  'fp-law/no-mutating-methods': 'off',
  'no-param-reassign': 'off',
  'functional/no-let': 'off',
  'functional/no-this-expressions': 'off',
}

export default [
  {
    // T1 — the base FP tier
    files: ['**/*.{js,jsx,ts,tsx,mjs,cjs}'],
    plugins: { functional, 'fp-law': fp_law, sonarjs },
    rules: {
      // ratchets — measured CLEAN repo-wide on 2026-07-17, never let them regress
      eqeqeq: ['error', 'smart'], // L-P2: sound equality keeps referential reasoning honest
      'prefer-arrow-callback': 'error', // L-C2: callbacks are lambdas, not `function` machinery
      // burn-downs
      'fp-law/snake-case': 'warn', // L-N1
      'functional/no-classes': [
        'warn', // L-F1 — three sanctioned platform seams, everything else is a factory/closure
        {
          ignoreIdentifierPattern: ['ErrorBoundary$'], // React has no functional componentDidCatch
          ignoreCodePattern: ['extends\\s+Error\\b', 'extends\\s+PhysicalLightingModel\\b'],
        },
      ],
      'sonarjs/cognitive-complexity': ['error', 15], // L-C3 hard ceiling; prefer ≤10
      complexity: ['error', 12], // L-C3 hard cyclomatic ceiling; prefer ≤8
      'max-depth': ['error', 4], // L-C3 hard ceiling; ordinary code stays at ≤3
      'max-lines': ['warn', { max: 600 }], // house law: files ≤600 LoC (AGENTS.md L-C3)
    },
  },
  {
    files: [...INHERITED_COMPLEXITY_FILES],
    rules: { 'sonarjs/cognitive-complexity': 'off', complexity: 'off' },
  },
  {
    // T2 — product code: the mutation family + module-load purity
    files: ['packages/**/*.{js,jsx,ts,tsx,mjs,cjs}'],
    rules: {
      'fp-law/no-mutating-methods': 'warn', // L-I1/L-I2
      'no-param-reassign': ['warn', { props: true }], // L-I2: the caller's value is not yours
      'functional/no-let': ['warn', { allowInFunctions: true, allowInForLoopInit: true }], // L-I4: no mutable module bindings
      'functional/no-this-expressions': 'warn', // L-F1's other half
      'fp-law/no-module-scope-effects': ['warn', { allow: EFFECT_EDGES }], // L-P3
    },
  },
  {
    // T4 — the engine is a perf-sacred mutable core: scene graphs and voxel hot paths mutate by
    // design (measured: 2590 loop / 242 param-mutation sites). The law stops at this boundary;
    // naming, classes, size and complexity (T1) still apply.
    files: ['packages/engine/**'],
    rules: mutation_family_off,
  },
  {
    files: ['packages/engine/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['three', 'three/webgpu'].map((name) => ({
            name,
            importNames: ['DynamicDrawUsage'],
            message:
              'WebGPU forces an upload on every render for DynamicDrawUsage. Use explicit needsUpdate/version changes and update ranges.',
          })),
        },
      ],
    },
  },
  {
    // T5 — tests/benches choreograph state and fixtures by design (LAST: wins over T2)
    files: ['**/*.test.*', '**/*.spec.*', '**/e2e/**', '**/bench/**'],
    rules: {
      ...mutation_family_off,
      'fp-law/no-module-scope-effects': 'off',
    },
  },
]
