// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import i18n from '../../i18n'

/**
 * Read the live TransferPolicy snapshot required by the SDK marketplace builders. This is transaction
 * pre-flight: the rule TypeNames are validated by the SDK before any money PTB is signed.
 * @param {{ grpc_client: { core: { getObject: Function } } }} sdk
 * @param {string} policy_id
 */
export async function get_marketplace_policy(sdk, policy_id) {
  const { object } = await sdk.grpc_client.core.getObject({
    objectId: policy_id,
    include: { json: true },
  })
  const rules = object?.json?.rules
  if (!object || object instanceof Error || !rules) {
    const cause = new Error(`TransferPolicy ${policy_id} is unavailable for marketplace pre-flight`)
    throw new Error(i18n.t('marketplace.chain.policy_unavailable'), { cause })
  }
  return { id: object.objectId || policy_id, rules }
}

/**
 * Delegate a marketplace purchase to the context-bound SDK builder. Existing-cap wallets borrow/return that
 * personal kiosk; first-time buyers let the SDK create one in the same PTB.
 * @param {{
 *   sdk: any,
 *   kind: 'item'|'character',
 *   policy_id: string,
 *   cap: { kioskId:string, objectId:string } | null,
 *   asset_id: string,
 *   seller_kiosk_id: string,
 *   price_mist: bigint|string,
 * }} args
 */
export async function marketplace_buy_tx({ sdk, kind, policy_id, cap, asset_id, seller_kiosk_id, price_mist }) {
  const policy = await get_marketplace_policy(sdk, policy_id)
  const common = {
    seller_kiosk_id,
    price_mist,
    kiosk_id: cap?.kioskId ?? null,
    personal_kiosk_cap_id: cap?.objectId ?? null,
    policy,
  }
  return kind === 'item'
    ? sdk.marketplace_buy_item_ptb({ ...common, item_id: asset_id })
    : sdk.marketplace_buy_character_ptb({ ...common, character_id: asset_id })
}
