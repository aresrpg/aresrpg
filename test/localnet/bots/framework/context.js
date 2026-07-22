// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SDK CONTEXT — build the `context` every @aresrpg/sdk builder factory binds to, from the manifest.
//
// The builders need { network, ids?.aresrpg (injection seam), kiosk_client }. We keep OUR OWN localnet
// SuiJsonRpcClient (framework/sui.js) for submit+reads; this file only assembles the build-time context.
//
// ── LOCALNET id injection: we USE the context.ids override seam (never edit the SDK deployment file) ─────
// build_context() passes manifest ids as `context.ids.aresrpg` on EVERY SDK call — the documented injection
// seam (packages/sdk/src/sui/write/items_shop.js:118 `aresrpg_deployment(network, context.ids?.aresrpg)`).
// That is the right seam and the framework is fully wired to it. BUT two SDK-resolver facts (probed firsthand
// 2026-07-11 — evidence in diagnose_deployment) mean the override is NECESSARY-BUT-NOT-SUFFICIENT for
// localnet EXECUTION today, and the residual fix lives in the SDK resolver (NOT in baked localnet data):
//   GAP-1  aresrpg_deployment('localnet', fullOverride) THROWS — `const base = ARESRPG_IDS['localnet']` is
//          undefined and `if (!base) throw` fires BEFORE overrides merge. One-line SDK fix: `?? {}` on the
//          base lookup, so context.ids fully populates an unknown network. (Proven: testnet+override returns
//          the localnet ids fine — only the unknown-network guard blocks localnet.)
//   GAP-2  builders call aresrpg_shared_ref(net, KEY, mut, { objectId }) — objectId only. initialSharedVersion
//          resolves from SHARED_VERSIONS[net] (no localnet), and there is no path from context.ids to it. The
//          override arg CAN take initialSharedVersion (proven), but no builder passes it. SDK-resolver fix
//          (mirrors the existing &Random pattern): when a shared object's initialSharedVersion is unstamped,
//          fall back to an unresolved `tx.object(id)` (client resolves at build) exactly like
//          `random_shared_ref`→`tx.object.random()` — OR thread `context.ids.shared_versions[KEY]` into the
//          shared_ref override. Either keeps localnet ids OUT of the deployment map (per the no-stamp rule).
// diagnose_deployment() detects GAP-1 at boot and REFUSES LOUDLY with this remediation — a bot never emits an
// unresolvable/wrong-version PTB against real gas.

import { aresrpg_deployment, aresrpg_shared_ref } from '../../../../packages/sdk/src/deployment/aresrpg.js'

import { KioskClient } from './deps.js'

/**
 * Build the SDK builder context.
 * @param {object} args
 * @param {any} args.manifest
 * @param {'localnet'|'testnet'} args.network  'localnet' = live (manifest ids); 'testnet' = offline build proof
 * @param {any} [args.kiosk_client]
 */
export function build_context({ manifest, network, kiosk_client }) {
  return {
    network,
    // Inject manifest ids only for localnet (the seam aresrpg_deployment merges). Offline 'testnet' uses the
    // SDK's own stamped ids (so shared_ref versions are correct) — do NOT override there.
    ids: network === 'localnet' ? { aresrpg: manifest?.ids?.aresrpg ?? {} } : undefined,
    kiosk_client,
  }
}

/**
 * A KioskClient over our localnet JSON-RPC client. On localnet @mysten/kiosk has NO built-in rule package ids,
 * so pass them from the manifest (`ids.kiosk`) — else character-create / equip / marketplace kiosk ops fail.
 * @param {any} client SuiJsonRpcClient
 * @param {'localnet'|'testnet'} network
 * @param {{personalKioskRulePackageId?:string, kioskLockRulePackageId?:string, royaltyRulePackageId?:string}} [kiosk_ids]
 */
export function make_kiosk_client(client, network, kiosk_ids) {
  const packageIds = kiosk_ids && Object.values(kiosk_ids).some(Boolean) ? kiosk_ids : undefined
  return new KioskClient({ client, network, ...(packageIds ? { packageIds } : {}) })
}

/**
 * Probe the SDK deployment resolver for `network` + the manifest ids. Returns { ok, gaps[], sample } — call at
 * boot in live mode and REFUSE LOUDLY if not ok (a bot must never emit an unresolvable PTB against real gas).
 */
export function diagnose_deployment(network, ids = {}) {
  const gaps = []
  let dep = null
  try {
    dep = aresrpg_deployment(network, ids)
  } catch (e) {
    gaps.push(`GAP-1 aresrpg_deployment('${network}'): ${e.message.split('\n')[0]}`)
  }
  if (dep) {
    try {
      aresrpg_shared_ref(network, 'VERSION', false, { objectId: dep.VERSION })
    } catch (e) {
      gaps.push(`GAP-2 aresrpg_shared_ref('${network}','VERSION'): ${e.message.split('\n')[0]}`)
    }
  }
  return { ok: gaps.length === 0, gaps, dep }
}

export const REMEDIATION =
  'The framework already injects manifest ids via context.ids (never edits the SDK deployment file). Two ' +
  'minimal SDK-RESOLVER changes make localnet execute (no baked localnet data): (1) aresrpg_deployment — ' +
  '`const base = ARESRPG_IDS[network] ?? {}` so context.ids populates an unknown network; (2) aresrpg_shared_ref ' +
  '— when a shared object initialSharedVersion is unstamped, fall back to unresolved tx.object(id) (mirror the ' +
  'random_shared_ref→tx.object.random() pattern) OR thread context.ids.shared_versions[KEY] into its override. ' +
  'Both keep localnet ids out of the deployment map.'
