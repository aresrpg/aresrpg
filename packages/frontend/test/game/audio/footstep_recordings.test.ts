// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, spyOn, test } from 'bun:test'

import { FOOTSTEP_AUDIO_ASSETS, load_footstep_recordings } from '../../../src/game/audio/footstep_recordings.ts'
import { create_footsteps } from '../../../src/game/audio/footsteps.ts'
import { set_master_audio_volume } from '../../../src/game/core/audio_volume.ts'

test('one failed download leaves the other material recordings usable', async () => {
  const warning = spyOn(console, 'warn').mockImplementation(() => undefined)
  const samples = new Float32Array([0.02, -0.04, 0.01])
  const buffer = {
    numberOfChannels: 1,
    getChannelData: () => samples,
    copyToChannel: (data: Float32Array) => samples.set(data),
  } as unknown as AudioBuffer
  const context = { decodeAudioData: async () => buffer } as unknown as BaseAudioContext
  const failed = '/sound_effect/step-grass-dry-1.ogg'
  const fetcher = (async (url: string) =>
    new Response(new Uint8Array([1]), { status: url === failed ? 404 : 200 })) as typeof fetch
  try {
    const recordings = await load_footstep_recordings(context, fetcher)
    expect(recordings.size).toBe(Object.keys(FOOTSTEP_AUDIO_ASSETS).length - 1)
    expect(recordings.has('step-grass-dry-1')).toBeFalse()
    expect(recordings.get('step-water-1')).toBe(buffer)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(samples[1]).toBeCloseTo(-0.6)
    expect(samples[0]! / samples[1]!).toBeCloseTo(-0.5)
  } finally {
    warning.mockRestore()
  }
})

test('grass steps use decoded buffers, respect mute, and discard late loads after disposal', async () => {
  const buffer = {} as AudioBuffer
  const played: (AudioBuffer | null)[] = []
  let resolve_load: ((buffers: ReadonlyMap<string, AudioBuffer>) => void) | undefined
  let requests = 0
  let closed = 0
  const context = {
    state: 'running',
    currentTime: 0,
    destination: {},
    createBufferSource: () => {
      const source = {
        buffer: null as AudioBuffer | null,
        playbackRate: { value: 1 },
        onended: null,
        connect: () => undefined,
        disconnect: () => undefined,
        start: () => {
          played.push(source.buffer)
        },
        stop: () => undefined,
      }
      return source
    },
    createGain: () => ({
      gain: {
        value: 1,
        cancelScheduledValues: () => undefined,
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
      disconnect: () => undefined,
    }),
    createStereoPanner: () => ({ pan: { value: 0 }, connect: () => undefined, disconnect: () => undefined }),
    close: async () => {
      closed += 1
    },
  } as unknown as AudioContext
  const footsteps = create_footsteps(
    () => 0,
    () => context,
    async () => {
      requests += 1
      return new Promise((resolve) => {
        resolve_load = resolve
      })
    }
  )
  const step = () => {
    footsteps.reset()
    footsteps.tick({ position: [0, 0, 0], on_ground: true, preset: 'grass', speed: 5 })
    footsteps.tick({ position: [2, 0, 0], on_ground: true, preset: 'grass', speed: 5 })
  }
  try {
    set_master_audio_volume(1)
    footsteps.unlock()
    step()
    expect(played).toEqual([])
    resolve_load!(new Map([['step-grass-dry-1', buffer]]))
    await new Promise((resolve) => setTimeout(resolve, 0))
    step()
    expect(played).toEqual([buffer])
    expect(requests).toBe(1)
    set_master_audio_volume(0)
    step()
    expect(played).toHaveLength(1)
    footsteps.dispose()
    expect(closed).toBe(1)
    set_master_audio_volume(1)
    footsteps.unlock()
    step()
    expect(requests).toBe(1)
    const late = create_footsteps(
      () => 0,
      () => context,
      async () => {
        requests += 1
        return new Promise((resolve) => {
          resolve_load = resolve
        })
      }
    )
    late.unlock()
    late.dispose()
    resolve_load!(new Map([['step-grass-dry-1', buffer]]))
    await new Promise((resolve) => setTimeout(resolve, 0))
    late.set_enabled(true)
    late.tick({ position: [0, 0, 0], on_ground: true, preset: 'grass', speed: 5 })
    late.tick({ position: [2, 0, 0], on_ground: true, preset: 'grass', speed: 5 })
    expect(requests).toBe(2)
    expect(played).toHaveLength(1)
  } finally {
    footsteps.dispose()
    set_master_audio_volume(1)
  }
})

test('successive strides fade the previous voice instead of stacking grass recordings', async () => {
  const buffer = {} as AudioBuffer
  const voices: { stopped: number[]; fades: number[]; end: (() => void) | null }[] = []
  const context = {
    state: 'running',
    currentTime: 0,
    destination: {},
    createBufferSource: () => {
      const voice = { stopped: [] as number[], fades: [] as number[], end: null as (() => void) | null }
      voices.push(voice)
      return {
        buffer: null,
        playbackRate: { value: 1 },
        set onended(callback: () => void) {
          voice.end = callback
        },
        connect: () => undefined,
        disconnect: () => undefined,
        start: () => undefined,
        stop: (when: number) => {
          voice.stopped.push(when)
        },
      }
    },
    createGain: () => {
      const voice = voices.at(-1)!
      return {
        gain: {
          value: 1,
          cancelScheduledValues: () => undefined,
          setValueAtTime: () => undefined,
          linearRampToValueAtTime: (_value: number, when: number) => {
            voice.fades.push(when)
          },
        },
        connect: () => undefined,
        disconnect: () => undefined,
      }
    },
    createStereoPanner: () => ({ pan: { value: 0 }, connect: () => undefined, disconnect: () => undefined }),
    close: async () => undefined,
  } as unknown as AudioContext
  const footsteps = create_footsteps(
    () => 0.5,
    () => context,
    async () => new Map([['step-grass-dry-1', buffer]])
  )
  footsteps.unlock()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const stride = (x: number) => footsteps.tick({ position: [x, 0, 0], on_ground: true, preset: 'grass', speed: 10.5 })
  try {
    stride(0)
    stride(2)
    stride(4)
    expect(voices).toHaveLength(2)
    expect(voices[0]!.stopped).toHaveLength(1)
    expect(voices[0]!.fades).toEqual(voices[0]!.stopped)
    expect(voices[0]!.stopped[0]).toBeGreaterThan(0)
    expect(voices[0]!.stopped[0]).toBeLessThanOrEqual(0.02)
    voices[0]!.end!()
    stride(6)
    expect(voices[1]!.stopped).toHaveLength(1)
    footsteps.reset()
    expect(voices[2]!.stopped).toHaveLength(1)
    stride(8)
    stride(10)
    footsteps.tick({ position: [12, 0, 0], on_ground: true, preset: 'grass', speed: 0 })
    expect(voices).toHaveLength(4)
    expect(voices[3]!.stopped).toHaveLength(1)
  } finally {
    footsteps.dispose()
  }
})
