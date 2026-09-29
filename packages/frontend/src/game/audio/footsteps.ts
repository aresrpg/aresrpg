// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Grounded distance owns cadence; recorded material samples own the sound.

import type { MaterialPreset } from '@aresrpg/engine'

import { FOOTSTEP_RECORDINGS, load_footstep_recordings, pick_footstep_recording } from './footstep_recordings.ts'
import { scale_audio_volume } from '../core/audio_volume.ts'
import { play_audio } from './audio_registry.ts'

export type FootstepCadence = Readonly<{
  x: number | null
  z: number | null
  distance: number
  stride: number
}>

const BASE_STRIDE = 1.8
const STRIDE_JITTER = 0.12
const MOVE_EPSILON = 0.0001
const STEP_FADE_SECONDS = 0.012

export const create_footstep_cadence = (): FootstepCadence =>
  Object.freeze({ x: null, z: null, distance: 0, stride: BASE_STRIDE })

export const footstep_preset = ({
  surface,
  structure,
  liquid,
  in_water,
}: Readonly<{
  surface: MaterialPreset
  structure?: MaterialPreset
  liquid: MaterialPreset
  in_water: boolean
}>): MaterialPreset => (in_water ? liquid : (structure ?? surface))

const jitter = (value: number, fraction: number, random: () => number): number =>
  value * (1 + (random() * 2 - 1) * fraction)

export const advance_footstep_cadence = (
  cadence: FootstepCadence,
  position: Readonly<{ x: number; z: number; on_ground: boolean }>,
  random: () => number = Math.random
): Readonly<{ cadence: FootstepCadence; fired: boolean }> => {
  if (cadence.x === null || cadence.z === null || !position.on_ground)
    return Object.freeze({
      cadence: Object.freeze({ ...cadence, x: position.x, z: position.z, distance: 0 }),
      fired: false,
    })
  const delta = Math.hypot(position.x - cadence.x, position.z - cadence.z)
  if (delta > BASE_STRIDE * 1.5)
    return Object.freeze({
      cadence: Object.freeze({ ...cadence, x: position.x, z: position.z, distance: 0 }),
      fired: false,
    })
  const distance = cadence.distance + (delta < MOVE_EPSILON ? 0 : delta)
  if (distance < cadence.stride)
    return Object.freeze({
      cadence: Object.freeze({ ...cadence, x: position.x, z: position.z, distance }),
      fired: false,
    })
  return Object.freeze({
    cadence: Object.freeze({
      x: position.x,
      z: position.z,
      distance: distance - cadence.stride,
      stride: jitter(BASE_STRIDE, STRIDE_JITTER, random),
    }),
    fired: true,
  })
}

export type FootstepDynamics = Readonly<{ impact: number; pitch: number }>

export const footstep_dynamics = (speed: number): FootstepDynamics => {
  const run = Math.min(1, Math.max(0, (speed - 4.8) / (10.5 - 4.8)))
  return Object.freeze({
    impact: 0.85 + run * 0.35,
    pitch: 0.96 + run * 0.1,
  })
}

type Footsteps = Readonly<{
  tick: (
    input: Readonly<{
      position: readonly [number, number, number]
      on_ground: boolean
      preset: MaterialPreset
      speed: number
      water_entered?: boolean
    }>
  ) => void
  unlock: () => void
  set_enabled: (enabled: boolean) => void
  reset: () => void
  dispose: () => void
}>

const create_audio_context = (): AudioContext | null => {
  const Constructor = (globalThis.AudioContext ?? Reflect.get(globalThis, 'webkitAudioContext')) as
    typeof AudioContext | undefined
  if (!Constructor) return null
  try {
    return new Constructor()
  } catch (error) {
    console.warn('Footstep audio could not start.', error)
    return null
  }
}

export const create_footsteps = (
  random: () => number = Math.random,
  context_factory: () => AudioContext | null = create_audio_context,
  load_recordings: typeof load_footstep_recordings = load_footstep_recordings
): Footsteps => {
  let context: AudioContext | null = null
  let enabled = true
  let disposed = false
  let cadence = create_footstep_cadence()
  let pan_right = false
  let recordings: ReadonlyMap<string, AudioBuffer> | null = null
  let recordings_loading: Promise<void> | null = null
  const last_recording = new Map<string, number>()
  let active_voice: Readonly<{ source: AudioBufferSourceNode; output: GainNode }> | null = null

  const stop_current = (): void => {
    const voice = active_voice
    active_voice = null
    if (!voice || !context) return
    const now = context.currentTime
    voice.output.gain.cancelScheduledValues(now)
    voice.output.gain.setValueAtTime(voice.output.gain.value, now)
    voice.output.gain.linearRampToValueAtTime(0, now + STEP_FADE_SECONDS)
    voice.source.stop(now + STEP_FADE_SECONDS)
  }

  // eslint-disable-next-line functional/prefer-immutable-types -- Web Audio contexts are mutable platform effect handles.
  const preload_recordings = (active_context: AudioContext): void => {
    if (recordings || recordings_loading) return
    recordings_loading = load_recordings(active_context).then(
      (loaded) => {
        if (context === active_context) recordings = loaded
      },
      (error: unknown) => console.warn('Footstep recordings could not preload.', error)
    )
  }
  const unlocked_context = (): AudioContext | null => {
    if (disposed) return null
    context ??= context_factory()
    if (!context || context.state === 'closed') return null
    if (context.state === 'suspended')
      void context.resume().catch((error: unknown) => console.warn('Footstep audio could not resume.', error))
    preload_recordings(context)
    return context
  }

  const play = (preset: MaterialPreset, speed: number): void => {
    if (scale_audio_volume(1) === 0) return
    const active = unlocked_context()
    const loaded = recordings
    if (!active || !loaded) return
    const treatment = FOOTSTEP_RECORDINGS[preset]
    const selected = pick_footstep_recording(preset, last_recording.get(treatment.prefix), random, (key) =>
      loaded.has(key)
    )
    if (!selected) return
    const buffer = loaded.get(selected.key)!
    stop_current()
    last_recording.set(treatment.prefix, selected.variant)
    pan_right = !pan_right
    const dynamics = footstep_dynamics(speed)
    const source = active.createBufferSource()
    const output = active.createGain()
    const panner = active.createStereoPanner()
    const voice = Object.freeze({ source, output })
    active_voice = voice
    /* eslint-disable functional/immutable-data -- These Web Audio nodes are mutable browser effect handles. */
    source.buffer = buffer
    source.playbackRate.value = jitter(1, 0.025, random) * dynamics.pitch
    output.gain.value = scale_audio_volume(treatment.gain * dynamics.impact)
    panner.pan.value = pan_right ? 0.1 : -0.1
    source.onended = () => {
      if (active_voice === voice) active_voice = null
      source.disconnect()
      output.disconnect()
      panner.disconnect()
    }
    /* eslint-enable functional/immutable-data */
    source.connect(output)
    output.connect(panner)
    panner.connect(active.destination)
    source.start(active.currentTime)
  }

  return Object.freeze({
    tick: ({ position, on_ground, preset, speed, water_entered = false }) => {
      if (!enabled) return
      if (water_entered) play_audio('water_enter')
      if (!on_ground || speed === 0 || scale_audio_volume(1) === 0) {
        stop_current()
        cadence = create_footstep_cadence()
        return
      }
      const result = advance_footstep_cadence(cadence, { x: position[0], z: position[2], on_ground }, random)
      cadence = result.cadence
      if (result.fired) play(preset, speed)
    },
    unlock: () => {
      if (!enabled || scale_audio_volume(1) === 0) return
      unlocked_context()
    },
    set_enabled: (next) => {
      enabled = next
      if (!next) {
        stop_current()
        cadence = create_footstep_cadence()
      }
    },
    reset: () => {
      stop_current()
      cadence = create_footstep_cadence()
    },
    dispose: () => {
      stop_current()
      disposed = true
      enabled = false
      cadence = create_footstep_cadence()
      const active = context
      context = null
      recordings = null
      recordings_loading = null
      last_recording.clear()
      if (active && active.state !== 'closed')
        void active.close().catch((error: unknown) => console.warn('Footstep audio could not close.', error))
    },
  })
}
