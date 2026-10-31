// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Job category labels shared by the Jobs window and the Stats window's Skills tab.

import type { JobKind } from '@aresrpg/immutable'

import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'

export const CATEGORY_LABEL_KEY: Readonly<Record<JobKind, string>> = Object.freeze({
  gathering: 'jobs.category.gathering',
  weapon_craft: 'jobs.category.weapon',
  equipment_craft: 'jobs.category.equipment',
  consumable_craft: 'jobs.category.consumable',
})
export const covers_label = (copy: AppCopy, kind: JobKind): string =>
  ({
    gathering: copy_text(copy.characters_page)('bag_resources'),
    weapon_craft: encyclopedia_text(copy)('group_weapons'),
    equipment_craft: copy_text(copy.characters_page)('bag_equipment'),
    consumable_craft: copy_text(copy.characters_page)('bag_consumables'),
  })[kind]
