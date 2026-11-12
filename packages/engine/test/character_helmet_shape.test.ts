// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { Matrix4, Vector3 } from 'three'

import { read_character_glb } from './helpers/character_glb.ts'

const characters = new URL('../../../seed/models/characters/', import.meta.url)
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
// Approved models captured at 0ced9ea4, 2026-11-12. Only the Helmet frame may change.
const approved = [
  [
    'aeon',
    '1c94b8254015de7bddbc16636c71a6756ec63310b3f66d9bb8d21126ab0ba5af',
    '662e35a026b3b76580666fe668724e674c39b6270948c1c4b2652178986e303d',
    '67a4f01b4dddf51e201ea2bd2e872010bee4f4edd1b611a618a80a4ca50a3c4a',
  ],
  [
    'blast_girl',
    '045928d2297807df80badb81612950b66e2540ad7f93ca79b20c3a4998c9c97d',
    '8f3ba7dbb77aae8aa83f55fc1adb9669e329bbbc17a8a497e832d5b0f8cdcf7d',
    '22cf41a5e08d376377a1a29c0804c4606492277e5da0883d3b48379f7ac6b5f8',
  ],
  [
    'enforcer_machin',
    '65b26787e16d1be52c695fe36ba5004176ab0d3b9901f6c7c58e667695c7d9f4',
    'a3b5a9e32f0d6789ece1c45b03ddb732b7fdb142a8d09c61177bdce2001a3c4e',
    '514f05c542d7bd80909a5705e6c1dd430bfee553de2fcf89930a336b0d758801',
  ],
  [
    'fuddies',
    '65adc82a602bc60687174ea7d87cecc09b84d5d0b2811a46151e4d436104f1e1',
    '03cd1c6e97e17c0ac0f9b7f7d2abfe0fa1d0aca3ab95ef2ddb7ea95f5da61a2a',
    '9de25a72369f70f52f1926328ce154a52f8a6898a21cfbf04ab8063926f7b00d',
  ],
  [
    'mystic_yeti',
    '9e7e55b9a4e92b06dc7f469d83c753bacf803d284bfaeed561c454d4a55d227e',
    '888c2d3ee42c2d6a07d150f14753d694686f043538bf60958c62574cc09dd087',
    'ea15c8e20b603fd97e9d63bcdcf5cc6f41024ee89f4880571e459fbbe9ce59b8',
  ],
  [
    'pawtato_heroes',
    '299d2b91fce6beaafb66d48ada002889f0ab90adcc1d9c7b180f446cc96ef9e7',
    'b24b5e0374a3ccf331887def328a5d22c43f3dc6dcb68c9cc5ecdabd9d187bab',
    '18dd8436621676a0959c0b71663f0be8e9875b9349ff30cbe1f51b118c9de380',
  ],
  [
    'puggies',
    '39b025ed1dcf3f2c1e7885ea844a4eb1792c380b9e3c7692f785ea1674d3e16a',
    '83ed00b1f48cf0ec5da11a1be54c61d8e0a75cbb6b45058a3274024bef993f15',
    '58997ae71118b45983162904dd99c5e9139d8522433de3240044262e42908ddf',
  ],
  [
    'rootlets',
    '8a3de85c82e1906574e6bb3c3dce1f02bd42bb18b0f5da8782d945937bdcd919',
    'a034b14b85a3f95791787cce2b6be93c1cfd9c16a0a4587e8bb5eb4c562d59b0',
    '49aac2cbf5fb52ba3aa052eb94c10d49ed2840f15fa1afaa63e8f4e808cfc2de',
  ],
  [
    'suimilios',
    '9c70ec4b5a8833a4f08b267359e6657e00839b91e207ad05214254f0150d9d33',
    '8d2e391475b6ff9a79e4fdc5bf7c48ca0739c7ee1c668838f884ac92dac15b94',
    '71b657afe11c3d6c885a09073ef36935b105532d34e52b2709c83da8bde7e5c7',
  ],
  [
    'the_ones',
    'fbf12df801ab6ac9424e585e77ccf24f42a20352c313515222a64788a5f44d63',
    '8f597269c7d792fe0826591fcbfbc48473c78dc41c3d36b385e64d9513bff10a',
    '51a2a91ed7ec0bc2d4fd4c43b5d7207fb42fb57718c29148e494688fe108d880',
  ],
] as const
const originals = readdirSync(characters).filter((name) => /_(male|female)\.glb$/.test(name))
const bodies = [...originals, ...approved.map(([name]) => `${name}.glb`)]

const expect_similarity = (matrix: Matrix4, label: string) => {
  const axes = [0, 1, 2].map((axis) => new Vector3().setFromMatrixColumn(matrix, axis))
  const lengths = axes.map((axis) => axis.length())
  expect(Math.min(...lengths), label).toBeGreaterThan(0)
  // Exported native bone rotations have float32 noise; unequal authored scales do not.
  expect(Math.max(...lengths) / Math.min(...lengths), label).toBeCloseTo(1, 4)
  for (const [left, right] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ])
    expect(Math.abs(axes[left!]!.dot(axes[right!]!) / (lengths[left!]! * lengths[right!]!)), label).toBeLessThan(0.0001)
}

test.each(bodies)('%s keeps helmet proportions through its inherited animated transform', (name) => {
  const model = read_character_glb(new URL(name, characters))
  const head = model.document.nodes.findIndex(({ name }) => name?.endsWith(':Head'))
  expect(head).toBeGreaterThanOrEqual(0)
  const socket =
    model.document.nodes[head]!.children?.find((index) => model.document.nodes[index]!.name === 'Helmet') ?? head
  expect_similarity(model.world(socket), `${name}: rest`)
  for (const clip of model.document.animations ?? []) {
    for (const fraction of [0, 0.5, 1]) {
      const poses = new Map<number, { translation?: number[]; rotation?: number[]; scale?: number[] }>()
      for (const { sampler, target } of clip.channels) {
        const values = model.accessor(clip.samplers[sampler]!.output)
        poses.set(target.node, {
          ...poses.get(target.node),
          [target.path]: values[Math.floor((values.length - 1) * fraction)]!,
        })
      }
      expect_similarity(model.world(socket, poses), `${name}: ${clip.name} at ${fraction}`)
    }
  }
})

test.each(approved)(
  '%s keeps its approved anatomy, hair, palette, rig and motion unchanged',
  (name, binary_hash, hair_hash, document_hash) => {
    const bytes = readFileSync(new URL(`${name}.glb`, characters))
    const length = bytes.readUInt32LE(12)
    expect(digest(bytes.subarray(28 + length))).toBe(binary_hash)
    expect(digest(readFileSync(new URL(`${name}_hair.glb`, characters)))).toBe(hair_hash)
    const document = JSON.parse(bytes.subarray(20, 20 + length).toString()) as { nodes: { name?: string }[] }
    const without_frame = {
      ...document,
      nodes: document.nodes.map((node) =>
        node.name === 'Helmet'
          ? Object.fromEntries(
              Object.entries(node).filter(([key]) => !['scale', 'rotation', 'translation'].includes(key))
            )
          : node
      ),
    }
    expect(digest(JSON.stringify(without_frame))).toBe(document_hash)
  }
)
