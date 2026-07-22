// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure, serializable planning fixture for the cross-wallet marketplace rows. Chain authoring and execution stay in
// the gold boot/spec layers; this module only validates and freezes the identities and exact MIST accounting they use.

export const MARKET_ASK_MIST = 100_000_000n
export const MARKET_ROYALTY_BPS = 1_000
export const MARKET_ROYALTY_MIN_MIST = 10_000_000n
export const MARKET_LOT_AMOUNTS = Object.freeze([1, 10, 100])

const BPS_DENOMINATOR = 10_000n
const ACTOR_ROLES = Object.freeze(['seller', 'buyer_a', 'buyer_b'])

function non_empty_text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`market_two_actor: ${label} is required`)
  return value.trim()
}

function non_negative_mist(value, label) {
  let amount
  try {
    amount = BigInt(value)
  } catch {
    throw new Error(`market_two_actor: ${label} must be an integer MIST amount`)
  }
  if (amount < 0n) throw new Error(`market_two_actor: ${label} must be >= 0`)
  return amount
}

function royalty_bps(value) {
  let amount
  try {
    amount = BigInt(value)
  } catch {
    throw new Error('market_two_actor: royalty_bps must be an integer')
  }
  if (amount < 0n || amount > BPS_DENOMINATOR) throw new Error('market_two_actor: royalty_bps must be in [0, 10000]')
  return amount
}

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`market_two_actor: ${label} must be distinct`)
  return values
}

function deep_freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deep_freeze(child)
  return Object.freeze(value)
}

/** Exact secondary-sale money path: royalty is an extra buyer debit; the seller kiosk receives the full ask. */
export function market_purchase_math(
  ask_mist,
  fee_bps = MARKET_ROYALTY_BPS,
  min_royalty_mist = MARKET_ROYALTY_MIN_MIST
) {
  const ask = non_negative_mist(ask_mist, 'ask_mist')
  const bps = royalty_bps(fee_bps)
  const minimum = non_negative_mist(min_royalty_mist, 'min_royalty_mist')
  const proportional = (ask * bps) / BPS_DENOMINATOR
  const royalty = proportional > minimum ? proportional : minimum
  return Object.freeze({
    ask_mist: ask,
    royalty_mist: royalty,
    buyer_debit_before_gas_mist: ask + royalty,
    seller_net_before_withdraw_gas_mist: ask,
  })
}

function actor_fixture(character, role) {
  if (!character || typeof character !== 'object') throw new Error(`market_two_actor: ${role} actor is required`)
  const wallet_index = Number(character.wallet_index)
  if (!Number.isInteger(wallet_index) || wallet_index < 0)
    throw new Error(`market_two_actor: ${role}.wallet_index must be a non-negative integer`)
  return {
    role,
    wallet_index,
    character_id: non_empty_text(character.character_id, `${role}.character_id`),
    kiosk_id: non_empty_text(character.kiosk_id, `${role}.kiosk_id`),
    personal_kiosk_cap_id: non_empty_text(character.personal_kiosk_cap_id, `${role}.personal_kiosk_cap_id`),
  }
}

function stack_fixture(stack_item_ids) {
  if (!stack_item_ids || typeof stack_item_ids !== 'object' || Array.isArray(stack_item_ids))
    throw new Error('market_two_actor: stack_item_ids must map lots 1/10/100 to item ids')
  const keys = Object.keys(stack_item_ids).sort((left, right) => Number(left) - Number(right))
  if (keys.length !== MARKET_LOT_AMOUNTS.length || !MARKET_LOT_AMOUNTS.every((amount) => keys.includes(String(amount))))
    throw new Error('market_two_actor: stack_item_ids must contain exactly the legal fixture lots 1/10/100')
  const lots = MARKET_LOT_AMOUNTS.map((amount) => ({
    amount,
    item_id: non_empty_text(stack_item_ids[amount], `stack_item_ids.${amount}`),
  }))
  unique(
    lots.map(({ item_id }) => item_id),
    'stack item ids'
  )
  return lots
}

/**
 * Select seller + two race buyers and the objects used by the deterministic market rows. The returned value has
 * no bigint/function/reference to caller-owned data, so it is safe to JSON.stringify into the gold manifest.
 */
export function build_market_two_actor_fixture({ characters, unique_item_ids, stack_item_ids, policy }) {
  if (!Array.isArray(characters) || characters.length < ACTOR_ROLES.length)
    throw new Error('market_two_actor: seller and two buyer characters are required')
  if (!Array.isArray(unique_item_ids) || unique_item_ids.length !== 2)
    throw new Error('market_two_actor: exactly two unique items are required (trade + race)')
  if (!policy || typeof policy !== 'object') throw new Error('market_two_actor: policy is required')

  const actors = ACTOR_ROLES.map((role, index) => actor_fixture(characters[index], role))
  unique(
    actors.map(({ wallet_index }) => wallet_index),
    'actor wallet indexes'
  )
  unique(
    actors.map(({ character_id }) => character_id),
    'actor character ids'
  )

  const unique_ids = unique(
    unique_item_ids.map((item_id, index) => non_empty_text(item_id, `unique_item_ids.${index}`)),
    'unique item ids'
  )
  const stack_lots = stack_fixture(stack_item_ids)
  unique([...unique_ids, ...stack_lots.map(({ item_id }) => item_id)], 'all market item ids')

  const accounting = market_purchase_math(MARKET_ASK_MIST)
  const fixture = {
    actors,
    unique_item_ids: unique_ids,
    stack_lots,
    policy: {
      id: non_empty_text(policy.id, 'policy.id'),
      balance: non_negative_mist(policy.balance, 'policy.balance').toString(),
      rules: JSON.parse(JSON.stringify(policy.rules ?? [])),
    },
    listing_plan: {
      ask_mist: accounting.ask_mist.toString(),
      royalty_bps: MARKET_ROYALTY_BPS,
      royalty_mist: accounting.royalty_mist.toString(),
      buyer_debit_before_gas_mist: accounting.buyer_debit_before_gas_mist.toString(),
      seller_net_before_withdraw_gas_mist: accounting.seller_net_before_withdraw_gas_mist.toString(),
      trade_item_id: unique_ids[0],
      race_item_id: unique_ids[1],
    },
  }
  JSON.stringify(fixture)
  return deep_freeze(fixture)
}
