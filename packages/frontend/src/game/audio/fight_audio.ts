// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fight cue -> exact legacy file-backed audio mix. Presentation order is owned by
// fight_presenter; this module only selects and plays the sound for each phase.

import type { FightPresentationCue } from '@aresrpg/engine'
import { CHANNELS, EFFECT_KINDS } from '@aresrpg/fight/move_contract'
import type { HydratedFightCheckpoint, SpellEffect } from '@aresrpg/fight'

import type { FightCuePhase } from '../fight/fight_presenter.ts'
import {
  ELEMENT_AUDIO_VARIANTS,
  element_audio_key,
  fight_audio_keys_for_families,
  play_fight_audio,
  preload_fight_audio,
} from './fight_audio_registry.ts'

type CharacterVoices = Readonly<Record<string, boolean>>

const CAST_CHARGE: Readonly<Record<string, string>> = Object.freeze({
  air: 'cast_charge_air',
  earth: 'cast_charge_earth',
  fire: 'cast_charge_fire',
  water: 'cast_charge_water',
})
const ABSORB = Object.freeze(['absorb_1', 'absorb_2', 'absorb_3'] as const)

const stable_index = (id: string, count: number): number =>
  [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % count

const effect_family = (effect: Readonly<SpellEffect>): string =>
  effect.kind === EFFECT_KINDS.add && effect.stat === CHANNELS.hp ? 'heal' : effect.element || 'neutral'

export const fight_audio_families = (checkpoint: Readonly<HydratedFightCheckpoint>): readonly string[] => {
  const classes = new Set(Object.values(checkpoint.sources.players).map(({ classe }) => classe))
  const player_levels = Object.values(checkpoint.sources.spells)
    .filter(({ classe }) => classes.has(classe))
    .flatMap(({ levels }) => levels)
  const mob_levels = checkpoint.contract.fighters.flatMap((fighter) =>
    fighter.kind.type === 'mob' ? fighter.kind.snapshot.kit.map(({ level }) => level) : []
  )
  const effects = [...player_levels, ...mob_levels].flatMap(({ effects: normal, crit_effects }) => [
    ...normal,
    ...crit_effects,
  ])
  const families = new Set(effects.map(effect_family))
  if (Object.values(checkpoint.sources.players).some(({ weapon }) => weapon !== null)) families.add('weapon')
  return Object.freeze([...families].sort())
}

export const preload_fight_sounds = (checkpoint: Readonly<HydratedFightCheckpoint>): void =>
  preload_fight_audio(fight_audio_keys_for_families(fight_audio_families(checkpoint)))

export const play_fight_turn_start = (emit: (key: string, volume?: number) => void = play_fight_audio): void =>
  emit('turn_start')

const fight_audio_family_layer = (family: string, layer: string): keyof typeof ELEMENT_AUDIO_VARIANTS => {
  const exact = `${family}:${layer}` as keyof typeof ELEMENT_AUDIO_VARIANTS
  return Object.hasOwn(ELEMENT_AUDIO_VARIANTS, exact)
    ? exact
    : (`neutral:${layer}` as keyof typeof ELEMENT_AUDIO_VARIANTS)
}

export const fight_audio_variant = (
  family: string,
  layer: string,
  previous: number | undefined,
  random = Math.random
): Readonly<{ family_layer: string; key: string; variant: number }> => {
  const resolved = fight_audio_family_layer(family, layer)
  const count = ELEMENT_AUDIO_VARIANTS[resolved] ?? 1
  let variant = Math.min(count, 1 + Math.floor(random() * count))
  if (count > 1 && variant === previous) variant = (variant % count) + 1
  const [resolved_family, resolved_layer] = resolved.split(':') as [string, string]
  return Object.freeze({
    family_layer: resolved,
    key: element_audio_key(resolved_family, resolved_layer, variant),
    variant,
  })
}

export const create_fight_audio_observer = (
  emit: (key: string, volume?: number) => void = play_fight_audio,
  random: () => number = Math.random
) => {
  const last_variant = new Map<string, number>()
  const variant = (family: string, layer: string): string => {
    const family_layer = fight_audio_family_layer(family, layer)
    const resolved = fight_audio_variant(family, layer, last_variant.get(family_layer), random)
    last_variant.set(resolved.family_layer, resolved.variant)
    return resolved.key
  }
  return (cue: FightPresentationCue, phase: FightCuePhase, character_voices: CharacterVoices): void => {
    if (cue.type === 'cast') {
      if (phase === 'start') {
        const charge = CAST_CHARGE[cue.element]
        if (charge) emit(charge)
        return
      }
      emit('cast_resolve')
      if (cue.amount <= 0 && cue.style !== 'trap' && cue.style !== 'glyph') return
      emit(
        cue.element === 'heal' ? variant('heal', 'cast') : variant(cue.element, 'impact'),
        cue.element === 'heal' ? 0.35 : 0.5
      )
      if (cue.critical) emit('crit', 0.45)
      if (cue.killed) emit('death', 0.4)
      if (cue.affected_cells.length >= 3 && cue.element !== 'heal') emit(variant(cue.element, 'aoe'), 0.32)
      return
    }
    if (phase !== 'start') return
    if (cue.type === 'zone') {
      emit(cue.element === 'heal' ? variant('heal', 'cast') : variant(cue.element, 'impact'), 0.5)
      return
    }
    if (cue.type === 'damage') {
      const heavy = cue.critical || cue.hp_after === 0 || cue.amount >= Math.max(1, cue.hp_before * 0.37)
      emit(heavy ? 'hit_heavy' : 'hit_medium')
      const male = character_voices[cue.target_id]
      if (cue.source_id.startsWith('fight_mob_') && typeof male === 'boolean') emit(male ? 'hurt_male' : 'hurt_female')
      return
    }
    if (cue.type === 'absorb') {
      emit(ABSORB[stable_index(cue.id, ABSORB.length)])
      return
    }
    if (cue.type === 'movement' && cue.mode === 'knockback') emit('knockback', 0.32)
  }
}
