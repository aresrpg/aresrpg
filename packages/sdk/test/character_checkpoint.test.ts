// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { bcs } from '@mysten/sui/bcs'
import { fromHex } from '@mysten/sui/utils'

import { read_character_checkpoint } from '../src/character_checkpoint.ts'

const CURRENT_WORLD = bcs.String.serialize('01_first_shore').toBytes()
// Live testnet Field<CheckpointKey, Checkpoint> 0xa75ea0…f46a @ version 981006460,
// character 0x1c493b…7d69, captured 2026-08-19. These are its captured value bytes.
const CAPTURED_CHECKPOINT = fromHex('50c3000050c3000070dde70ea001000000')

const client = (world = CURRENT_WORLD) => ({
  core: {
    getDynamicField: async ({ name }: { name: { type: string } }) => ({
      dynamicField: { value: { bcs: name.type.endsWith('::CurrentWorldKey') ? world : CAPTURED_CHECKPOINT } },
    }),
  },
})

test('reads one captured same-world checkpoint snapshot', async () => {
  expect(await read_character_checkpoint(client() as never, '0xgame', '0xcharacter', '01_first_shore')).toEqual({
    x: 50_000,
    z: 50_000,
  })
})

test('refuses a checkpoint when the character currently occupies another world', async () => {
  const other_world = bcs.String.serialize('yakutia').toBytes()
  expect(
    await read_character_checkpoint(client(other_world) as never, '0xgame', '0xcharacter', '01_first_shore')
  ).toBeNull()
})
