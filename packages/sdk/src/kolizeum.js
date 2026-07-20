import { Transaction } from '@mysten/sui/transactions'

import { shared_object_arg } from './deployment/aresrpg.js'
import { as_object_arg } from './sui/object_arg.js'
import { settle_and_take_ptb } from './fight.js'
import { kolizeum_ids } from './sui/write/kolizeum_lobby.js'

// KOLIZEUM — the public per-domain home for the sibling `aresrpg_kolizeum` package's wagered PvP (§7 / §17.9; a
// REAL WIN's pot takes a 10% platform cut at settle (PLATFORM CUTS) — draw/cancel/exit
// refund whole, uncut). The lobby money core (create / join / exit / cancel / sweep) lives in `sui/write/kolizeum_lobby.js`
// and the live-lobby read in `sui/read/kolizeum.js`; this module RE-EXPORTS both (one public import per domain,
// mirroring `fight.js`) and adds the fight bridge: `start` (K1 — the creator commits the lobby to a PvP `Fight`),
// `seat` (K1 — a member self-seats), `settle` (K2 — release the pot off a terminal `FightOutcome`), `open` (K2 — the
// brand-asserted arena-outcome TERMINAL, consumed HERE not by core's PvM `results` door), and `settle_arena` (the
// one-PTB composer: `settle_and_take → settle(&outcome) → open(outcome)`). None draw `&Random` (the PvP snapshots are
// deterministic geared reads; the arena outcome carries zero loot so `open` just unpacks+drops — no roll).
//
// PACKAGE-SPLIT 2026-07-11: kolizeum is its OWN `aresrpg_kolizeum` package again — every `kolizeum::*` target
// resolves to KOLIZEUM_PACKAGE_ID (guarded by `kolizeum_ids`). FROZEN Move signatures read firsthand from
// packages/move/kolizeum/sources/kolizeum.move. Trust is the private `KolizeumBrand` witness (no KolizeumRegistry —
// it calls the engine's package-internal doors directly). The version params are NOT one object: `fight_version`
// (`FightVersion = aresrpg_fight::version::Version`) is the ENGINE's OWN shared Version (ENGINE_VERSION — a DIFFERENT
// object AND type); `version` (core `aresrpg::version::Version`) is the ONE core shared Version (post-split `seat`
// DROPPED its duplicate `items_version` arg — now 11 args). `settle` takes the ENGINE `&FightOutcome`, not a `FightResult`.
//
// S-51b STATIC REFS: deployment singletons are STATIC SharedObjectRefs via the shared-version cache
// (aresrpg_shared_ref); mutability mirrors the Move ref kind EXACTLY. Runtime objects (kolizeum / fight /
// kiosk / pkcap / outcome) ride the ref-or-id seam (`as_object_arg`, sui/object_arg.js).

export {
  create_public_ptb,
  create_friends_only_ptb,
  join_ptb,
  exit_ptb,
  cancel_ptb,
  sweep_ptb,
} from './sui/write/kolizeum_lobby.js'
export { get_kolizeum, KOLIZEUM_STATUS } from './sui/read/kolizeum.js'

/**
 * The context a kolizeum bridge builder needs: the network (drives lazy id resolution) + an optional `ids`
 * injection seam. `start`/`seat` take the player's `&Kiosk` + `&PersonalKioskCap` directly (unwrapped on-chain —
 * no borrow dance).
 * @typedef {object} KolizeumContext
 * @property {'mainnet' | 'testnet' | 'devnet' | 'localnet'} network
 * @property {{ aresrpg?: Record<string, string> }} [ids]
 */

// ╔════════════════ [ START — K1: spawn the PvP fight (creator only) ] ════════ ]

/**
 * START (K1): the CREATOR commits an OPEN lobby to a PvP `Fight` and seats themselves as side A (`kolizeum::start`,
 * NO &Random). Flips OPEN → STARTED and binds the derived fight id (settlement asserts it). Takes the creator's
 * `&Kiosk` + `&PersonalKioskCap` directly.
 * @param {KolizeumContext} context
 */
export function start_ptb(context) {
  const { network } = context
  return ({
    kolizeum_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    raised_spell_ids = [],
    tx = new Transaction(),
  }) => {
    const a = kolizeum_ids(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.KOLIZEUM_PACKAGE_ID}::kolizeum::start`,
      arguments: [
        as_object_arg(tx, kolizeum_id), // kolizeum: &mut Kolizeum (a cached ref must be mutable:true)
        shared_object_arg(tx, network, 'FIGHT_REGISTRY', true, a.FIGHT_REGISTRY), // registry: &mut FightRegistry
        as_object_arg(tx, kiosk_id), // kiosk: &Kiosk (READ-ONLY here — a kiosk ref may be mutable:false)
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID
        tx.pure.vector('id', raised_spell_ids), // raised_spell_ids: vector<ID>
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version (THE one core version)
        shared_object_arg(tx, network, 'ENGINE_VERSION', false, a.ENGINE_VERSION), // fight_version: &FightVersion — the ENGINE package's own shared Version (NOT core VERSION)
        tx.object.clock(), // clock: &Clock (0x6)
      ],
    })
    return tx
  }
}

// ╔════════════════ [ SEAT — K1: a member self-seats on their side ] ══════════ ]

/**
 * SEAT (K1): a lobby MEMBER self-seats their registered character on THEIR side of the STARTED fight
 * (`kolizeum::seat`, NO &Random; the Clock settles lazy regen). Verifies membership + the bound fight
 * on-chain, then vouches via fight's gated join. The creator is already seated by `start` (a re-seat hits fight's
 * dup guard).
 * @param {KolizeumContext} context
 */
export function seat_ptb(context) {
  const { network } = context
  return ({
    kolizeum_id,
    fight_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    raised_spell_ids = [],
    tx = new Transaction(),
  }) => {
    const a = kolizeum_ids(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.KOLIZEUM_PACKAGE_ID}::kolizeum::seat`,
      arguments: [
        as_object_arg(tx, kolizeum_id), // kolizeum: &Kolizeum (READ-ONLY here — a ref may be mutable:false)
        as_object_arg(tx, fight_id), // fight: &mut Fight (a cached ref must be mutable:true)
        shared_object_arg(tx, network, 'FIGHT_REGISTRY', true, a.FIGHT_REGISTRY), // fight_registry: &mut FightRegistry
        as_object_arg(tx, kiosk_id), // kiosk: &Kiosk (READ-ONLY post-split — a ref may be mutable:false)
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID
        tx.pure.vector('id', raised_spell_ids), // raised_spell_ids: vector<ID>
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version (THE one core version — post-split `seat` dropped its duplicate items_version arg)
        shared_object_arg(tx, network, 'ENGINE_VERSION', false, a.ENGINE_VERSION), // fight_version: &FightVersion — the ENGINE package's own shared Version (NOT core VERSION)
        tx.object.clock(), // clock: &Clock (0x6) — appended LAST (before auto-injected ctx)
      ],
    })
    return tx
  }
}

// ╔════════════════ [ SETTLE — K2: release the pot off a terminal FightResult ] ═ ]

/**
 * SETTLE (K2): release the pot off a terminal ENGINE `settlement::FightOutcome` (`kolizeum::settle`, NO &Random) —
 * the un-griefable oracle (it reads the outcome's proven `fight_id` + `winner_team`). Binds to the lobby's fight (a
 * foreign outcome cannot settle this pot), then pays the winning side its equal split of the pot LESS a 10%
 * platform cut (PLATFORM CUTS), or refunds every pledge WHOLE, uncut, on a draw.
 * Permissionless among outcome-holders; pays out even during a freeze (`assert_latest`).
 * @param {KolizeumContext} context
 */
export function settle_ptb(context) {
  const { network } = context
  return ({ kolizeum_id, outcome_id, tx = new Transaction() }) => {
    const a = kolizeum_ids(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.KOLIZEUM_PACKAGE_ID}::kolizeum::settle`,
      arguments: [
        as_object_arg(tx, kolizeum_id), // kolizeum: &mut Kolizeum (a cached ref must be mutable:true)
        as_object_arg(tx, outcome_id), // result: &FightOutcome (ENGINE settlement type — borrowed; OWNED)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version (core)
      ],
    })
    return tx
  }
}

// ╔════════════════ [ OPEN — K2: the brand-asserted arena-outcome terminal ] ══ ]

/**
 * OPEN (K2): consume a seat's terminal `settlement::FightOutcome` at the ARENA terminal (`kolizeum::open`, NO &Random,
 * NO version) — asserts the `KolizeumBrand` echo (core's PvM `results` door refuses arena outcomes and vice-versa),
 * then unpacks + drops it (a PvP outcome carries zero xp/loot — the pot, released by `settle`, is the prize; the
 * delete is the storage rebate). This is the STANDALONE door a LATE seat calls anytime on the outcome
 * `settle_and_take` transferred to it; the primary settler uses `settle_arena_ptb` (the one-PTB compose). `outcome_id`
 * is an OWNED `FightOutcome` object (ref-or-id seam) — for a SAME-PTB result handle use `settle_arena_ptb`.
 * @param {KolizeumContext} context
 */
export function open_ptb(context) {
  const { network } = context
  return ({ outcome_id, tx = new Transaction() }) => {
    const a = kolizeum_ids(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.KOLIZEUM_PACKAGE_ID}::kolizeum::open`,
      arguments: [
        as_object_arg(tx, outcome_id), // outcome: FightOutcome (BY VALUE — consumed; OWNED, ref-or-id seam)
      ],
    })
    return tx
  }
}

// ╔══ [ SETTLE_ARENA — the one-PTB terminal: settle_and_take → settle(&o) → open(o) ] ══ ]

/**
 * CONVENIENCE compose (the arena twin of fight.js's `settle_open_world_ptb`): in ONE PTB, TAKE the caller's own
 * seat's `FightOutcome` off the terminal PvP `Fight` (`settlement::settle_and_take`, ENGINE — deletes the Fight,
 * transfers every OTHER seat's outcome to its owner), RELEASE the pot off that same outcome
 * (`kolizeum::settle(&outcome)` — equal split to the winning side / refund-all on a draw), then CONSUME it at the
 * brand-asserted arena terminal (`kolizeum::open(outcome)`). NO &Random anywhere on this path (arena outcomes carry
 * zero loot), so there is no trailing-command restriction. The middle BORROWS the handle (`&FightOutcome`) and the
 * terminal takes it BY VALUE — the handle is placed AS-IS (never through `as_object_arg`; a PTB result is not an
 * on-chain object until execution), exactly like the dungeon `settle_and_take → settle_run(&h) → open_taken(h)` chain.
 * @param {KolizeumContext} context
 */
export function settle_arena_ptb(context) {
  const { network } = context
  return ({ fight_id, character_id, kolizeum_id, tx = new Transaction() }) => {
    const a = kolizeum_ids(network, context.ids?.aresrpg) // guard KOLIZEUM_PACKAGE_ID before building anything

    // 1. settle_and_take (ENGINE) → the caller's own outcome as a chainable RESULT HANDLE (the Fight is consumed here)
    const { tx: chained, outcome } = settle_and_take_ptb(context)({
      fight_id,
      character_id,
      tx,
    })

    // 2. kolizeum::settle(kolizeum, &outcome, version) — BORROW the handle to release the pot to the winners
    chained.moveCall({
      target: `${a.KOLIZEUM_PACKAGE_ID}::kolizeum::settle`,
      arguments: [
        as_object_arg(chained, kolizeum_id), // kolizeum: &mut Kolizeum (a cached ref must be mutable:true)
        outcome, // result: &FightOutcome (the settle_and_take RESULT HANDLE — borrowed, NEVER an object id)
        shared_object_arg(chained, network, 'VERSION', false, a.VERSION), // version: &Version (core)
      ],
    })

    // 3. kolizeum::open(outcome) — CONSUME the handle by value at the brand-asserted arena terminal
    chained.moveCall({
      target: `${a.KOLIZEUM_PACKAGE_ID}::kolizeum::open`,
      arguments: [outcome], // outcome: FightOutcome (BY VALUE — the same handle; NEVER an object id)
    })

    return chained
  }
}
