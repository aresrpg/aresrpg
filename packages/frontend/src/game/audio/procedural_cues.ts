// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Small semantic UI rewards, synthesized at the state-transition edge. No asset, timer, or
// packet owns these sounds; callers name the truth that just became visible.

/* eslint-disable functional/immutable-data -- Web Audio nodes are mutable browser effect handles. */

import { scale_audio_volume } from '../core/audio_volume.ts'

export type ProceduralCue = 'city' | 'discovery' | 'gather' | 'sale' | 'level_up' | 'victory' | 'defeat'
type Tone = Readonly<{
  frequency: number
  duration: number
  delay: number
  gain: number
  type: OscillatorType
  to?: number
}>

export const PROCEDURAL_CUE_TONES: Readonly<Record<ProceduralCue, readonly Tone[]>> = Object.freeze({
  city: Object.freeze(
    [294, 370, 440, 587, 880].map((frequency, index) => ({
      frequency,
      duration: 0.28,
      delay: index * 0.15,
      gain: index === 4 ? 0.1 : 0.075,
      type: index === 4 ? ('sine' as const) : ('triangle' as const),
    }))
  ),
  discovery: Object.freeze([
    { frequency: 659, duration: 0.14, delay: 0, gain: 0.11, type: 'triangle' as const },
    { frequency: 988, duration: 0.16, delay: 0.08, gain: 0.11, type: 'triangle' as const },
    { frequency: 1319, duration: 0.3, delay: 0.16, gain: 0.1, type: 'sine' as const, to: 1976 },
  ]),
  gather: Object.freeze([
    { frequency: 523, duration: 0.12, delay: 0.02, gain: 0.12, type: 'triangle' as const },
    { frequency: 784, duration: 0.18, delay: 0.1, gain: 0.1, type: 'sine' as const, to: 1046 },
  ]),
  sale: Object.freeze([
    { frequency: 880, duration: 0.09, delay: 0, gain: 0.09, type: 'sine' as const, to: 1175 },
    { frequency: 1320, duration: 0.12, delay: 0.07, gain: 0.08, type: 'triangle' as const },
  ]),
  level_up: Object.freeze(
    [523, 659, 784, 1046].map((frequency, index) => ({
      frequency,
      duration: 0.24,
      delay: index * 0.12,
      gain: 0.14,
      type: 'triangle' as const,
    }))
  ),
  victory: Object.freeze(
    [523, 659, 784, 1046].map((frequency, index) => ({
      frequency,
      duration: 0.24,
      delay: index * 0.12,
      gain: 0.14,
      type: 'triangle' as const,
    }))
  ),
  defeat: Object.freeze(
    [440, 370, 294].map((frequency, index) => ({
      frequency,
      duration: 0.3,
      delay: index * 0.14,
      gain: 0.11,
      type: 'sawtooth' as const,
    }))
  ),
})

const create_context = (): AudioContext | null => {
  const Constructor = (globalThis.AudioContext ?? Reflect.get(globalThis, 'webkitAudioContext')) as
    typeof AudioContext | undefined
  if (!Constructor) return null
  try {
    return new Constructor()
  } catch (error) {
    console.warn('Procedural cue audio could not start.', error)
    return null
  }
}

export const create_procedural_cues = (context_factory: () => AudioContext | null = create_context) => {
  let context: AudioContext | null = null
  return (cue: ProceduralCue): void => {
    context ??= context_factory()
    if (!context || context.state === 'closed') return
    if (context.state === 'suspended')
      void context.resume().catch((error: unknown) => console.warn('Procedural cue audio could not resume.', error))
    const now = context.currentTime
    PROCEDURAL_CUE_TONES[cue].forEach((tone) => {
      const gain = scale_audio_volume(tone.gain)
      if (gain === 0) return
      const start = now + tone.delay
      const oscillator = context!.createOscillator()
      const envelope = context!.createGain()
      oscillator.type = tone.type
      oscillator.frequency.setValueAtTime(tone.frequency, start)
      if (tone.to) oscillator.frequency.exponentialRampToValueAtTime(tone.to, start + tone.duration)
      envelope.gain.setValueAtTime(0, start)
      envelope.gain.linearRampToValueAtTime(gain, start + 0.008)
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration)
      oscillator.connect(envelope)
      envelope.connect(context!.destination)
      oscillator.start(start)
      oscillator.stop(start + tone.duration + 0.02)
    })
  }
}

export const play_procedural_cue = create_procedural_cues()
