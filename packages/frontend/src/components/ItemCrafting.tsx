// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createContext, useContext } from 'react'
import { job_groups, job_level_from_xp, type JobSlug } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import { crafting_character } from '../modules/craft_character_lock.ts'
import { CraftControls } from '../characters/CraftControls.tsx'
import { encyclopedia_catalog } from '../content/catalog.ts'
import { copy_text } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

export type ItemCraftSession = Readonly<{ character: CharacterRow; inventory?: readonly ItemRow[] }>

export const ItemCraftSessionContext = createContext<ItemCraftSession | undefined>(undefined)

const useCraftSession = (session: ItemCraftSession | undefined) => {
  const contextual = useContext(ItemCraftSessionContext)
  return session ?? contextual
}

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
  const effective_session = useCraftSession(session)
  const copy = useAppStore((state) => state.copy)
  const character = useAppStore((state) =>
    effective_session?.inventory === undefined
      ? crafting_character(state, effective_session?.character)
      : effective_session.character
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
  return (
    <CraftControls
      key={item_type}
      recipe={recipe}
      character={character}
      inventory_override={effective_session?.inventory}
      job={job as JobSlug}
      level={job_level_from_xp(Number(character?.jobs[job as JobSlug] ?? 0))}
      t={copy_text(copy.characters_page)}
      open_ingredient={open_ingredient}
    />
  )
}
