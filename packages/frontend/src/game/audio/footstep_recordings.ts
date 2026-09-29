// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Recorded material responses; the engine's MaterialPreset remains the coverage contract.

import type { MaterialPreset } from '@aresrpg/engine'

type RecordingSet = Readonly<{ prefix: string; variants: number; gain: number }>
const GRASS = Object.freeze({ prefix: 'step-grass-dry', variants: 4, gain: 0.24 })
const SNOW = Object.freeze({ prefix: 'step-snow', variants: 6, gain: 0.26 })

export const FOOTSTEP_RECORDINGS: Readonly<Record<MaterialPreset, RecordingSet>> = Object.freeze({
  brick: Object.freeze({ prefix: 'step-stone', variants: 5, gain: 0.28 }),
  plaster: Object.freeze({ prefix: 'step-stone', variants: 5, gain: 0.22 }),
  slate: Object.freeze({ prefix: 'step-stone', variants: 5, gain: 0.28 }),
  copper: Object.freeze({ prefix: 'step-wood', variants: 6, gain: 0.25 }),
  stone: Object.freeze({ prefix: 'step-stone', variants: 5, gain: 0.28 }),
  earth: Object.freeze({ prefix: 'step-earth', variants: 4, gain: 0.26 }),
  grass: GRASS,
  frozen_grass: Object.freeze({ ...SNOW, gain: 0.24 }),
  wood: Object.freeze({ prefix: 'step-wood', variants: 6, gain: 0.28 }),
  bark: Object.freeze({ prefix: 'step-wood', variants: 6, gain: 0.28 }),
  foliage: Object.freeze({ ...GRASS, gain: 0.2 }),
  sand: Object.freeze({ prefix: 'step-sand', variants: 3, gain: 0.25 }),
  snow: SNOW,
  ice: Object.freeze({ prefix: 'step-ice', variants: 4, gain: 0.26 }),
  water: Object.freeze({ prefix: 'step-water', variants: 5, gain: 0.3 }),
})

export const FOOTSTEP_AUDIO_ASSETS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.values(FOOTSTEP_RECORDINGS).flatMap(({ prefix, variants }) =>
      Array.from({ length: variants }, (_, index) => [
        `${prefix}-${index + 1}`,
        `/sound_effect/${prefix}-${index + 1}.ogg`,
      ])
    )
  )
)

export const pick_footstep_recording = (
  preset: MaterialPreset,
  previous: number | undefined,
  random: () => number = Math.random,
  available: (key: string) => boolean = () => true
): Readonly<{ key: string; source: string; variant: number }> | null => {
  const { prefix, variants } = FOOTSTEP_RECORDINGS[preset]
  const candidates = Array.from({ length: variants }, (_, index) => ({
    key: `${prefix}-${index + 1}`,
    variant: index + 1,
  })).filter(({ key }) => available(key))
  if (!candidates.length) return null
  const fresh = candidates.filter(({ variant }) => variant !== previous)
  const choices = fresh.length ? fresh : candidates
  const selected = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!
  return Object.freeze({ ...selected, source: FOOTSTEP_AUDIO_ASSETS[selected.key]! })
}

// Decode creates a fresh buffer. Normalize it once before sharing it with the world player;
// the source clips have very different recording levels (especially grass versus stone).
const decode_recording = async (
  // eslint-disable-next-line functional/prefer-immutable-types -- Audio decoding belongs to this mutable platform context.
  context: BaseAudioContext,
  bytes: ArrayBuffer
): Promise<AudioBuffer> => {
  const buffer = await context.decodeAudioData(bytes)
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
  const peak = channels.reduce(
    (largest, samples) => samples.reduce((value, sample) => Math.max(value, Math.abs(sample)), largest),
    0
  )
  const gain = peak > 0 ? Math.min(24, 0.6 / peak) : 1
  channels.forEach((samples, index) =>
    buffer.copyToChannel(
      samples.map((sample) => sample * gain),
      index
    )
  )
  return buffer
}

export const load_footstep_recordings = async (
  // eslint-disable-next-line functional/prefer-immutable-types -- Web Audio contexts are mutable platform effect handles.
  context: BaseAudioContext,
  fetch_recording: typeof fetch = fetch
): Promise<ReadonlyMap<string, AudioBuffer>> => {
  const entries = Object.entries(FOOTSTEP_AUDIO_ASSETS)
  const results = await Promise.allSettled(
    entries.map(async ([key, source]) => {
      const response = await fetch_recording(source)
      if (!response.ok) throw new Error(`Footstep recording ${source} returned ${response.status}.`)
      return [key, await decode_recording(context, await response.arrayBuffer())] as const
    })
  )
  const failed = results.flatMap((result, index) =>
    result.status === 'rejected' ? [{ source: entries[index]![1], error: result.reason as unknown }] : []
  )
  if (failed.length) console.warn('Some footstep recordings could not load; those variants remain silent.', failed)
  return new Map(results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])))
}
