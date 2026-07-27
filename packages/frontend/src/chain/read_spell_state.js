// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #55 — the CHAIN-TRUE spell allocation read. The S-46 merge killed the Character struct's `spells:
// SpellAllocation` field: per-spell invested levels now live as namespaced dynamic fields on the Character
// under `character_link::SpellLevelKey { spell: ID }` (the SpellTemplate OBJECT id; absent slot = the free
// baseline level 1), and unspent points are DERIVED — (character level − 1) earnable minus the
// `character_link::SpellPointsSpentKey {}` running total (absent = 0). Namespace: NS_CHARACTER_WORLD
// (extension.move). Reads ride the SDK's cap-free `read_namespaced_field` transport (derived DF id → gRPC
// json — no dynamic-field pagination). The grimoire and encyclopedia both consume this one door.

import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'
import { ITEMS_NS } from '@aresrpg/sdk/sui'

import { DEMO_NETWORK } from './deployment'
import { get_sdk } from './sdk'

/** BCS of `SpellLevelKey { spell: ID }` = the 32 raw bytes of the object id (an ID is a bare address). */
const id_bytes = (id) =>
  Uint8Array.from(
    String(id)
      .replace(/^0x/, '')
      .padStart(64, '0')
      .match(/.{1,2}/g)
      .map((h) => parseInt(h, 16))
  )

/**
 * Read `character_id`'s on-chain spell allocation: the points SPENT so far + the invested level of each spell
 * in `spell_object_ids` (SpellTemplate object ids — the grimoire rows). Absent slots resolve to the honest
 * chain defaults (spent 0, level 1 — character_link's baselines). Unspent points are (char_level − 1) − spent,
 * derived by the CALLER (it owns the level read).
 * @param {string} character_id
 * @param {string[]} spell_object_ids
 * @returns {Promise<{ spent: number, levels: Record<string, number> }>}
 */
export async function read_spell_state(character_id, spell_object_ids) {
  const sdk = await get_sdk()
  const pkg = aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID')
  const [spent, ...levels] = await Promise.all([
    sdk.read_namespaced_field({
      object_id: character_id,
      namespace: ITEMS_NS.CHARACTER_WORLD,
      key_type: `${pkg}::character_link::SpellPointsSpentKey`,
      // {} key → the SDK default (EMPTY_STRUCT_KEY: the one-byte empty-struct BCS — proven live on 0x3fa7…5344)
    }),
    ...spell_object_ids.map((spell) =>
      sdk.read_namespaced_field({
        object_id: character_id,
        namespace: ITEMS_NS.CHARACTER_WORLD,
        key_type: `${pkg}::character_link::SpellLevelKey`,
        key_bytes: id_bytes(spell),
      })
    ),
  ])
  return {
    spent: Number(spent ?? 0), // u64 rides gRPC json as a string; spent points fit a JS number
    levels: Object.fromEntries(
      spell_object_ids.map((spell, i) => [spell, Number(levels[i] ?? 1)]) // absent DF = baseline level 1
    ),
  }
}
