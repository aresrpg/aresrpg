// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// On-chain MARKETPLACE writes, signed by the connected wallet. LIST / DELIST keep their existing local kiosk
// transaction shape. Item and character BUY pre-flight the live TransferPolicy over gRPC, then delegate the whole
// four-rule purchase PTB to the context-bound SDK marketplace builders. That SDK seam validates the policy's live
// rule TypeNames and resolves linkage targets from deployment config before any SUI transaction is signed.

import { Transaction } from '@mysten/sui/transactions'
import { KioskClient, KioskTransaction } from '@mysten/kiosk'
import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'

import { use_auth, sign_and_execute_self_pay_transaction } from '../../auth'
import i18n from '../../i18n'
import { get_sdk } from '../sdk'
import { DEMO_NETWORK } from '../deployment'
import { get_personal_cap, invalidate as invalidate_kiosk_cap_cache } from '../kiosk_cap_cache'

import { get_marketplace_policy, marketplace_buy_tx } from './marketplace_buy_sdk'

// S-61: every id below resolves from the SDK's ONE deployment home (aresrpg_id) — the retired T62 bridge is
// gone. Kiosk operates on the CONCRETE type; the Item struct identity is the ORIGINAL (type-origin) package
// id, never the upgraded call target.
const ITEM_TYPE = `${aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID')}::item::Item`

// The forked+UPGRADED kiosk-rules package (royalty/kiosk_lock call target — see the SSOT jsdoc). NON-REQUIRED
// in the deployment gate, so the two buy paths guard it explicitly: an unstamped network must refuse loudly
// BEFORE building a money PTB, never splice '' into a moveCall target.
function kiosk_rules_pkg() {
  const id = aresrpg_id(DEMO_NETWORK, 'KIOSK_ROYALTY_RULE_PACKAGE_ID')
  if (!id)
    throw new Error(
      `KIOSK_ROYALTY_RULE_PACKAGE_ID is not stamped for ${DEMO_NETWORK} — run the ceremony before marketplace buys`
    )
  return id
}

async function sign(tx) {
  const { address, wallet_name } = use_auth.getState()
  if (!address || !wallet_name) throw new Error(i18n.t('marketplace.lots.not_signed_in'))
  const sdk = await get_sdk()
  const { digest } = await sign_and_execute_self_pay_transaction(wallet_name, address, tx)
  // A tx that EXECUTED but ABORTED on-chain still resolves here — neither the wallet's signAndExecuteTransaction
  // nor waitForTransaction throws on an on-chain abort. WITHOUT this check the abort reads as success: the optimistic
  // store never rolls back, and the "listed" toast LIES. Throw so the caller's optimistic `.catch` rolls back.
  // #23 gRPC: core.waitForTransaction → { Transaction | FailedTransaction } union; success === !!Transaction
  // (was jsonRpc { effects: { status: { status } } }). Constitution: a "confirmed" toast must mean chain-confirmed.
  const res = await sdk.grpc_client.core.waitForTransaction({ digest, include: { effects: true } })
  if (!res?.Transaction)
    throw new Error(res?.FailedTransaction?.effects?.status?.error || `Transaction ${digest} failed on-chain`)
  return res
}

// Command #1 of every marketplace PTB: the `header::aresrpg` brand-gate marker (SPONSOR + pay-per-use fee counter
// filter aresrpg txs by the PRESENCE of this MoveCall — load-bearing, keep it). Every builder prepends it.
function header(tx) {
  tx.moveCall({ target: `${aresrpg_id(DEMO_NETWORK, 'LATEST_PACKAGE_ID')}::header::aresrpg` })
}

// A KioskClient whose personal_kiosk CALL target is the linkage-bound fork (KIOSK_ROYALTY_RULE_PACKAGE_ID — the
// SAME upgraded pkg royalty_rule/kiosk_lock_rule live on), for driving the KioskTransaction personal-kiosk dance
// (borrow_val/list/return_val on list, create/return on buy). MUST target the fork, not the @mysten/kiosk origin
// default (0x06f6…): a personal_kiosk::* call at the origin collides with the fork's rule calls in the same PTB →
// InvalidLinkage at kiosk::list (list path) / the personal_kiosk borrow (buy path). This is DISTINCT from the READ
// client (`sdk.kiosk_client`, kept for kiosk_cap_cache.get_personal_cap): the owned-kiosks lookup does an EXACT type-string match on the
// PersonalKioskCap, whose canonical type resolves to the ORIGIN regardless of which upgraded pkg minted it — so cap
// discovery must keep the origin id. Mirrors the SDK's own personal_kiosk_call_client (items_creation.js). The `.client`
// (graphql transport) is reused so no second connection is opened.
function personal_call_client(sdk) {
  return new KioskClient({
    client: sdk.kiosk_client.client,
    network: DEMO_NETWORK,
    packageIds: { personalKioskRulePackageId: kiosk_rules_pkg() },
  })
}

/**
 * List an owned (kiosk-locked) Item for sale at `price_mist` SUI. S-63 lock-native: EVERY item is personal-
 * kiosk-locked from birth (the kiosk-lock constitution — see `item::lock_in_kiosk`'s `LockPledge` hot potato,
 * which type-forces a same-PTB lock on every mint/craft/buy/gather path), so listing one is a plain
 * `kiosk::list` on the kiosk that already holds it (mirrors `list_character`), NEVER a place+list of a loose
 * object. `kiosk_id` targets that exact kiosk. The buyer pays exactly `price_mist`; there is no on-chain
 * marketplace fee (bare policy), so the seller receives the full amount.
 * @param {{ item_id: string, kiosk_id?: string, price_mist: bigint | string }} args
 */
export async function list_item({ item_id, kiosk_id, price_mist }) {
  const sdk = await get_sdk()
  const { address } = use_auth.getState()
  if (!address) throw new Error(i18n.t('marketplace.lots.not_signed_in'))
  const cap = await get_personal_cap(sdk, address, kiosk_id)
  if (!cap) throw new Error(i18n.t('marketplace.lots.item_not_found'))

  const tx = new Transaction()
  header(tx)
  const ktx = new KioskTransaction({ transaction: tx, kioskClient: personal_call_client(sdk), cap })
  ktx.list({ itemType: ITEM_TYPE, itemId: item_id, price: BigInt(price_mist) })
  ktx.finalize()
  return sign(tx)
}

/**
 * List one already-shaped stack through the SDK's native kiosk composer. `amount` is guarded client-side by the
 * composer and repeated against the purchased Item by lot_rule, so only 1/10/100/1000 can reach a buyer.
 * @param {{ item_id: string, kiosk_id?: string, amount: number, price_mist: bigint | string }} args
 */
export async function list_stack({ item_id, kiosk_id, amount, price_mist }) {
  const sdk = await get_sdk()
  const { address } = use_auth.getState()
  if (!address) throw new Error(i18n.t('marketplace.lots.not_signed_in'))
  const cap = await get_personal_cap(sdk, address, kiosk_id)
  if (!cap) throw new Error(i18n.t('marketplace.lots.stack_not_found'))
  const item_policy = aresrpg_id(DEMO_NETWORK, 'ITEM_POLICY')
  const policy = await get_marketplace_policy(sdk, item_policy)
  const tx = new Transaction()
  header(tx)
  await sdk.marketplace_list_stack_ptb({
    kiosk_id: cap.kioskId,
    personal_kiosk_cap_id: cap.objectId,
    item_id,
    amount,
    price_mist,
    policy,
    tx,
  })
  return sign(tx)
}

/** Split `amount` units from a stack; both halves remain locked in this same kiosk. */
export async function split_stack({ item_id, kiosk_id, amount }) {
  const sdk = await get_sdk()
  const { address } = use_auth.getState()
  if (!address) throw new Error(i18n.t('marketplace.lots.not_signed_in'))
  const cap = await get_personal_cap(sdk, address, kiosk_id)
  if (!cap) throw new Error(i18n.t('marketplace.lots.stack_not_found'))
  const tx = new Transaction()
  header(tx)
  await sdk.split_stack_ptb({
    kiosk_id: cap.kioskId,
    personal_kiosk_cap_id: cap.objectId,
    item_id,
    amount,
    tx,
  })
  return sign(tx)
}

/** Merge two same-template stacks; the target survivor remains locked in their shared kiosk. */
export async function merge_stacks({ kiosk_id, target_item_id, source_item_id }) {
  const sdk = await get_sdk()
  const { address } = use_auth.getState()
  if (!address) throw new Error(i18n.t('marketplace.lots.not_signed_in'))
  const cap = await get_personal_cap(sdk, address, kiosk_id)
  if (!cap) throw new Error(i18n.t('marketplace.lots.stacks_not_found'))
  const tx = new Transaction()
  header(tx)
  await sdk.merge_stack_ptb({
    kiosk_id: cap.kioskId,
    personal_kiosk_cap_id: cap.objectId,
    target_item_id,
    source_item_id,
    tx,
  })
  return sign(tx)
}

/**
 * Cancel a listing: `kiosk::delist` ONLY — the item returns to the LOCKED state in its own kiosk (re-listable,
 * and visible to the SELL picker again). S-63 lock-native: NO take + transfer — `kiosk::take` aborts
 * `EItemLocked` on a locked item, and address-delivery breaks the kiosk-lock constitution. Targets the exact
 * kiosk the item is listed in.
 * @param {{ item_id: string, kiosk_id: string }} args
 */
export async function delist_item({ item_id, kiosk_id }) {
  const sdk = await get_sdk()
  const { address } = use_auth.getState()
  if (!address) throw new Error(i18n.t('marketplace.lots.not_signed_in'))
  const cap = await get_personal_cap(sdk, address, kiosk_id)
  if (!cap) throw new Error(i18n.t('marketplace.lots.listing_not_found'))

  const tx = new Transaction()
  header(tx)
  const ktx = new KioskTransaction({ transaction: tx, kioskClient: personal_call_client(sdk), cap })
  ktx.delist({ itemType: ITEM_TYPE, itemId: item_id })
  ktx.finalize()
  return sign(tx)
}

/**
 * Buy a listed item with SUI, satisfying ALL FIVE live rules on `TransferPolicy<Item>` (royalty + kiosk_lock +
 * personal_kiosk + item_listing_rule + lot_rule — a partial resolution aborts `confirm_request`): purchase from the
 * seller's kiosk, pay the royalty, prove the item is non-zero, prove the lot contract (stackables only; unique items
 * bypass inside the rule), LOCK into the buyer's personal kiosk (creating one if absent — kiosk-lock constitution,
 * never address-delivery), prove both kiosk rules, then confirm. Payment + royalty split off gas; `price_mist` is
 * the exact on-chain seller ask while the confirmation separately shows ask + royalty.
 * @param {{ item_id: string, seller_kiosk_id: string, price_mist: bigint | string }} args
 */
export async function buy_item({ item_id, seller_kiosk_id, price_mist }) {
  const sdk = await get_sdk()
  const { address } = use_auth.getState()
  if (!address) throw new Error(i18n.t('marketplace.lots.not_signed_in'))
  const cap = await get_personal_cap(sdk, address)
  const item_policy = aresrpg_id(DEMO_NETWORK, 'ITEM_POLICY')
  const tx = await marketplace_buy_tx({
    sdk,
    kind: 'item',
    policy_id: item_policy,
    cap,
    asset_id: item_id,
    seller_kiosk_id,
    price_mist,
  })
  const res = await sign(tx)
  // `cap` was null → the `.createPersonal(true)` branch above just minted the buyer's FIRST personal kiosk
  // ("first buy auto-creates"). The cache's cached "none" entry for this address is now stale — drop it so
  // the next get_personal_cap call discovers the fresh cap instead of replaying the empty result.
  if (!cap) invalidate_kiosk_cap_cache(address)
  return res
}

/** Withdraw all native kiosk sale proceeds to the connected wallet. Sale payment is credited automatically. */
export async function withdraw_kiosk_proceeds() {
  const sdk = await get_sdk()
  const { address } = use_auth.getState()
  if (!address) throw new Error(i18n.t('marketplace.lots.not_signed_in'))
  const cap = await get_personal_cap(sdk, address)
  if (!cap) throw new Error(i18n.t('marketplace.lots.kiosk_not_found'))
  const tx = new Transaction()
  header(tx)
  const ktx = new KioskTransaction({ transaction: tx, kioskClient: personal_call_client(sdk), cap })
  ktx.withdraw(address).finalize()
  return sign(tx)
}

// ═══ CHARACTER MARKET (S-18 · §17.30) ════════════════════════════════════════════════════════════════════
// Characters are kiosk-locked from creation (kiosk-lock constitution), so LISTING one is a plain kiosk::list
// on the kiosk that owns it. BUYING one satisfies the Character policy's FULL live rule set — the four-receipt
// resolution in buy_character below (royalty + kiosk_lock + personal_kiosk + the §17.30 level gate).
const CHARACTER_TYPE = `${aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID')}::character::Character`

/**
 * List an owned (kiosk-locked) character for sale at `price_mist`. §17.30's level-30 gate is enforced
 * on-chain at PURCHASE time — a listing below the gate simply can't sell; the UI mirrors the gate where the
 * level is known.
 * @param {{ character_id: string, kiosk_id?: string, price_mist: bigint | string }} args
 */
export async function list_character({ character_id, kiosk_id, price_mist }) {
  const sdk = await get_sdk()
  const { address } = use_auth.getState()
  if (!address) throw new Error(i18n.t('marketplace.lots.not_signed_in'))
  const cap = await get_personal_cap(sdk, address, kiosk_id)
  if (!cap) throw new Error(i18n.t('marketplace.lots.character_not_found'))

  const tx = new Transaction()
  header(tx)
  const ktx = new KioskTransaction({ transaction: tx, kioskClient: personal_call_client(sdk), cap })
  ktx.list({ itemType: CHARACTER_TYPE, itemId: character_id, price: BigInt(price_mist) })
  ktx.finalize()
  return sign(tx)
}

/**
 * Buy a listed character with SUI through the existing SDK marketplace builder. The live policy snapshot proves
 * all four required rules before composition; the SDK then purchases, pays royalty, proves the §17.30 level gate,
 * locks into the buyer's personal kiosk, proves both kiosk rules, and confirms the transfer request.
 * @param {{ character_id: string, seller_kiosk_id: string, price_mist: bigint | string }} args
 */
export async function buy_character({ character_id, seller_kiosk_id, price_mist }) {
  const sdk = await get_sdk()
  const { address } = use_auth.getState()
  if (!address) throw new Error(i18n.t('marketplace.lots.not_signed_in'))
  const cap = await get_personal_cap(sdk, address)
  const character_policy = aresrpg_id(DEMO_NETWORK, 'CHARACTER_POLICY')
  const tx = await marketplace_buy_tx({
    sdk,
    kind: 'character',
    policy_id: character_policy,
    cap,
    asset_id: character_id,
    seller_kiosk_id,
    price_mist,
  })
  const res = await sign(tx)
  // `cap` was null → the `.createPersonal(true)` branch above just minted the buyer's FIRST personal kiosk
  // ("first buy auto-creates"). The cache's cached "none" entry for this address is now stale — drop it so
  // the next get_personal_cap call discovers the fresh cap instead of replaying the empty result.
  if (!cap) invalidate_kiosk_cap_cache(address)
  return res
}
