// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { deflateSync } from 'node:zlib'

import { expect, test } from 'bun:test'

import { interpret_dofus_data_swf } from './dofus_retro_swf.mjs'

const action = (opcode, payload = Buffer.alloc(0)) => {
  if (opcode < 0x80) return Buffer.from([opcode])
  const header = Buffer.alloc(3)
  header.writeUInt8(opcode)
  header.writeUInt16LE(payload.length, 1)
  return Buffer.concat([header, payload])
}
const string_value = (value) => Buffer.concat([Buffer.from([0]), Buffer.from(value), Buffer.from([0])])
const integer_value = (value) => {
  const encoded = Buffer.alloc(5)
  encoded.writeUInt8(7)
  encoded.writeInt32LE(value, 1)
  return encoded
}
const push = (...values) => action(0x96, Buffer.concat(values))
const data_swf = (actions) => {
  const tag_header = Buffer.alloc(6)
  tag_header.writeUInt16LE((12 << 6) | 0x3f)
  tag_header.writeUInt32LE(actions.length, 2)
  const body = Buffer.concat([
    Buffer.from([0, 0, 12, 1, 0]), // zero-bit RECT, 12 fps, one frame
    tag_header,
    actions,
    Buffer.alloc(2),
  ])
  const header = Buffer.alloc(8)
  header.write('CWS')
  header.writeUInt8(6, 3)
  header.writeUInt32LE(header.length + body.length, 4)
  return Buffer.concat([header, deflateSync(body)])
}

test('the Retro SWF interpreter preserves AVM1 stack order and string concatenation', () => {
  const actions = Buffer.concat([
    push(string_value('text'), string_value('left'), string_value(' right')),
    action(0x21),
    action(0x1d),
    push(string_value('array'), integer_value(1), integer_value(2), integer_value(3), integer_value(3)),
    action(0x42),
    action(0x1d),
    Buffer.from([0]),
  ])

  expect(interpret_dofus_data_swf(data_swf(actions))).toEqual({ text: 'left right', array: [3, 2, 1] })
})
