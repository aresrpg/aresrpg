// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import assert from 'node:assert/strict'

import { mock } from 'bun:test'
import * as three from 'three'

let audio_ready: (buffer: unknown) => void = () => undefined
let model_ready: (gltf: { scene: three.Object3D }) => void = () => undefined
let stopped = 0
let disconnected = 0
let gain_disconnected = 0
let time = 0
const listener = () =>
  Object.assign(new three.Object3D(), {
    gain: {
      disconnect: () => {
        gain_disconnected++
      },
    },
    setMasterVolume: () => undefined,
  })
const sound = () => {
  const value = Object.assign(new three.Object3D(), {
    gain: {
      disconnect: () => {
        gain_disconnected++
      },
    },
    isPlaying: false,
    setBuffer: () => undefined,
    setDistanceModel: () => undefined,
    setRefDistance: () => undefined,
    setMaxDistance: () => undefined,
    setRolloffFactor: () => undefined,
    setVolume: () => undefined,
    play: () => {
      value.isPlaying = true
    },
    stop: () => {
      value.isPlaying = false
      stopped++
    },
    disconnect: () => {
      disconnected++
    },
    onEnded: () => {
      value.isPlaying = false
    },
  })
  return value
}
mock.module('three', () => ({
  ...three,
  AudioListener: new Proxy(three.AudioListener, { construct: listener }),
  AudioLoader: new Proxy(three.AudioLoader, {
    construct: () => ({
      load: (_url: string, ready: typeof audio_ready) => {
        audio_ready = ready
      },
    }),
  }),
  PositionalAudio: new Proxy(three.PositionalAudio, { construct: sound }),
}))
mock.module('../src/gltf_loader.ts', () => ({
  load_gltf_source: () =>
    new Promise((resolve) => {
      model_ready = resolve
    }),
}))
Date.now = () => time
const { create_fight_sword_layer } = await import('../src/fight_swords.ts')
const scene = new three.Scene()
const camera = new three.Object3D()
const layer = create_fight_sword_layer({ scene, camera, url: 'borrowed', impact_sound_url: 'impact' })
const marker = { id: 'fight', x: 0, y: 0, z: 0, placement_ms: 0 }
audio_ready({})
layer.set_markers([marker])
assert.equal(scene.children.length, 1)
time = 2_001
layer.tick(time)
layer.dispose()
assert.equal(stopped, 1)
assert.equal(disconnected, 1)
assert.equal(gain_disconnected, 2)
assert.equal(camera.children.length, 0)
assert.equal(scene.children.length, 0)
model_ready({ scene: new three.Object3D() })
await Promise.resolve()
layer.set_markers([marker])
layer.set_visible(true)
layer.tick(time)
assert.equal(scene.children.length, 0)
layer.dispose()
assert.equal(gain_disconnected, 2)
console.log('fight sword lifetime passed')
