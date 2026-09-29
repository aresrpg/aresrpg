// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button } from '@aresrpg/ui'
import { MATERIAL_PRESETS, type MaterialPreset } from '@aresrpg/engine'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { useState } from 'react'

import { create_footsteps } from '../../src/game/audio/footsteps.ts'
import { load_footstep_recordings } from '../../src/game/audio/footstep_recordings.ts'
import { dispatch_app, initialize_app_store, observe_app, read_app_state } from '../../src/store.ts'

initialize_app_store({
  quality: 'medium',
  music_enabled: false,
  master_volume: 1,
  render_distance: null,
})
let stop = observe_app(['settings'])
const sound_log: string[] = []
const original_play = HTMLMediaElement.prototype.play
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: new Proxy(original_play, {
    apply: (target, receiver, args) => {
      const player = receiver as HTMLMediaElement
      const playback = Reflect.apply(target, player, args) as Promise<void>
      return playback.then(() => {
        sound_log.push(new URL(player.src).pathname)
        document.getElementById('audio-events')!.textContent = JSON.stringify(sound_log)
      })
    },
  }),
})

const footsteps_log: Readonly<{ duration: number; peak: number }>[] = []
let active_steps = 0
let peak_steps = 0
const original_start = AudioBufferSourceNode.prototype.start
Object.defineProperty(AudioBufferSourceNode.prototype, 'start', {
  configurable: true,
  value: new Proxy(original_start, {
    apply: (target, receiver, args) => {
      const source = receiver as AudioBufferSourceNode
      active_steps += 1
      peak_steps = Math.max(peak_steps, active_steps)
      document.getElementById('footstep-overlap')!.textContent = String(peak_steps)
      source.addEventListener(
        'ended',
        () => {
          active_steps -= 1
        },
        { once: true }
      )
      const { buffer } = source
      const channels = Array.from({ length: buffer?.numberOfChannels ?? 0 }, (_, index) =>
        buffer!.getChannelData(index)
      )
      const peak = channels.reduce(
        (largest, samples) => samples.reduce((value, sample) => Math.max(value, Math.abs(sample)), largest),
        0
      )
      footsteps_log.push({ duration: buffer?.duration ?? 0, peak })
      document.getElementById('footstep-events')!.textContent = JSON.stringify(footsteps_log)
      return Reflect.apply(target, source, args)
    },
  }),
})
let loading: Promise<ReadonlyMap<string, AudioBuffer>> | null = null
const footsteps = create_footsteps(
  Math.random,
  () => new AudioContext(),
  (context) => {
    loading = load_footstep_recordings(context)
    return loading
  }
)
const walk = async (preset: MaterialPreset): Promise<void> => {
  footsteps.unlock()
  await loading
  footsteps.reset()
  footsteps.tick({ position: [0, 0, 0], on_ground: true, preset, speed: 5 })
  footsteps.tick({ position: [2, 0, 0], on_ground: true, preset, speed: 5 })
}

const run_grass = async (): Promise<void> => {
  footsteps.unlock()
  await loading
  footsteps.reset()
  footsteps.tick({ position: [0, 0, 0], on_ground: true, preset: 'grass', speed: 10.5 })
  for (let step = 1; step <= 8; step += 1) {
    footsteps.tick({ position: [step * 2, 0, 0], on_ground: true, preset: 'grass', speed: 10.5 })
    await new Promise((resolve) => setTimeout(resolve, 180))
  }
  document.getElementById('run-state')!.textContent = 'done'
}

const change = (patch: Partial<ReturnType<typeof read_app_state>['settings']>): void =>
  dispatch_app({ type: 'settings/changed', settings: { ...read_app_state().settings, ...patch } })

const Fixture = () => {
  const [clicks, count] = useState(0)
  return (
    <>
      <Button
        onClick={(event) => {
          event.stopPropagation()
          count(clicks + 1)
        }}
      >
        <span>Ordinary button</span>
      </Button>
      <Button disabled>Disabled button</Button>
      <Button onClick={() => change({ music_enabled: !read_app_state().settings.music_enabled })}>
        Change setting
      </Button>
      <Button onClick={() => change({ master_volume: 0 })}>Mute</Button>
      <Button
        onClick={() => {
          stop()
          stop = observe_app(['settings'])
        }}
      >
        Restart observers
      </Button>
      <Button onClick={() => stop()}>Dispose observers</Button>
      {createPortal(
        <button onClick={() => count(clicks + 1)}>Portal button</button>,
        document.getElementById('portal')!
      )}
      <div>
        {MATERIAL_PRESETS.map((preset) => (
          <Button
            key={preset}
            onClick={() => {
              void walk(preset).catch((error: unknown) => console.error('Footstep fixture failed.', error))
            }}
          >
            Step {preset}
          </Button>
        ))}
      </div>
      <Button
        onClick={() => {
          void run_grass().catch((error: unknown) => console.error('Running fixture failed.', error))
        }}
      >
        Run grass
      </Button>
      <output id="run-state">idle</output>
      <output id="footstep-overlap">0</output>
      <output id="footstep-events">[]</output>
      <output id="clicks">{clicks}</output>
      <output id="audio-events">[]</output>
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
