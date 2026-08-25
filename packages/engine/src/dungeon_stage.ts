// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One lightweight dungeon staging set: a faceted stone island above a local dark-water sheet.

import { CircleGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, type Scene } from 'three'

import type { DungeonStageRender } from './types.ts'

export const create_dungeon_stage = ({ scene }: Readonly<{ scene: Scene }>) => {
  const root = new Group()
  root.visible = false
  const water_geometry = new PlaneGeometry(150, 150)
  const water_material = new MeshStandardMaterial({
    color: 0x071d2c,
    emissive: 0x031522,
    emissiveIntensity: 0.55,
    metalness: 0.15,
    roughness: 0.24,
    transparent: true,
    opacity: 0.94,
  })
  const water = new Mesh(water_geometry, water_material)
  water.rotation.x = -Math.PI / 2
  water.position.y = -2.6
  water.receiveShadow = true
  const stone_material = new MeshStandardMaterial({ color: 0x3b4149, roughness: 0.96, metalness: 0.02 })
  const lower_geometry = new CylinderGeometry(24, 19, 5.2, 11, 2)
  const upper_geometry = new CylinderGeometry(20.5, 23.5, 2.1, 13, 1)
  const lower = new Mesh(lower_geometry, stone_material)
  lower.position.y = -1.35
  lower.receiveShadow = true
  lower.castShadow = true
  const upper = new Mesh(upper_geometry, stone_material)
  upper.position.y = 1.55
  upper.rotation.y = 0.19
  upper.receiveShadow = true
  upper.castShadow = true
  const rim_material = new MeshStandardMaterial({ color: 0x58606a, roughness: 1 })
  const rim_geometry = new CircleGeometry(19.2, 13)
  const rim = new Mesh(rim_geometry, rim_material)
  rim.rotation.x = -Math.PI / 2
  rim.rotation.z = 0.19
  rim.position.y = 2.63
  rim.receiveShadow = true
  root.add(water, lower, upper, rim)
  scene.add(root)

  return Object.freeze({
    set: (stage: DungeonStageRender | null): void => {
      root.visible = stage !== null
      if (stage) root.position.set(stage.x, stage.y - 2.63, stage.z)
    },
    dispose: (): void => {
      scene.remove(root)
      water_geometry.dispose()
      lower_geometry.dispose()
      upper_geometry.dispose()
      rim_geometry.dispose()
      water_material.dispose()
      stone_material.dispose()
      rim_material.dispose()
    },
  })
}
