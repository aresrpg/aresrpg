// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import nauvis_art from '../assets/worlds/nauvis.webp'
import yakutia_art from '../assets/worlds/yakutia.webp'

import { encyclopedia_catalog, titleize } from './catalog.ts'
import { worlds_source } from './worlds.ts'

const WORLD_ART = Object.freeze({ nauvis: nauvis_art, yakutia: yakutia_art })

export const world_card_rows = () =>
  worlds_source.map((world) =>
    Object.freeze({
      id: world.world,
      label: titleize(world.world),
      entry_level: world.entry_level,
      biomes:
        encyclopedia_catalog.world(world.world)?.terrain?.biomes.map(({ name }) => titleize(name)) ?? Object.freeze([]),
      art: WORLD_ART[world.world as keyof typeof WORLD_ART] ?? null,
    })
  )
