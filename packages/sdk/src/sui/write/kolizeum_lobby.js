import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
  character_type,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

import { borrow_personal_kiosk_cap } from './borrow_personal_kiosk_cap.js'

// KOLIZEUM PTB BUILDERS for the sibling `aresrpg_kolizeum` package's `kolizeum` — the wagered-PvP lobby lifecycle
// (§17.9: a REAL WIN's pot takes a 10% platform cut at settle — PLATFORM CUTS; a
// draw/cancel/exit refunds every pledge WHOLE, uncut). Create/join read the creator's/joiner's authentic
// on-chain level, so they take a `&Character` — kiosk-locked, borrowed out via the personal-cap dance
// (character_update.js shape) and returned in-tx. The pledge is an EXACT split off gas (`pledge.value() ==
// pledge_amount` or it aborts). exit/cancel/sweep are refund/janitor flows needing only the lobby + core version.
// PACKAGE-SPLIT 2026-07-11: kolizeum left the merged `aresrpg` package into its own `aresrpg_kolizeum` — every
// target now resolves to KOLIZEUM_PACKAGE_ID (a NON-required id, guarded by `kolizeum_ids`); the arities are otherwise
// unchanged (it still uses core VERSION — it has no own Version).
//
// FROZEN Move signatures (read firsthand from packages/move/kolizeum/sources/kolizeum.move):
//   public fun create_public(config: &GameConfig, format_slots, pledge_amount, max_level_diff: u64, character: &Character, pledge: Coin<SUI>, version, ctx)
//   public fun create_friends_only(config, format_slots, pledge_amount, max_level_diff, friend_list: &FriendList, character: &Character, pledge, version, ctx)
//   public fun join(kolizeum: &mut Kolizeum, character: &Character, pledge: Coin<SUI>, config: &GameConfig, version, ctx)
//   public fun exit(kolizeum: &mut Kolizeum, version, ctx) · cancel(kolizeum: &mut Kolizeum, version, ctx) · sweep(kolizeum: Kolizeum)

/**
 * Resolve the aresrpg deployment AND assert the sibling `aresrpg_kolizeum` package id is stamped (package-split
 * 2026-07-11). KOLIZEUM_PACKAGE_ID is NON-required in the core deployment gate — the create/fight/pool core must
 * build without it, so an unpublished arena never blocks character/shop/fight — hence every kolizeum builder (here
 * and in kolizeum.js) guards the one id it targets HERE: refuse loudly rather than emit an empty `::kolizeum::*`
 * target. Same "refuse, never guess" law as `aresrpg_deployment`'s REQUIRED gate, scoped to the one sibling id.
 * @param {'mainnet' | 'testnet' | 'devnet' | 'localnet'} network
 * @param {Partial<import('../../deployment/aresrpg.js').AresrpgIds>} [ids] the `context.ids?.aresrpg` injection seam
 * @returns {ReturnType<typeof aresrpg_deployment>}
 */
export function kolizeum_ids(network, ids) {
  const a = aresrpg_deployment(network, ids)
  if (!a.KOLIZEUM_PACKAGE_ID)
    throw new Error(
      `[kolizeum] aresrpg_kolizeum is not deployed on "${network}" — KOLIZEUM_PACKAGE_ID is unset. Stamp it in src/deployment/aresrpg.js at the publish ceremony before any kolizeum call.`,
    )
  return a
}

/**
 * Borrow the locked character VALUE out of the personal kiosk, run `handler(character)` (which issues the kolizeum
 * moveCall taking `&Character`), then return it. One home for the borrow-val dance the create/join flows share.
 */
function with_borrowed_character(
  context,
  { character_id, kiosk_id, personal_kiosk_cap_id, tx, character_type },
  handler,
) {
  const kiosk = as_object_arg(tx, kiosk_id) // ref-or-id seam — resolved once, reused for borrow + return
  borrow_personal_kiosk_cap(context)({
    personal_kiosk_cap_id,
    tx,
    handler: kiosk_cap => {
      const [character, borrow] = tx.moveCall({
        target: '0x2::kiosk::borrow_val',
        typeArguments: [character_type],
        arguments: [kiosk, kiosk_cap, tx.pure.id(character_id)],
      })
      handler(character)
      tx.moveCall({
        target: '0x2::kiosk::return_val',
        typeArguments: [character_type],
        arguments: [kiosk, character, borrow],
      })
    },
  })
}

/**
 * CREATE a PUBLIC lobby (anyone may join), seeding side A with the creator + the pot with their pledge. `pledge_amount`
 * is split EXACTLY off gas.
 * @param {import("../../../types.js").Context} context
 */
export function create_public_ptb(context) {
  const { network } = context
  return ({
    format_slots,
    pledge_amount,
    max_level_diff,
    character_id,
    kiosk_id,
    personal_kiosk_cap_id,
    tx = new Transaction(),
  }) => {
    const a = kolizeum_ids(network, context.ids?.aresrpg)
    const [pledge] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(pledge_amount))])
    with_borrowed_character(
      context,
      {
        character_id,
        kiosk_id,
        personal_kiosk_cap_id,
        tx,
        character_type: character_type(a),
      },
      character => {
        tx.moveCall({
          target: `${a.KOLIZEUM_PACKAGE_ID}::kolizeum::create_public`,
          arguments: [
            shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
            tx.pure.u64(BigInt(format_slots)), // format_slots: u64
            tx.pure.u64(BigInt(pledge_amount)), // pledge_amount: u64
            tx.pure.u64(BigInt(max_level_diff)), // max_level_diff: u64
            character, // character: &Character
            pledge, // pledge: Coin<SUI>
            shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
          ],
        })
      },
    )
    return tx
  }
}

/**
 * CREATE a FRIENDS-ONLY lobby — the allowlist is SNAPSHOTTED from the creator's own `FriendList` (pass its object id).
 * @param {import("../../../types.js").Context} context
 */
export function create_friends_only_ptb(context) {
  const { network } = context
  return ({
    format_slots,
    pledge_amount,
    max_level_diff,
    friend_list_id,
    character_id,
    kiosk_id,
    personal_kiosk_cap_id,
    tx = new Transaction(),
  }) => {
    const a = kolizeum_ids(network, context.ids?.aresrpg)
    const [pledge] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(pledge_amount))])
    with_borrowed_character(
      context,
      {
        character_id,
        kiosk_id,
        personal_kiosk_cap_id,
        tx,
        character_type: character_type(a),
      },
      character => {
        tx.moveCall({
          target: `${a.KOLIZEUM_PACKAGE_ID}::kolizeum::create_friends_only`,
          arguments: [
            shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
            tx.pure.u64(BigInt(format_slots)), // format_slots: u64
            tx.pure.u64(BigInt(pledge_amount)), // pledge_amount: u64
            tx.pure.u64(BigInt(max_level_diff)), // max_level_diff: u64
            as_object_arg(tx, friend_list_id), // friend_list: &FriendList (creator's own; OWNED — ref-or-id seam)
            character, // character: &Character
            pledge, // pledge: Coin<SUI>
            shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
          ],
        })
      },
    )
    return tx
  }
}

/**
 * JOIN an OPEN lobby by pledging (the auto-balanced side seats the fighter). `pledge_amount` must equal the lobby's.
 * @param {import("../../../types.js").Context} context
 */
export function join_ptb(context) {
  const { network } = context
  return ({
    kolizeum_id,
    pledge_amount,
    character_id,
    kiosk_id,
    personal_kiosk_cap_id,
    tx = new Transaction(),
  }) => {
    const a = kolizeum_ids(network, context.ids?.aresrpg)
    const [pledge] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(pledge_amount))])
    with_borrowed_character(
      context,
      {
        character_id,
        kiosk_id,
        personal_kiosk_cap_id,
        tx,
        character_type: character_type(a),
      },
      character => {
        tx.moveCall({
          target: `${a.KOLIZEUM_PACKAGE_ID}::kolizeum::join`,
          arguments: [
            as_object_arg(tx, kolizeum_id), // kolizeum: &mut Kolizeum (a cached ref must be mutable:true)
            character, // character: &Character
            pledge, // pledge: Coin<SUI>
            // S-51b ARITY FIX: the deployed `join` takes `config: &GameConfig` (kolizeum.move:215, the S-46
            // kill-switch bit) — the pre-S-51b builder omitted it and aborted with an arg-count mismatch.
            shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
            shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
          ],
        })
      },
    )
    return tx
  }
}

/**
 * EXIT an OPEN lobby before start with a FULL refund (§17.9 anti-stomp). Refund-safe (gates on `assert_latest`).
 * @param {import("../../../types.js").Context} context
 */
export function exit_ptb(context) {
  const { network } = context
  return ({ kolizeum_id, tx = new Transaction() }) => {
    const a = kolizeum_ids(network, context.ids?.aresrpg)
    tx.moveCall({
      target: `${a.KOLIZEUM_PACKAGE_ID}::kolizeum::exit`,
      arguments: [
        as_object_arg(tx, kolizeum_id), // kolizeum: &mut Kolizeum (a cached ref must be mutable:true)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
      ],
    })
    return tx
  }
}

/**
 * CANCEL an OPEN lobby (creator only) — every pledge refunded, lobby → CANCELLED. Refund-safe (`assert_latest`).
 * @param {import("../../../types.js").Context} context
 */
export function cancel_ptb(context) {
  const { network } = context
  return ({ kolizeum_id, tx = new Transaction() }) => {
    const a = kolizeum_ids(network, context.ids?.aresrpg)
    tx.moveCall({
      target: `${a.KOLIZEUM_PACKAGE_ID}::kolizeum::cancel`,
      arguments: [
        as_object_arg(tx, kolizeum_id), // kolizeum: &mut Kolizeum (a cached ref must be mutable:true)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
      ],
    })
    return tx
  }
}

/**
 * SWEEP a SETTLED / CANCELLED drained lobby for the storage rebate (anyone may call; aborts if any SUI remains).
 * @param {import("../../../types.js").Context} context
 */
export function sweep_ptb(context) {
  const { network } = context
  return ({ kolizeum_id, tx = new Transaction() }) => {
    const a = kolizeum_ids(network, context.ids?.aresrpg)
    tx.moveCall({
      target: `${a.KOLIZEUM_PACKAGE_ID}::kolizeum::sweep`,
      arguments: [as_object_arg(tx, kolizeum_id)], // kolizeum: Kolizeum (by value — consumed; a cached ref must be mutable:true)
    })
    return tx
  }
}
