// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEED effect → one localized effect LINE (NO JSX). The single home for turning a projected spell effect
// into the player-facing line every spell surface renders: the grimoire (Spellbook.jsx), the encyclopedia
// class page (classes_tab.tsx) — both via the structured `seed_effect_parts` + the shared <EffectLine>
// renderer — plus compact HUD surfaces via the flat-string `seed_effect_line`, which is DERIVED from the
// same parts (one grammar, zero drift).
//
// OWNER DISPLAY SPEC (07-13, Vanish screenshot; verbatim "it should show +(grey)1(green) MP(grey) with the
// icon, and then a second line 'become invisible', no cards, just lines"):
//   · stat/point lines  → [stat icon] sign+unit GREY, the VALUE green (buff) / red (penalty): `+1 AP`
//   · damage lines      → [element dot] value in the element colour: `7 earth damage · crit 9`
//   · state lines       → plain verb sentences: `Become invisible · 2 turns` — NO magnitude noise for
//     magnitude-less kinds (the screenshot's floating "1" under INVISIBILITY is exactly the garbage killed
//     here: INVISIBILITY/TELEPORT/SWAP/DISPEL/… carry base=1 as a flag, never a shown number)
//   · meta suffix       → dim, only when informative: duration (every positive `turns` carried by the effect),
//     crit range/value, AoE zone (non-POINT only), proc chance (<100)
//
// GROUND TRUTH (all decoded from the chain-mint path, never guessed):
//   · effect shape = fight-spells.js `decode_effect`: { kind, element?, base, damageMin?, damageMax?,
//     chance, turns, area_shape, area_size, zone?, crit_base?, crit_effect?, stat? } — FLAT chain value plus
//     the authored display ranges carried by the final seed corpus
//   · GIVE/REMOVE_POINTS `stat`: POINT_AP=0 / POINT_MP=1 (spell_effect.move:130)
//   · ALTER_STAT `stat`: the Move STAT_* enum (spell_effect.move:135-149) — 0 strength · 1 intelligence ·
//     2 chance · 3 agility · 4 wisdom · 5 vitality · 6 range · 7 crit · 8 percent damage · 9 raw damage ·
//     11 heal. The old blanket "raw damage" wording was FALSE for every live ALTER_STAT (corpus now mints
//     stats 0-3/5-9).
//   · ALTER_RESIST: element-tagged "resistance" — "+8 Earth resistance" (fx_alter_resist_el + the shared
//     spells.el_* name). The resist-element fix (07-20) moved the intended element out of the ALTER_STAT-only
//     `stat` field (where the mint dropped it → el_none/255 → 0% mitigation) into `element`, so the line now
//     names it. A legacy el_none/element-less row falls back to the bare "resistance" phrasing — never an
//     invented element. Still no '%': the corpus resist rows carry no FLAG_PERCENT (the old "% resist all" lie).
//   · REFLECT_DAMAGE keeps '%': the generator mints it with FLAG.percent (spells_712_engine.mjs:167).
//   · REDUCE_DAMAGE carries NO element in the live corpus — the old template interpolated one anyway,
//     rendering a literal "spells.undefined" on screen. These element-less shields consume incoming damage
//     from ANY element, so the shared line states that scope explicitly.
//
// i18n: every kind routes through `spells.fx_*` (×6 locales). The VALUE emphasis needs a value/text split
// that survives any word order, so templates carry `{{value}}` and the builder splits the TRANSLATED string
// on a sentinel — one key per kind covers all 6 locales. Stat names reuse the existing `stat.*` namespace;
// AoE labels reuse `encyclopedia.aoe_shape.*` (one taxonomy). An unmapped kind renders the loud untranslated
// `? KIND` canary (asserted never to fire for the live corpus by spell-coverage.test.js).

import { element_color } from './element-colors.js'

// ── the house value tones (single home — spellbook-data.js + classes_tab.tsx import from here) ──────────────
export const TONE_BUFF = '#4fd6a0' // green — beneficial value (house --good / --clog-num-mp)
export const TONE_BAD = '#ff6b6b' // red — penalty/drain value (house --bad)
export const HEAL_PINK = '#ff6bb0' // heal value — the house heal grammar (--clog-num-heal)

// Move STAT_* id (spell_effect.move:135-149) → { statistics/<icon>.png key, stat.* i18n leaf, unit? }. AP/MP
// ride the POINT_AP/POINT_MP ids of GIVE/REMOVE_POINTS through the same asset set (action/movement).
// `unit` rides the VALUE, not the stat name (owner copy law, issue #886: the reading is `+25% Damage` — the
// symbol '%', never the word "percent" in any locale). Percent-typed stats are the only ones that carry one.
const STAT_VIEW = {
  0: { icon: 'strength', key: 'stat.strength' },
  1: { icon: 'intelligence', key: 'stat.intelligence' },
  2: { icon: 'chance', key: 'stat.chance' },
  3: { icon: 'agility', key: 'stat.agility' },
  4: { icon: 'wisdom', key: 'stat.wisdom' },
  5: { icon: 'vitality', key: 'stat.vitality' },
  6: { icon: 'range', key: 'stat.range' },
  7: { icon: 'crit', key: 'stat.critical_hit' },
  8: { icon: 'raw_damage', key: 'stat.percent_damage', unit: '%' },
  9: { icon: 'raw_damage', key: 'stat.raw_damage' },
  11: { icon: 'health', key: 'stat.heal' },
}
const POINT_VIEW = {
  0: { icon: 'action', key: 'stat.action' }, // POINT_AP
  1: { icon: 'movement', key: 'stat.movement' }, // POINT_MP
}

// The four elements as they arrive decoded (fight-spells.js element_names) — the one home for "is this a
// real element" across the damage-school label and the resist line (el_none/255 → 'neutral' is NOT here).
const ELEMENT_KEYS = ['fire', 'water', 'earth', 'air']

/**
 * The kind/element label — an element name for the damage schools, else the buff/heal/utility family label.
 * @param {(key: string, params?: object) => string} t @param {string} key  element ('fire'…) or family key
 */
export const seed_el_label = (t, key) =>
  ELEMENT_KEYS.includes(key) ? t(`spells.el_${key}`) : t(`spells.${key}`)

// AoE shape code → the encyclopedia's own 6-locale `encyclopedia.aoe_shape.*` vocabulary — reused verbatim.
const AOE_SHAPE_KEY = {
  POINT: 'point',
  CIRCLE: 'circle',
  CROSS: 'cross',
  LINE: 'line',
  TBAR: 'tbar',
  RING: 'ring',
  ALLMAP: 'allmap',
  CONE: 'cone',
}

// Sentinel-split: translate the kind template with {{value}} = \u0000, then split around it so the VALUE can
// render as its own coloured span in ANY locale word order. A template without {{value}} yields value: null.
const SENTINEL = '\u0000'
const split_value = (t, key, params, value) => {
  const s = String(t(key, { ...params, value: SENTINEL }))
  const i = s.indexOf(SENTINEL)
  if (i < 0) return { pre: s, value: null, post: '' }
  return { pre: s.slice(0, i), value: String(value), post: s.slice(i + SENTINEL.length) }
}

const finite_number = (value) => {
  if (value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

// Spell target-filter bits (spell_effect.move): enemy-only (`NOT_TEAM` = 1) is the compact default. Friendly
// riders need their target named because the same effect wording otherwise reads like a gift to the enemy.
const TF_NOT_ENEMY = 4
const TF_ONLY_CASTER = 32

const effect_target_label = (t, target_filter) => {
  const filter = finite_number(target_filter) ?? 0
  if ((filter & TF_ONLY_CASTER) === TF_ONLY_CASTER) return t('spells.tag_self')
  if ((filter & TF_NOT_ENEMY) === TF_NOT_ENEMY) return t('spells.target_ally')
  return null
}

/**
 * The authored magnitude shown by every seed-effect surface. Unequal bounds use the locale's own range
 * connector (`to` / `à` / `bis` / …); equal bounds collapse to one number. A bounded damage line missing either
 * side renders an em dash instead of reviving the chain midpoint as player-facing damage truth.
 * @param {(key: string, params?: object) => string} t
 * @param {{ base?: number | string, value?: number | string, damageMin?: number, damageMax?: number }} fx
 */
export const seed_effect_value = (t, fx) => {
  const min = finite_number(fx?.damageMin)
  const max = finite_number(fx?.damageMax)
  if (min != null && max != null) return min === max ? String(min) : `${min} ${String(t('entity.range_to'))} ${max}`
  return '—'
}

/**
 * @typedef {object} EffectLineView
 * @property {string | null} icon   statistics asset key ('action' | 'strength' | …) — stat/point/heal lines
 * @property {string | null} dot    leading element-dot colour — damage-class lines (no element icon asset exists)
 * @property {string} pre           grey text before the value (carries the grey sign: '+' / '-')
 * @property {string | null} value  the emphasised magnitude — null = a sentence line with NO number (the
 *                                  "no magnitude noise" rule for flag-valued kinds)
 * @property {string} tone          css colour for the value span (element hue / buff green / penalty red / heal pink)
 * @property {string} post          grey text after the value
 * @property {string | null} meta   dim ' · '-joined suffix (duration / crit / zone / proc chance) or null
 */

// Owner (v33 review, "circle 0 is a weird name for a spell of single cell, just don't show anything if
// it's not a AoE"): CIRCLE/CROSS/RING/LINE/TBAR/CONE at size 0 are geometrically the ONE target cell
// (packages/sim/src/spell_targeting.js cells_in_circle/cells_in_cross/cells_in_line/cells_in_tbar all
// collapse to just `target` — or, for CONE, to nothing — at size 0; manhattan distance <= 0 or length 1
// never reach a second cell), so they are never real area-of-effect. ALLMAP is the one shape whose zone is
// independent of `size` (always the whole board). The single home for "is this genuinely an AoE" — every
// zone-label call site (this file's meta, classes_tab.tsx's effect-zone chip) derives from here, never
// re-derives its own condition.
export const is_area_effect = (shape, size) => shape === 'ALLMAP' || (shape !== 'POINT' && Number(size ?? 0) > 0)

/** The meta suffix pieces (duration · crit · zone · chance) — only what is genuinely informative. */
const meta_of = (t, fx) => {
  const turns = finite_number(fx.turns)
  const critical_effect = fx.crit_effect
  const critical_min = finite_number(critical_effect?.damageMin)
  const critical_max = finite_number(critical_effect?.damageMax)
  const critical_value =
    critical_min != null && critical_max != null
      ? seed_effect_value(t, critical_effect)
      : fx.crit_base != null
        ? String(fx.crit_base)
        : null
  const shape = fx.area_shape ?? 'POINT'
  const size = fx.area_size ?? 0
  const target = effect_target_label(t, fx.target_filter)
  const pieces = [
    ...(fx.kind === 'REDUCE_DAMAGE' ? [t('spells.fx_any_element')] : []),
    ...(target ? [target] : []),
    ...(turns != null && turns > 0 ? [t('spells.fx_turns', { count: turns })] : []),
    ...(critical_value != null ? [t('spells.crit_val', { value: critical_value })] : []),
    ...(is_area_effect(shape, size) ? [t(`encyclopedia.aoe_shape.${AOE_SHAPE_KEY[shape] ?? 'point'}`, { size })] : []),
    ...(fx.chance != null && fx.chance < 100 ? [t('encyclopedia.proc_chance', { n: fx.chance })] : []),
  ]
  return pieces.length ? pieces.join(' · ') : null
}

/** A damage-class line: element dot + element-coloured value. */
const damage_parts = (t, fx, key) => ({
  icon: null,
  dot: element_color(fx.element),
  tone: element_color(fx.element),
  ...split_value(t, key, { element: seed_el_label(t, fx.element) }, seed_effect_value(t, fx)),
})

/** A signed STAT line (ALTER_STAT): stat icon, the GREY sign injected into `pre`, |value| green (buff) /
 * red (debuff). One composite key (`fx_stat: "{{value}} {{stat}}"`) + the `stat.*` names covers every
 * STAT_* id in all 6 locales — never 2 keys × 12 stats. */
const stat_parts = (t, view, signed_value) => {
  const gain = signed_value >= 0
  const s = split_value(t, 'spells.fx_stat', { stat: t(view.key) }, `${Math.abs(signed_value)}${view.unit ?? ''}`)
  return { icon: view.icon, dot: null, tone: gain ? TONE_BUFF : TONE_BAD, ...s, pre: `${s.pre}${gain ? '+' : '-'}` }
}

/** A plain verb sentence line — NO magnitude (the flag-valued kinds), neutral text throughout. */
const sentence_parts = (t, key, params = {}) => ({
  icon: null,
  dot: null,
  tone: TONE_BUFF,
  pre: String(t(key, params)),
  value: null,
  post: '',
})

/**
 * One structured effect line for a fight-spells.json effect — the ONE grammar every spell surface renders.
 * @param {(key: string, params?: object) => string} t
 * @param {{ kind: string, base?: number, damageMin?: number, damageMax?: number, crit_base?: number,
 *   crit_effect?: { damageMin?: number, damageMax?: number }, element?: string, turns?: number, chance?: number,
 *   stat?: number, area_shape?: string, area_size?: number }} fx
 * @returns {EffectLineView}
 */
export const seed_effect_parts = (t, fx) => ({ ...core_parts(t, fx), meta: meta_of(t, fx) })

const core_parts = (t, fx) => {
  switch (fx.kind) {
    case 'DAMAGE':
      return damage_parts(t, fx, 'spells.fx_damage')
    case 'PERCENT_LIFE':
      return damage_parts(t, { ...fx, damageMin: fx.base ?? 0, damageMax: fx.base ?? 0 }, 'spells.fx_percent_life')
    case 'APPLY_DOT':
      return damage_parts(t, fx, 'spells.fx_apply_dot')
    case 'LIFE_STEAL':
      return damage_parts(t, fx, 'spells.fx_life_steal')
    case 'PUNISHMENT':
      return damage_parts(t, fx, 'spells.fx_punishment')
    case 'CASTER_DAMAGE':
      // recoil — the value hurts the caster, so it reads in the penalty red, not the element hue
      return { ...damage_parts(t, fx, 'spells.fx_caster_damage'), tone: TONE_BAD }
    case 'HEAL':
      return {
        icon: 'health',
        dot: null,
        tone: HEAL_PINK,
        ...split_value(t, 'spells.fx_heal', {}, seed_effect_value(t, fx)),
      }
    case 'GIVE_POINTS':
      // AP/MP grants ride the SAME composite grammar as stat buffs (fx_stat + the stat.* name, sign in the
      // grey pre) — exactly +(grey)1(green)AP(grey), one key for every resource and stat.
      return stat_parts(t, POINT_VIEW[fx.stat] ?? POINT_VIEW[0], Math.abs(fx.base ?? 0))
    case 'REMOVE_POINTS':
      return stat_parts(t, POINT_VIEW[fx.stat] ?? POINT_VIEW[0], -Math.abs(fx.base ?? 0))
    case 'STEAL_POINTS': {
      // Point THEFT (drain the target + credit the caster, spell_effect.move K_STEAL_POINTS) — the theft
      // verb carries the direction (spells.fx_steal_ap/mp, 6-locale), penalty red like a drain.
      const view = POINT_VIEW[fx.stat] ?? POINT_VIEW[0]
      const s = split_value(t, fx.stat === 1 ? 'spells.fx_steal_mp' : 'spells.fx_steal_ap', {}, Math.abs(fx.base ?? 0))
      return { icon: view.icon, dot: null, tone: TONE_BAD, ...s }
    }
    case 'ALTER_STAT': {
      // The frontend JSON keeps the generator's SIGNED base (the mint moves the sign into FLAG_NEGATIVE),
      // so the sign here is the honest buff/debuff discriminator.
      const view = STAT_VIEW[fx.stat] ?? { icon: 'raw_damage', key: 'stat.raw_damage' }
      return stat_parts(t, view, fx.base ?? 0)
    }
    case 'STEAL_STAT': {
      const view = STAT_VIEW[fx.stat] ?? { icon: 'raw_damage', key: 'stat.raw_damage' }
      const s = split_value(t, 'spells.fx_steal_stat', { stat: t(view.key) }, Math.abs(fx.base ?? 0))
      return { icon: view.icon, dot: null, tone: TONE_BAD, ...s }
    }
    case 'ALTER_RESIST': {
      const gain = (fx.base ?? 0) >= 0
      // Name the element for a fixed row ("+8 Earth resistance"); a legacy el_none/element-less row falls
      // back to the bare phrasing — honest, never an invented element.
      const named = ELEMENT_KEYS.includes(fx.element)
      const s = named
        ? split_value(t, 'spells.fx_alter_resist_el', { element: seed_el_label(t, fx.element) }, Math.abs(fx.base ?? 0))
        : split_value(t, 'spells.fx_alter_resist', {}, Math.abs(fx.base ?? 0))
      return { icon: null, dot: null, tone: gain ? TONE_BUFF : TONE_BAD, ...s, pre: `${s.pre}${gain ? '+' : '-'}` }
    }
    case 'REDUCE_DAMAGE':
      return { icon: null, dot: null, tone: TONE_BUFF, ...split_value(t, 'spells.fx_reduce_damage', {}, fx.base) }
    case 'REFLECT_DAMAGE':
      return { icon: null, dot: null, tone: TONE_BUFF, ...split_value(t, 'spells.fx_reflect_damage', {}, fx.base) }
    // ── the wave-12 retro statuses (#1049): every kind the per-fighter status home can hold owns an arm here,
    // asserted exhaustively by effect-badge-kind-coverage.test.js — a new status kind with no arm goes RED
    // instead of painting `? 38` on a player's turn card. Semantics: spell_effect.move:76-84.
    case 'DAMAGE_TO_HEAL':
      return sentence_parts(t, 'spells.fx_damage_to_heal')
    case 'NAMED_DAMAGE_STACK':
      return { icon: 'raw_damage', dot: null, tone: TONE_BUFF, ...split_value(t, 'spells.fx_named_damage_stack', {}, fx.base) }
    case 'REACTIVE_PUNISHMENT':
      return { icon: null, dot: null, tone: TONE_BUFF, ...split_value(t, 'spells.fx_reactive_punishment', {}, fx.base) }
    case 'EROSION':
      // value = percent of max HP lost alongside the damage taken — a penalty, so the value reads red.
      return { icon: 'health', dot: null, tone: TONE_BAD, ...split_value(t, 'spells.fx_erosion', {}, `${fx.base ?? 0}%`) }
    case 'DAMAGE_REDIRECT':
      // value 0 = a full redirect to the source; > 0 = that percent reflected at the attacker.
      return (fx.base ?? 0) > 0
        ? { icon: null, dot: null, tone: TONE_BUFF, ...split_value(t, 'spells.fx_damage_redirect_pct', {}, `${fx.base}%`) }
        : sentence_parts(t, 'spells.fx_damage_redirect')
    case 'TIMED_PAYLOAD':
      return sentence_parts(t, 'spells.fx_timed_payload')
    case 'STANCE':
      return sentence_parts(t, 'spells.fx_stance')
    case 'PUSH':
      return { icon: null, dot: null, tone: TONE_BUFF, ...split_value(t, 'spells.fx_push', {}, fx.base) }
    case 'PULL':
      return { icon: null, dot: null, tone: TONE_BUFF, ...split_value(t, 'spells.fx_pull', {}, fx.base) }
    // ── flag-valued kinds: sentences, NO number (base is a placement/flag payload, never a magnitude) ──
    case 'PLACE_TRAP':
      return sentence_parts(t, 'spells.fx_trap')
    case 'PLACE_GLYPH':
      return sentence_parts(t, 'spells.fx_place_glyph')
    case 'TELEPORT':
      return sentence_parts(t, 'spells.fx_teleport')
    case 'SWAP':
      return sentence_parts(t, 'spells.fx_swap')
    case 'CARRY':
      return sentence_parts(t, 'spells.fx_carry')
    case 'THROW':
      return sentence_parts(t, 'spells.fx_throw')
    case 'INVISIBILITY':
      return sentence_parts(t, 'spells.fx_invisibility')
    case 'APPLY_STATE':
      return sentence_parts(t, 'spells.fx_apply_state')
    case 'DISPEL':
      return sentence_parts(t, 'spells.fx_dispel')
    case 'REVEAL':
      return sentence_parts(t, 'spells.fx_reveal')
    case 'RETURN_SPELL':
      return sentence_parts(t, 'spells.fx_return_spell')
    default:
      // LOUD untranslated canary for an unmapped kind (a future reseed) — never a silent blank.
      // spell-coverage.test.js fails on this for the live corpus.
      return { icon: null, dot: null, tone: TONE_BAD, pre: `? ${fx.kind}`, value: null, post: '' }
  }
}

/**
 * The flat-string form — DERIVED from the parts (one grammar). The in-fight dungeon readout + the coverage
 * tests consume this; the grimoire/encyclopedia render the structured parts via <EffectLine>.
 * @param {(key: string, params?: object) => string} t @param {object} fx @returns {string}
 */
export const seed_effect_line = (t, fx) => {
  const p = seed_effect_parts(t, fx)
  return `${p.pre}${p.value ?? ''}${p.post}${p.meta ? ` · ${p.meta}` : ''}`
}
