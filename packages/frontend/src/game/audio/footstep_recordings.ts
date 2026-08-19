// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The six proven legacy dapp impacts, restored as recorded exciters. Surface identity and cadence
// remain owned by footsteps.ts; this file owns only asset identity, decoding, and variant choice.

import type { MaterialPreset } from '@aresrpg/engine'

type RecordedFootstepPreset = 'stone' | 'sand'
const VARIANT_COUNT = 6
const SOURCES: Readonly<Record<RecordedFootstepPreset, readonly string[]>> = Object.freeze({
  stone: Object.freeze(Array.from({ length: VARIANT_COUNT }, (_, index) => `/sound_effect/footstep-${index + 1}.ogg`)),
  sand: Object.freeze(
    Array.from({ length: VARIANT_COUNT }, (_, index) => `/sound_effect/footstep-sand-${index + 1}.ogg`)
  ),
})

export const FOOTSTEP_AUDIO_ASSETS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(SOURCES).flatMap(([preset, sources]) =>
      sources.map((source, index) => [`footstep_${preset}_${index + 1}`, source])
    )
  )
)

export const recorded_footstep_preset = (preset: MaterialPreset): preset is 'stone' | 'sand' =>
  preset === 'stone' || preset === 'sand'

export const pick_footstep_recording = (
  preset: RecordedFootstepPreset,
  previous: number | undefined,
  random: () => number = Math.random
): Readonly<{ key: string; source: string; variant: number }> => {
  let variant = Math.min(VARIANT_COUNT, 1 + Math.floor(random() * VARIANT_COUNT))
  if (variant === previous) variant = (variant % VARIANT_COUNT) + 1
  const key = `footstep_${preset}_${variant}`
  return Object.freeze({ key, source: FOOTSTEP_AUDIO_ASSETS[key]!, variant })
}

// eslint-disable-next-line functional/prefer-immutable-types -- Web Audio contexts are mutable platform effect handles.
export const load_footstep_recordings = async (context: BaseAudioContext): Promise<ReadonlyMap<string, AudioBuffer>> =>
  new Map(
    await Promise.all(
      Object.entries(FOOTSTEP_AUDIO_ASSETS).map(async ([key, source]) => {
        const response = await fetch(source)
        if (!response.ok) throw new Error(`Footstep recording ${source} returned ${response.status}.`)
        return [key, await context.decodeAudioData(await response.arrayBuffer())] as const
      })
    )
  )
