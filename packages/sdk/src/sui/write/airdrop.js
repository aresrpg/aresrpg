// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  aresrpg_deployment,
  shared_object_arg,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

import { new_ptb } from './header.js'

// AIRDROP PTB BUILDERS for the merged `aresrpg` package's `airdrop` module — whitelist claim-MINT for
// external-collection holders (design `docs/ITEM_SEND_PLAN.md` Part B). The
// reserved item MINTS directly into the whitelisted signer's OWN personal kiosk, kiosk-locked — a mint is a
// first acquisition, not a trade, so NO royalty is charged and NONE is bypassed (the kiosk-lock constitution
// stays intact). One claim per address (the claim REMOVES the claimer from the on-chain whitelist).
//
// The player CLAIM is `airdrop_claim_ptb`; the admin ceremony (create / add / remove / close) rides the
// AdminCap composers below (the SDK is the tx choke — CLAUDE.md principle 4). Mirrors lootbox.js / shop idioms.
//
// FROZEN Move signatures (read firsthand from packages/move/aresrpg/sources/airdrop.move):
//   public fun claim(airdrop: &mut Airdrop, template: &ItemTemplate, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap,
//     policy: &TransferPolicy<Item>, config: &GameConfig, version: &Version, ctx)
//   public fun admin_create(cap: &AdminCap, template: &ItemTemplate, name: String, description: String, version, ctx)
//   public fun admin_add_addresses(cap: &AdminCap, airdrop: &mut Airdrop, addresses: vector<address>, version, ctx)
//   public fun admin_remove_addresses(cap: &AdminCap, airdrop: &mut Airdrop, addresses: vector<address>, version, ctx)
//   public fun admin_close(cap: &AdminCap, airdrop: Airdrop, version, ctx)

/**
 * CLAIM the reserved item: the whitelisted signer mints ONE into their OWN personal kiosk, kiosk-locked. The
 * ITEM_POLICY is READ-ONLY (a mint `lock`s, it never `purchase`s — no royalty, no policy mutation). Aborts
 * `ENotEligible` if the signer is not on the whitelist (or already claimed) and `EWrongTemplate` if `template_id`
 * is not the drop's. Claim gas is sponsorable (aresrpg-family call).
 * @param {import("../../../types.js").Context} context
 */
export function airdrop_claim_ptb(context) {
  const { network } = context
  return ({
    airdrop_id,
    template_id,
    kiosk_id,
    personal_kiosk_cap_id,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!airdrop_id || !template_id || !kiosk_id || !personal_kiosk_cap_id)
      throw new Error(
        '[airdrop_claim_ptb] airdrop_id, template_id, kiosk_id and personal_kiosk_cap_id are all required.',
      )
    tx.moveCall({
      target: `${a.GIFTING_PACKAGE_ID}::airdrop::claim`,
      arguments: [
        as_object_arg(tx, airdrop_id), // airdrop: &mut Airdrop (shared; whitelist row removed)
        as_object_arg(tx, template_id), // template: &ItemTemplate (asserted == the drop's)
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk (the claimer's OWN personal kiosk)
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap (the claimer's)
        shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY), // policy: &TransferPolicy<Item> (read-only — mint-lock)
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
      ],
    })
    return tx
  }
}

/**
 * ADMIN: create + share an `Airdrop` for `template_id` with an empty whitelist (populate via
 * `airdrop_add_addresses_ptb`). AdminCap + version gated on-chain.
 * @param {import("../../../types.js").Context} context
 */
export function airdrop_create_ptb(context) {
  const { network } = context
  return ({
    admin_cap_id,
    template_id,
    name,
    description = '',
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!admin_cap_id || !template_id || !name)
      throw new Error(
        '[airdrop_create_ptb] admin_cap_id, template_id and name are required.',
      )
    tx.moveCall({
      target: `${a.GIFTING_PACKAGE_ID}::airdrop::admin_create`,
      arguments: [
        as_object_arg(tx, admin_cap_id), // cap: &AdminCap
        as_object_arg(tx, template_id), // template: &ItemTemplate (must exist)
        tx.pure.string(name), // name: String
        tx.pure.string(description), // description: String
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
      ],
    })
    return tx
  }
}

/**
 * ADMIN: add eligible `addresses` to a drop's whitelist (idempotent on-chain). AdminCap + version gated.
 * @param {import("../../../types.js").Context} context
 */
export function airdrop_add_addresses_ptb(context) {
  const { network } = context
  return ({
    admin_cap_id,
    airdrop_id,
    addresses,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!admin_cap_id || !airdrop_id)
      throw new Error(
        '[airdrop_add_addresses_ptb] admin_cap_id and airdrop_id are required.',
      )
    if (!Array.isArray(addresses) || addresses.length === 0)
      throw new Error(
        '[airdrop_add_addresses_ptb] addresses must be a non-empty array.',
      )
    tx.moveCall({
      target: `${a.GIFTING_PACKAGE_ID}::airdrop::admin_add_addresses`,
      arguments: [
        as_object_arg(tx, admin_cap_id), // cap: &AdminCap
        as_object_arg(tx, airdrop_id), // airdrop: &mut Airdrop
        tx.pure.vector('address', addresses), // addresses: vector<address>
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
      ],
    })
    return tx
  }
}

/**
 * ADMIN: remove `addresses` from a drop's whitelist (idempotent on-chain). AdminCap + version gated.
 * @param {import("../../../types.js").Context} context
 */
export function airdrop_remove_addresses_ptb(context) {
  const { network } = context
  return ({
    admin_cap_id,
    airdrop_id,
    addresses,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!admin_cap_id || !airdrop_id)
      throw new Error(
        '[airdrop_remove_addresses_ptb] admin_cap_id and airdrop_id are required.',
      )
    if (!Array.isArray(addresses) || addresses.length === 0)
      throw new Error(
        '[airdrop_remove_addresses_ptb] addresses must be a non-empty array.',
      )
    tx.moveCall({
      target: `${a.GIFTING_PACKAGE_ID}::airdrop::admin_remove_addresses`,
      arguments: [
        as_object_arg(tx, admin_cap_id), // cap: &AdminCap
        as_object_arg(tx, airdrop_id), // airdrop: &mut Airdrop
        tx.pure.vector('address', addresses), // addresses: vector<address>
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
      ],
    })
    return tx
  }
}

/**
 * ADMIN: close a drop — consume the `Airdrop` by value and delete it (unclaimed = un-minted; CLAIM-MINT
 * pre-minted nothing). AdminCap + version gated.
 * @param {import("../../../types.js").Context} context
 */
export function airdrop_close_ptb(context) {
  const { network } = context
  return ({
    admin_cap_id,
    airdrop_id,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!admin_cap_id || !airdrop_id)
      throw new Error(
        '[airdrop_close_ptb] admin_cap_id and airdrop_id are required.',
      )
    tx.moveCall({
      target: `${a.GIFTING_PACKAGE_ID}::airdrop::admin_close`,
      arguments: [
        as_object_arg(tx, admin_cap_id), // cap: &AdminCap
        as_object_arg(tx, airdrop_id), // airdrop: Airdrop (consumed by value + deleted)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
      ],
    })
    return tx
  }
}
