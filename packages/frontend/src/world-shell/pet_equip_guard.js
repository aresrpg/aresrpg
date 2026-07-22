// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #88 — PetPowerKey survived the pet-growth upgrade, but its legacy accumulated-power values can exceed the
// replacement curve's 60-feed denominator. equipment::equip normalizes pet stats before attaching the item and
// aborts item_stats::EInvalidScale for those values. This cap-free, direct-chain read keeps known legacy pets out
// of that doomed PTB until the contract train migrates the field; absence/read uncertainty stays fail-open and
// the transaction simulation remains the final judge.

import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'
import { ITEMS_NS } from '@aresrpg/sdk/sui'

import { DEMO_NETWORK } from '../chain/deployment'
import { get_sdk } from '../chain/sdk'

const PET_FULL_FEEDS = 60n

const is_legacy_pet_power = (value) => {
  if (typeof value === 'bigint') return value > PET_FULL_FEEDS
  if (typeof value === 'number') return Number.isInteger(value) && value > Number(PET_FULL_FEEDS)
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return false
  return BigInt(value) > PET_FULL_FEEDS
}

/**
 * Return the first staged pet whose direct on-chain PetPowerKey cannot fit the current curve, else null.
 * Non-pets do not initialize the SDK or perform a read. A missing/uncertain value fails open because no client
 * projection can prove it unsafe; the normal transaction simulation still refuses any actual Move abort.
 * @param {{ item_id: string, slot: string }[]} to_equip
 * @param {{ sdk?: {read_namespaced_field: Function}, package_id?: string }} [dependencies]
 */
export async function legacy_pet_equip_guard(to_equip, dependencies = {}) {
  const pets = (to_equip ?? []).filter((row) => row.slot === 'pet')
  if (!pets.length) return null

  try {
    const sdk = dependencies.sdk ?? (await get_sdk())
    const package_id = dependencies.package_id ?? aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID')
    if (!package_id) return null
    const powers = await Promise.all(
      pets.map(({ item_id }) =>
        sdk.read_namespaced_field({
          object_id: item_id,
          namespace: ITEMS_NS.ITEM,
          key_type: `${package_id}::character_link::PetPowerKey`,
        })
      )
    )
    return pets.find((_, index) => is_legacy_pet_power(powers[index])) ?? null
  } catch {
    return null
  }
}
