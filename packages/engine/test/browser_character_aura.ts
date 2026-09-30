// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'

import type { CharacterEntityRender, CharacterAppearanceRender, CharacterAura } from '../src/types.ts'
import { create_entity_layer } from '../src/entities.ts'
import { create_character_crowd_layer } from '../src/character_crowd.ts'
import { create_character_aura_layer } from '../src/character_aura_layer.ts'

export const create_aura_probe = async (
  canvas: HTMLCanvasElement,
  appearance: CharacterAppearanceRender,
  aura_for: (equipped: boolean, admin: boolean) => CharacterAura | undefined
) => {
  const renderer = new WebGPURenderer({ canvas, antialias: true })
  await renderer.init()
  renderer.setSize(innerWidth, innerHeight, false)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = NeutralToneMapping
  const scene = new Scene()
  scene.background = new Color('#141821')
  const camera = new PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100)
  camera.position.set(3, 2.5, 7)
  camera.lookAt(0, 1, 0)
  scene.add(new HemisphereLight(0xffffff, 0x34303a, 2))
  const sun = new DirectionalLight(0xffeddd, 3)
  sun.position.set(2, 5, 4)
  scene.add(sun)
  const floor = new Mesh(new PlaneGeometry(20, 20), new MeshStandardMaterial({ color: '#34363c', roughness: 1 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.02
  scene.add(floor)
  const entities = create_entity_layer({ scene })
  const crowd = create_character_crowd_layer({ scene })
  const anchors = {
    world_anchor: (id: string) => entities.world_anchor(id) ?? crowd.world_anchor(id),
    entity_height: (id: string) => entities.entity_height(id) ?? crowd.entity_height(id),
  }
  const auras = create_character_aura_layer(scene, camera, anchors, 'high')

  const board = {
    width: 4,
    height: 1,
    cell_size: 1.4,
    origin: { x: -2.8, y: 0, z: -0.7 },
    cells: Array.from({ length: 4 }, (_, cell) => ({ cell, x: cell, y: 0, kind: 'floor' as const })),
  }
  entities.set_board(board)
  let equipped = true
  let admin = false
  let moving = false
  let fighting = false
  let batched = false
  let visible = true
  let x = 0
  let previous = performance.now()
  let animation_time = previous
  let peak_particles = 0
  const id = () => (fighting ? 'fighter' : 'subject')
  const spec = (): CharacterEntityRender => ({
    id: id(),
    kind: 'character',
    appearance,
    aura: aura_for(equipped, admin),
    anchor: fighting ? { kind: 'fight_cell', cell: 0 } : { kind: 'world', position: [x, 0, 0] },
    facing: { kind: 'yaw', yaw: Math.PI / 2 },
    presentation: batched ? 'crowd' : 'individual',
    visible,
    animation: { name: moving ? 'RUN' : 'IDLE', time_scale: 1 },
  })
  const submit = () => {
    const value = spec()
    entities.set(batched && !fighting ? [] : [value])
    crowd.set(
      batched && !fighting
        ? [value as CharacterEntityRender & { anchor: { kind: 'world'; position: readonly [number, number, number] } }]
        : []
    )
    auras.set([value])
  }
  const draw = (now: number) => {
    const delta = Math.min(0.05, (now - previous) / 1000)
    previous = now
    if (moving && !fighting) {
      x += delta * 2
      if (x > 2.5) x = -2.5
      submit()
    }
    // Render assertions use the same bounded animation clock as fixture movement, including shader stalls.
    animation_time += delta * 1000
    entities.tick(animation_time)
    crowd.tick(animation_time)
    auras.tick(animation_time)
    peak_particles = Math.max(peak_particles, auras.stats().particles)
    renderer.render(scene, camera)
    requestAnimationFrame(draw)
  }
  submit()
  requestAnimationFrame(draw)
  const probe = {
    admin: (next: boolean) => {
      admin = next
      submit()
    },
    equip: (next: boolean) => {
      equipped = next
      submit()
    },
    moving: (next: boolean) => {
      moving = next
      submit()
    },
    visible: (next: boolean) => {
      visible = next
      submit()
    },
    crowd: (next: boolean) => {
      batched = next
      submit()
    },
    fight: () => {
      moving = false
      fighting = true
      batched = false
      submit()
    },
    walk_fight: async () => {
      peak_particles = 0
      const completed = await entities.animate({ id: 'fighter', cells: [0, 1, 2, 3], gait: 'walk' })
      return { completed, particles: peak_particles }
    },
    snapshot: () => ({
      ...auras.stats(),
      height: anchors.entity_height(id()),
      crowd: crowd.stats(),
      aura_height: (scene.getObjectByName('character-aura:shell') as Mesh).geometry.getAttribute('aura_size').getX(0),
    }),
  }

  return probe
}
