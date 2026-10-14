// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_authored_spell_source, type ClaudeSoundEvent, type SpellEffectRecipe } from '@aresrpg/engine/data'
import type { create_audio_source } from '@aresrpg/engine/spell-audio'
import authored from '../../../../../seed/content/audio.json'
import { scale_audio_volume } from '../core/audio_volume.ts'

const RECORDINGS = Object.entries(authored.sounds).filter(([name]) => name.startsWith('spell_fx_'))
export const spell_effect_audio_plan = (recipe: SpellEffectRecipe) => {
  const source = create_authored_spell_source()
  const preset = source.select(recipe.preset.cls, recipe.preset.name, recipe.preset)
  const plan = source.sound_plan()
  if (recipe.triggered) {
    const offset = preset.cast + preset.fly + (preset.trap ? source.trap_wait : 0)
    return plan.filter((event) => event.step === 2).map((event) => ({ ...event, t: event.t - offset }))
  }
  return preset.trap ? plan.filter((event) => event.step !== 2) : plan
}
const recording = async (file: string): Promise<string> => {
  const response = await fetch(`/sound_effect/${file}`)
  if (!response.ok) throw new Error(`Spell recording failed: ${file} (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
}

const create_spell_audio = () => {
  let player: ReturnType<typeof create_audio_source> | null = null
  let pending: Promise<void> | null = null
  let plan: readonly ClaudeSoundEvent[] = []
  const buses = new Map<GainNode, number>()
  let generation = 0
  const sync = (): void => {
    if (player?.A.master) player.A.master.gain.value = scale_audio_volume(0.9)
  }
  const prepare = (): Promise<void> => {
    if (typeof window === 'undefined') return Promise.resolve()
    const revision = generation
    pending ??= Promise.all(
      RECORDINGS.map(async ([name, row]) => [name.slice(9), await recording(row.file)] as const)
    ).then(async (rows) => {
      if (revision !== generation) return
      const onset = Object.fromEntries(
        RECORDINGS.map(([name, row]) => [name.slice(9), 'onset_seconds' in row ? row.onset_seconds : 0])
      )
      const { create_audio_source } = await import('@aresrpg/engine/spell-audio')
      if (revision !== generation) return
      player = create_audio_source(Object.fromEntries(rows), onset, create_authored_spell_source().lead, () => plan)
      const loading = player
      await loading.boot_audio()
      if (revision !== generation) {
        if (loading.A.ctx?.state !== 'closed') await loading.A.ctx?.close()
        return
      }
      sync()
    })
    return pending
  }
  const cancel = (): void => {
    buses.forEach((_, bus) => bus.disconnect())
    buses.clear()
    if (player) player.A.bus = undefined
  }
  return {
    prepare,
    sync,
    play: (recipe: SpellEffectRecipe): void => {
      if (!player?.A.ready) return
      plan = spell_effect_audio_plan(recipe)
      const now = player.A.ctx!.currentTime
      buses.forEach((until, bus) => {
        if (until <= now) {
          bus.disconnect()
          buses.delete(bus)
        }
      })
      // The demo replaces its one audition bus. Each accepted game cast owns its complete sound tail.
      player.A.bus = undefined
      sync()
      void player.A.ctx?.resume().catch((error) => console.warn('Spell audio could not resume.', error))
      const playback = recipe.triggered ? { ...recipe.preset, cast: 0, fly: 0, trap: 0 } : recipe.preset
      player.play_spell(playback, 1)
      const sounds = player.A.s
      const duration = Math.max(
        ...plan.map((event) => {
          const key = event.name.startsWith('d:') ? `d_${event.name.slice(2)}` : event.name.slice(2)
          return event.t + (sounds[key]?.duration ?? 0) / ((event.o.rate ?? 1) * 0.96)
        })
      )
      buses.set(player.A.bus!, now + duration + 0.1)
    },
    cancel,
    dispose: (): void => {
      generation += 1
      cancel()
      const context = player?.A.ctx
      if (context && context.state !== 'closed')
        void context.close().catch((error) => console.warn('Spell audio could not close.', error))
      player = null
      pending = null
      plan = []
    },
  }
}
export const spell_audio = create_spell_audio()
