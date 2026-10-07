// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { living_content, type Pins } from '../../sdk/src/pins.ts'
import { giftcard_id, item_template_id } from '../../sdk/src/seed_ids.ts'
import type { GiftPolicy } from '../../sdk/src/gift_provenance.ts'
import distribution from '../../../seed/content/airdrop.json' with { type: 'json' }
import items from '../../../seed/content/items.json' with { type: 'json' }

/** The seed campaign is the sole allowlist. A route or a crate template cannot grant sponsorship. */
export const gift_policy = (pins: Pins): GiftPolicy => {
  const { content_root, seed_package_original } = living_content({ pins }, 'Gift sponsorship')
  const game_type = pins.package_original
  if (typeof game_type !== 'string') throw new Error('Gift sponsorship needs the original game package')
  const cards = distribution.giftcards.filter((card) => card.campaign === 'sui_basecamp_singapore')
  if (cards.length !== 100 || cards.some((card) => card.item_type !== 'sui_crate' || card.amount !== 1))
    throw new Error('The Basecamp campaign must contain exactly 100 single-crate vouchers')
  const crate = items.find((item) => item.item_type === 'sui_crate')
  const rewards = crate?.consumable?.rewards
  if (!rewards?.length) throw new Error('The Sui Crate reward table is missing')
  return {
    pins,
    game_type,
    box_template: item_template_id(content_root, seed_package_original, 'sui_crate'),
    giftcards: new Set(cards.map(({ id }) => giftcard_id(content_root, game_type, id))),
    reward_templates: new Set(
      rewards.map(({ item_type }) => item_template_id(content_root, seed_package_original, item_type))
    ),
  }
}
