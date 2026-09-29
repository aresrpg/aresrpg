// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { compile_runtime_world_recipe } from '../src/world_recipe.ts'
import { create_webgpu_backend } from '../src/webgpu_backend.ts'

import { LIFECYCLE_WORLD } from './browser_lifecycle.ts'

export const probe_sword_labels = async (canvas: HTMLCanvasElement, url: string, sound: string) => {
  const backend = await create_webgpu_backend(canvas, 'low', compile_runtime_world_recipe(LIFECYCLE_WORLD), () => {})
  const element = document.createElement('div')
  element.textContent = 'Join fight · F'
  element.dataset.swordProbe = 'webgpu'
  try {
    backend.set_camera([0, 8, 20], [0, 3, 0])
    backend.set_audio_volume(0)
    backend.set_fight_swords(url, sound, [{ id: 'fight', x: 0, y: 0, z: 0, placement_ms: Date.now() - 60_000 }])
    backend.set_fight_sword_label('fight', element)
    backend.render(performance.now())
    const attached = element.isConnected && element.style.display !== 'none'
    const before = element.style.transform
    backend.set_camera([10, 8, 20], [0, 3, 0])
    backend.render(performance.now() + 16)
    const moved = before !== element.style.transform
    backend.set_fight_swords(url, sound, [])
    backend.render(performance.now() + 32)
    const hidden = element.style.display === 'none' || !element.isConnected
    backend.set_fight_sword_label('fight', null)
    return { attached, moved, hidden, detached: !element.isConnected }
  } finally {
    backend.dispose()
  }
}
