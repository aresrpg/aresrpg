// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// .dependency-cruiser.cjs — the IMPORT-GRAPH constitution (docs/CODE_LAW.md "Arch gates").
// Run via scripts/depcruise-gate.sh (ratchet: .dependency-cruiser-known-violations.json is empty after
// issue #95's burn-down; --ignore-known therefore allows ZERO cycles and anything new is red).
//
// Rule 1 generalizes `ares test fightcore` gate a (scripts/fight-core-gates.mjs): the hand-rolled
// gate is a DENYLIST over regex-extracted import specifiers; this is the same law as a resolved
// ALLOWLIST — the fight core may import itself, the named generic helpers (ground truth censused
// 2026-07-17 from fight/*.js imports), and sim/sdk/zustand. A new import of ANYTHING else —
// context stores, adapters, random utilities — is a deliberate decision, not a drive-by.
module.exports = {
  forbidden: [
    {
      name: 'fight-core-hermetic',
      comment:
        'L-P4 / @aresrpg/fight index.js header law (M1a promotion 2026-07-17): the ONE generic ' +
        'headless fight core imports ONLY itself, @aresrpg/sim, @aresrpg/sdk and zustand/vanilla — ' +
        'the pre-M1a generic-helper exemption list is ZERO (those helpers live inside the package ' +
        'now). NEVER a frontend module, a context store/shim, React, three, or the engine.',
      severity: 'error',
      from: { path: '^packages/fight/src/' },
      to: {
        pathNot: [
          '^packages/fight/src/',
          // workspace symlinks resolve to real paths (packages/sdk/…), plain deps stay under
          // node_modules — allow @aresrpg/sdk, @aresrpg/sim and zustand in BOTH forms
          'node_modules/(zustand|@aresrpg/(sdk|sim))(/|$)',
          '^packages/(sdk|sim)/',
        ],
      },
    },
    {
      name: 'party-core-hermetic',
      comment:
        'M2 rung: @aresrpg/party is a hermetic headless core — its import ' +
        'graph is itself + zustand/vanilla, nothing else (no React, no DOM, no three, no frontend, ' +
        'no engine). Twin of the in-package hermetic.test.js, enforced on the resolved graph.',
      severity: 'error',
      from: { path: '^packages/party/src' },
      to: { pathNot: ['^packages/party/src', 'node_modules/zustand(/|$)'] },
    },
    {
      name: 'inventory-core-hermetic',
      comment:
        'M2 rung: @aresrpg/inventory is a hermetic headless core — its ' +
        'import graph is itself + @aresrpg/sdk, nothing else. Twin of the in-package ' +
        'hermetic.test.js, enforced on the resolved graph.',
      severity: 'error',
      from: { path: '^packages/inventory/src' },
      to: { pathNot: ['^packages/inventory/src', 'node_modules/@aresrpg/sdk(/|$)', '^packages/sdk/'] },
    },
    {
      name: 'world-core-hermetic',
      comment:
        'D770a (W1 promotion 2026-07-18): the headless world core (session_gate / spawns_zones / ' +
        'presence atoms) imports ONLY itself, @aresrpg/sdk and zustand/vanilla. Cross-domain facts ' +
        'arrive as typed inputs ferried by the composition root — NEVER a frontend module, a context ' +
        'store/shim, React, three, or the engine.',
      severity: 'error',
      from: { path: '^packages/world/src/' },
      to: {
        pathNot: ['^packages/world/src/', 'node_modules/(zustand|@aresrpg/sdk)(/|$)', '^packages/sdk/'],
      },
    },
    {
      name: 'engine-quarantine',
      comment:
        'HOUSE law (CLAUDE.md: the dApp is a renderer of chain truth): the voxel engine ' +
        '(@aresrpg/engine3) mounts only inside the 3D shells — game/ and world-shell/ (census ' +
        '2026-07-17: every live import site sits there). fight/, stores/, pages/, components/, ' +
        'auth/… must stay engine-free.',
      severity: 'error',
      from: {
        path: '^packages/frontend/src/',
        pathNot: '^packages/frontend/src/(game|world-shell)/',
      },
      to: { path: 'node_modules/@aresrpg/engine3(/|$)|^packages/engine/' },
    },
    {
      name: 'presenter-beat-boundary',
      comment:
        'issue #281: a presentation beat must track an OBSERVED STATE DELTA, never an EVENT ARRIVAL. ' +
        'The receipt/foreign-object -> wave beat EMITTERS (fight_render_events = produce_receipt_render_turns, ' +
        'fight_predicted_render = produce_predicted_render_events) are reachable ONLY through the presenter ' +
        'seam: present.js (the pacing the store fold funnels every receipt/object-diff through) and ' +
        'predict_cast.js (my own local-cast prediction). An arbitrary consumer — a store, page, component, ' +
        'hook, adapter, or context — importing an emitter would build a wave straight off an arrival, ' +
        'bypassing the delta-observing dedupe (wave_versions / foreign-replay diff) that keeps a kill from ' +
        'dying twice. Read the paced beats off the store wave, or the curated builders in present.js, instead.',
      severity: 'error',
      from: {
        path: '^packages/(frontend|fight|party|inventory|world)/src/',
        pathNot: '^packages/fight/src/(present|predict_cast|fight_render_events)\\.js$',
      },
      to: { path: '^packages/fight/src/(fight_render_events|fight_predicted_render)\\.js$' },
    },
    {
      name: 'no-circular',
      comment:
        'L-C1 (composition is associative only on a DAG): no module-level import cycles inside ' +
        'packages/frontend/src or the promoted domain cores (fight, party, inventory, world). ' +
        '.dependency-cruiser-known-violations.json is empty after issue #95; any cycle is red.',
      severity: 'error',
      from: { path: '^packages/(frontend|fight|party|inventory|world)/src/' },
      to: { circular: true },
    },
  ],
  options: {
    // Workspace deps are opaque leaves like node_modules: their edges are recorded (rules above
    // match them) but their internals are not traversed — sibling packages police themselves.
    doNotFollow: { path: ['node_modules', '^packages/(sdk|sim|engine)/'] },
    exclude: { path: ['\\.test\\.[cm]?[jt]sx?$', '/test_helpers/', '\\.d\\.ts$'] },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'default'],
    },
    moduleSystems: ['es6', 'cjs'],
    tsPreCompilationDeps: true,
  },
}
