// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// An item's sheet without where it comes from: identity, characteristics and a pet's diet. It reads the item
// table alone, so a tooltip or the market shows it without loading the recipes, the mobs or the worlds.
import type { ReactNode } from 'react'

import { ItemDetailBody, type ItemDetailProps } from './ItemDetailBody.tsx'
import { ItemPetDiet } from './ItemPetDiet.tsx'

/** `select_item` makes the diet's foods open their own sheet; `sources` follow the diet on a full sheet. */
export const ItemSummary = ({
  select_item,
  sources,
  ...props
}: ItemDetailProps & Readonly<{ select_item?: (id: string) => void; sources?: ReactNode }>) => (
  <ItemDetailBody {...props}>
    {props.children}
    {!props.edit && props.category === 'pet' && <ItemPetDiet item_type={props.item_type} select_item={select_item} />}
    {sources}
  </ItemDetailBody>
)
