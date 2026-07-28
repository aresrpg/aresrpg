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
        'auth/… must stay engine-free. The local fight simulator (docs/design/' +
        'simulator_rebuild_spec.md §7) is the third sanctioned 3D shell, and it is admitted as ONE ' +
        'FILE, not a directory: simulator/mount.js owns the engine + tactical board composition and ' +
        'hands every other simulator module a handle, so the page, its reducer and its components ' +
        'stay engine-free exactly like the rest of src/.',
      severity: 'error',
      from: {
        path: '^packages/frontend/src/',
        pathNot: '^packages/frontend/src/(game|world-shell)/|^packages/frontend/src/simulator/mount\\.js$',
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
      name: 'fight-state-ingress-single-home',
      comment:
        'Issue #1336: raw fight events and chain Fight snapshots enter canonical state only through ' +
        'core_inbox.js. fight_render_events.js is the explicitly fenced presentation-only sibling seam; it ' +
        'may decode VFX rows but cannot write the fold.',
      severity: 'error',
      from: {
        path: '^packages/fight/src/',
        pathNot: '^packages/fight/src/(core_inbox|fight_render_events)\\.js$',
      },
      to: { path: '^packages/sdk/src/fight\\.js$' },
    },
    {
      name: 'simulator-consumes-shared-only',
      comment:
        'ZERO-DIVERGENCE law (owner ruling 2026-07-25): "everything we use in the simulator is the exact same ' +
        'generic code we use in the real world — we can NEVER have any divergence or adapted modules for ' +
        'display; the single only mocked system are the chain events for the simulator page". The /simulator ' +
        'page is a COMPOSITION over shared homes, so its import graph is an ALLOWLIST of them: itself, the ' +
        'workspace packages (@aresrpg/sdk|sim|fight|world|party|inventory|engine3 — the deterministic twins and ' +
        'the sanctioned sim_chain event mock), the shared frontend surfaces it mounts (game/, world-shell/, ' +
        'components/, fight-engine/, core/, utils/, i18n/) and the published world corpus (pages/encyclopedia/). ' +
        'EVERYTHING ELSE is red on purpose. auth/ tx/ chain/ rpc/ p2p/ roster/ stores/ are the sharp ones: the ' +
        'simulator is local by constitution (a fight there must be structurally unable to sign a transaction), ' +
        'so an import of the real chain/tx layer is either a live chain call on a local page or a ' +
        'simulator-local re-implementation of a world fact — both are the divergence this rule exists to stop. ' +
        'A new directory here is a deliberate, reviewed decision, never a drive-by (the fight-core-hermetic ' +
        'idiom applied to the page).',
      severity: 'error',
      from: { path: '^packages/frontend/src/simulator/' },
      to: {
        pathNot: [
          '^packages/frontend/src/simulator/',
          '^packages/frontend/src/(components|core|fight-engine|game|i18n|utils|world-shell)/',
          '^packages/frontend/src/pages/encyclopedia/',
          '^packages/(engine|fight|inventory|party|sdk|sim|world)/',
          'node_modules',
        ],
      },
    },
    {
      name: 'simulator-no-reverse-leak',
      comment:
        'The other half of the zero-divergence law: the simulator CONSUMES shared homes, it never BECOMES one. ' +
        'Nothing outside simulator/** may import it except its composition root, pages/simulator.tsx — the ' +
        'page that mounts it. A world surface reaching into simulator/** would make a local-only, chain-free ' +
        'module authoritative for the real game, which is the divergence running in the opposite direction: ' +
        'the extraction of a shared fact belongs in its shared home (@aresrpg/* or game/world-shell), and both ' +
        'sides import THAT. Enforced on the resolved graph, so a re-export chain cannot launder it either.',
      severity: 'error',
      from: {
        path: '^packages/(frontend|fight|party|inventory|world)/src/',
        pathNot: '^packages/frontend/src/(simulator/|pages/simulator\\.tsx$)',
      },
      to: { path: '^packages/frontend/src/simulator/' },
    },
    {
      name: 'seed-receipt-boot-paint-only',
      comment:
        'Issues #1467/#1510: the seed receipt (content/seed_manifest → move/scripts/out/seed_manifest.json) ' +
        'is a BUILD-TIME artifact frozen into the deployed bundle. It may seed initial paint; it may NEVER ' +
        'be the truth an id-join or a chain-derived value resolves against — one republish outrunning one ' +
        'redeploy and every consumer of that join goes to zero. Measured on the live testnet 2026-07-28: the ' +
        "bundled receipt's 374 mob ids matched ZERO of the 383 rows /v1 was serving, so the encyclopedia's " +
        'DROPPED BY was empty for every item while the bestiary next door listed the droppers. Six sites ' +
        'joined it that way; the shop catalog (nothing buyable) and the equip pre-flight (nothing equippable) ' +
        'were the sharp ones. THE LAW: anything that must agree with live chain state reads /v1. ' +
        'The allowlist below is the boot-paint set — three modules that project the receipt WITHOUT ever ' +
        'letting it filter a live row: chain/deployment.ts (the seeded world id enumeration + display label), ' +
        'pages/encyclopedia/world_corpus.ts and game/screens/hud/Inventory.jsx (authored-slug → minted-id ' +
        'projections over the authored catalog). FightReport was removed from this set by #1522: settlement ' +
        'snapshots the live /v1 item_type slug onto each loot projection before the fight card renders. ' +
        'A FOURTH importer is a deliberate, reviewed act: add it here with its reason, or read /v1 like ' +
        'everything else.',
      severity: 'error',
      from: {
        path: '^packages/frontend/src/',
        pathNot:
          '^packages/frontend/src/(chain/deployment\\.ts|pages/encyclopedia/world_corpus\\.ts|game/screens/hud/Inventory\\.jsx)$',
      },
      to: {
        path: '^packages/frontend/src/content/seed_manifest\\.ts$|^packages/move/scripts/out/seed_manifest\\.json$',
      },
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
