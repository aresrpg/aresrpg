// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Context for the original author program. Art and its timeline have no second implementation.
import catalog from './generated/claude_spell_catalog.json'
import { create_source, type ClaudeSpell } from './generated/claude_spell_source.js'

const EFFECT_TAIL_SECONDS = create_source().hold

export type SpellEffectClass = keyof typeof catalog
export const SPELL_EFFECT_CLASSES = Object.freeze(Object.keys(catalog) as SpellEffectClass[])
export type SpellEffectArea = Readonly<{
  kind: string
  element: string
  stat: string
  value: number
  cells: readonly number[]
}>
export type SpellEffectTiming = Readonly<{
  release_seconds: number
  travel_seconds: number
  impact_seconds: number
  complete_seconds: number
  end_seconds: number
  animation_release_seconds: number
}>
export type SpellEffectRecipe = Readonly<{
  preset: ClaudeSpell
  areas: readonly SpellEffectArea[]
  atlas_urls: readonly string[]
  triggered: boolean
  /** A trap explodes at its stored anchor, which can differ from the entering fighter cell. */
  zone_anchor?: number
  timing?: SpellEffectTiming
}>

export const spell_effect_timing = (recipe: SpellEffectRecipe, animation_release_seconds = 0.45): SpellEffectTiming => {
  const { preset, triggered } = recipe
  const release = triggered ? 0 : preset.cast
  const travel = triggered ? 0 : preset.fly
  return Object.freeze({
    release_seconds: release,
    travel_seconds: travel,
    impact_seconds: release + travel,
    complete_seconds: release + travel + 0.65,
    end_seconds: release + travel + (preset.trap && !triggered ? 1.1 : EFFECT_TAIL_SECONDS),
    animation_release_seconds,
  })
}
