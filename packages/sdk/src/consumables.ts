// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { spending_receipt } from './cache.ts'
import { living_content, type SDK } from './client.ts'
import type { create_kiosk_runner, KioskCustody } from './kiosk_runner.ts'
import { item_template_id, world_content_id } from './seed_ids.ts'

/** Merge available fragments once and consume every requested unit in one atomic PTB. */
export const consumable_action =
  (sdk: ReturnType<typeof SDK>, with_kiosk: ReturnType<typeof create_kiosk_runner>['with_kiosk']) =>
  async ({
    character_id,
    item_id,
    item_type,
    world,
    custody,
    merge_sources = [],
    amount = 1,
  }: {
    amount?: number
    character_id: string
    item_id: string
    item_type: string
    world?: string
    merge_sources?: readonly string[]
    custody?: KioskCustody
  }): Promise<ReturnType<typeof spending_receipt>> => {
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Consumable amount must be a positive integer')
    const { content_root, seed_package_original } = living_content(sdk, 'Character transaction')
    const template = item_template_id(content_root, seed_package_original, item_type)
    const world_content = world ? world_content_id(content_root, seed_package_original, world) : null
    await sdk.hydrate_unknown([template, ...(world_content ? [world_content] : [])])
    const receipt = await with_kiosk(
      (tx, kiosk, cap) => {
        for (let unit = 0; unit < amount; unit++) {
          if (world_content)
            sdk.doors.use_city_consumable(tx, { kiosk, cap, character_id, item_id, template, world_content })
          else sdk.doors.use_consumable(tx, { kiosk, cap, character_id, item_id, template })
        }
      },
      {
        custody,
        budget: amount > 1 ? 'estimate' : undefined,
        merges: [{ target_id: item_id, source_ids: merge_sources }],
      }
    )
    return spending_receipt(receipt)
  }
