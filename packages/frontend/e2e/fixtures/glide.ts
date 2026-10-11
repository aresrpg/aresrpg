// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_glide_probe } from '../../../engine/test/browser_glide.ts'
import { load_pet_companion } from '../../src/content/pet_models.ts'
import { load_character_appearance } from '../../src/game/character_entities.ts'

import type { create_glide_world_probe } from './glide_world.ts'

declare global {
  interface Window {
    glide_world_probe: Awaited<ReturnType<typeof create_glide_world_probe>>
    glide_probe: Awaited<ReturnType<typeof create_glide_probe>>
  }
}
if (new URLSearchParams(location.search).has('relay')) {
  const { create_glide_world_probe } = await import('./glide_world.ts')
  window.glide_world_probe = await create_glide_world_probe(document.querySelector('canvas')!)
} else {
  window.glide_probe = await create_glide_probe(
    document.querySelector('canvas')!,
    await load_character_appearance({
      id: 'rider',
      classe: 'senshi',
      male: false,
      colors: ['#f3eadb', '#7755bb', '#ddbb55'],
      loadout: {},
    }),
    (name) => load_pet_companion('pet', name)
  )
  await window.glide_probe.choose('beru')
  window.addEventListener('pagehide', () => window.glide_probe.dispose(), { once: true })
}
