// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_riding_probe } from '../../../engine/test/browser_riding.ts'
import { load_character_appearance } from '../../src/game/character_entities.ts'
import { load_pet_model_url } from '../../src/content/pet_models.ts'

import type { create_riding_world_probe } from './riding_world.ts'

declare global {
  interface Window {
    riding_probe: Awaited<ReturnType<typeof create_riding_probe>>
    riding_world_probe: Awaited<ReturnType<typeof create_riding_world_probe>>
  }
}

if (new URLSearchParams(location.search).has('world')) {
  const { create_riding_world_probe } = await import('./riding_world.ts')
  window.riding_world_probe = await create_riding_world_probe(document.querySelector('canvas')!)
} else {
  const source = new URLSearchParams(location.search).get('source')
  const probe = await create_riding_probe(
    document.querySelector('canvas')!,
    async (classe, male) => {
      const appearance = await load_character_appearance({
        id: 'rider',
        classe,
        male,
        colors: ['#f3eadb', '#2f8fe8', '#d9af57'],
        loadout: {},
      })
      return source
        ? { ...appearance, body_url: `${source}/characters/${classe}_${male ? 'male' : 'female'}.glb` }
        : appearance
    },
    async (pet_type) => (source ? `${source}/pets/${pet_type}.glb` : load_pet_model_url(pet_type))
  )
  window.riding_probe = probe
  await probe.choose('suicune')
}
