import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
  random_shared_ref,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

// LOOT-BOX PTB BUILDERS for the merged `aresrpg` package's pet loot-boxes — rolls on buy with a nice
// animation, in a separate shop section. TWO-PHASE door (locked with the Move lane), mirroring the fight-loot
// pattern: `open_box` (terminal &Random) burns the bought box, rolls, and hands the sender a SOULBOUND
// `PetBoxClaim { opener, rolled_template }` + emits `LootBoxOpened { box_template, rolled_template, opener }`;
// `claim_pet` (deterministic) then consumes that claim + the rolled template ref to mint + kiosk-lock the pet.
// The frontend reads `rolled_template` off the event to drive a TRUTHFUL reveal (the roll is the chain's, never
// a client re-roll), then the reveal card's COLLECT button composes `claim_pet`.
//
// RECONCILED against the published `loot_box.move` (module `aresrpg::loot_box` — note the underscore; the SDK
// target strings previously drifted to `lootbox::*` and 404'd the arity/keep-set gates). Targets are
// `loot_box::open_box` / `loot_box::claim_pet`; arg order/set below matches the Move signatures exactly
// (registry/config/policy singletons resolved via `shared_object_arg`, never caller-supplied — the frontend
// action reads the result off the EVENT NAME and needs no change).
//
// TX-RETRY LAW (money safety): an EXECUTED open/claim that FAILED (a digest exists) is NEVER auto-retried.

// &Random (0x8) PIN — identical to items_shop.js: pins the system object via `random_shared_ref` when stamped,
// else falls back to the unresolved `tx.object.random()`. Byte-identical (mutable:false, same 0x8).
/** @param {'mainnet'|'testnet'|'devnet'|'localnet'} network @param {import('@mysten/sui/transactions').Transaction} tx */
function random_arg(network, tx) {
  const ref = random_shared_ref(network)
  return ref ? tx.sharedObjectRef(ref) : tx.object.random()
}

// `loot_box::open_box` gas CEILING in MIST: a &Random open is un-simulatable, but a
// Sui budget is a CEILING, never the charge — success pays ACTUAL gas (computation+storage−rebate); only a LOW
// budget is dangerous (aborts on-chain, burns what ran). So we ship a generous fixed ceiling instead of refusing
// until a measured value exists. tx.js's open_box probe logs real gasUsed from live opens — tighten from that
// evidence if it ever matters. ×1.5 headroom below keeps the effective ceiling ≤ the 0.1 SUI hard cap.
/** @type {number} */
export const MEASURED_OPEN_BOX_GAS_MIST = 50_000_000 // 0.05 SUI ceiling (charged: actual, typically ~a few M MIST)

/**
 * Derive open_box gas: ceil(CEILING × 1.5) = 0.075 SUI max lock, charged at actual. Caller may override with
 * `gas_budget_mist`. The null-refusal path is kept for future re-keys that deliberately unset the constant.
 * @returns {number}
 */
export function open_box_gas_budget_mist() {
  if (MEASURED_OPEN_BOX_GAS_MIST == null)
    throw new Error(
      '[lootbox] MEASURED_OPEN_BOX_GAS_MIST is unset — a &Random open is UN-SIMULATABLE, so its gas budget ' +
        'cannot be derived. Stamp the ceiling (budget = ceiling, charged = actual; only a LOW value burns). ' +
        'Refusing to guess low.',
    )
  return Math.ceil(MEASURED_OPEN_BOX_GAS_MIST * 1.5)
}

/**
 * PHASE 1 — open_box (TERMINAL &Random): burn the kiosk-locked box, roll, hand back a soulbound PetBoxClaim.
 * `box_id` = the kiosk-locked loot-box Item to consume; `box_template_id` = its own shared ItemTemplate (the roll
 * pool). Un-simulatable ⇒ the budget comes from the measured constant × 1.5 unless `gas_budget_mist` is passed.
 * The moveCall is the LAST command (only coin/prep may precede a &Random call — here nothing does). See the
 * TX-RETRY LAW above: never auto-retry an executed failure.
 * @param {import("../../../types.js").Context} context
 */
export function open_box_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    box_id,
    box_template_id,
    gas_budget_mist,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!kiosk_id || !personal_kiosk_cap_id)
      throw new Error(
        '[open_box_ptb] kiosk_id and personal_kiosk_cap_id are required — the personal kiosk holding the box + its owner cap.',
      )
    if (!box_id)
      throw new Error(
        '[open_box_ptb] box_id is required — the kiosk-locked loot-box Item to consume.',
      )
    if (!box_template_id)
      throw new Error(
        "[open_box_ptb] box_template_id is required — the box's shared ItemTemplate (carries the pet roll pool).",
      )

    tx.setGasBudget(gas_budget_mist ?? open_box_gas_budget_mist())

    tx.moveCall({
      target: `${a.GIFTING_PACKAGE_ID}::loot_box::open_box`,
      arguments: [
        shared_object_arg(tx, network, 'LOOT_REGISTRY', false, a.LOOT_REGISTRY), // registry: &LootRegistry
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(box_id), // box_item_id: ID (the loot-box stack to consume)
        as_object_arg(tx, box_template_id), // box_template: &ItemTemplate (the box's own template — the roll pool)
        shared_object_arg(
          tx,
          network,
          'EXTRACT_POLICY',
          false,
          a.EXTRACT_POLICY,
        ), // xpolicy: &ItemExtractPolicy (burn seam)
        shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY), // market_policy: &TransferPolicy<Item> (mint lock)
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig (kill-switch)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
        random_arg(network, tx), // r: &Random (0x8) — TERMINAL, nothing may follow
      ],
    })
    return tx // TERMINAL
  }
}

/**
 * PHASE 2 — claim_pet (DETERMINISTIC): consume the PetBoxClaim + the rolled template ref → mint + kiosk-lock the
 * pet. `claim_id` = the soulbound PetBoxClaim (consumed by value); `rolled_template_id` = the rolled pet's shared
 * ItemTemplate (read off the LootBoxOpened event). Simulatable ⇒ NO pinned gas (the caller's run_tx dry-runs it);
 * freely composable (no &Random).
 * @param {import("../../../types.js").Context} context
 */
export function claim_pet_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    claim_id,
    rolled_template_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!kiosk_id || !personal_kiosk_cap_id)
      throw new Error(
        '[claim_pet_ptb] kiosk_id and personal_kiosk_cap_id are required — the personal kiosk to mint the pet into.',
      )
    if (!claim_id)
      throw new Error(
        '[claim_pet_ptb] claim_id is required — the soulbound PetBoxClaim to consume.',
      )
    if (!rolled_template_id)
      throw new Error(
        "[claim_pet_ptb] rolled_template_id is required — the rolled pet's shared ItemTemplate (from the LootBoxOpened event).",
      )

    tx.moveCall({
      target: `${a.GIFTING_PACKAGE_ID}::loot_box::claim_pet`,
      arguments: [
        as_object_arg(tx, claim_id), // claim: PetBoxClaim (owned, consumed by value)
        as_object_arg(tx, rolled_template_id), // rolled_template: &ItemTemplate (the pet's template)
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig (gifting split: param 3)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY), // policy: &TransferPolicy<Item> (mint lock)
      ],
    })
    return tx
  }
}
