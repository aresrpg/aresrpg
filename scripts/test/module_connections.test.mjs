// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { validate_module, validate_connections } from '../module_connections.mjs'

const module_asset = () => ({
  kind: 'building',
  pieces: [['block', [0, 0, 0], 'stone', 0, 'bottom']],
  module: {
    size: [8, 6, 8],
    ports: [
      { name: 'west', position: [0, 2.5, 4], span: [0, 3, 2], face: 'x-', profile: 'passage' },
      { name: 'east', position: [8, 2.5, 4], span: [0, 3, 2], face: 'x+', profile: 'passage' },
    ],
  },
})
const plan = () => ({
  parts: [
    { asset: 'room', position: [0, 0, 0], rotation: 0 },
    { asset: 'room', position: [8, 0, 0], rotation: 0 },
  ],
  connections: [
    [
      [0, 'east'],
      [1, 'west'],
    ],
  ],
})

test('module boundaries contain their pieces and uniquely named port openings', () => {
  expect(() => validate_module(module_asset())).not.toThrow()
  const source = module_asset()
  expect(() => validate_module({ ...source, pieces: [['block', [8, 0, 0], 'stone', 0, 'bottom']] })).toThrow('geometry')
  source.module.ports[0].position = [1, 2.5, 4]
  expect(() => validate_module(source)).toThrow('boundary face')
  source.module.ports[0].position = [0, 1, 4]
  expect(() => validate_module(source)).toThrow('opening')
  source.module.ports = [source.module.ports[1], source.module.ports[1]]
  expect(() => validate_module(source)).toThrow('unique')
})

test('joined placements match exact openings and reject incompatible or reused endpoints', () => {
  const assets = { room: module_asset() }
  expect(() => validate_connections(assets, plan())).not.toThrow()
  const shifted = plan()
  shifted.parts[1].position[1] = 1
  expect(() => validate_connections(assets, shifted)).toThrow('do not match')
  const duplicate = plan()
  duplicate.connections.push(duplicate.connections[0])
  expect(() => validate_connections(assets, duplicate)).toThrow('connect twice')
  const missing = plan()
  missing.connections[0][1][1] = 'missing'
  expect(() => validate_connections(assets, missing)).toThrow('absent port')
})

test('quarter-turn placements transform port positions, normals and rectangular spans together', () => {
  const assets = { room: module_asset() }
  const rotated = {
    parts: [
      { asset: 'room', position: [0, 0, 0], rotation: 1 },
      { asset: 'room', position: [0, 0, 8], rotation: 1 },
    ],
    connections: [
      [
        [0, 'east'],
        [1, 'west'],
      ],
    ],
  }
  expect(() => validate_connections(assets, rotated)).not.toThrow()
  rotated.parts[1].rotation = 3
  expect(() => validate_connections(assets, rotated)).toThrow('do not match')
})

test('mirrored parts connect their transformed port rather than the original named face', () => {
  const assets = { room: module_asset() }
  const mirrored = {
    parts: [
      { asset: 'room', position: [0, 0, 0], rotation: 0 },
      { asset: 'room', position: [16, 0, 0], rotation: 0, mirror: true },
    ],
    connections: [
      [
        [0, 'east'],
        [1, 'east'],
      ],
    ],
  }
  expect(() => validate_connections(assets, mirrored)).not.toThrow()
  mirrored.parts[1].mirror = false
  expect(() => validate_connections(assets, mirrored)).toThrow('do not match')
})
