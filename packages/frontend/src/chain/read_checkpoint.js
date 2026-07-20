// The CHAIN-TRUE per-world CHECKPOINT read (§5 position-truth). A character's checkpoint — proven position +
// proven time — lives as a namespaced dynamic field on the Character under `character_link::CheckpointKey
// { world: ID }` (namespace NS_CHARACTER_WORLD), advanced by every position-proving tx (world join, zone
// SEARCH, world-fight claim — zones.move). It is the ONLY authoritative resume position: a reload must render
// HERE, not the WORLD_SPAWN origin, or the mobs/nodes zone-scoped to this checkpoint are invisible and the
// character's next search aborts ETravelTooFar (checkpoint::verify_travel). Reads ride the SDK's cap-free
// `read_namespaced_field` transport (derived DF id → gRPC json) — the SAME sibling-field pattern the spell
// allocation read uses (read_spell_state.js); no /v1 row projects it (ZoneSearched carries no character/x/z).

import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'
import { ITEMS_NS } from '@aresrpg/sdk/sui'

import { DEMO_NETWORK } from './deployment'
import { get_sdk } from './sdk'

/** BCS of `CheckpointKey { world: ID }` = the 32 raw bytes of the world id (an ID is a bare address). */
const id_bytes = (id) =>
  Uint8Array.from(
    String(id)
      .replace(/^0x/, '')
      .padStart(64, '0')
      .match(/.{1,2}/g)
      .map((h) => parseInt(h, 16))
  )

/**
 * The character's per-world checkpoint, or null when none exists (pre-first-join) / unreadable. `x`/`z` are
 * UNSIGNED CHAIN block coords — translate to signed world render space with `chain_to_world` + the world's
 * per-axis offset (`bounds/2`, from the World doc — @aresrpg/sdk/coords).
 * @param {string} character_id @param {string} world_id
 * @returns {Promise<{ x: number, z: number, time_ms: number, pet_equipped: boolean } | null>}
 */
export async function read_checkpoint(character_id, world_id) {
  if (!character_id || !world_id) return null
  const sdk = await get_sdk()
  const pkg = aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID')
  const cp = await sdk.read_namespaced_field({
    object_id: character_id,
    namespace: ITEMS_NS.CHARACTER_WORLD,
    key_type: `${pkg}::character_link::CheckpointKey`,
    key_bytes: id_bytes(world_id),
  })
  if (!cp) return null
  const x = Number(cp.x)
  const z = Number(cp.z)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  return { x, z, time_ms: Number(cp.time_ms ?? 0), pet_equipped: !!cp.pet_equipped }
}
