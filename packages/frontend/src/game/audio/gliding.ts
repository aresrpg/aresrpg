// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- This world-lifetime effect owns its Web Audio nodes. */
import { AUDIO_ASSETS, AUTHORED_AUDIO, play_audio } from './audio_registry.ts'
import { scale_audio_volume } from '../core/audio_volume.ts'

const load_wind = async (context: Readonly<AudioContext>): Promise<AudioBuffer> => {
  const response = await fetch(AUDIO_ASSETS.glide_wind!)
  if (!response.ok) throw new Error(`Glide wind: HTTP ${response.status}`)
  return context.decodeAudioData(await response.arrayBuffer())
}

/** Local physics transitions own the cue; one decoded buffer loops without media-element gaps. */
export const create_gliding_audio = (
  context_factory: () => AudioContext | null = () => (typeof AudioContext === 'undefined' ? null : new AudioContext()),
  load: typeof load_wind = load_wind,
  cue: () => void = () => play_audio('glide_deploy')
) => {
  let context: AudioContext | null = null
  let buffer: AudioBuffer | null = null
  let voice: Readonly<{ source: AudioBufferSourceNode; gain: GainNode }> | null = null
  let gliding = false
  let disposed = false
  let volume = -1

  const unlock = (): void => {
    if (disposed || scale_audio_volume(1) === 0) return
    if (!context) {
      context = context_factory()
      const active = context
      if (!active) return
      void load(active).then(
        (loaded) => {
          if (!disposed) buffer = loaded
        },
        (error: unknown) => console.warn('Glide wind could not load.', error)
      )
    }
    if (context?.state === 'suspended')
      void context.resume().catch((error: unknown) => console.warn('Glide audio could not resume.', error))
  }

  const stop = (): void => {
    if (!voice || !context) return
    const { source, gain } = voice
    voice = null
    gain.gain.cancelAndHoldAtTime(context.currentTime)
    gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.3)
    source.stop(context.currentTime + 0.31)
  }

  const start = (): void => {
    if (voice || !context || !buffer) return
    const source = context.createBufferSource()
    const gain = context.createGain()
    source.buffer = buffer
    source.loop = true
    gain.gain.value = 0
    source.connect(gain)
    gain.connect(context.destination)
    source.onended = () => {
      source.disconnect()
      gain.disconnect()
    }
    source.start()
    voice = { source, gain }
    volume = -1
  }

  const reset = (): void => {
    gliding = false
    stop()
  }

  return {
    unlock,
    tick: (next: boolean): void => {
      if (disposed) return
      if (next && !gliding) cue()
      gliding = next
      if (!next) return stop()
      start()
      const next_volume = scale_audio_volume(AUTHORED_AUDIO.glide_wind!.volume)
      if (voice && context && volume !== next_volume) {
        volume = next_volume
        voice.gain.gain.cancelAndHoldAtTime(context.currentTime)
        voice.gain.gain.linearRampToValueAtTime(volume, context.currentTime + 0.25)
      }
    },
    reset,
    dispose: (): void => {
      reset()
      disposed = true
      buffer = null
      if (context) void context.close().catch((error: unknown) => console.warn('Glide audio could not close.', error))
    },
  }
}
