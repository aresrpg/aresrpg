// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { bcs } from '@mysten/sui/bcs'
import { deriveObjectID } from '@mysten/sui/utils'

import { SEED_STRING_KEYS } from './seed_contract.gen.ts'

const string_bytes = (value: string): Uint8Array => bcs.String.serialize(value).toBytes()
const wrapped_string_bytes = (value: string): Uint8Array =>
  bcs.struct('StringKey', { value: bcs.String }).serialize({ value }).toBytes()

export const item_template_id = (registry: string, item_type: string): string =>
  deriveObjectID(registry, '0x1::string::String', string_bytes(item_type))

const content_id = (
  registry: string,
  package_id: string,
  key: Readonly<{ module: string; name: string }>,
  value: string
): string => deriveObjectID(registry, `${package_id}::${key.module}::${key.name}`, wrapped_string_bytes(value))

export const mob_template_id = (registry: string, package_id: string, mob_type: string): string =>
  content_id(registry, package_id, SEED_STRING_KEYS.MobKey, mob_type)

export const spell_template_id = (registry: string, package_id: string, name: string): string =>
  content_id(registry, package_id, SEED_STRING_KEYS.SpellKey, name)

export const recipe_id = (registry: string, package_id: string, output_type: string): string =>
  content_id(registry, package_id, SEED_STRING_KEYS.RecipeKey, output_type)

export const sale_id = (registry: string, package_id: string, item_type: string): string =>
  content_id(registry, package_id, SEED_STRING_KEYS.SaleKey, item_type)

export const airdrop_id = (registry: string, package_id: string, id: string): string =>
  content_id(registry, package_id, SEED_STRING_KEYS.AirdropKey, id)

export const giftcard_id = (registry: string, package_id: string, id: string): string =>
  content_id(registry, package_id, SEED_STRING_KEYS.GiftcardKey, id)

export const world_seed_marker_id = (registry: string, package_id: string, world: string): string =>
  content_id(registry, package_id, SEED_STRING_KEYS.WorldSeedKey, world)

export const seal_marker_id = (registry: string, package_id: string): string =>
  content_id(registry, package_id, SEED_STRING_KEYS.SealKey, 'sealed')
