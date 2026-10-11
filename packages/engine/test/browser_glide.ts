// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  type InstancedBufferGeometry,
  type Mesh,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import { create_entity_layer } from '../src/entities.ts'
import { create_pet_wing_layer } from '../src/pet_wing_layer.ts'
import type { PetWingStyle } from '../src/pet_wing_style.ts'
import type { CharacterAppearanceRender, EngineQuality, EntityRender } from '../src/types.ts'

type Pet = Readonly<{ model_url: string; wings?: PetWingStyle }>
export const create_glide_probe = async (
  canvas: HTMLCanvasElement,
  appearance: CharacterAppearanceRender,
  load_pet: (name: string) => Promise<Pet | null>
) => {
  const renderer = new WebGPURenderer({ canvas, antialias: true })
  await renderer.init()
  renderer.setSize(innerWidth, innerHeight, false)
  renderer.toneMapping = NeutralToneMapping
  renderer.outputColorSpace = SRGBColorSpace
  const scene = new Scene()
  scene.background = new Color('#493561')
  const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 100)
  camera.position.set(5, 3.8, 9)
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 1.2, 0)
  controls.update()
  const light = new HemisphereLight(0xffffff, 0x403447, 2)
  const sun = new DirectionalLight(0xffeedd, 2)
  sun.position.set(3, 5, 4)
  scene.add(light, sun)
  const entities = create_entity_layer({ scene })
  const wings = create_pet_wing_layer(scene, camera, entities.mount_anchor, 'high')
  let specs: readonly EntityRender[] = []
  let deployed = true
  let frame = 0
  const submit = () => {
    entities.set(specs)
    wings.set(specs)
  }
  const choose = async (name: string) => {
    const pet = await load_pet(name)
    if (!pet?.wings) throw new Error(`Missing wing profile for ${name}`)
    specs = [
      {
        id: 'rider',
        kind: 'character',
        appearance,
        anchor: { kind: 'mount', entity_id: 'pet' },
        facing: { kind: 'yaw', yaw: 0 },
        animation: { name: 'SIT', time_scale: 1 },
      },
      {
        id: 'pet',
        kind: 'mob',
        model_url: pet.model_url,
        wings: { ...pet.wings, deployed },
        anchor: { kind: 'world', position: [0, 0, 0] },
        facing: { kind: 'yaw', yaw: 0 },
        animation: { name: 'IDLE', time_scale: 1 },
      },
    ]
    submit()
  }
  renderer.setAnimationLoop((now) => {
    entities.tick(now)
    wings.tick(now)
    renderer.render(scene, camera)
    frame++
  })
  const count = (name: string) =>
    ((scene.getObjectByName(name) as Mesh).geometry as InstancedBufferGeometry).instanceCount
  return {
    choose,
    deploy: (active: boolean) => {
      deployed = active
      specs = specs.map((spec) =>
        spec.kind === 'mob' && spec.wings ? { ...spec, wings: { ...spec.wings, deployed } } : spec
      )
      submit()
    },
    quality: (quality: EngineQuality) => wings.set_quality(quality),
    night: (night: boolean) => {
      light.intensity = night ? 0.2 : 2
      sun.intensity = night ? 0.1 : 2
      scene.background = new Color(night ? '#101522' : '#493561')
    },
    view: (x: number, y: number, z: number) => {
      camera.position.set(x, y, z)
      controls.update()
    },
    snapshot: () => ({
      frame,
      ready: entities.mount_anchor('pet') !== null,
      wings: count('pet-wings:surfaces'),
      trails: count('pet-wings:trails'),
    }),
    dispose: () => {
      renderer.setAnimationLoop(null)
      wings.dispose()
      entities.dispose()
      controls.dispose()
      renderer.dispose()
    },
  }
}
