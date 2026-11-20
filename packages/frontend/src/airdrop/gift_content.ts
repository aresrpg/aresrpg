// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { giftcard_id, item_template_id } from '@aresrpg/sdk/seed-ids'
import { resolve_pins, living_content } from '@aresrpg/sdk/pins'
import type { GiftStatus } from '@aresrpg/sdk/gift'
import type { GiftPolicy } from '@aresrpg/sdk/gift-provenance'

import { giftcards, campaigns } from '../../../../seed/content/airdrop.json'
import { env } from '../env.ts'
import { box_rewards, items_by_type } from '../content/items.ts'

export const gift_content = () => {
  const campaign = campaigns.find(({ id }) => id === 'sui_basecamp_singapore')!
  const box = items_by_type[campaign.items[0]!]!
  const rewards = box_rewards(box.item_type)
  const pins = resolve_pins(env.network)
  const { content_root, seed_package_original } = living_content({ pins }, 'Gift display')
  const game_type = pins.package_original
  if (typeof game_type !== 'string') throw new Error('Gifts need the original game package')
  const cards = giftcards.filter((card) => card.campaign === campaign.id)
  const templates = Object.fromEntries(
    rewards.map(({ item_type }) => [item_template_id(content_root, seed_package_original, item_type), item_type])
  )
  return {
    campaign,
    box,
    rewards,
    count: cards.reduce((total, card) => total + card.amount, 0),
    /** The printed campaign's cards and its crate's reward table: what the gift page follows on chain. */
    policy: {
      pins,
      game_type,
      box_template: item_template_id(content_root, seed_package_original, box.item_type),
      giftcards: new Set(cards.map(({ id }) => giftcard_id(content_root, game_type, id))),
      reward_templates: new Set(Object.keys(templates)),
    } satisfies GiftPolicy,
    reward: (status: GiftStatus | null) =>
      status?.claim && status.reward_template && templates[status.reward_template]
        ? { claim_id: status.claim, item_type: templates[status.reward_template]!, amount: status.amount ?? 1 }
        : undefined,
  }
}
