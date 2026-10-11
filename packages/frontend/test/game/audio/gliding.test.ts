// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, expect, test } from 'bun:test'

import { create_gliding_audio } from '../../../src/game/audio/gliding.ts'
import { set_master_audio_volume } from '../../../src/game/core/audio_volume.ts'

afterEach(() => set_master_audio_volume(1))

const fixture = () => {
  const ramps: number[][] = []
  const sources: { loop: boolean; starts: number; stops: number[] }[] = []
  let cues = 0
  let closes = 0
  let resolve_load!: (buffer: AudioBuffer) => void
  const loaded = new Promise<AudioBuffer>((resolve) => {
    resolve_load = resolve
  })
  const context = {
    state: 'running',
    currentTime: 10,
    destination: {},
    close: async () => {
      closes++
    },
    createGain: () => ({
      gain: {
        value: 0,
        cancelAndHoldAtTime: () => {},
        linearRampToValueAtTime: (value: number, time: number) => ramps.push([value, time]),
      },
      connect: () => {},
      disconnect: () => {},
    }),
    createBufferSource: () => {
      const source = {
        loop: false,
        starts: 0,
        stops: [] as number[],
        connect: () => {},
        disconnect: () => {},
        start: () => {
          source.starts++
        },
        stop: (time: number) => source.stops.push(time),
      }
      sources.push(source)
      return source
    },
  }
  const audio = create_gliding_audio(
    () => context as unknown as AudioContext,
    () => loaded,
    () => {
      cues++
    }
  )
  const finish_loading = async () => {
    resolve_load({} as AudioBuffer)
    await loaded
  }
  return { audio, finish_loading, ramps, sources, cues: () => cues, closes: () => closes }
}

test('late wind loading after landing cannot start a stale glide', async () => {
  const { audio, finish_loading, sources, cues } = fixture()
  audio.unlock()
  audio.tick(true)
  audio.reset()
  await finish_loading()
  audio.tick(false)
  expect(cues()).toBe(1)
  expect(sources).toHaveLength(0)
  audio.dispose()
})

test('gliding owns one cue and a continuous loop, with volume and exit fades', async () => {
  const { audio, finish_loading, ramps, sources, cues, closes } = fixture()
  audio.unlock()
  await finish_loading()
  audio.tick(true)
  audio.tick(true)
  expect(cues()).toBe(1)
  expect(sources).toHaveLength(1)
  expect(sources[0]!.loop).toBe(true)
  expect(sources[0]!.starts).toBe(1)
  expect(ramps).toEqual([[0.65, 10.25]])
  set_master_audio_volume(0)
  audio.tick(true)
  expect(ramps.at(-1)).toEqual([0, 10.25])
  audio.tick(false)
  expect(ramps.at(-1)).toEqual([0, 10.3])
  expect(sources[0]!.stops).toEqual([10.31])
  audio.tick(false)
  audio.tick(true)
  expect(cues()).toBe(2)
  expect(sources).toHaveLength(2)
  audio.dispose()
  audio.tick(true)
  expect(closes()).toBe(1)
  expect(cues()).toBe(2)
})

test('disposing during decode never creates a source afterwards', async () => {
  const { audio, finish_loading, sources } = fixture()
  audio.unlock()
  audio.dispose()
  await finish_loading()
  audio.tick(true)
  expect(sources).toHaveLength(0)
})
