// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
} from './deployment/aresrpg.js'
import { as_object_arg } from './sui/object_arg.js'

// DUNGEON — the public per-domain home for the merged `aresrpg` package's dungeon flows (§9 "the key IS the run").
// The `abandon` builder + the bound-`RunPass` read live in `sui/write/dungeon_run.js` / `sui/read/dungeon.js`; this
// module RE-EXPORTS both (one public import per domain, mirroring `fight.js`) and adds the run LIFECYCLE: ENTER
// (`activate`), the NEXT-FIGHT bridge (`next_fight` / `join_fight`), and settlement (`settle_run`). Ids resolve
// LAZILY through THE single deployment home — a builder for an un-stamped network REFUSES loudly, never invents an
// id (`context.ids.aresrpg` is the offline/test injection seam).
//
// FROZEN Move signatures — read firsthand from packages/move/aresrpg/sources/{dungeon,run}.move. The S-46 merge
// DELETED the DungeonRegistry (pure cap custody — no dungeon door takes a registry now). POST-SPLIT the version
// params are NOT all one object: `fight_version` (Move type `FightVersion = aresrpg_fight::version::Version`) is the
// ENGINE package's OWN shared Version (ENGINE_VERSION — a DIFFERENT object AND type); `items_version` / `version`
// (`ItemsVersion` / `Version` = core `aresrpg::version::Version`) are the ONE core shared Version. `next_fight` is
// deterministic like `fight::create` (verifier law — spawn rolls at place/force_start).
//
// S-51b STATIC REFS: deployment singletons (GameConfig / Version / EngineVersion / FightRegistry /
// ExtractPolicy) are STATIC SharedObjectRefs via the shared-version cache (aresrpg_shared_ref); mutability
// mirrors the Move ref kind EXACTLY. RUNTIME objects (world / fight / pass / mob_template / kiosk / pkcap)
// ride the ref-or-id seam (`as_object_arg`, sui/object_arg.js) — id string or caller-cached ref.

export { abandon_ptb } from './sui/write/dungeon_run.js'
export { get_run_pass } from './sui/read/dungeon.js'

/**
 * The context a dungeon builder needs: the network (drives lazy id resolution) + an optional `ids` injection seam.
 * `activate` additionally needs a `kiosk_client` (the personal-cap borrow dance for the locked `&Character`); the
 * other builders take the kiosk/pkcap directly.
 * @typedef {object} DungeonContext
 * @property {'mainnet' | 'testnet' | 'devnet' | 'localnet'} network
 * @property {import('@mysten/kiosk').KioskClient} [kiosk_client]
 * @property {{ aresrpg?: Record<string, string> }} [ids]
 */

// ╔════════════════ [ ACTIVATE — the key IS the run (§9 ENTER) ] ══════════════ ]

/**
 * ENTER through the character-bound path. `extract_one_for_burn` leaves the original stack id locked in
 * the key kiosk and returns only a single unit under an abilityless BurnPledge; `activate` consumes both values
 * immediately. The character kiosk/cap are passed to Move so the dungeon door can prove ownership, borrow the
 * locked character mutably, and perform the branded world/dungeon lock flip atomically.
 *
 * This is deliberately a literal TWO-call composite. No raw item result is transferred or returned by the SDK,
 * and a transaction that omits the second call cannot discharge the BurnPledge, so extraction reverts.
 * @param {DungeonContext} context
 */
export function activate_ptb(context) {
  const { network } = context
  return ({
    world_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    key_item_id,
    key_kiosk_id,
    key_kiosk_cap_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    const version = shared_object_arg(tx, network, 'VERSION', false, a.VERSION)
    const character_kiosk = as_object_arg(tx, kiosk_id)
    const character_pkcap = as_object_arg(tx, personal_kiosk_cap_id)
    const key_kiosk = key_kiosk_id
      ? as_object_arg(tx, key_kiosk_id)
      : character_kiosk
    const key_cap_id = key_kiosk_id
      ? (key_kiosk_cap_id ?? personal_kiosk_cap_id)
      : personal_kiosk_cap_id

    const [key, key_pledge] = tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::extract::extract_one_for_burn`,
      arguments: [
        key_kiosk,
        as_object_arg(tx, key_cap_id),
        tx.pure.id(key_item_id),
        shared_object_arg(
          tx,
          network,
          'EXTRACT_POLICY',
          false,
          a.EXTRACT_POLICY,
        ),
        version,
      ],
    })

    tx.moveCall({
      target: `${a.DUNGEON_PACKAGE_ID}::dungeon::activate`,
      arguments: [
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG),
        as_object_arg(tx, world_id),
        character_kiosk,
        character_pkcap,
        tx.pure.id(character_id),
        key,
        key_pledge,
        version,
        version,
      ],
    })
    return tx
  }
}

/**
 * Append N character entries to one PTB in caller order. Reusing the same `key_item_id` is intentional: each
 * split door preserves and re-locks the remainder under that id before the next pair executes.
 * @param {DungeonContext} context
 */
export function activate_many_ptb(context) {
  const append = activate_ptb(context)
  return ({ members = [], tx = new Transaction() } = {}) => {
    if (!Array.isArray(members))
      throw new Error('[activate_many_ptb] members must be an array.')
    for (const member of members) append({ ...member, tx })
    return tx
  }
}

// ╔════════════════ [ NEXT FIGHT — mint / join a room fight (SEAM-D2, §9) ] ════ ]

/**
 * Mint a fresh `Fight` for the pass's current room. The Move door asserts `character_id` equals the immutable
 * character recorded by RunPass; the argument stays explicit so the fight snapshot ABI remains composable.
 * @param {DungeonContext} context
 */
export function next_fight_ptb(context) {
  const { network } = context
  return ({
    world_id,
    run_pass_id,
    mob_template_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    raised_spell_ids = [],
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    const version = shared_object_arg(tx, network, 'VERSION', false, a.VERSION)
    tx.moveCall({
      target: `${a.DUNGEON_PACKAGE_ID}::dungeon::next_fight`,
      arguments: [
        shared_object_arg(
          tx,
          network,
          'FIGHT_REGISTRY',
          true,
          a.FIGHT_REGISTRY,
        ),
        as_object_arg(tx, world_id),
        as_object_arg(tx, run_pass_id),
        as_object_arg(tx, mob_template_id),
        as_object_arg(tx, kiosk_id),
        as_object_arg(tx, personal_kiosk_cap_id),
        tx.pure.id(character_id),
        tx.pure.vector('id', raised_spell_ids),
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG),
        shared_object_arg(
          tx,
          network,
          'ENGINE_VERSION',
          false,
          a.ENGINE_VERSION,
        ),
        version,
        version,
        tx.object.clock(),
      ],
    })
    return tx
  }
}

/** Join a party member's room fight; Move checks the requested seat against RunPass.character.
 * @param {DungeonContext} context
 */
export function join_fight_ptb(context) {
  const { network } = context
  return ({
    fight_id,
    run_pass_id,
    creator_pass_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    raised_spell_ids = [],
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    const version = shared_object_arg(tx, network, 'VERSION', false, a.VERSION)
    tx.moveCall({
      target: `${a.DUNGEON_PACKAGE_ID}::dungeon::join_fight`,
      arguments: [
        shared_object_arg(
          tx,
          network,
          'FIGHT_REGISTRY',
          true,
          a.FIGHT_REGISTRY,
        ),
        as_object_arg(tx, fight_id),
        as_object_arg(tx, run_pass_id),
        tx.pure.id(creator_pass_id),
        as_object_arg(tx, kiosk_id),
        as_object_arg(tx, personal_kiosk_cap_id),
        tx.pure.id(character_id),
        tx.pure.vector('id', raised_spell_ids),
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG),
        shared_object_arg(
          tx,
          network,
          'ENGINE_VERSION',
          false,
          a.ENGINE_VERSION,
        ),
        version,
        version,
        tx.object.clock(),
      ],
    })
    return tx
  }
}

// ╔════════════════ [ SETTLE — advance / consume off the seat's FightResult (SEAM-D3) ] ═ ]

/**
 * SETTLE a RunPass and restore its bound character to the recorded world on every terminal outcome. The kiosk
 * proof lets Move borrow that exact locked character; GameConfig carries the pinned dungeon brand gate.
 * @param {DungeonContext} context
 */
export function settle_run_ptb(context) {
  const { network } = context
  return ({
    run_pass_id,
    outcome_id,
    world_id,
    kiosk_id,
    personal_kiosk_cap_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    tx.moveCall({
      target: `${a.DUNGEON_PACKAGE_ID}::dungeon::settle_run`,
      arguments: [
        as_object_arg(tx, run_pass_id),
        as_object_arg(tx, outcome_id),
        as_object_arg(tx, world_id),
        as_object_arg(tx, kiosk_id),
        as_object_arg(tx, personal_kiosk_cap_id),
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG),
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION),
      ],
    })
    return tx
  }
}
