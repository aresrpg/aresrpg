// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { AnimationMixer, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3 } from 'three'
import { WebGPURenderer } from 'three/webgpu'

import { create_character_model, find_character_bone, type CharacterModel } from '../src/character_model.ts'
import { create_entity_layer } from '../src/entities.ts'
import { create_character_crowd_layer } from '../src/character_crowd.ts'
import type { CharacterAppearanceRender } from '../src/types.ts'

export const create_title_model_probe = async (
  canvas: HTMLCanvasElement,
  load_appearance: (title: boolean, hat?: string, cloak?: string) => Promise<CharacterAppearanceRender>,
  pet_url: string | null
) => {
  const renderer = new WebGPURenderer({ canvas, antialias: true })
  await renderer.init()
  renderer.setSize(innerWidth, innerHeight, false)
  const scene = new Scene()
  scene.background = new Color('#141821')
  const camera = new PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100)
  camera.position.set(3, 2.5, 7)
  camera.lookAt(0, 1, 0)
  scene.add(new HemisphereLight(0xffffff, 0x34303a, 2))
  const sun = new DirectionalLight(0xffeddd, 3)
  sun.position.set(2, 5, 4)
  scene.add(sun)
  const crowd = create_character_crowd_layer({ scene })
  const entities = create_entity_layer({ scene })
  let last_appearance: CharacterAppearanceRender | null = null
  let model: CharacterModel | null = null
  let mixer: AnimationMixer | null = null
  let body_url: string | null = null
  let frames = 0
  let previous = performance.now()
  let animation = 'IDLE'
  const show = async (appearance: CharacterAppearanceRender) => {
    last_appearance = appearance
    entities.set([])
    const next = await create_character_model(appearance)
    model?.root.removeFromParent()
    model?.dispose()
    model = next
    model.root.position.set(-1, -model.min_y, 0)
    scene.add(model.root)
    mixer = new AnimationMixer(model.root)
    const clip = model.clips.find(({ name }) => name === animation)
    if (clip) mixer.clipAction(clip).play()
    ;({ body_url } = appearance)
    crowd.set([
      {
        id: 'nearby',
        kind: 'character',
        appearance,
        presentation: 'crowd',
        anchor: { kind: 'world', position: [1, 0, 0] },
        facing: { kind: 'yaw', yaw: 0 },
        animation: { name: 'IDLE', time_scale: 1 },
      },
    ])
  }
  const equip = async (title: boolean, hat?: string, cloak?: string) => show(await load_appearance(title, hat, cloak))
  const draw = (now: number) => {
    mixer?.update(Math.min(0.05, (now - previous) / 1000))
    previous = now
    crowd.tick(now)
    entities.tick(now)
    renderer.render(scene, camera)
    frames++
    requestAnimationFrame(draw)
  }
  await equip(true)
  requestAnimationFrame(draw)
  const mounted_distance = () => {
    const rider = scene.getObjectByName('entity:rider')?.getObjectByName('Rider')
    const seat = scene.getObjectByName('entity:pet')?.getObjectByName('Mount')
    return rider && seat ? rider.getWorldPosition(new Vector3()).distanceTo(seat.getWorldPosition(new Vector3())) : null
  }

  const crowd_parts = () => {
    let count = 0
    scene.traverse((node) => {
      if (node.name.startsWith('character-crowd:'))
        for (const socket of ['head', 'cape']) count += find_character_bone(node, socket)?.children.length ?? 0
    })
    return count
  }

  return {
    equip,
    show,
    mount: () => {
      if (!last_appearance || !pet_url) throw new Error('Mount assets unavailable')
      if (model) model.root.visible = false
      crowd.set([])
      entities.set([
        {
          id: 'pet',
          kind: 'mob',
          model_url: pet_url,
          anchor: { kind: 'world', position: [0, 0, 0] },
          facing: { kind: 'yaw', yaw: 0 },
          animation: { name: 'IDLE', time_scale: 1 },
        },
        {
          id: 'rider',
          kind: 'character',
          appearance: last_appearance,
          anchor: { kind: 'mount', entity_id: 'pet' },
          facing: { kind: 'yaw', yaw: 0 },
          animation: { name: 'SIT', time_scale: 1 },
        },
      ])
    },
    turn: (yaw: number) => {
      if (model) model.root.rotation.y = yaw
    },
    animate: (name: string) => {
      animation = name
      const clip = model?.clips.find((clip) => clip.name === name)
      if (clip && mixer) {
        mixer.stopAllAction()
        mixer.clipAction(clip).play()
      }
    },
    snapshot: () => {
      const head = find_character_bone(model!.root, 'head')!
      const cape = find_character_bone(model!.root, 'cape')!
      return {
        body_url,
        clips: model!.clips.map(({ name, duration }) => ({ name, duration })),
        mounted_visible: scene.getObjectByName('entity:rider')?.visible ?? false,
        mounted_distance: mounted_distance(),
        crowd_parts: crowd_parts(),
        frames,
        crowd: crowd.stats(),
        head_parts: head.children.length - (last_appearance?.hair_url ? 1 : 0),
        hair_visible: last_appearance?.hair_url ? head.children[0]?.visible : false,
        cape_parts: cape.children.length,
        rider: !!model!.root.getObjectByName('Rider'),
        cape_position: cape.getWorldPosition(new Vector3()).toArray(),
      }
    },
  }
}
