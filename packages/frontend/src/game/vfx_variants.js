// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PER-SPELL VFX VARIANT SELECTOR — the b_spell "spread strategy" (docs/VFX_FULL_UTILIZATION_PLAN.md §(b)): today
// vfx_map.js collapses all 276 spells to ~6 element beats (every fire spell shares one flame). This PURE selector
// breaks that: keyed by (class, element, role, hash(spell_id)) it picks a DIFFERENT ported pack variant per spell,
// so a Senshi Gale Slash and a Storm Arc land different bolts, a Yajin damage vs dot vs trap read distinctly, etc.
// The returned name is a preset in the engine's b_spell modules (vfx_presets_{dark,air,elemental,flame}.js).
//
// WIRE (1 line, for the lead — vfx_map.js is another lane's file right now): in vfx_map's per-cast resolution,
// override the projectile layer with `variant_for(spell)` when it returns non-null, else keep the element default:
//     import { variant_for } from './vfx_variants.js'
//     const orb_preset = variant_for(spell) ?? CAST_VFX[asset_element(el)].orb.preset_3d.preset
// (the returned name also covers the ground-decal zone for glyph/trap spells and the skyfall delivery for air
// pull/push — a drop-in override, no CAST_VFX restructure). Until wired, the gate is already green on the preset
// tokens; this only adds the runtime VARIETY.

/** Deterministic 32-bit FNV-1a hash of a spell id — the per-spell decorrelation for variant rotation. Pure.
 *  @param {string} id @returns {number} */
export function spell_hash(id) {
  let h = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const DARK_TINTS = /** @type {const} */ (['black', 'evil', 'void'])
const AIR_TIERS = 6 // air_bolt_orb_01..06 / air_zap_strike_01..06

// Yajin (necromancer) role → dark family shape. damage → orb; the punishing/draining kit → the comet bolt;
// the placed hazards → the ground zone. (Everything else falls to the orb.)
const DARK_BOLT_ROLES = new Set(['dot', 'punishment', 'life_steal', 'drain_ap', 'drain_mp'])
const DARK_ZONE_ROLES = new Set(['trap', 'glyph', 'state'])
// "area/placed" roles route to the *_area ground decal instead of a projectile bolt.
const AREA_ROLES = new Set(['glyph', 'trap', 'dot'])

const two = (/** @type {number} */ n) => String(n).padStart(2, '0')

/**
 * EVERY variant preset name variant_for can emit — derived from THIS module's own tables (one home; the
 * fight_cast_vfx merge-drift test hand-mirrors this list). Consumer: vfx_map.prewarm_specs — the fight-start
 * prewarm compiles these pipelines too, because a variant that only compiles on its first live cast is exactly
 * the "still a lot of freezes during fight vfx" class: the element beats were prewarmed but
 * every first mapped spell mounted a cold variant. @returns {string[]} */
export function all_variant_names() {
  return [
    ...DARK_TINTS.flatMap((t) => [`dark_orb_${t}`, `dark_bolt_${t}`, `dark_zone_${t}`]),
    ...Array.from({ length: AIR_TIERS }, (_, i) => `air_bolt_orb_${two(i + 1)}`),
    ...Array.from({ length: AIR_TIERS }, (_, i) => `air_zap_strike_${two(i + 1)}`),
    'elem_variant_electric_bolt',
    'elem_variant_electric_area',
    'elem_variant_fire_bolt',
    'elem_variant_fire_area',
    'elem_variant_nature_bolt',
    'elem_variant_nature_area',
    'flame_variant_void',
    'flame_variant_green',
    'flame_variant_cold',
    'flame_variant_light',
    'flame_variant_purple',
  ]
}

/**
 * The per-spell VFX variant preset name, or null to keep the element's default CAST_VFX beat. PURE + deterministic
 * (hash-driven), so the same spell always reads the same. @param {{ id?:string, classType?:string, element?:string,
 * role?:string }} spell @returns {string|null} */
// Complexity retained (#2069): this is one exhaustive spell-variant decision table; splitting it would scatter the precedence contract without an independent seam.
export function variant_for(spell) {
  if (!spell || !spell.id) return null
  const { id, element: el, role, classType: cls } = spell
  const h = spell_hash(id)

  // 1. YAJIN necromancer → the DarkMagic family (3 tints × orb/bolt/zone), split by role.
  if (cls === 'yajin') {
    const tint = DARK_TINTS[h % 3]
    if (DARK_ZONE_ROLES.has(role ?? '')) return `dark_zone_${tint}`
    if (DARK_BOLT_ROLES.has(role ?? '')) return `dark_bolt_${tint}`
    return `dark_orb_${tint}` // damage + all remaining Yajin casts
  }

  // 1b. TELEPORT (warleap et al.) — an element-agnostic self-relocation (teleport must
  //     render a real beat, not null). No dedicated teleport pack among the ported FX, so it BORROWS
  //     ElementalMagic's arcane-purple utility flavour (the SAME language the buff/state kit uses at step 6) —
  //     a magical blink, not an elemental bolt. Yajin already returned above, keeping its dark family cohesive.
  if (role === 'teleport') return 'flame_variant_purple'

  // 2. AIR → ElectricFX: damage rotates the 6-tint ball; the pull/push knockers get the skyfall strike; the
  //    draining/dotting kit borrows ElementalMagic's own golden lightning (elem_variant_electric).
  if (el === 'air') {
    if (role === 'pull' || role === 'push') return `air_zap_strike_${two((h % AIR_TIERS) + 1)}`
    if (role === 'dot' || role === 'drain_ap' || role === 'drain_mp' || role === 'debuff_stat')
      return AREA_ROLES.has(role ?? '') ? 'elem_variant_electric_area' : 'elem_variant_electric_bolt'
    return `air_bolt_orb_${two((h % AIR_TIERS) + 1)}`
  }

  // 3. FIRE → ElementalMagic's own fire variant; the punishing kit takes the void-flame flavour.
  if (el === 'fire') {
    if (role === 'punishment') return 'flame_variant_void'
    return AREA_ROLES.has(role ?? '') ? 'elem_variant_fire_area' : 'elem_variant_fire_bolt'
  }

  // 4. EARTH → ElementalMagic nature (yellow-green); poison-dots take the green flame flavour.
  if (el === 'earth') {
    if (role === 'dot') return 'flame_variant_green'
    return AREA_ROLES.has(role ?? '') ? 'elem_variant_nature_area' : 'elem_variant_nature_bolt'
  }

  // 5. WATER → a cold-flame flavour on the lingering dots; damage keeps the default ice beat.
  if (el === 'water') {
    if (role === 'dot') return 'flame_variant_cold'
    return null
  }

  // 6. NEUTRAL → holy-light flavour on heals, arcane-purple on the buffs/utility; damage keeps default.
  if (el === 'neutral') {
    if (role === 'heal') return 'flame_variant_light'
    if (role === 'buff_stat' || role === 'give_ap' || role === 'give_mp' || role === 'state')
      return 'flame_variant_purple'
    return null
  }

  return null
}
