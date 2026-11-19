// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { is_weapon_category, is_tool_category } from '@aresrpg/immutable'
import { MarketCategoryGlyph } from '@aresrpg/ui'
import { slot_art } from '@aresrpg/ui/art'
import { Gem, KeyRound, Package, PawPrint, FlaskConical, Sword, Users } from 'lucide-react'

const symbols = {
  EQUIPMENT: Sword,
  PETS: PawPrint,
  RUNES: Gem,
  CONSUMABLE: FlaskConical,
  RESOURCES: Package,
  CHARACTERS: Users,
  rune: Gem,
  resource: Package,
  consumable: FlaskConical,
  key: KeyRound,
}

export const MarketCategoryIcon = ({ category }: Readonly<{ category: string }>) => {
  const slot = is_weapon_category(category) ? 'weapon' : is_tool_category(category) ? 'tool' : category
  return <MarketCategoryGlyph art={slot_art[slot] ?? null} Icon={symbols[category as keyof typeof symbols] ?? null} />
}
