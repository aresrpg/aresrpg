// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Distance-driven procedural footsteps. The world supplies the existing material preset; this
// audio edge owns how that physical surface sounds and creates no content-side sound taxonomy.

import type { MaterialPreset } from '@aresrpg/engine'

import { load_footstep_recordings, pick_footstep_recording, recorded_footstep_preset } from './footstep_recordings.ts'

type FootstepVoice = Readonly<{
  response: 'solid' | 'soft' | 'vegetation' | 'aggregate' | 'liquid'
  duration: number
  filter_type: BiquadFilterType
  cutoff: number
  q: number
  gain: number
  noise_response: number
  decay: number
  toe_delay: number
  toe_gain: number
  friction_gain: number
  friction_cutoff: number
  particle_density: number
  particle_gain: number
  resonances: readonly Readonly<{
    frequency: number
    end_frequency: number
    gain: number
    type: OscillatorType
  }>[]
}>

export const FOOTSTEP_GAIN_MULTIPLIER = 3
export const RECORDED_FOOTSTEP_TREATMENT = Object.freeze({
  stone: Object.freeze({ gain: 0.7, pitch: 1, cutoff: null, q: 0 }),
  sand: Object.freeze({ gain: 0.42, pitch: 0.94, cutoff: 1_450, q: 0.42 }),
})

export const FOOTSTEP_VOICES: Readonly<Record<MaterialPreset, FootstepVoice>> = Object.freeze({
  stone: Object.freeze({
    response: 'solid',
    duration: 0.09,
    filter_type: 'lowpass',
    cutoff: 1_350,
    q: 0.65,
    gain: 0.065,
    noise_response: 0.25,
    decay: 42,
    toe_delay: 0.032,
    toe_gain: 0.2,
    friction_gain: 0.08,
    friction_cutoff: 1_000,
    particle_density: 0,
    particle_gain: 0,
    resonances: Object.freeze([
      Object.freeze({ frequency: 118, end_frequency: 72, gain: 0.42, type: 'triangle' }),
      Object.freeze({ frequency: 310, end_frequency: 255, gain: 0.08, type: 'sine' }),
    ]),
  }),
  earth: Object.freeze({
    response: 'soft',
    duration: 0.13,
    filter_type: 'lowpass',
    cutoff: 720,
    q: 0.65,
    gain: 0.072,
    noise_response: 0.16,
    decay: 25,
    toe_delay: 0.045,
    toe_gain: 0.38,
    friction_gain: 0.22,
    friction_cutoff: 550,
    particle_density: 0,
    particle_gain: 0,
    resonances: Object.freeze([Object.freeze({ frequency: 82, end_frequency: 56, gain: 0.3, type: 'sine' })]),
  }),
  grass: Object.freeze({
    response: 'vegetation',
    duration: 0.16,
    filter_type: 'bandpass',
    cutoff: 1_250,
    q: 0.32,
    gain: 0.04,
    noise_response: 0.18,
    decay: 17,
    toe_delay: 0.058,
    toe_gain: 0.7,
    friction_gain: 0.85,
    friction_cutoff: 1_600,
    particle_density: 0,
    particle_gain: 0,
    resonances: Object.freeze([]),
  }),
  frozen_grass: Object.freeze({
    response: 'aggregate',
    duration: 0.18,
    filter_type: 'bandpass',
    cutoff: 2_200,
    q: 1.1,
    gain: 0.05,
    noise_response: 0.52,
    decay: 20,
    toe_delay: 0.05,
    toe_gain: 0.65,
    friction_gain: 0.42,
    friction_cutoff: 1_800,
    particle_density: 0.05,
    particle_gain: 0.4,
    resonances: Object.freeze([Object.freeze({ frequency: 620, end_frequency: 280, gain: 0.15, type: 'triangle' })]),
  }),
  wood: Object.freeze({
    response: 'solid',
    duration: 0.1,
    filter_type: 'bandpass',
    cutoff: 1_350,
    q: 1.4,
    gain: 0.055,
    noise_response: 0.35,
    decay: 32,
    toe_delay: 0.038,
    toe_gain: 0.42,
    friction_gain: 0.12,
    friction_cutoff: 900,
    particle_density: 0,
    particle_gain: 0,
    resonances: Object.freeze([
      Object.freeze({ frequency: 190, end_frequency: 132, gain: 0.34, type: 'triangle' }),
      Object.freeze({ frequency: 430, end_frequency: 350, gain: 0.12, type: 'sine' }),
    ]),
  }),
  foliage: Object.freeze({
    response: 'vegetation',
    duration: 0.17,
    filter_type: 'highpass',
    cutoff: 2_400,
    q: 0.52,
    gain: 0.038,
    noise_response: 0.66,
    decay: 18,
    toe_delay: 0.06,
    toe_gain: 0.9,
    friction_gain: 0.95,
    friction_cutoff: 2_400,
    particle_density: 0,
    particle_gain: 0,
    resonances: Object.freeze([]),
  }),
  sand: Object.freeze({
    response: 'aggregate',
    duration: 0.21,
    filter_type: 'lowpass',
    cutoff: 1_450,
    q: 0.42,
    gain: 0.034,
    noise_response: 0.38,
    decay: 12,
    toe_delay: 0.062,
    toe_gain: 0.58,
    friction_gain: 0.72,
    friction_cutoff: 1_100,
    particle_density: 0.032,
    particle_gain: 0.18,
    resonances: Object.freeze([]),
  }),
  snow: Object.freeze({
    response: 'aggregate',
    duration: 0.2,
    filter_type: 'lowpass',
    cutoff: 930,
    q: 0.7,
    gain: 0.058,
    noise_response: 0.28,
    decay: 14,
    toe_delay: 0.065,
    toe_gain: 0.92,
    friction_gain: 0.38,
    friction_cutoff: 1_000,
    particle_density: 0.085,
    particle_gain: 0.62,
    resonances: Object.freeze([Object.freeze({ frequency: 105, end_frequency: 72, gain: 0.16, type: 'triangle' })]),
  }),
  ice: Object.freeze({
    response: 'solid',
    duration: 0.14,
    filter_type: 'bandpass',
    cutoff: 3_800,
    q: 2.2,
    gain: 0.042,
    noise_response: 0.9,
    decay: 36,
    toe_delay: 0.035,
    toe_gain: 0.36,
    friction_gain: 0.06,
    friction_cutoff: 3_000,
    particle_density: 0,
    particle_gain: 0,
    resonances: Object.freeze([
      Object.freeze({ frequency: 1_650, end_frequency: 760, gain: 0.3, type: 'sine' }),
      Object.freeze({ frequency: 2_850, end_frequency: 1_900, gain: 0.12, type: 'sine' }),
    ]),
  }),
  water: Object.freeze({
    response: 'liquid',
    duration: 0.22,
    filter_type: 'bandpass',
    cutoff: 1_150,
    q: 0.85,
    gain: 0.062,
    noise_response: 0.34,
    decay: 12,
    toe_delay: 0.075,
    toe_gain: 0.9,
    friction_gain: 0.65,
    friction_cutoff: 1_200,
    particle_density: 0,
    particle_gain: 0,
    resonances: Object.freeze([
      Object.freeze({ frequency: 470, end_frequency: 175, gain: 0.22, type: 'sine' }),
      Object.freeze({ frequency: 820, end_frequency: 310, gain: 0.08, type: 'sine' }),
    ]),
  }),
})

export type FootstepCadence = Readonly<{
  x: number | null
  z: number | null
  distance: number
  stride: number
}>

const BASE_STRIDE = 1.8
const STRIDE_JITTER = 0.12
const MOVE_EPSILON = 0.0001

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

export type FootstepDynamics = Readonly<{ impact: number; friction: number; pitch: number }>

export const footstep_dynamics = (speed: number): FootstepDynamics => {
  const run = Math.min(1, Math.max(0, (speed - 4.8) / (10.5 - 4.8)))
  return Object.freeze({
    impact: 0.85 + run * 0.35,
    friction: 0.9 + run * 0.25,
    pitch: 0.96 + run * 0.1,
  })
}

export const footstep_samples = (
  preset: MaterialPreset,
  sample_rate: number,
  random: () => number = Math.random,
  speed = 4.8
): Float32Array<ArrayBuffer> => {
  const voice = FOOTSTEP_VOICES[preset]
  const dynamics = footstep_dynamics(speed)
  const samples = new Float32Array(new ArrayBuffer(Math.max(1, Math.floor(sample_rate * voice.duration)) * 4))
  let colored_noise = 0
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sample_rate
    const progress = index / samples.length
    const white = random() * 2 - 1
    colored_noise += (white - colored_noise) * voice.noise_response
    const heel = Math.exp(-time * voice.decay)
    const toe_time = time - voice.toe_delay
    const toe = toe_time < 0 ? 0 : Math.exp(-toe_time * voice.decay * 0.72) * voice.toe_gain
    const particle =
      voice.response === 'aggregate' && random() < voice.particle_density ? (random() * 2 - 1) * voice.particle_gain : 0
    const attack = Math.min(1, time / 0.0025)
    const release = Math.min(1, (1 - progress) * 5) ** 2
    // eslint-disable-next-line functional/immutable-data -- This is a fresh PCM construction buffer.
    samples[index] = Math.max(
      -1,
      Math.min(1, (colored_noise + particle) * (heel + toe) * attack * release * dynamics.impact)
    )
  }
  return samples
}

export const footstep_friction_samples = (
  preset: MaterialPreset,
  sample_rate: number,
  random: () => number = Math.random,
  speed = 4.8
): Float32Array<ArrayBuffer> => {
  const voice = FOOTSTEP_VOICES[preset]
  const dynamics = footstep_dynamics(speed)
  const samples = new Float32Array(new ArrayBuffer(Math.max(1, Math.floor(sample_rate * voice.duration)) * 4))
  const friction_decay = voice.response === 'vegetation' || voice.response === 'liquid' ? 8 : 14
  let colored_noise = 0
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sample_rate
    const progress = index / samples.length
    const local_time = time - voice.toe_delay * 0.45
    const white = random() * 2 - 1
    colored_noise += (white - colored_noise) * Math.min(0.95, voice.noise_response * 0.55 + 0.1)
    const envelope =
      local_time <= 0
        ? 0
        : (1 - Math.exp(-local_time * 80)) * Math.exp(-local_time * friction_decay) * dynamics.friction
    const release = Math.min(1, (1 - progress) * 5) ** 2
    // eslint-disable-next-line functional/immutable-data -- This is a fresh PCM construction buffer.
    samples[index] = Math.max(-1, Math.min(1, colored_noise * envelope * release))
  }
  return samples
}

type Footsteps = Readonly<{
  tick: (
    input: Readonly<{
      position: readonly [number, number, number]
      on_ground: boolean
      preset: MaterialPreset
      speed: number
    }>
  ) => void
  unlock: () => void
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
    console.warn('Procedural footstep audio could not start.', error)
    return null
  }
}

export const create_footsteps = (
  random: () => number = Math.random,
  context_factory: () => AudioContext | null = create_audio_context
): Footsteps => {
  let context: AudioContext | null = null
  let cadence = create_footstep_cadence()
  let pan_right = false
  let recordings: ReadonlyMap<string, AudioBuffer> | null = null
  let recordings_loading: Promise<void> | null = null
  let last_recording: Readonly<Partial<Record<'stone' | 'sand', number>>> = Object.freeze({})

  // eslint-disable-next-line functional/prefer-immutable-types -- Web Audio contexts are mutable platform effect handles.
  const preload_recordings = (active_context: AudioContext): void => {
    if (recordings || recordings_loading) return
    recordings_loading = load_footstep_recordings(active_context).then(
      (loaded) => {
        if (context === active_context) recordings = loaded
      },
      (error: unknown) => {
        recordings_loading = null
        console.warn('Recorded footsteps could not preload; keeping procedural fallback.', error)
      }
    )
  }

  const unlocked_context = (): AudioContext | null => {
    context ??= context_factory()
    if (!context || context.state === 'closed') return null
    if (context.state === 'suspended')
      void context.resume().catch((error: unknown) => console.warn('Footstep audio could not resume.', error))
    preload_recordings(context)
    return context
  }

  const play_recording = (
    // eslint-disable-next-line functional/prefer-immutable-types -- Web Audio contexts are mutable platform effect handles.
    active_context: AudioContext,
    preset: MaterialPreset,
    speed: number,
    right: boolean
  ): boolean => {
    if (!recordings || !recorded_footstep_preset(preset)) return false
    const selected = pick_footstep_recording(preset, last_recording[preset], random)
    const buffer = recordings.get(selected.key)
    if (!buffer) return false
    last_recording = Object.freeze({ ...last_recording, [preset]: selected.variant })
    const dynamics = footstep_dynamics(speed)
    const treatment = RECORDED_FOOTSTEP_TREATMENT[preset]
    const source = active_context.createBufferSource()
    const output = active_context.createGain()
    const panner = active_context.createStereoPanner()
    /* eslint-disable functional/immutable-data -- Web Audio nodes are mutable browser effect handles. */
    source.buffer = buffer
    source.playbackRate.value = jitter(1, 0.025, random) * dynamics.pitch * treatment.pitch
    output.gain.value = treatment.gain
    panner.pan.value = right ? 0.12 : -0.12
    if (treatment.cutoff === null) source.connect(output)
    else {
      const softener = active_context.createBiquadFilter()
      softener.type = 'lowpass'
      softener.frequency.value = treatment.cutoff
      softener.Q.value = treatment.q
      source.connect(softener)
      softener.connect(output)
    }
    output.connect(panner)
    panner.connect(active_context.destination)
    source.start(active_context.currentTime)
    /* eslint-enable functional/immutable-data */
    return true
  }

  const play = (preset: MaterialPreset, speed: number): void => {
    const context = unlocked_context()
    if (!context) return
    pan_right = !pan_right
    if (play_recording(context, preset, speed, pan_right)) return
    const voice = FOOTSTEP_VOICES[preset]
    const dynamics = footstep_dynamics(speed)
    const started_at = context.currentTime
    const source = context.createBufferSource()
    const buffer = context.createBuffer(
      1,
      Math.max(1, Math.floor(context.sampleRate * voice.duration)),
      context.sampleRate
    )
    buffer.copyToChannel(footstep_samples(preset, context.sampleRate, random, speed), 0)
    /* eslint-disable functional/immutable-data -- Web Audio nodes are mutable browser effect handles. */
    source.buffer = buffer
    source.playbackRate.value = jitter(1, 0.075, random) * dynamics.pitch
    const filter = context.createBiquadFilter()
    filter.type = voice.filter_type
    filter.frequency.value = jitter(voice.cutoff, 0.09, random)
    filter.Q.value = voice.q
    const output = context.createGain()
    output.gain.value = jitter(voice.gain, 0.12, random) * FOOTSTEP_GAIN_MULTIPLIER
    source.connect(filter)
    filter.connect(output)
    const friction_source = context.createBufferSource()
    const friction_buffer = context.createBuffer(
      1,
      Math.max(1, Math.floor(context.sampleRate * voice.duration)),
      context.sampleRate
    )
    friction_buffer.copyToChannel(footstep_friction_samples(preset, context.sampleRate, random, speed), 0)
    friction_source.buffer = friction_buffer
    friction_source.playbackRate.value = jitter(1, 0.045, random) * dynamics.pitch
    const friction_filter = context.createBiquadFilter()
    friction_filter.type = 'bandpass'
    friction_filter.frequency.value = jitter(voice.friction_cutoff, 0.08, random)
    friction_filter.Q.value = 0.55
    const friction_gain = context.createGain()
    friction_gain.gain.value = voice.friction_gain
    friction_source.connect(friction_filter)
    friction_filter.connect(friction_gain)
    friction_gain.connect(output)
    voice.resonances.forEach(({ frequency, end_frequency, gain, type }) => {
      const body = context.createOscillator()
      const body_gain = context.createGain()
      body.type = type
      body.frequency.setValueAtTime(jitter(frequency, 0.08, random) * dynamics.pitch, started_at)
      body.frequency.exponentialRampToValueAtTime(end_frequency * dynamics.pitch, started_at + voice.duration)
      body_gain.gain.setValueAtTime(gain * dynamics.impact, started_at)
      body_gain.gain.exponentialRampToValueAtTime(0.0001, started_at + voice.duration)
      body.connect(body_gain)
      body_gain.connect(output)
      body.start(started_at)
      body.stop(started_at + voice.duration)
    })
    if (typeof context.createStereoPanner === 'function') {
      const panner = context.createStereoPanner()
      panner.pan.value = jitter(pan_right ? 0.18 : -0.18, 0.25, random)
      output.connect(panner)
      panner.connect(context.destination)
    } else output.connect(context.destination)
    source.start(started_at)
    source.stop(started_at + voice.duration)
    friction_source.start(started_at)
    friction_source.stop(started_at + voice.duration)
    /* eslint-enable functional/immutable-data */
  }

  return Object.freeze({
    tick: ({ position, on_ground, preset, speed }) => {
      const result = advance_footstep_cadence(cadence, { x: position[0], z: position[2], on_ground }, random)
      cadence = result.cadence
      if (result.fired) play(preset, speed)
    },
    unlock: () => {
      unlocked_context()
    },
    reset: () => {
      cadence = create_footstep_cadence()
    },
    dispose: () => {
      cadence = create_footstep_cadence()
      const active = context
      context = null
      recordings = null
      recordings_loading = null
      last_recording = Object.freeze({})
      if (active && active.state !== 'closed')
        void active.close().catch((error: unknown) => console.warn('Footstep audio could not close.', error))
    },
  })
}
