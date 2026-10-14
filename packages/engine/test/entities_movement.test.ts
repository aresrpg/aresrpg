// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { AnimationClip, Group, NumberKeyframeTrack, Scene } from 'three'

import { create_entity_layer } from '../src/entities.ts'

const board = Object.freeze({
  width: 2,
  height: 1,
  cell_size: 2,
  origin: Object.freeze({ x: -2, y: 4, z: -1 }),
  cells: Object.freeze([
    Object.freeze({ cell: 10, x: 0, y: 0, kind: 'start_a' as const }),
    Object.freeze({ cell: 11, x: 1, y: 0, kind: 'start_b' as const }),
  ]),
})

for (const gait of ['walk', 'run'] as const) {
  for (const full_clips of [true, false]) {
    test(`${gait} keeps its stride after replacing an unfinished attack (${full_clips ? 'full rig' : 'RUN only'})`, async () => {
      const scene = new Scene()
      const root = new Group()
      const leg = new Group()
      leg.name = 'leg'
      root.add(leg)
      // Aragne's locomotion clip is RUN; fight WALK resolves to that same clip.
      const run = new AnimationClip('RUN', 0.65, [
        new NumberKeyframeTrack('leg.rotation[x]', [0, 0.325, 0.65], [0, 1, 0]),
      ])
      const clips = full_clips
        ? [
            new AnimationClip('IDLE', 2, [new NumberKeyframeTrack('leg.rotation[x]', [0, 2], [0, 0])]),
            run,
            new AnimationClip('ATTACK', 0.7, [new NumberKeyframeTrack('leg.rotation[x]', [0, 0.7], [0, 0])]),
          ]
        : [run]
      const layer = create_entity_layer({
        scene,
        load_model: async () => ({ root, clips, min_y: 0, dispose: () => {} }),
      })
      const spec = {
        id: 'walker',
        kind: 'mob' as const,
        model_url: '/walker.glb',
        anchor: { kind: 'fight_cell' as const, cell: 10 },
        facing: { kind: 'yaw' as const, yaw: 0 },
      }
      layer.set_board(board)
      layer.set([spec])
      await layer.prepare_models()
      const start = performance.now()
      layer.tick(start)
      const attack = layer.beat(spec.id, 'attack', undefined, false, 0.8)
      layer.tick(start + 100)
      layer.tick(start + 200)
      layer.tick(start + 350)
      const motion = layer.animate({
        id: spec.id,
        cells: Array.from({ length: 10 }, (_, index) => (index % 2 === 0 ? 11 : 10)),
        gait,
      })
      const poses: number[] = []
      for (let frame = 1; frame <= 15; frame += 1) {
        layer.tick(start + 350 + frame * 100)
        layer.set([spec])
        poses.push(leg.rotation.x)
      }
      const late_poses = poses.slice(-4)
      expect(Math.max(...late_poses) - Math.min(...late_poses)).toBeGreaterThan(0.1)
      expect(await attack).toBe(false)
      layer.tick(start + 6000)
      expect(await motion).toBe(true)
      layer.dispose()
    })
  }
}
