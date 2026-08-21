// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Forge vocabulary shared by the runeforge workbench and the bag's item actions (one home).

import { craft_job_of, rune_effect } from '@aresrpg/immutable'
import type { ItemRow } from '@aresrpg/protocol'

/** Crushable/scribeable gear: a rolled stat block + a category with a forgery job (never keys). */
export const is_forge_gear = (item: Readonly<ItemRow>): boolean =>
  !!item.stats && item.category !== 'key' && craft_job_of(item.category) !== null

export const is_rune = (item: Readonly<ItemRow>): boolean =>
  item.category === 'rune' && rune_effect(item.item_type) !== null
