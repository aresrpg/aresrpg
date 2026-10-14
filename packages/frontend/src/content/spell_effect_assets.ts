// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// These are the exact art sheets sampled by the approved source shader, in sampler order.
const atlases: Readonly<Record<string, string>> =
  typeof Bun === 'undefined'
    ? import.meta.glob('../../../../seed/icons/spell_effects/*.webp', { eager: true, import: 'default', query: '?url' })
    : Object.freeze({})
export const spell_effect_atlases = (): readonly string[] =>
  ['swords', 'tomoda', 'rojin', 'props'].map(
    (name) =>
      atlases[`../../../../seed/icons/spell_effects/${name}.webp`] ?? `/__seed/assets/spell_effects/${name}.webp`
  )
