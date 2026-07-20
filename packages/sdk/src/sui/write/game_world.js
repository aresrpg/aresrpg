// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
  random_shared_ref,
} from '../../deployment/aresrpg.js'
import { world_to_chain, DEFAULT_WORLD_OFFSET } from '../../coords.js'
import { as_object_arg } from '../object_arg.js'

// &Random (0x8) PIN — mirrors fight.js's `random_arg` (see there for the full latency rationale). Pins the
// system object via `random_shared_ref` when the network's genesis version is stamped; falls back to the
// unresolved `tx.object.random()` otherwise. Byte-identical either way (mutable:false, same 0x8) — execution
// and Random-PTB terminality are unchanged; only the build-time resolve round-trip is saved.
/** @param {'mainnet'|'testnet'|'devnet'|'localnet'} network @param {import('@mysten/sui/transactions').Transaction} tx */
function random_arg(network, tx) {
  const ref = random_shared_ref(network)
  return ref ? tx.sharedObjectRef(ref) : tx.object.random()
}

/**
 * D747 fixed ceiling for terminal `&Random` zone searches. Lane H measured the shared rejection-sampling
 * derivation at roughly 145–190M MIST; 400M covers its randomness-dependent collision tail with real headroom.
 * Sui charges actual gas, not this ceiling, so only a ceiling that is too low risks an InsufficientGas burn.
 */
export const SEARCH_ZONE_GAS_MIST = 400_000_000

// GAME WORLD PTB BUILDERS for the merged `aresrpg` package's `zones` + `gathering` — the player-signed world flows.
// All three are `entry` funs consuming `&Random` as the TERMINAL command (a single move call with random LAST →
// Random-PTB compliant), and each takes the player's `&Kiosk` + soulbound `&PersonalKioskCap` DIRECTLY (the fn
// borrows the inner owner cap ON-CHAIN — the recall_character.js shape, no borrow_val/return_val dance). The S-46
// merge killed the CharacterLink custody object and the second version gate: ONE shared `version::Version` now.
//
// FROZEN Move signatures (read firsthand from packages/move/aresrpg/sources/{zones,gathering}.move):
//   entry fun join_world(world, kiosk, pkcap, character_id: ID, config, version, clock, r, ctx)
//   entry fun search_zone(world: &mut, kiosk, pkcap, character_id, x: u32, z: u32, config, version, clock, r, ctx)
//     ^ upgrade #4 (S-71): x/z = the CLAIMED STANDING POSITION (travel-verified, checkpoint advances there) —
//       was zx/zy zone coords + an occupancy lock that deadlocked discovery to the spawn zone forever
//   entry fun gather(world: &mut, kiosk, pkcap, character_id, zx, zy, node_index: u64, template: &ItemTemplate,
//     rare_template: &ItemTemplate, policy: &TransferPolicy<Item>, registry: &mut FightRegistry,
//     protector_template: &MobTemplate, engine_version: &EngineVersion, config, version, clock, r, ctx)
//     ^ §6 golden-gather: rare_template is the authored rare variant; asserted against the world rare_link BEFORE
//       the 0.1% draw. No link ⇒ inert (the SDK dummy-defaults it to `template`). A link ⇒ the caller MUST pass
//       the linked variant id or gather aborts ERareTemplateMismatch (deterministic, every dry-run catches it).
//     ^ §17.22 PROTECTOR AMBUSH (2026-07-11 republish): on a `protector_bp` roll the gather spawns a SOLO PvM
//       fight INTRA-call, so gather now also takes the fight machinery — `registry` (&mut FightRegistry, the
//       derivation parent + in-fight latch, exactly as create_fight_ptb passes it), `engine_version`
//       (&EngineVersion, the ENGINE package's shared Version), and `protector_template` (&MobTemplate, the
//       (job,tier)-matched world protector). protector_template_id is REQUIRED — no inert default exists (a
//       MobTemplate, not the ItemTemplate); see the sourcing note on the builder.
//
// S-51b STATIC REFS: GameConfig / Version / ItemPolicy / FightRegistry / EngineVersion ride the shared-version
// cache (aresrpg_shared_ref) — mutability mirrors the Move ref kind EXACTLY (FightRegistry is `&mut` → true;
// the rest `&` → false). world / kiosk / pkcap / template / protector_template ride the ref-or-id seam
// (`as_object_arg`): id string or cached ref — NOTE world is `&World` in join_world but `&mut World` in
// search_zone/gather (a cached world ref must carry mutable:true for those two).

/**
 * JOIN a world (first join spawns + writes the pre-entry checkpoint; a rejoin keeps the stored checkpoint). Terminal
 * `&Random`. `world_id` is the target `World` shared object.
 * @param {import("../../../types.js").Context} context
 */
export function join_world_ptb(context) {
  const { network } = context
  return ({
    world_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::zones::join_world`,
      arguments: [
        as_object_arg(tx, world_id), // world: &World
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap (unwrapped on-chain)
        tx.pure.id(character_id), // character_id: ID
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version (THE one)
        tx.object.clock(), // clock: &Clock (0x6)
        random_arg(network, tx), // r: &Random (0x8) — LAST → Random-PTB compliant (pinned when stamped → build-offline)
      ],
    })
    return tx
  }
}

/**
 * SEARCH (discover / re-search after TTL) the zone of the caller's CLAIMED STANDING POSITION `(x, z)` — travel-
 * verified from the checkpoint, and the checkpoint ADVANCES there (§5 position-proving; the S-71 walked-to-zone
 * unlock). Rolls the spawn tables and tops up density. Terminal `&Random`.
 *
 * COORD CODEC (2026-07-10): `x`/`z` are SIGNED WORLD block coords (the client's render space, centred on the
 * world origin). This builder is the write-side boundary: it translates them to the UNSIGNED CHAIN u32 the
 * Move fn takes via the per-world offset (`offset_x`/`offset_z` = bounds/2, from the `World` doc — coords.js).
 * @param {import("../../../types.js").Context} context
 */
export function search_zone_ptb(context) {
  const { network } = context
  return ({
    world_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    x,
    z,
    offset_x = DEFAULT_WORLD_OFFSET,
    offset_z = DEFAULT_WORLD_OFFSET,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    tx.setGasBudget(SEARCH_ZONE_GAS_MIST)
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::zones::search_zone`,
      arguments: [
        as_object_arg(tx, world_id), // world: &mut World
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID
        tx.pure.u32(Math.floor(world_to_chain(x, offset_x))), // x: u32 — WORLD→CHAIN standing position (block coords, NOT zone index)
        tx.pure.u32(Math.floor(world_to_chain(z, offset_z))), // z: u32 — WORLD→CHAIN
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
        tx.object.clock(), // clock: &Clock (0x6)
        random_arg(network, tx), // r: &Random (0x8) — LAST (pinned when stamped → build-offline)
      ],
    })
    return tx
  }
}

/**
 * GATHER resource node `node_index` in zone `(zx, zy)`: rolls the yield off the job level and mints the stacked item
 * into the caller's personal kiosk (the `policy` is the `TransferPolicy<Item>`). `rare_template_id` is the §6
 * golden-gather variant; it DUMMY-DEFAULTS to `template_id` (inert unless the resource has an authored rare link,
 * in which case the caller MUST pass the linked variant's id or the gather aborts ERareTemplateMismatch). Terminal `&Random`.
 *
 * `protector_template_id` (§17.22, REQUIRED) is the `&MobTemplate` the ambush fight spawns on a `protector_bp` roll —
 * the (job, tier)-matched world protector. SOURCING (declared, not yet wired): the World exposes only the ambush RATE
 * (`world::protector_bp`), NOT the protector's on-chain MobTemplate id; the protector roster lives in seed content
 * (`seed/gathering/farmer/protectors.json`, each row keyed by `gatherProtectorJson.{jobType,tier}`) but the minted
 * MobTemplate object ids are NOT surfaced by any read (`get_world` / `get_zone_spawns` / the deployment map) yet. The
 * caller must resolve the node's (job, tier) → protector MobTemplate id; that map is the seed/rpc lane's to publish
 * (see the RETURN note). This builder only THREADS the arg (mirrors create_fight_ptb's `mob_template_id`).
 * @param {import("../../../types.js").Context} context
 */
export function gather_ptb(context) {
  const { network } = context
  return ({
    world_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    zx,
    zy,
    node_index,
    template_id,
    rare_template_id = template_id,
    protector_template_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::gathering::gather`,
      arguments: [
        as_object_arg(tx, world_id), // world: &mut World
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID
        tx.pure.u32(zx), // zx: u32
        tx.pure.u32(zy), // zy: u32
        tx.pure.u64(BigInt(node_index)), // node_index: u64
        as_object_arg(tx, template_id), // template: &ItemTemplate (the node's yielded item)
        as_object_arg(tx, rare_template_id), // rare_template: &ItemTemplate (§6 golden variant; dummy-defaults to template — inert unless a rare link exists)
        shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY), // policy: &TransferPolicy<Item>
        shared_object_arg(tx, network, 'FIGHT_REGISTRY', true, a.FIGHT_REGISTRY), // registry: &mut FightRegistry (§17.22 ambush — derivation parent + in-fight latch)
        as_object_arg(tx, protector_template_id), // protector_template: &MobTemplate (the (job,tier)-matched world protector — REQUIRED)
        shared_object_arg(tx, network, 'ENGINE_VERSION', false, a.ENGINE_VERSION), // engine_version: &EngineVersion (the ENGINE package's shared Version)
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
        tx.object.clock(), // clock: &Clock (0x6)
        random_arg(network, tx), // r: &Random (0x8) — LAST (pinned when stamped → build-offline)
      ],
    })
    return tx
  }
}
