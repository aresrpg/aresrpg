// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

const null_terminated = (bytes, initial_offset) => {
  const end = bytes.indexOf(0, initial_offset)
  if (end < 0) throw new Error('Unterminated string in Dofus SWF action')
  return Object.freeze({ value: bytes.toString('utf8', initial_offset, end), offset: end + 1 })
}

const PUSH_SKIP = Symbol('push-skip')
const push_readers = Object.freeze({
  0: (bytes, offset) => null_terminated(bytes, offset),
  1: (bytes, offset) => Object.freeze({ value: bytes.readFloatLE(offset), offset: offset + 4 }),
  2: (_bytes, offset) => Object.freeze({ value: null, offset }),
  3: (_bytes, offset) => Object.freeze({ value: undefined, offset }),
  4: (_bytes, offset) => Object.freeze({ value: PUSH_SKIP, offset: offset + 1 }),
  5: (bytes, offset) => Object.freeze({ value: bytes.readUInt8(offset) !== 0, offset: offset + 1 }),
  6: (bytes, offset) => {
    const reordered = Buffer.from([...bytes.subarray(offset + 4, offset + 8), ...bytes.subarray(offset, offset + 4)])
    return Object.freeze({ value: reordered.readDoubleLE(0), offset: offset + 8 })
  },
  7: (bytes, offset) => Object.freeze({ value: bytes.readInt32LE(offset), offset: offset + 4 }),
  8: (bytes, offset, constants) => Object.freeze({ value: constants[bytes.readUInt8(offset)], offset: offset + 1 }),
  9: (bytes, offset, constants) => Object.freeze({ value: constants[bytes.readUInt16LE(offset)], offset: offset + 2 }),
})

const push_values = (bytes, constants) => {
  const values = []
  let offset = 0
  while (offset < bytes.length) {
    const type = bytes.readUInt8(offset++)
    const reader = push_readers[type]
    if (!reader) throw new Error(`Unsupported Dofus SWF push type ${type}`)
    const { offset: next_offset, value } = reader(bytes, offset, constants)
    if (value !== PUSH_SKIP) values.push(value)
    offset = next_offset
  }
  return values
}

const read_constants = (payload) => {
  const count = payload.readUInt16LE(0)
  let offset = 2
  return Array.from({ length: count }, () => {
    const { offset: next_offset, value } = null_terminated(payload, offset)
    offset = next_offset
    return value
  })
}

const pop_count = (stack) => Number(stack.pop())
const init_array = ({ stack }) => {
  const count = pop_count(stack)
  stack.push(stack.splice(stack.length - count, count).reverse())
}
const init_object = ({ stack }) => {
  const count = pop_count(stack)
  const entries = stack.splice(stack.length - count * 2, count * 2)
  stack.push(Object.fromEntries(Array.from({ length: count }, (_, index) => entries.slice(index * 2, index * 2 + 2))))
}
const new_object = ({ stack }) => {
  const name = stack.pop()
  const count = pop_count(stack)
  const args = stack.splice(stack.length - count, count)
  stack.push(name === 'Object' ? {} : { name, args })
}
const get_variable = ({ stack, variables }) => stack.push(variables[stack.pop()])
const set_variable = ({ stack, variables }) => {
  const value = stack.pop()
  variables[stack.pop()] = value
}
const get_member = ({ stack }) => {
  const name = stack.pop()
  stack.push(stack.pop()?.[name])
}
const set_member = ({ stack }) => {
  const value = stack.pop()
  const name = stack.pop()
  const target = stack.pop()
  if (target && typeof target === 'object') target[name] = value
}
const pop = ({ stack }) => stack.pop()
const binary = (operation) =>
  function apply_binary({ stack }) {
    const right = stack.pop()
    const left = stack.pop()
    stack.push(operation(left, right))
  }
const action_handlers = Object.freeze({
  0x0a: binary((left, right) => Number(left) + Number(right)),
  0x17: pop,
  0x1c: get_variable,
  0x1d: set_variable,
  0x21: binary((left, right) => String(left) + String(right)),
  0x40: new_object,
  0x42: init_array,
  0x43: init_object,
  0x47: binary((left, right) => String(left) + String(right)),
  0x4e: get_member,
  0x4f: set_member,
})

const action_record = (bytes, initial_offset) => {
  const action = bytes.readUInt8(initial_offset)
  const length = action >= 0x80 ? bytes.readUInt16LE(initial_offset + 1) : 0
  const payload_offset = initial_offset + (action >= 0x80 ? 3 : 1)
  return Object.freeze({
    action,
    payload: bytes.subarray(payload_offset, payload_offset + length),
    offset: payload_offset + length,
  })
}

const data_variables = (bytes) => {
  const stack = []
  const variables = {}
  let constants = []
  let offset = 0
  while (offset < bytes.length) {
    const { action, offset: next_offset, payload } = action_record(bytes, offset)
    offset = next_offset
    if (action === 0) break
    if (action === 0x88) constants = read_constants(payload)
    else if (action === 0x96) stack.push(...push_values(payload, constants))
    else action_handlers[action]?.({ stack, variables })
  }
  return variables
}

const action_blocks = (compressed) => {
  const bytes = Buffer.concat([Buffer.from('FWS'), compressed.subarray(3, 8), inflateSync(compressed.subarray(8))])
  const rect_bits = 5 + (bytes.readUInt8(8) >> 3) * 4
  let offset = 8 + Math.ceil(rect_bits / 8) + 4
  const blocks = []
  while (offset + 2 <= bytes.length) {
    const header = bytes.readUInt16LE(offset)
    offset += 2
    const tag = header >> 6
    let length = header & 0x3f
    if (length === 0x3f) {
      length = bytes.readUInt32LE(offset)
      offset += 4
    }
    if (tag === 12) blocks.push(bytes.subarray(offset, offset + length))
    offset += length
    if (tag === 0) break
  }
  return blocks
}

export const interpret_dofus_data_swf = (bytes) =>
  action_blocks(bytes).reduce((all, actions) => Object.assign(all, data_variables(actions)), {})

export const cached_dofus_swf = ({ cache_dir, bank }) => {
  const marker_bytes = Buffer.from(`/lang/swf/${bank}_`)
  for (const name of readdirSync(cache_dir)) {
    const path = join(cache_dir, name)
    if (!statSync(path).isFile()) continue
    const bytes = readFileSync(path)
    const marker = bytes.indexOf(marker_bytes)
    if (marker < 0) continue
    const swf_start = bytes.indexOf(Buffer.from('CWS'), marker)
    const url_start = bytes.lastIndexOf(Buffer.from('https://'), marker)
    if (swf_start < 0 || url_start < 0) continue
    const url = bytes.subarray(url_start, swf_start).toString('utf8')
    const version = new RegExp(`${bank}_(\\d+)\\.swf`, 'u').exec(url)?.[1]
    if (version) return Object.freeze({ version: Number(version), bytes: bytes.subarray(swf_start) })
  }
  throw new Error(`Official ${bank} SWF was not found in ${cache_dir}`)
}

export const read_dofus_swf_variables = ({ cache_dir, bank }) => {
  const cached = cached_dofus_swf({ cache_dir, bank })
  return Object.freeze({ version: cached.version, variables: interpret_dofus_data_swf(cached.bytes) })
}
