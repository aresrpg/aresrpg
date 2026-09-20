// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Scene, PerspectiveCamera, Vector3 } from 'three'

import { create_entity_layer } from '../src/entities.ts'
import { create_entity_label_layer } from '../src/entity_labels.ts'
import type { WorldCaption } from '../src/caption_types.ts'
import { create_fight_float_layer } from '../src/fight_floats.ts'
import { create_mob_model } from '../src/mob_model.ts'
import { create_character_model } from '../src/character_model.ts'
import type { CharacterAppearanceRender } from '../src/types.ts'

export const probe_model_anchors = async (
  canvas: HTMLCanvasElement,
  appearance: CharacterAppearanceRender,
  models: Readonly<Record<string, { model_url: string; variant: string | null }>>
) => {
  const scene = new Scene()
  const layer = create_entity_layer({ scene })
  const camera = new PerspectiveCamera(60, 640 / 480, 0.1, 100)
  camera.position.set(104, 5, 18)
  camera.lookAt(104, 1, 0)
  camera.updateMatrixWorld(true)
  const labels = create_entity_label_layer({ canvas, camera, entities: layer })
  const captions = new Map<string, { caption: WorldCaption; anchor: () => Vector3 | null }>()
  const floats = create_fight_float_layer({
    entities: layer,
    captions: {
      set: (id, caption, anchor) => {
        if (caption) captions.set(id, { caption, anchor })
        else captions.delete(id)
      },
    },
  })
  // Prime caches as a preceding overworld view does before entering combat.
  const warm_character = await create_character_model(appearance)
  warm_character.dispose()
  const types = Object.keys(models)
  for (const type of types) {
    const model = models[type]!
    const warm = await create_mob_model(model.model_url)
    warm.dispose()
  }
  layer.set([
    {
      id: 'hero',
      kind: 'character',
      appearance,
      anchor: { kind: 'world', position: [100, 0, 0] },
      facing: { kind: 'yaw', yaw: 0 },
    },
    ...types.map((type, index) => ({
      id: type,
      kind: 'mob' as const,
      ...models[type]!,
      anchor: { kind: 'world' as const, position: [103 + index * 3, 0, 0] as const },
      facing: { kind: 'yaw' as const, yaw: 0 },
    })),
  ])
  const ids = ['hero', ...types]
  const deadline = performance.now() + 20000
  while (ids.some((id) => layer.entity_height(id) === null)) {
    if (performance.now() > deadline) throw new Error('Models did not finish loading')
    await new Promise(requestAnimationFrame)
  }
  try {
    layer.tick(performance.now())
    labels.resize(640, 480)
    const elements = ids.map((id) => {
      const element = document.createElement('div')
      element.textContent = `${id} · 100 HP`
      labels.set(id, element)
      return element
    })
    labels.render()
    const now = performance.now()
    floats.tick(now)
    const played = ids.map((id) => floats.play(id, 14, 'damage'))
    floats.tick(now + 300)
    const numbers = [...captions.values()]
    const rows = ids.map((id, index) => ({
      id,
      expected_x: 100 + index * 3,
      height: layer.entity_height(id),
      anchor: layer.world_anchor(id)?.toArray(),
      crown: layer.live_crown(id)?.toArray(),
      label_visible: elements[index]!.isConnected && elements[index]!.style.display !== 'none',
      label_transform: elements[index]!.style.transform,
    }))
    return {
      rows,
      floats: numbers.map((number, index) => ({
        played: played[index],
        visible: (number.caption.opacity ?? 1) > 0,
        projected: new Vector3().copy(number.anchor()!).project(camera).toArray(),
      })),
    }
  } finally {
    labels.dispose()
    floats.dispose()
    layer.dispose()
  }
}
