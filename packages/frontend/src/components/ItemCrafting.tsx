// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { job_groups, job_level_from_xp, type JobSlug } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { useContext } from 'react'

import { crafting_character } from '../modules/craft_character_lock.ts'
import type { CharacterSession } from '../characters/character_session.ts'
import { CraftControls, RecipeFacts } from '../characters/CraftControls.tsx'
import { encyclopedia_catalog } from '../content/catalog.ts'
import { copy_text } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { ItemDetailContext } from './ItemDetailContext.ts'

/** `inventory` is a bag of its own instead of the player's live one; only `craft` can craft from it. */
export type ItemCraftSession = Readonly<{
  character: CharacterRow
  inventory?: readonly ItemRow[]
  craft?: CharacterSession['craft']
}>

/** Every item surface uses the same recipe, inventory checks and transaction controller. */
export const ItemCrafting = ({
  item_type,
  session,
  open_ingredient,
}: Readonly<{
  item_type: string
  session?: ItemCraftSession
  open_ingredient: (item_type: string) => void
}>) => {
  const { inventory, craft }: Partial<ItemCraftSession> = session ?? {}
  // The docs read a recipe; only the game crafts it.
  const reference = useContext(ItemDetailContext) === 'reference'
  const copy = useAppStore((state) => state.copy)
  const character = useAppStore((state) =>
    session?.inventory === undefined ? crafting_character(state, session?.character) : session.character
  )
  const detail = encyclopedia_catalog.item(item_type)
  const recipe = encyclopedia_catalog.recipes.find(({ output_type }) => output_type === item_type)
  const job = detail?.recipe?.job as JobSlug | undefined
  if (
    !recipe ||
    !Object.values(job_groups)
      .flat()
      .includes(job as JobSlug) ||
    !copy
  )
    return null
  if (reference)
    return (
      <RecipeFacts
        recipe={recipe}
        job={job as JobSlug}
        t={copy_text(copy.characters_page)}
        open_ingredient={open_ingredient}
      />
    )
  return (
    <CraftControls
      key={item_type}
      recipe={recipe}
      character={character}
      inventory_override={inventory}
      craft={craft}
      job={job as JobSlug}
      level={job_level_from_xp(Number(character?.jobs[job as JobSlug] ?? 0))}
      t={copy_text(copy.characters_page)}
      open_ingredient={open_ingredient}
    />
  )
}
