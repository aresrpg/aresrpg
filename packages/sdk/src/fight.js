// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
  random_shared_ref,
} from './deployment/aresrpg.js'
import { as_object_arg } from './sui/object_arg.js'

/** @typedef {import('./fight_proof.js').MobGroupProof} MobGroupProof */

// &Random (0x8) is a SHARED system object. `tx.object.random()` emits an UNRESOLVED input, which forces
// tx-build to pay a server-side resolution round-trip on EVERY &Random PTB (the measured commit-latency
// blocker — pinning the Fight alone can't remove it while this stays unresolved). Pin it like every other
// shared object when the network's genesis version is stamped (`random_shared_ref`); fall back to the
// unresolved helper otherwise (graceful — an un-stamped network still builds, just keeps paying the resolve).
// The pinned ref is BYTE-IDENTICAL to the resolved `tx.object.random()` input (mutable:false, same 0x8), so
// execution is unchanged and Random-PTB terminality is untouched — it is purely the build-time resolve saved.
/** @param {'mainnet'|'testnet'|'devnet'|'localnet'} network @param {import('@mysten/sui/transactions').Transaction} tx */
function random_arg(network, tx) {
  const ref = random_shared_ref(network)
  return ref ? tx.sharedObjectRef(ref) : tx.object.random()
}

function normalized_unsigned(value, bits, label, max_override = null) {
  let normalized
  if (typeof value === 'bigint') {
    normalized = value
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    normalized = BigInt(value)
  } else if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) {
    normalized = BigInt(value)
  } else {
    throw new Error(`[fight] ${label} must be a safe unsigned integer`)
  }
  const max = max_override ?? (1n << BigInt(bits)) - 1n
  if (normalized < 0n || normalized > max)
    throw new Error(`[fight] ${label} must be a u${bits}`)
  return normalized
}

function normalized_id(value, label) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value))
    throw new Error(`[fight] ${label} must be an object ID`)
  return value
}

/** Validate and normalize the RPC-derived witness before touching the caller's transaction. */
function validated_group_proof(group_proof, spawn_id) {
  if (group_proof == null) return null
  const { index, facts, proof } = group_proof
  if (index == null || facts == null || proof == null)
    throw new Error('[fight] group_proof requires { index, facts, proof }')
  for (const field of [
    'spawn_id',
    'template_id',
    'x',
    'z',
    'group_size',
    'group_seed',
  ])
    if (facts[field] == null)
      throw new Error(`[fight] group_proof facts.${field} is required`)
  const index_value = normalized_unsigned(index, 64, 'group_proof index', 63n)
  const api_spawn = normalized_unsigned(spawn_id, 64, 'spawn_id')
  const proven_spawn = normalized_unsigned(
    facts.spawn_id,
    64,
    'group_proof facts.spawn_id',
  )
  if (proven_spawn !== api_spawn)
    throw new Error('[fight] group_proof facts.spawn_id must match spawn_id')
  let proof_bytes
  try {
    proof_bytes = Array.from(proof)
  } catch {
    throw new Error(
      '[fight] group_proof proof must be 0..6 flattened 32-byte sibling hashes',
    )
  }
  if (
    proof_bytes.length > 6 * 32 ||
    proof_bytes.length % 32 !== 0 ||
    proof_bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)
  )
    throw new Error(
      '[fight] group_proof proof must be 0..6 flattened 32-byte sibling hashes',
    )
  return {
    index: index_value,
    facts: {
      spawn_id: proven_spawn,
      template_id: normalized_id(
        facts.template_id,
        'group_proof facts.template_id',
      ),
      x: Number(normalized_unsigned(facts.x, 32, 'group_proof facts.x')),
      z: Number(normalized_unsigned(facts.z, 32, 'group_proof facts.z')),
      group_size: Number(
        normalized_unsigned(
          facts.group_size,
          16,
          'group_proof facts.group_size',
        ),
      ),
      group_seed: normalized_unsigned(
        facts.group_seed,
        64,
        'group_proof facts.group_seed',
      ),
    },
    proof: proof_bytes,
  }
}

// FIGHT PTB BUILDERS for the S-46 FINAL SPLIT: the game core (`aresrpg`, CORE ids) + the GENERIC branded combat
// engine (`aresrpg_fight`, ENGINE ids). The CORE doors (`fight::create`/`fight::join`, `results::open`/
// `mint_rolled`/`burn_result`) construct the private FightBrand witness and target LATEST_PACKAGE_ID; the
// PER-TURN entries (`turns::place`/`force_start`/`crank`, `actions::act_*`) and terminal `settlement::
// settle_and_destroy` live on the ENGINE package and target ENGINE_LATEST_PACKAGE_ID (the CALL TARGET,
// bumped per engine upgrade — S-68; ENGINE_PACKAGE_ID stays the TYPE ORIGIN for Fight/FightOutcome/event
// type strings) with the ENGINE's OWN shared `version::Version` (ENGINE_VERSION) — never the core Version. Pure functions: each is a context-bound factory
// `builder(context) => (args) => Transaction`, the proven `game_world.js` shape. NO borrow_val/return_val dance —
// every fight entry takes the player's `&Kiosk` + soulbound `&PersonalKioskCap` DIRECTLY and unwraps the inner
// owner cap ON-CHAIN. Ids resolve LAZILY through THE single deployment home (`deployment/aresrpg.js`) — a builder
// for an un-stamped network REFUSES loudly, never invents an id. `context.ids.aresrpg` is the offline/test
// injection seam.
//
// FROZEN Move signatures — read firsthand 2026-07-11 from packages/move/aresrpg/sources/{fight,results,zones}.move
// + packages/move/engine/sources/{turns,actions,settlement}.move (trust the code, not any doc). Engine entries
// take (fight, …, version: &Version[ENGINE], clock[, r]) — NO GameConfig (the engine reads its create-time Dials
// snapshot). SINGLE-PTB TURN LAW: act_move/act_weapon/act_cast are `&Random`-FREE (crits
// derive from the public turn seed; the resolver is deterministic), so a whole turn batches as ONE PTB via
// `commit_turn_ptb` with `act_pass` as its single terminal `&Random` command. Every `&Random` entry places
// the 0x8 Random object (via `random_arg` — a PINNED SharedObjectRef, or `tx.object.random()` when a network's
// genesis version isn't stamped) as the LAST argument of the LAST command → Random-PTB compliant (Sui forbids
// any command after a Random MoveCall bar TransferObjects/MergeCoins).
//
// S-51b STATIC REFS: every deployment singleton (GameConfig / Version / EngineVersion / FightRegistry /
// ItemPolicy) is a STATIC SharedObjectRef via the shared-version cache (aresrpg_shared_ref) — mutability
// mirrors the Move ref kind EXACTLY (&mut → true). RUNTIME objects (world/fight/kiosk/pkcap/templates/
// outcomes) ride the ref-or-id seam (`as_object_arg`, sui/object_arg.js): pass an id string (client-resolved
// at build) or a caller-cached ref — all-static inputs build kind-only with ZERO network requests.

export * from './fight_read.js'
export * from './fight_proof.js'
export { get_zone_group_commitment } from './sui/read/zone_spawns.js'

/**
 * The context a fight builder needs: the network (drives lazy id resolution) + an optional `ids` injection seam.
 * A narrow local shape (fight entries need no gRPC/kiosk client) that also keeps `context.ids` type-clean.
 * @typedef {object} FightContext
 * @property {'mainnet' | 'testnet' | 'devnet' | 'localnet'} network
 * @property {{ aresrpg?: Record<string, string> }} [ids]
 *   full/partial id set merged OVER the network deployment (offline tests / per-deployment overrides).
 */

// ╔════════════════ [ Create + Join (lifecycle entry) ] ══════════════════════ ]

/**
 * CREATE a Fight over a LIVE world mob-group. ONE PTB, TWO calls (both on the merged package): (1) the CLAIM door
 * (public fun, no `&Random`) travel-verifies + writes the entry checkpoint + frees the spawn and returns a
 * `GroupTicket` HOT POTATO; (2) `fight::create` consumes that ticket IN THE SAME PTB (the ONLY provenance it
 * accepts — F-02 anti-forgery). The `world`/`kiosk`/`pkcap` objects are shared across both calls (one input each);
 * `create` reads the world seed + assembles the creator's combat snapshot itself. First-come is the fight-side
 * `(world, spawn_id)` derived-object claim.
 *
 * Pass `zx`/`zy` for the global-search door; omit them for the occupied-zone door. Supplying the RPC-derived
 * `group_proof: { index, facts, proof }` selects the corresponding proof-taking door; null preserves the original
 * derivation path. Every door returns the same authenticated `GroupTicket` hot potato.
 *
 * DOOR POLARITY (advisor pass-67, 2026-07-17): the OLD derivation door is the SILENT DEFAULT. The cheap proof
 * door composes ONLY when the deployment manifest explicitly carries the diet surface — the ceremony-stamped
 * `ZONE_GROUP_ROOT_PACKAGE_ID` (the `zones::ZoneGroupRootKey` type origin). On an unstamped network a supplied
 * witness is IGNORED and the old claim+create composes byte-identical to the null-witness path — never
 * try-new-fallback-old at runtime (the proof door may not exist on that network's LATEST_PACKAGE_ID; a
 * composed-then-failed tx burns gas and a runtime fallback would mask the misconfiguration).
 * @param {FightContext} context
 */
export function create_fight_ptb(context) {
  const { network } = context
  return ({
    world_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    raised_spell_ids = [],
    spawn_id,
    zx = null,
    zy = null,
    group_proof = /** @type {MobGroupProof|null} */ (null),
    mob_template_id,
    is_public = true,
    party_id = null,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    const committed = a.ZONE_GROUP_ROOT_PACKAGE_ID
      ? validated_group_proof(group_proof, spawn_id)
      : null
    if (committed && (zx == null) !== (zy == null))
      throw new Error('[fight] group_proof requires zx and zy together')
    const in_zone = zx != null && zy != null
    const normalized_zx =
      committed && in_zone
        ? Number(normalized_unsigned(zx, 32, 'group_proof zx'))
        : zx
    const normalized_zy =
      committed && in_zone
        ? Number(normalized_unsigned(zy, 32, 'group_proof zy'))
        : zy
    // Singletons static; runtime objects through the seam — resolved ONCE, reused across both calls.
    // world is &mut in claim_mob_group AND & in create: a caller-cached world REF must carry mutable:true.
    const config = shared_object_arg(
      tx,
      network,
      'GAME_CONFIG',
      false,
      a.GAME_CONFIG,
    )
    const version = shared_object_arg(tx, network, 'VERSION', false, a.VERSION)
    const world = as_object_arg(tx, world_id)
    const kiosk = as_object_arg(tx, kiosk_id)
    const pkcap = as_object_arg(tx, personal_kiosk_cap_id)

    // (1) claim the live group → GroupTicket (hot potato). public fun, NO &Random → precedes the terminal create.
    // With zx/zy → the global-search door (claim any searched zone's group in reach); without → the occupied-zone door.
    const proof_suffix = committed ? '_with_proof' : ''
    const zone_args = in_zone
      ? [tx.pure.u32(Number(normalized_zx)), tx.pure.u32(Number(normalized_zy))]
      : []
    const group_args = committed
      ? [
          tx.pure.u64(committed.index),
          tx.pure.u64(committed.facts.spawn_id),
          tx.pure.id(committed.facts.template_id),
          tx.pure.u32(committed.facts.x),
          tx.pure.u32(committed.facts.z),
          tx.pure.u16(committed.facts.group_size),
          tx.pure.u64(committed.facts.group_seed),
          tx.pure.vector('u8', committed.proof),
        ]
      : [tx.pure.u64(BigInt(spawn_id))]
    const [ticket] = tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::zones::${in_zone ? 'claim_mob_group_in_zone' : 'claim_mob_group'}${proof_suffix}`,
      arguments: [
        world, // world: &mut World
        kiosk, // kiosk: &mut Kiosk
        pkcap, // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID
        ...zone_args,
        ...group_args,
        config, // config: &GameConfig
        version, // version: &Version (THE one shared Version)
        tx.object.clock(), // clock: &Clock (0x6)
      ],
    })

    // (2) create the Fight, consuming the ticket — same package now. DETERMINISTIC (verifier law: spawn rolls
    // moved to place/force_start).
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::fight::create`,
      arguments: [
        shared_object_arg(
          tx,
          network,
          'FIGHT_REGISTRY',
          true,
          a.FIGHT_REGISTRY,
        ), // registry: &mut FightRegistry
        ticket, // ticket: zones::GroupTicket (hot potato — consumed here)
        world, // world: &World (same object; pinned to the ticket)
        kiosk, // kiosk: &mut Kiosk
        pkcap, // pkcap: &PersonalKioskCap
        as_object_arg(tx, mob_template_id), // mob_template: &MobTemplate
        tx.pure.bool(is_public), // is_public: bool
        tx.pure.option('id', party_id), // party_id: Option<ID> (null → none)
        tx.pure.vector('id', raised_spell_ids), // raised_spell_ids: vector<ID> (F-07 — the seat's raised spells; [] = all level 1)
        config, // config: &GameConfig
        version, // version: &Version (core)
        shared_object_arg(
          tx,
          network,
          'ENGINE_VERSION',
          false,
          a.ENGINE_VERSION,
        ), // engine_version: &EngineVersion (the ENGINE package's shared Version)
        tx.object.clock(), // clock: &Clock (0x6)
      ],
    })

    return tx
  }
}

/**
 * JOIN an existing fight during placement (§7). `fight::join` is a `public fun` (NO &Random — the joiner's
 * snapshot is a deterministic geared-combat read; the Clock settles lazy regen before the §17.23 0-HP gate), so
 * this is a plain single-call PTB. `party_id` is the joiner's party
 * (Option<ID>) — required for a private (party-only) fight, ignored for a public one.
 * @param {FightContext} context
 */
export function join_fight_ptb(context) {
  const { network } = context
  return ({
    fight_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    party_id = null,
    raised_spell_ids = [],
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::fight::join`,
      arguments: [
        as_object_arg(tx, fight_id), // fight: &mut Fight (a cached ref must be mutable:true)
        shared_object_arg(
          tx,
          network,
          'FIGHT_REGISTRY',
          true,
          a.FIGHT_REGISTRY,
        ), // registry: &mut FightRegistry (S-12f in-fight latch)
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID
        tx.pure.option('id', party_id), // joiner_party: Option<ID> (null → none)
        tx.pure.vector('id', raised_spell_ids), // raised_spell_ids: vector<ID> (F-07)
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version (core)
        shared_object_arg(
          tx,
          network,
          'ENGINE_VERSION',
          false,
          a.ENGINE_VERSION,
        ), // engine_version: &EngineVersion (the ENGINE package's shared Version)
        tx.object.clock(), // clock: &Clock (0x6) — appended LAST (before auto-injected ctx)
        // ctx: &TxContext is auto-injected — NOT a PTB argument
      ],
    })

    return tx
  }
}

// ╔════════════════ [ Placement → Active ] ═══════════════════════════════════ ]

/**
 * PLACE: pick your seat's near-side start cell + READY in one call (`turns::place`, entry). The LAST ready
 * auto-starts the fight, so `&Random` (0x8) is LAST (the auto-start resolves any leading mob turns).
 * @param {FightContext} context
 */
export function place_ptb(context) {
  const { network } = context
  return ({ fight_id, character_id, cell, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.ENGINE_LATEST_PACKAGE_ID}::turns::place`,
      arguments: [
        as_object_arg(tx, fight_id), // fight: &mut Fight (a cached ref must be mutable:true)
        tx.pure.id(character_id), // character_id: ID
        tx.pure.u64(BigInt(cell)), // cell: u64 (a near-side start cell)
        shared_object_arg(
          tx,
          network,
          'ENGINE_VERSION',
          false,
          a.ENGINE_VERSION,
        ), // version: &Version — the ENGINE package's own shared Version (no GameConfig: the engine reads its create-time Dials snapshot)
        tx.object.clock(), // clock: &Clock (0x6)
        random_arg(network, tx), // r: &Random (0x8) — LAST (pinned when stamped → build-offline)
      ],
    })

    return tx
  }
}

/**
 * FORCE-START: permissionless placement force-start once the placement window has expired (`turns::force_start`,
 * entry) — marks every still-alive seat ready in place and flips ACTIVE. Terminal `&Random`.
 * @param {FightContext} context
 */
export function force_start_ptb(context) {
  const { network } = context
  return ({ fight_id, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.ENGINE_LATEST_PACKAGE_ID}::turns::force_start`,
      arguments: [
        as_object_arg(tx, fight_id), // fight: &mut Fight (a cached ref must be mutable:true)
        shared_object_arg(
          tx,
          network,
          'ENGINE_VERSION',
          false,
          a.ENGINE_VERSION,
        ), // version: &Version — the ENGINE package's own shared Version (no GameConfig: the engine reads its create-time Dials snapshot)
        tx.object.clock(), // clock: &Clock (0x6)
        random_arg(network, tx), // r: &Random (0x8) — LAST (pinned when stamped → build-offline)
      ],
    })

    return tx
  }
}

/**
 * CRANK: permissionless forward-crank of a STALLED active fight whose current turn deadline has passed
 * (`turns::crank`, entry) — forfeits the overdue turn and resolves forward (mobs act, next player lands).
 * Anyone may call. Terminal `&Random` (mob turns draw entropy).
 * @param {FightContext} context
 */
export function crank_ptb(context) {
  const { network } = context
  return ({ fight_id, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.ENGINE_LATEST_PACKAGE_ID}::turns::crank`,
      arguments: [
        as_object_arg(tx, fight_id), // fight: &mut Fight (a cached ref must be mutable:true)
        shared_object_arg(
          tx,
          network,
          'ENGINE_VERSION',
          false,
          a.ENGINE_VERSION,
        ), // version: &Version — the ENGINE package's own shared Version (no GameConfig: the engine reads its create-time Dials snapshot)
        tx.object.clock(), // clock: &Clock (0x6)
        random_arg(network, tx), // r: &Random (0x8) — LAST (pinned when stamped → build-offline)
      ],
    })

    return tx
  }
}

// ╔════════════════ [ In-turn actions (deterministic — batchable; PASS is the one &Random) ] ═ ]

/**
 * MOVE: spend MP to walk to `cell` (BFS-reachable around bodies/blockers) — `actions::act_move`, entry.
 * `&Random`-FREE + deterministic (single-PTB turn law): composes freely before the batch's terminal pass.
 * Requires it to BE the caller's turn (a stalled other turn aborts turns::ESomeoneOverdue → crank first).
 * @param {FightContext} context
 */
export function act_move_ptb(context) {
  const { network } = context
  return ({ fight_id, character_id, cell, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.ENGINE_LATEST_PACKAGE_ID}::actions::act_move`,
      arguments: [
        as_object_arg(tx, fight_id), // fight: &mut Fight (a cached ref must be mutable:true)
        tx.pure.id(character_id), // character_id: ID
        tx.pure.u64(BigInt(cell)), // cell: u64 (destination)
        shared_object_arg(
          tx,
          network,
          'ENGINE_VERSION',
          false,
          a.ENGINE_VERSION,
        ), // version: &Version — the ENGINE package's own shared Version (no GameConfig: the engine reads its create-time Dials snapshot)
        tx.object.clock(), // clock: &Clock (0x6) — LAST (no &Random: deterministic action)
      ],
    })

    return tx
  }
}

/**
 * WEAPON attack (§17.27): AP-priced strike at `target_cell`, repeatable while AP lasts (`actions::act_weapon`,
 * entry). `&Random`-FREE — the crit derives from the public turn seed; batchable before the terminal pass.
 * @param {FightContext} context
 */
export function act_weapon_ptb(context) {
  const { network } = context
  return ({ fight_id, character_id, target_cell, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.ENGINE_LATEST_PACKAGE_ID}::actions::act_weapon`,
      arguments: [
        as_object_arg(tx, fight_id), // fight: &mut Fight (a cached ref must be mutable:true)
        tx.pure.id(character_id), // character_id: ID
        tx.pure.u64(BigInt(target_cell)), // target_cell: u64
        shared_object_arg(
          tx,
          network,
          'ENGINE_VERSION',
          false,
          a.ENGINE_VERSION,
        ), // version: &Version — the ENGINE package's own shared Version (no GameConfig: the engine reads its create-time Dials snapshot)
        tx.object.clock(), // clock: &Clock (0x6) — LAST (no &Random: deterministic action)
      ],
    })

    return tx
  }
}

/**
 * CAST a spell at `target_cell` (`actions::act_cast`, entry). `spell_template_id` is the `&SpellTemplate` shared
 * object (per-(class,unlock)) the resolver reads. `&Random`-FREE — the resolver is fully deterministic (turn-seed
 * crits, authored-base damage); batchable before the terminal pass.
 * @param {FightContext} context
 */
export function act_cast_ptb(context) {
  const { network } = context
  return ({
    fight_id,
    character_id,
    spell_template_id,
    target_cell,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.ENGINE_LATEST_PACKAGE_ID}::actions::act_cast`,
      arguments: [
        as_object_arg(tx, fight_id), // fight: &mut Fight (a cached ref must be mutable:true)
        tx.pure.id(character_id), // character_id: ID
        as_object_arg(tx, spell_template_id), // spell: &SpellTemplate
        tx.pure.u64(BigInt(target_cell)), // target_cell: u64
        shared_object_arg(
          tx,
          network,
          'ENGINE_VERSION',
          false,
          a.ENGINE_VERSION,
        ), // version: &Version — the ENGINE package's own shared Version (no GameConfig: the engine reads its create-time Dials snapshot)
        tx.object.clock(), // clock: &Clock (0x6) — LAST (no &Random: deterministic action)
      ],
    })

    return tx
  }
}

/**
 * PASS: end your turn (`actions::act_pass`, entry) — advances the queue (mobs act, next player lands). The
 * turn's ONE terminal `&Random` command (the mob wave draws): in a batch it must be the LAST call.
 * @param {FightContext} context
 */
export function act_pass_ptb(context) {
  const { network } = context
  return ({ fight_id, character_id, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.ENGINE_LATEST_PACKAGE_ID}::actions::act_pass`,
      arguments: [
        as_object_arg(tx, fight_id), // fight: &mut Fight (a cached ref must be mutable:true)
        tx.pure.id(character_id), // character_id: ID
        shared_object_arg(
          tx,
          network,
          'ENGINE_VERSION',
          false,
          a.ENGINE_VERSION,
        ), // version: &Version — the ENGINE package's own shared Version (no GameConfig: the engine reads its create-time Dials snapshot)
        tx.object.clock(), // clock: &Clock (0x6)
        random_arg(network, tx), // r: &Random (0x8) — LAST (pinned when stamped → build-offline)
      ],
    })

    return tx
  }
}

/**
 * TESTNET-MEASURED worst-case `commit_turn` gas in MIST (the PRE-REBATE peak: computation + storage, BEFORE the
 * rebate lands — a budget must cover the peak charge, not the net). Used ONLY to budget the SOLO commit whose
 * dry-run the <1s latency lane SKIPS: a solo fight can never abort `turns::ESomeoneOverdue` (that
 * needs a second player seat — turns.move `assert_my_turn`), so its shape needs no per-commit simulate. MEASURE
 * THE HEAVY CASE — a full move+weapon+cast+pass turn cranking a MULTI-MOB wave (the crank compute, not a solo
 * mob) — so the ×1.5 headroom covers the worst real turn; a low guess fails ON-CHAIN and burns the budget.
 * Kept `null` (never a guess) so derivation refuses loudly until it is stamped at the publish rehearsal.
 *
 * MEASURED 2026-07-11 (lineage-6 core 0xa837cc99…, ENGINE 0x…): heavy multi-mob commit dry-run digest
 * <DIGEST> — computation <C> + storage <S> ⇒ pre-rebate peak <PEAK> MIST. ×1.5 ≈ <BUDGET> MIST, under the
 * 0.25 SUI ceiling. Re-measure on any engine turns/actions/mob change (crank compute is the driver).
 * @type {number | null}
 */
export const MEASURED_TURN_GAS_MIST = null

/**
 * Derive the SOLO-commit gas budget (MIST): `ceil(MEASURED_TURN_GAS_MIST × 1.5)`. REFUSES LOUDLY when unmeasured
 * — the solo commit skips its dry-run, so an unmeasured budget cannot be derived from simulation (a low guess
 * fails on-chain and burns the budget). Multiplayer commits never call this (they keep the sim → budget = sim ×1.5).
 * @returns {number}
 */
export function turn_gas_budget_mist() {
  if (MEASURED_TURN_GAS_MIST == null)
    throw new Error(
      '[fight] MEASURED_TURN_GAS_MIST is unset — the solo commit skips its dry-run, so its gas budget cannot be ' +
        'derived from simulation. Measure a real HEAVY multi-mob commit_turn at the publish rehearsal and stamp ' +
        'the constant. Refusing to guess (a low guess fails on-chain and burns the full budget).',
    )
  return Math.ceil(MEASURED_TURN_GAS_MIST * 1.5)
}

/**
 * COMMIT the WHOLE TURN as ONE PTB: every staged
 * action composes as a sequential deterministic MoveCall — kind 'move' → act_move, 'weapon' → act_weapon,
 * 'cast' → act_cast — then `act_pass` lands LAST as the tx's single terminal `&Random` command (the mob wave's
 * entropy; Sui forbids any further command after it). ATOMIC: one illegal action reverts the whole turn —
 * nothing partially applies, and a self-kill mid-batch walls the tail (actions::EActorDead) so the batch
 * reverts harmlessly. The single-action builders above stay legal for INCREMENTAL play (act now, think, act
 * again — a turn may still be N txs); this is the commit flow's batch. An empty `actions` array is the skip:
 * the PTB is exactly one act_pass.
 * @param {FightContext} context
 * @returns {(args: { fight_id: string | object, character_id: string, actions?: Array<
 *   { kind: 'move', cell: number } |
 *   { kind: 'weapon', target_cell: number } |
 *   { kind: 'cast', spell_template_id: string | object, target_cell: number }
 * >, tx?: Transaction }) => Transaction}
 */
export function commit_turn_ptb(context) {
  return ({ fight_id, character_id, actions = [], tx = new Transaction() }) => {
    for (const action of actions) {
      if (action.kind === 'move')
        act_move_ptb(context)({ fight_id, character_id, cell: action.cell, tx })
      else if (action.kind === 'weapon')
        act_weapon_ptb(context)({
          fight_id,
          character_id,
          target_cell: action.target_cell,
          tx,
        })
      else if (action.kind === 'cast')
        act_cast_ptb(context)({
          fight_id,
          character_id,
          spell_template_id: action.spell_template_id,
          target_cell: action.target_cell,
          tx,
        })
      else
        throw new Error(
          `commit_turn_ptb: unknown action kind ${/** @type {any} */ (action).kind}`,
        )
    }
    return act_pass_ptb(context)({ fight_id, character_id, tx })
  }
}

// ╔════════════════ [ ABANDON (quit = death) ] ════════════════════════════ ]

/**
 * ABANDON the fight (S-80): abandoning any fight is treated as a death
 * (`actions::abandon`, entry). A SEATED player (auth by sender, NOT gated on whose turn it is) drops to 0 HP
 * through the SAME damage write a killing hit uses, and the fight folds forward exactly as any death does: a
 * mid-turn abandoner hands the queue on, a side/party wipe goes terminal and settles normally (the abandoner
 * still gets its FightOutcome — no escape, no loot-path change). Legal in PLACEMENT and ACTIVE; a terminal fight
 * aborts (EFightOver=105) and an already-dead seat aborts (EAlreadyDead=106 — idempotence). Byte-identical
 * 5-arg shape to `act_pass` (no GameConfig — the engine reads its create-time Dials snapshot); terminal
 * `&Random` (an on-turn handoff resolves the interleaved mob turns that follow).
 * @param {FightContext} context
 */
export function abandon_fight_ptb(context) {
  const { network } = context
  return ({ fight_id, character_id, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.ENGINE_LATEST_PACKAGE_ID}::actions::abandon`,
      arguments: [
        as_object_arg(tx, fight_id), // fight: &mut Fight (a cached ref must be mutable:true)
        tx.pure.id(character_id), // character_id: ID
        shared_object_arg(
          tx,
          network,
          'ENGINE_VERSION',
          false,
          a.ENGINE_VERSION,
        ), // version: &Version — the ENGINE package's own shared Version (no GameConfig: the engine reads its create-time Dials snapshot)
        tx.object.clock(), // clock: &Clock (0x6)
        random_arg(network, tx), // r: &Random (0x8) — LAST (pinned when stamped → build-offline)
      ],
    })

    return tx
  }
}

// ╔════════════════ [ Settlement + loot (claims v2 — keybound FightResult) ] ══ ]

/**
 * SETTLE a TERMINAL fight (`settlement::settle_and_destroy`, ENGINE package, entry, NO &Random): mints one soulbound
 * `FightOutcome` per seat → its owner, then DELETES the shared Fight in the same call (the `fight` is passed BY
 * VALUE). Anyone may call once terminal (the storage rebate is the janitor's tip). No `FightResult`/loot here — each
 * owner later turns their `FightOutcome` into a core `FightResult` via `open_result_ptb` (their own terminal &Random).
 * NOTE module = `settlement`, package = ENGINE (never core `results`), version = ENGINE_VERSION (never core VERSION),
 * and NO GameConfig (the engine reads its create-time Dials snapshot).
 * @param {FightContext} context
 */
export function settle_fight_ptb(context) {
  const { network } = context
  return ({ fight_id, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.ENGINE_LATEST_PACKAGE_ID}::settlement::settle_and_destroy`,
      arguments: [
        as_object_arg(tx, fight_id), // fight: Fight (BY VALUE — deleted; a cached ref must be mutable:true)
        shared_object_arg(
          tx,
          network,
          'FIGHT_REGISTRY',
          true,
          a.FIGHT_REGISTRY,
        ), // registry: &mut FightRegistry (mints one FightOutcome per seat, frees every latch)
        shared_object_arg(
          tx,
          network,
          'ENGINE_VERSION',
          false,
          a.ENGINE_VERSION,
        ), // version: &Version — the ENGINE package's own shared Version (no GameConfig)
        // ctx: &mut TxContext is auto-injected
      ],
    })

    return tx
  }
}

/**
 * OPEN your `FightOutcome` (`results::open`, CORE package, entry, terminal &Random): CONSUMES the ENGINE settlement
 * artifact BY VALUE and mints your soulbound core `FightResult`, rolling the loot checklist + landing the XP/HP
 * write-backs on YOUR kiosk-borrowed character (bound to `outcome.character` by construction). Once, anytime — an
 * outcome never expires. Only the owning account can call (owned object). Exactly ONE version (the deployed door dropped the
 * separate items_version — it is the same core VERSION).
 * @param {FightContext} context
 */
export function open_result_ptb(context) {
  const { network } = context
  return ({
    outcome_id,
    kiosk_id,
    personal_kiosk_cap_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::results::open`,
      arguments: [
        as_object_arg(tx, outcome_id), // outcome: FightOutcome (BY VALUE — the ENGINE settlement artifact, consumed here; OWNED — a cached ref is {objectId, version, digest})
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version (the ONE core version — no separate items_version)
        tx.object.clock(), // clock: &Clock (0x6)
        random_arg(network, tx), // r: &Random (0x8) — LAST (pinned when stamped → build-offline)
      ],
    })

    return tx
  }
}

// ╔═════ [ Settle + open, COMPOSED (PTB-first: closes the settle→open stranded-outcome gap) ] ═ ]

/**
 * SETTLE a TERMINAL fight AND TAKE the caller's OWN seat's `FightOutcome` BY VALUE, as a chainable PTB result
 * (`settlement::settle_and_take`, ENGINE package, `public fun` — NOT entry, so it composes: a prior command's Fight
 * can flow in and the returned outcome can flow into the next same-PTB call). Every OTHER seat's outcome still
 * transfers to its owner exactly as `settle_and_destroy`; only `character_id`'s seat is possession-asserted
 * on-chain and handed back (a stranger cannot take a victim's outcome). Deletes the shared Fight (BY VALUE), same
 * as the destroy door. NO &Random (deterministic settlement — identical shape to `settle_and_destroy` plus the
 * `character` id). Read firsthand 2026-07-10 from packages/move/engine/sources/settlement.move.
 *
 * Returns `{ tx, outcome }` — NOT a bare `tx` like every sibling builder: `outcome` is the moveCall's RESULT
 * HANDLE (a TransactionArgument referencing this command's return value), not an object id. It only exists on
 * THIS `tx` instance and only until the PTB executes — feed it directly into `open_taken_ptb`'s `outcome` param
 * (never through `as_object_arg`, which is for ids/refs of objects that already exist on-chain).
 * @param {FightContext} context
 */
export function settle_and_take_ptb(context) {
  const { network } = context
  return ({ fight_id, character_id, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    const [outcome] = tx.moveCall({
      target: `${a.ENGINE_LATEST_PACKAGE_ID}::settlement::settle_and_take`,
      arguments: [
        as_object_arg(tx, fight_id), // fight: Fight (BY VALUE — deleted; a cached ref must be mutable:true)
        tx.pure.id(character_id), // character: ID (the caller's OWN seat — possession-gated on-chain)
        shared_object_arg(
          tx,
          network,
          'FIGHT_REGISTRY',
          true,
          a.FIGHT_REGISTRY,
        ), // registry: &mut FightRegistry (mints every seat's outcome, frees every latch)
        shared_object_arg(
          tx,
          network,
          'ENGINE_VERSION',
          false,
          a.ENGINE_VERSION,
        ), // version: &Version — the ENGINE package's own shared Version (no GameConfig)
        // ctx: &mut TxContext is auto-injected
      ],
    })

    return { tx, outcome }
  }
}

/**
 * OPEN a `FightOutcome` taken as a SAME-PTB result handle (`results::open_taken`, CORE package, `public fun` — the
 * composable twin of `open`; byte-identical body/semantics, terminal &Random). `outcome` MUST be the RESULT HANDLE
 * `settle_and_take_ptb` returned on the SAME `tx` (or another same-PTB producer) — it is placed on the arguments
 * array AS-IS, exactly like `create_fight_ptb`'s ticket-chaining, never through `as_object_arg` (a PTB result
 * doesn't exist as an on-chain object/ref until this tx executes). `tx` is therefore REQUIRED here (no default) —
 * there is no standalone use; the handle is only valid on the tx that produced it. Read firsthand 2026-07-10 from
 * packages/move/aresrpg/sources/results.move.
 * @param {FightContext} context
 */
export function open_taken_ptb(context) {
  const { network } = context
  return ({ outcome, kiosk_id, personal_kiosk_cap_id, tx }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::results::open_taken`,
      arguments: [
        outcome, // outcome: FightOutcome (BY VALUE — the settle_and_take RESULT HANDLE; NEVER an object id)
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version (the ONE core version — no separate items_version)
        tx.object.clock(), // clock: &Clock (0x6)
        random_arg(network, tx), // r: &Random (0x8) — LAST (pinned when stamped → build-offline)
      ],
    })

    return tx
  }
}

/**
 * SETTLE a latched dungeon run against a `FightOutcome` held as a SAME-PTB RESULT HANDLE (`dungeon::settle_run`,
 * CORE package, NO &Random) — the composable twin of `@aresrpg/sdk/dungeon`'s `settle_run_ptb`, byte-identical
 * body/semantics EXCEPT its `outcome` is the `settle_and_take_ptb` result handle placed on the arguments array
 * AS-IS (never through `as_object_arg` — a PTB result isn't an on-chain object until this tx executes), exactly
 * like `open_taken_ptb`. It BORROWS the outcome (`&FightOutcome`), so it composes BETWEEN `settle_and_take`
 * (which produces the handle) and `open_taken` (which CONSUMES it BY VALUE) in ONE PTB: settle_and_take →
 * settle_run(&handle) → open_taken(handle), the terminal &Random last. The pass is passed BY VALUE (consumed on
 * defeat / last-room completion; returned to the owning account on a non-last victory-advance). `tx` is REQUIRED (no
 * default) — the handle is only valid on the tx that produced it. Read firsthand 2026-07-10 from
 * packages/move/aresrpg/sources/dungeon.move.
 * @param {FightContext} context
 */
export function settle_run_taken_ptb(context) {
  const { network } = context
  return ({
    run_pass_id,
    outcome,
    world_id,
    kiosk_id,
    personal_kiosk_cap_id,
    tx,
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.DUNGEON_PACKAGE_ID}::dungeon::settle_run`,
      arguments: [
        as_object_arg(tx, run_pass_id), // pass: RunPass (BY VALUE; OWNED)
        outcome, // outcome: &FightOutcome (the settle_and_take RESULT HANDLE — borrowed, NEVER an object id)
        as_object_arg(tx, world_id), // world: &World
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk holding the run's bound character
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version (core)
      ],
    })

    return tx
  }
}

/**
 * CONVENIENCE compose: settle a terminal open-world fight AND open the caller's own outcome in ONE PTB —
 * `settle_and_take_ptb` → `open_taken_ptb`, the &Random-drawing call LAST (Random-PTB compliance: Sui forbids any
 * command after a Random moveCall bar TransferObjects/MergeCoins). This is the PLAIN open-world two-call chain
 * only — the dungeon/kolizeum variants (which insert their own `&outcome` read BEFORE the open) are the CLIENT
 * lane's composition to build, not this SDK's (YAGNI).
 * @param {FightContext} context
 */
export function settle_open_world_ptb(context) {
  return ({
    fight_id,
    character_id,
    kiosk_id,
    personal_kiosk_cap_id,
    tx = new Transaction(),
  }) => {
    const { tx: chained, outcome } = settle_and_take_ptb(context)({
      fight_id,
      character_id,
      tx,
    })
    return open_taken_ptb(context)({
      outcome,
      kiosk_id,
      personal_kiosk_cap_id,
      tx: chained,
    })
  }
}

/**
 * MINT the rolled loot owed for ONE item template into the account's personal kiosk (`results::mint_rolled`, entry,
 * NO &Random) — stackables mint as one stack, gear as qty singletons, kiosk-lock law enforced. Call once per
 * distinct template the roll owes (read the owed qty from the opened result, `rolled_qty`). The merge DROPPED the
 * registry arg here (it only custodied the dead mint cap). `item_template_id` is the `&ItemTemplate`.
 * @param {FightContext} context
 */
export function mint_rolled_ptb(context) {
  const { network } = context
  return ({
    result_id,
    item_template_id,
    kiosk_id,
    personal_kiosk_cap_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::results::mint_rolled`,
      arguments: [
        as_object_arg(tx, result_id), // result: &mut FightResult (OWNED)
        as_object_arg(tx, item_template_id), // template: &ItemTemplate
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version (the ONE core version — no separate items_version)
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY), // policy: &TransferPolicy<Item>
        // ctx: &mut TxContext is auto-injected
      ],
    })

    return tx
  }
}

/**
 * BURN an OPENED, EMPTIED `FightResult` for the storage rebate (`results::burn_result`, entry, NO &Random). The
 * `result` is passed BY VALUE (deleted). Aborts on-chain while rolled loot remains — mint it all first.
 * @param {FightContext} context
 */
export function burn_result_ptb(context) {
  const { network } = context
  return ({ result_id, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::results::burn_result`,
      arguments: [
        as_object_arg(tx, result_id), // result: FightResult (BY VALUE — deleted; OWNED)
      ],
    })

    return tx
  }
}
