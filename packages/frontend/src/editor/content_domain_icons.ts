// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  Crosshair,
  DoorOpen,
  Gem,
  Gift,
  Globe2,
  Hammer,
  Package,
  Skull,
  Sparkles,
  Trees,
  type LucideIcon,
} from 'lucide-react'

import type { SeedDomain } from './seed_editor.ts'

const domain_icons: Readonly<Record<SeedDomain, LucideIcon>> = Object.freeze({
  airdrop: Gift,
  dungeons: DoorOpen,
  fight_boards: Crosshair,
  items: Package,
  mastery: Gem,
  mobs: Skull,
  recipes: Hammer,
  spells: Sparkles,
  structure_packs: Trees,
  worlds: Globe2,
})

export const content_domain_icon = (domain: SeedDomain): LucideIcon => domain_icons[domain]
