// TREASURY / ROYALTY reads for the admin SUI tab — PURE chain reads, NO backend, NO new service.
// Migrates the vaporized `get_admin_sui` treasury/royalty numbers to chain-direct sources:
//   • treasury balance — the treasury address is CONFIGURATION (TREASURY_ADDRESS below), then a Core gRPC
//     getBalance. The SuiNS name `treasury@aresrpg` resolves to that address (verified against mainnet SuiNS
//     2026-07-06, owner-purchased); forward name→address is JSON-RPC only (sunset) and Core gRPC/GraphQL
//     exposes only reverse address→name, so the address is pinned as config, not resolved live.
//   • accrued royalties — the un-swept marketplace fees pooled inside the base `TransferPolicy` objects
//     (kiosk `royalty_rule::pay` deposits into `policy.balance`; `sweep_to_treasury` later drains it).
//     Both live policies count: Item (item marketplace) + Character (the §17.30 character market). The old
//     AresRPG_TransferPolicy wrapper is NOT read — on-chain it is typed for the RETIRED 0x29f6b3be lineage's
//     structs (verified 2026-07-09), so no current-lineage trade can ever pool royalty in it.

import { aresrpg_id, release_network } from '@aresrpg/sdk/deployment/aresrpg'

import { DEMO_NETWORK } from './deployment'
import { get_sdk } from './sdk'

// Treasury (revenue destination) address — CONFIGURATION, not a runtime name-resolve (see header). The
// publisher projects the compiled Move.toml named address into release.json; the client only reads it.
const TREASURY_ADDRESS = release_network(DEMO_NETWORK)?.actors?.treasury ?? null

// The base TransferPolicies where a kiosk sale's royalty pools before it is swept (ids from the SDK's ONE
// deployment home; '' pre-ceremony entries are filtered so an unstamped network degrades to an honest 0).
const POLICY_IDS = [aresrpg_id(DEMO_NETWORK, 'ITEM_POLICY'), aresrpg_id(DEMO_NETWORK, 'CHARACTER_POLICY')].filter(
  Boolean
)

/** Pooled SUI (MIST) out of a base `TransferPolicy<T>` object's content fields (`.balance`). */
function policy_pool_mist(fields) {
  if (fields?.balance != null) return BigInt(fields.balance)
  return 0n
}

/**
 * Read the treasury balance + accrued marketplace royalties chain-direct. Every field degrades to an
 * honest empty/zero on failure — the caller renders "unresolved"/0, it NEVER throws to the tab.
 * #23: reads route through the gRPC Core API (`get_sdk().grpc_client`). The treasury address comes from the
 * selected release row; a missing entry OR a failed balance read leaves `treasury_mist` null.
 * @returns {Promise<{ treasury_address: string|null, treasury_mist: string|null, royalties_mist: string }>}
 */
export async function get_treasury_snapshot() {
  const { grpc_client } = await get_sdk()

  // 1) & 2) treasury address (config, per network) + its live SUI balance via the Core gRPC getBalance.
  //    `core.getBalance → { balance: { balance } }` MIST string. Missing config or a failed read → null.
  const treasury_address = TREASURY_ADDRESS
  let treasury_mist = null
  if (treasury_address)
    try {
      const { balance } = await grpc_client.core.getBalance({ owner: treasury_address })
      treasury_mist = String(balance.balance)
    } catch {
      /* balance read failed — honest null, never fabricate */
    }

  // 3) accrued (un-swept) royalties — sum the pooled SUI across the live base policies (Item + Character).
  let royalties_mist = 0n
  if (POLICY_IDS.length)
    try {
      // #23 gRPC: getObjects → { objects:[Object|Error] }; json:true is the flat policy struct.
      const { objects } = await grpc_client.core.getObjects({ objectIds: POLICY_IDS, include: { json: true } })
      for (const o of objects) if (!(o instanceof Error)) royalties_mist += policy_pool_mist(o?.json)
    } catch {
      /* policy read failed — honest 0, never fabricate */
    }

  return { treasury_address, treasury_mist, royalties_mist: String(royalties_mist) }
}
