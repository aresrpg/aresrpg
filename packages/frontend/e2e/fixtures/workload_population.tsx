// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { MobEntityRender, ResourceNodeMarker } from '@aresrpg/engine'
import { createRoot } from 'react-dom/client'

import { NametagCard } from '../../src/components/NametagCard.tsx'
import { content_catalog } from '../../src/content/catalog.ts'
import { load_pet_model_url } from '../../src/content/pet_models.ts'
import { resource_markers } from '../../src/game/resource_nodes.ts'

import '../../src/tailwind.css'

export const workload_pets = async (
  count: number,
  focus: readonly [number, number],
  ground_height: (x: number, z: number) => number
): Promise<readonly MobEntityRender[]> => {
  const types = ['suicune', 'vaporeon', 'primemachin', 'oeuftermath']
  const models = await Promise.all(types.map(load_pet_model_url))
  if (models.some((model) => !model)) throw new Error('Workload omitted authored pet models')
  return Array.from({ length: count }, (_, index) => {
    const x = focus[0] + ((index % 10) - 4.5) * 3
    const z = focus[1] + (Math.floor(index / 10) - 4.5) * 3
    return {
      id: `workload_pet_${index}`,
      kind: 'mob',
      model_url: models[index % models.length]!,
      anchor: { kind: 'world', position: [x, ground_height(x, z), z] },
      facing: { kind: 'yaw', yaw: 0 },
      animation: { name: 'RUN', time_scale: 1.5 },
    }
  })
}

export const workload_resources = (
  packs: number,
  nodes: number,
  focus: readonly [number, number],
  ground_height: (x: number, z: number) => number
): readonly ResourceNodeMarker[] => {
  const { resources } = content_catalog.world('nauvis')!
  return resource_markers(
    Array.from({ length: packs }, (_, index) => ({
      ...resources[index % resources.length]!,
      id: `workload_resource_${index}`,
      nodes,
      x: focus[0] + ((index % 8) - 3.5) * 9,
      z: focus[1] + (Math.floor(index / 8) - 2.5) * 9,
    })),
    ground_height
  )
}

export const workload_labels = (
  markers: readonly ResourceNodeMarker[],
  label: (id: string, element: HTMLElement | null) => void
) => {
  const rows = markers
    .filter(({ id }) => id.endsWith(':n0'))
    .map(({ id, item_type }) => {
      const element = document.createElement('div')
      const root = createRoot(element)
      root.render(
        <NametagCard name={content_catalog.item(item_type)?.item.name} lines={[{ key: 'gather', text: 'Gather' }]} />
      )
      return { id, element, root }
    })
  return {
    count: rows.length,
    show: (visible: boolean) => rows.forEach(({ id, element }) => label(id, visible ? element : null)),
    dispose: () =>
      rows.forEach(({ id, root }) => {
        label(id, null)
        root.unmount()
      }),
  }
}
