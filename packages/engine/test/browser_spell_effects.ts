// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Browser probe uses the production cast layer, model loader, and release-marker preparation.
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'

import { create_fight_presentation } from '../src/fight_presentation.ts'
import { create_transient_effects } from '../src/transient_effects.ts'
import { create_entity_layer } from '../src/entities.ts'
import { create_spell_effect_layer } from '../src/spell_effect_layer.ts'
import type { CharacterAppearanceRender, FightPresentationCue } from '../src/types.ts'

import { compare_spell_mask } from './browser_spell_mask.ts'

type CastCue = Extract<FightPresentationCue, { type: 'cast' }>
export const create_spell_effect_probe = async (canvas: HTMLCanvasElement) => {
  // Match the production canvas: post-process AA, never a second multisampled overlay target.
  const renderer = new WebGPURenderer({ canvas, antialias: false })
  await renderer.init()
  renderer.setSize(1000, 700, false)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = NeutralToneMapping
  const scene = new Scene()
  scene.background = new Color('#151321')
  const camera = new PerspectiveCamera(42, 1000 / 700, 0.1, 100)
  camera.position.set(7, 7, 10)
  camera.lookAt(0, 0.8, 0)
  scene.add(new HemisphereLight(0xffffff, 0x333344, 2))
  const light = new DirectionalLight(0xffffff, 2)
  light.position.set(-4, 8, 3)
  scene.add(light)
  const floor = new Mesh(new PlaneGeometry(20, 20), new MeshBasicMaterial({ color: '#242033' }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.025
  scene.add(floor)
  const entities = create_entity_layer({ scene })
  const grid = Array.from({ length: 81 }, (_, i) => ({
    cell: i,
    x: i % 9,
    y: Math.floor(i / 9),
    kind: 'floor' as const,
  }))
  entities.set_board({ origin: { x: -4.5, y: 0, z: -4.5 }, cell_size: 1, cells: grid, width: 9, height: 9 })
  let reduced = false
  const effects = create_spell_effect_layer({
    renderer,
    camera,
    anchors: entities,
    wait_for_gpu: () => (Reflect.get(renderer.backend, 'device') as GPUDevice).queue.onSubmittedWorkDone(),
    reduced_motion: () => reduced,
  })
  const legacy = create_transient_effects({ scene, entities, captions: { set: () => {} } })
  const presentation = create_fight_presentation({ entities, vfx: legacy, spells: effects })
  let clock = 0,
    started_at = 0,
    playing = false,
    previous = performance.now(),
    current: CastCue | null = null
  const draw = (): void => {
    renderer.info.reset()
    renderer.render(scene, camera)
    effects.render()
  }
  renderer.setAnimationLoop((now) => {
    const delta = Math.min(50, Math.max(0, now - previous))
    previous = now
    if (playing) {
      clock += delta
      entities.tick(clock)
      effects.tick(clock)
      legacy.tick(clock)
    }
    draw()
  })
  return {
    resize: (width: number, height: number): void => {
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    },
    mask_parity: () => compare_spell_mask(entities.spell_context().roots, camera, renderer),
    roundtrip: () => {
      const read = () => {
        const copy = document.createElement('canvas')
        copy.width = canvas.width
        copy.height = canvas.height
        const context = copy.getContext('2d')!
        context.drawImage(canvas, 0, 0)
        return context.getImageData(0, 0, canvas.width, canvas.height).data
      }
      renderer.render(scene, camera)
      const before = read()
      effects.render()
      const after = read()
      const samples = [10, Math.floor(canvas.height / 2), canvas.height - 10].map((y) => {
        const offset = (y * canvas.width + 10) * 4
        return { y, before: [...before.slice(offset, offset + 4)], after: [...after.slice(offset, offset + 4)] }
      })
      let changed = 0,
        maximum = 0
      for (let index = 0; index < before.length; index += 1) {
        const delta = Math.abs(before[index]! - after[index]!)
        maximum = Math.max(maximum, delta)
        if (delta > 1) changed += 1
      }
      return { samples, changed, maximum }
    },
    choose: async (cue: CastCue, appearance: CharacterAppearanceRender) => {
      playing = false
      clock += 10000
      effects.tick(clock)
      entities.set([
        {
          id: cue.caster_id,
          kind: 'character',
          appearance,
          anchor: { kind: 'fight_cell', cell: 37 },
          facing: { kind: 'yaw', yaw: Math.PI / 2 },
        },
      ])
      current = {
        ...cue,
        target_cell: 43,
        affected_cells: [43],
        effect: {
          ...cue.effect!,
          areas: cue.effect!.areas.map((area) => ({
            ...area,
            cells: area.cells.length > 1 ? [33, 34, 35, 42, 43, 44, 51, 52, 53] : [43],
          })),
        },
      }
      entities.tick(clock)
      effects.tick(clock)
      current = (await presentation.prepare(current)) as CastCue
      void presentation.play(current)
      started_at = clock
      return current
    },
    sample: (seconds: number) => {
      playing = false
      const target = started_at + seconds * 1000
      while (clock < target) {
        clock = Math.min(target, clock + 1000 / 60)
        entities.tick(clock)
        effects.tick(clock)
      }
      draw()
    },
    play: () => {
      playing = true
    },
    reduced: (value: boolean) => {
      reduced = value
    },
    frame: () => {
      clock += 1000 / 60
      entities.tick(clock)
      effects.tick(clock)
      legacy.tick(clock)
      draw()
    },
    snapshot: () => ({
      white: scene.getObjectByName('spell-hit:white')?.visible ?? false,
      inverted: scene.getObjectByName('spell-hit:invert')?.visible ?? false,
      cue: current,
      draw_calls: renderer.info.render.drawCalls,
      triangles: renderer.info.render.triangles,
    }),
    dispose: () => {
      renderer.setAnimationLoop(null)
      effects.dispose()
      legacy.dispose()
      entities.dispose()
      floor.geometry.dispose()
      floor.material.dispose()
      renderer.dispose()
    },
  }
}
