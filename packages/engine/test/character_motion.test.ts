// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { Matrix4, Quaternion, Vector3 } from 'three'

type Node = {
  name: string
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  matrix?: number[]
  children?: number[]
}
type Clip = {
  name: string
  samplers: { input: number; output: number }[]
  channels: { sampler: number; target: { node: number; path: 'translation' | 'rotation' | 'scale' } }[]
}
const read_model = (slug: string) => {
  const bytes = readFileSync(new URL(`../../../seed/models/characters/${slug}.glb`, import.meta.url))
  const json_length = bytes.readUInt32LE(12)
  const source = JSON.parse(bytes.subarray(20, 20 + json_length).toString()) as {
    nodes: Node[]
    accessors: { bufferView: number; byteOffset?: number; count: number; type: string }[]
    bufferViews: { byteOffset?: number; byteStride?: number }[]
    animations: Clip[]
  }
  const read = (index: number) => {
    const accessor = source.accessors[index]!
    const view = source.bufferViews[accessor.bufferView]!
    const size = accessor.type === 'SCALAR' ? 1 : accessor.type === 'VEC4' ? 4 : 3
    const start = 28 + json_length + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    return Array.from({ length: accessor.count }, (_, row) =>
      Array.from({ length: size }, (_, axis) =>
        bytes.readFloatLE(start + row * (view.byteStride ?? size * 4) + axis * 4)
      )
    )
  }
  const parents = new Map(
    source.nodes.flatMap((node, index) => node.children?.map((child) => [child, index] as const) ?? [])
  )
  const duration = (clip: Clip) =>
    Math.max(0, ...clip.samplers.flatMap(({ input }) => read(input).map(([time]) => time!)))
  const pose = (clip: Clip, phase: number) => {
    const nodes = source.nodes.map((row) => {
      const position = new Vector3().fromArray(row.translation ?? [0, 0, 0])
      const rotation = new Quaternion().fromArray(row.rotation ?? [0, 0, 0, 1])
      const scale = new Vector3().fromArray(row.scale ?? [1, 1, 1])
      if (row.matrix) new Matrix4().fromArray(row.matrix).decompose(position, rotation, scale)
      return { position, rotation, scale }
    })
    const time = duration(clip) * phase
    for (const channel of clip.channels) {
      const sampler = clip.samplers[channel.sampler]!
      const times = read(sampler.input).map(([time]) => time!)
      const values = read(sampler.output)
      const found = times.findIndex((value) => value >= time)
      const next = found < 0 ? times.length - 1 : found
      const previous = Math.max(0, next - 1)
      const span = times[next]! - times[previous]!
      const alpha = span ? (time - times[previous]!) / span : 0
      const node = nodes[channel.target.node]!
      if (channel.target.path === 'rotation')
        node.rotation.fromArray(values[previous]!).slerp(new Quaternion().fromArray(values[next]!), alpha)
      else {
        const value = { translation: node.position, scale: node.scale }[channel.target.path]
        value.fromArray(values[previous]!).lerp(new Vector3().fromArray(values[next]!), alpha)
      }
    }
    const world = (index: number): Matrix4 => {
      const node = nodes[index]!
      const local = new Matrix4().compose(node.position, node.rotation, node.scale)
      const parent = parents.get(index)
      return parent === undefined ? local : world(parent).multiply(local)
    }
    return (name: string) => world(source.nodes.findIndex((node) => node.name === `mixamorig:${name}`))
  }
  return { source, duration, pose }
}

// The reported export contained named jumps with sparse motion, so test the actual
// signed trajectory and visible limb directions rather than clip presence.
test.each(['IDLE', 'WALK', 'RUN', 'JUMP', 'JUMP_RUN', 'FALL'])(
  'Blast %s follows the standard community motion on its fitted rig',
  (name) => {
    const model = read_model('blast_girl')
    const reference = read_model('aeon')
    const clip = model.source.animations.find((clip) => clip.name === name)!
    const donor = reference.source.animations.find((clip) => clip.name === name)!
    // Sources sample at 60fps and 24fps; their exporter rounds the final frame.
    expect(Math.abs(model.duration(clip) - reference.duration(donor))).toBeLessThan(1 / 24 + 1 / 60)
    const rest = model.pose({ name: '', samplers: [], channels: [] }, 0)
    const donor_rest = reference.pose({ name: '', samplers: [], channels: [] }, 0)
    for (const fraction of [0, 0.2, 0.5, 0.8, 1]) {
      const reference_frames = Math.round(reference.duration(donor) * 24)
      const phase = Math.round(fraction * reference_frames) / reference_frames
      const actual = model.pose(clip, phase)
      const expected = reference.pose(donor, phase)
      const displacement = (pose: typeof actual, base: typeof rest) => {
        const origin = new Vector3().setFromMatrixPosition(base('Hips'))
        return new Vector3().setFromMatrixPosition(pose('Hips')).sub(origin).divideScalar(origin.y)
      }
      const position = displacement(actual, rest)
      const target = displacement(expected, donor_rest)
      // Measured 24→60fps resampling error: <0.016 hip heights and <0.072 radians.
      expect(position.distanceTo(target)).toBeLessThan(0.02)
      // Compare visible directions against independently specified physical-side pairs.
      for (const [joint, mapped] of [
        ['Hips', 'Hips'],
        ['Spine2', 'Spine2'],
        ['LeftArm', 'RightArm'],
        ['RightArm', 'LeftArm'],
        ['LeftForeArm', 'RightForeArm'],
        ['RightForeArm', 'LeftForeArm'],
        ['LeftUpLeg', 'RightUpLeg'],
        ['LeftLeg', 'RightLeg'],
      ] as const) {
        const aim = new Vector3(0, 1, 0).transformDirection(actual(joint))
        const target_aim = new Vector3(0, 1, 0).transformDirection(expected(mapped))
        expect(aim.angleTo(target_aim)).toBeLessThan(0.08)
      }
      // Boots have authored flat sole/forward axes; their bone +Y axes differ between rigs.
      for (const [foot, mapped] of [
        ['LeftFoot', 'RightFoot'],
        ['RightFoot', 'LeftFoot'],
      ] as const) {
        const deformation = actual(foot).multiply(rest(foot).invert())
        const target_deformation = expected(mapped).multiply(donor_rest(mapped).invert())
        for (const axis of [new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
          expect(
            axis.clone().transformDirection(deformation).angleTo(axis.clone().transformDirection(target_deformation))
          ).toBeLessThan(0.08)
        }
      }
    }
  }
)

test('Blast idle keeps both wrists below their shoulders instead of the reported T-pose', () => {
  const model = read_model('blast_girl')
  const idle = model.source.animations.find(({ name }) => name === 'IDLE')!
  for (const phase of [0, 0.2, 0.5, 0.8, 1]) {
    const pose = model.pose(idle, phase)
    for (const side of ['Left', 'Right']) {
      const shoulder = new Vector3().setFromMatrixPosition(pose(`${side}Arm`))
      const wrist = new Vector3().setFromMatrixPosition(pose(`${side}Hand`))
      expect(wrist.y).toBeLessThan(shoulder.y)
      expect(Math.sign(wrist.x)).toBe(Math.sign(shoulder.x))
    }
  }
})
