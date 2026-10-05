// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createContext, useContext } from 'react'

import { content_catalog } from '../content/catalog.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { crafting_character } from '../modules/craft_character_lock.ts'
import { encumbered_asset_ids } from '../inventory_stacks.ts'

import { relevant_quests, type JourneyQuest, type JourneyState } from './model.ts'
import { journey_tracker_available } from './facts.ts'
import { journey_ingredients, type JourneyIngredient } from './ingredients.ts'

export type JourneySource = Readonly<{
  state: JourneyState
  quests: readonly JourneyQuest[]
  available: boolean
  text: CopyText
  icon: (item: string) => string | null
  name: (item: string) => string
  journal: (open: boolean) => void
  collapse: (collapsed: boolean) => void
  acknowledge: () => void
  activate?: (quest: JourneyQuest) => void
  action_label?: string
  ingredients?: (output: string) => readonly JourneyIngredient[]
}>

export const JourneySourceContext = createContext<JourneySource | null>(null)

/** Presentation may receive local facts. The ordinary source remains the live reducer. */
export const useJourneySource = (copy: AppCopy): JourneySource => {
  const supplied = useContext(JourneySourceContext)
  const state = useAppStore((app) => app.journey)
  const inventory = useAppStore((app) => app.session.inventory)
  const character = useAppStore(crafting_character)
  const listings = useAppStore((app) => app.marketplace.own_listings)
  const trades = useAppStore((app) => app.trade.rows)
  const encumbered = encumbered_asset_ids(listings, trades)
  const available = useAppStore(journey_tracker_available)
  return (
    supplied ?? {
      state,
      available,
      quests: relevant_quests(state.completed),
      ingredients: (output) => journey_ingredients(output, inventory, encumbered, character?.kiosk ?? null),
      text: copy_text(copy.journey),
      icon: item_detail_icon,
      name: (item) => content_catalog.item(item)?.item.name ?? '',
      journal: (open) => dispatch_app({ type: 'journey/journal', open }),
      collapse: (collapsed) => dispatch_app({ type: 'journey/collapse', collapsed }),
      acknowledge: () => dispatch_app({ type: 'journey/acknowledged' }),
    }
  )
}
