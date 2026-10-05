// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { normalizeStructTag, normalizeSuiObjectId, isValidSuiObjectId } from '@mysten/sui/utils'
import type { Transaction } from '@mysten/sui/transactions'

import type { Sdk } from './client.ts'
import { kares_coin_type, rewards_shared_pin } from './kares_ptb.ts'

const object_id = (value: unknown): string => {
  if (typeof value !== 'string' || !isValidSuiObjectId(value)) throw new Error('Invalid rewards economy object ID')
  return normalizeSuiObjectId(value)
}

/** The fullnode owns Move layout decoding, including the pre-token publication state. */
export const decode_rewards_economy = (json: Readonly<Record<string, unknown>>) => {
  if (typeof json.token !== 'string') throw new Error('Invalid rewards economy token')
  if (typeof json.started_ms !== 'string' || !/^(0|[1-9]\d*)$/.test(json.started_ms))
    throw new Error('Invalid rewards economy funding time')
  return {
    id: object_id(json.id),
    coin_type: json.token === '' ? null : kares_coin_type(`0x${json.token.replace(/^0x/, '')}`),
    currency: object_id(json.currency),
    staking_pool: object_id(json.staking_pool),
    combat_pot: object_id(json.combat_pot),
    community_pool: object_id(json.community_pool),
    started_ms: BigInt(json.started_ms),
  }
}

export const read_rewards_economy = async (sdk: Pick<Sdk, 'pins' | 'sui_client'>) => {
  const pin = rewards_shared_pin(sdk.pins.kares_economy, 'economy')
  const original = object_id(sdk.pins.kares_rewards_package_original)
  const { objects } = await sdk.sui_client.core.getObjects({ objectIds: [pin.id], include: { json: true } })
  const [object] = objects
  if (
    !object ||
    !object.type ||
    !object.json ||
    object.objectId !== pin.id ||
    normalizeStructTag(object.type) !== `${original}::economy::Economy` ||
    object.owner?.$kind !== 'Shared' ||
    object.owner.Shared?.initialSharedVersion !== pin.shared_version
  )
    throw new Error('Unexpected canonical rewards economy')
  const economy = decode_rewards_economy(object.json)
  if (economy.id !== pin.id) throw new Error('Unexpected rewards economy UID')
  return economy
}

/** Resolve before building; the contract serializes this proof against atomic funding. */
export const prepare_boss_rewards = async (sdk: Sdk) => {
  const economy = await read_rewards_economy(sdk)
  if (economy.coin_type) await sdk.hydrate_unknown([economy.combat_pot])
  return (tx: Transaction, fight: string, fighter_idx: bigint): void => {
    if (economy.coin_type)
      sdk.doors.prepare_boss_rewards_token(tx, {
        fight_object: fight,
        fighter_idx,
        pot: economy.combat_pot,
        coin_type: economy.coin_type,
      })
    else sdk.doors.prepare_boss_rewards_unfunded(tx, { fight_object: fight, fighter_idx })
  }
}

/** Drained token fields still need typed destruction; local token pins cannot prove funding. */
export const prepare_trade_close = async (sdk: Sdk) => {
  const { coin_type } = await read_rewards_economy(sdk)
  return (tx: Transaction, trade: string): void => {
    if (coin_type) sdk.doors.trade_close_token(tx, { trade, coin_type })
    else sdk.doors.trade_close(tx, { trade })
  }
}
