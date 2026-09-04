// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LIVING CONTENT addresses (owner 2026-08-23): every content object derives under the seed
// package's registry ROOT with its DEFINING (original) package's key types — items, mobs,
// spells, recipes, worlds, boards. Distribution objects (airdrops/giftcards) claim under the
// SAME root through core's living doors. The seal-era ids (core registry parent, marker
// objects) are gone with the seal itself.

import { bcs } from '@mysten/sui/bcs'
import { deriveObjectID } from '@mysten/sui/utils'

import { SEED_STRING_KEYS } from './seed_contract.gen.ts'

const wrapped_string_bytes = (value: string): Uint8Array =>
  bcs.struct('StringKey', { value: bcs.String }).serialize({ value }).toBytes()

const ZONE_KEY_BCS = bcs.struct('ZoneKey', { zone_x: bcs.u32(), zone_z: bcs.u32() })

const content_id = (
  root: string,
  package_id: string,
  key: Readonly<{ module: string; name: string }>,
  value: string
): string => deriveObjectID(root, `${package_id}::${key.module}::${key.name}`, wrapped_string_bytes(value))

export const item_template_id = (content_root: string, seed_package_original: string, item_type: string): string =>
  content_id(content_root, seed_package_original, SEED_STRING_KEYS.ItemKey, item_type)

export const mob_template_id = (content_root: string, seed_package_original: string, mob_type: string): string =>
  content_id(content_root, seed_package_original, SEED_STRING_KEYS.MobKey, mob_type)

export const spell_template_id = (content_root: string, seed_package_original: string, name: string): string =>
  content_id(content_root, seed_package_original, SEED_STRING_KEYS.SpellKey, name)

export const recipe_id = (content_root: string, seed_package_original: string, output_type: string): string =>
  content_id(content_root, seed_package_original, SEED_STRING_KEYS.RecipeKey, output_type)

export const world_content_id = (content_root: string, seed_package_original: string, world: string): string =>
  content_id(content_root, seed_package_original, SEED_STRING_KEYS.WorldContentKey, world)

export const dungeon_content_id = (content_root: string, seed_package_original: string, dungeon: string): string =>
  content_id(content_root, seed_package_original, SEED_STRING_KEYS.DungeonContentKey, dungeon)

export const world_id = (content_root: string, game_package_original: string, world: string): string =>
  content_id(content_root, game_package_original, SEED_STRING_KEYS.WorldKey, world)

/** One shared Zone is derived under its World from the exact Move `zone::ZoneKey` bytes. */
export const zone_id = (world: string, game_package_original: string, zone_x: number, zone_z: number): string =>
  deriveObjectID(world, `${game_package_original}::zone::ZoneKey`, ZONE_KEY_BCS.serialize({ zone_x, zone_z }).toBytes())

export const board_catalog_id = (content_root: string, seed_package_original: string): string =>
  // Move injects `dummy_field: bool` into a fieldless struct, so `BoardCatalogKey()` is BCS 0x00.
  deriveObjectID(content_root, `${seed_package_original}::board_catalog::BoardCatalogKey`, new Uint8Array([0]))

/** Supply objects claim under the same root, but their key types are CORE's (the doors live
 * beside the objects they mint) — so the key's package is the GAME's defining id. */
export const mastery_offer_id = (content_root: string, game_package_original: string, item_type: string): string =>
  content_id(content_root, game_package_original, SEED_STRING_KEYS.MasteryOfferKey, item_type)

export const airdrop_id = (content_root: string, game_package_original: string, id: string): string =>
  content_id(content_root, game_package_original, SEED_STRING_KEYS.AirdropKey, id)

export const giftcard_id = (content_root: string, game_package_original: string, id: string): string =>
  content_id(content_root, game_package_original, SEED_STRING_KEYS.GiftcardKey, id)
