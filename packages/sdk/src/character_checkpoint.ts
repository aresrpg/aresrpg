// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One explicit player-facing read: the Party "run to position" action snapshots another
// character's current-world checkpoint once. It never polls and never becomes movement truth.

import { bcs } from '@mysten/sui/bcs'

type DynamicFieldClient = Readonly<{
  core: Readonly<{
    getDynamicField: (
      input: Readonly<{
        parentId: string
        name: Readonly<{ type: string; bcs: Uint8Array }>
      }>
    ) => Promise<Readonly<{ dynamicField: Readonly<{ value: Readonly<{ bcs: Uint8Array }> }> }>>
  }>
}>

export type CharacterCheckpoint = Readonly<{ x: number; z: number }>

const CHECKPOINT_BCS = bcs.struct('Checkpoint', {
  x: bcs.u32(),
  z: bcs.u32(),
  at_ms: bcs.u64(),
  pet: bcs.bool(),
})

const key = (type_package: string, name: 'CurrentWorldKey' | 'CheckpointKey', value?: string) =>
  Object.freeze({
    type: `${type_package}::world::${name}`,
    // Sui gives a fieldless Move key one hidden false byte. CheckpointKey(String) is positional,
    // so its name bytes are exactly the wrapped String bytes with no extra framing.
    bcs: value === undefined ? bcs.bool().serialize(false).toBytes() : bcs.String.serialize(value).toBytes(),
  })

export const read_character_checkpoint = async (
  client: DynamicFieldClient,
  type_package: string | null,
  character_id: string,
  expected_world: string
): Promise<CharacterCheckpoint | null> => {
  if (!type_package) throw new Error('Character checkpoints are unavailable on this network')
  const [current, checkpoint] = await Promise.allSettled([
    client.core.getDynamicField({
      parentId: character_id,
      name: key(type_package, 'CurrentWorldKey'),
    }),
    client.core.getDynamicField({
      parentId: character_id,
      name: key(type_package, 'CheckpointKey', expected_world),
    }),
  ])
  if (current.status === 'rejected') throw current.reason
  if (bcs.String.parse(current.value.dynamicField.value.bcs) !== expected_world) return null
  if (checkpoint.status === 'rejected') throw checkpoint.reason
  const value = CHECKPOINT_BCS.parse(checkpoint.value.dynamicField.value.bcs)
  return Object.freeze({ x: value.x, z: value.z })
}
