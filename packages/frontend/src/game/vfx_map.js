// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE FIGHT-VFX CHOREOGRAPHY MAP — the single home for every per-beat presentation decision: which 3D preset
// plays, its world footprint, its travel/anchor class, and (IMPACT_FEEL) the on-land camera shake, screen-flash
// colour, and screen-grade moment. fight_cast_vfx.js (the three.js renderer) reads CAST_VFX/BURST_VFX/BEAT; the
// adapter (voxel_fight_adapter.play_cast) reads IMPACT_FEEL + magnitude_scale for the impact package. TUNING =
// editing a row here, never the renderer.
//
// FLAGSHIP 3D VFX — phase 2 of the sprite-to-3D migration. EVERY fight layer is a GPU-particle
// preset from @aresrpg/engine3/vfx (vfx_presets_data.js / vfx_presets_spell.js), named by `preset_3d`; the sprite
// sheets that played the cast/burst attacks are DELETED. The Godot BinbunVFX packs (Explosion/Hit/Flame/Elemental/
// Electric/DarkMagic/Battle/Status) ARE the spec — each preset transcribes a pack's particle numbers (see the two
// data files). ZERO sprite sheets survive on ANY fight surface — the herald sword-slam (fight_sword.js) plays the
// 3D earth-eruption preset too (ZERO legacy sprite sheets survive on ANY fight surface).
//
// ELEMENT READ (the pack each element ports from):
//   fire    → FlameFX crimson-ember flame              water → ElementalMagicFX ice-blue
//   air     → ElectricFX cyan lightning (skyfall comet) neutral → BattleFX arcane violet (mob/unknown fallback)
//   earth   → gold-loam ground ERUPTION (burst)         death → Necro/DarkMagic soul-green (the KO burst)
//   heal    → Paladin holy gold                          weapon → BattleFX physical-red slash (melee burst)

// Wave B melee/status packs (coordinator rider 2026-07-12): the dedicated ElectricFX air-impact pack + the
// reserved shield-ward / dark-vortex presets, imported from the engine /vfx barrel (these are preset-NAME
// resolvers; the renderer resolves the returned names via PRESETS, same as every other row here).
import { shield_ward_preset, AIR_IMPACT_PRESETS } from '@aresrpg/engine3/vfx'

import { all_variant_names } from './vfx_variants.js'

// ── BEAT SHAPE (seconds) — the master cast clock, one home. The windup plays at the caster, the projectile
// travels the mid-beat, the impact burst lands on the SAME instant the board's damage float + SFX resolve. ──
export const BEAT = {
  flare_s: 0.45, //   windup gather at the caster
  travel_s: 0.55, //  projectile flight caster → target (≈ the board's hit-beat frame, so they coincide)
  impact_s: 0.5, //   impact burst at the target
  arc_h: 1.4, //      metres the orb bows upward at mid-flight (a lobbed cast, not a flat laser)
  sky_h: 10, //       metres a SKY-FALL projectile spawns above the target (meteor-class; air's comet DELIVERY)
  ground_drop: 1.2, // chest→feet drop, so a ground-anchored burst erupts from the target's feet
}

// ── 3D PRESET ASSIGNMENT — the impact/impact_big layers play a SHARED hit/explosion library preset (not
// element-coloured), so a per-element `tint` recolours them (tint_emitter keeps white-hot cores white). The
// charge/bolt/remnant/burst layers name an already-element-coloured preset inline below (no tint). The
// shake/flash/SFX package is UNCHANGED — it keys off the beat, not the art. ──
const hex_rgb = (/** @type {number} */ h) =>
  /** @type {[number,number,number]} */ ([((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255])
/** element → { impact: Hit-pack preset, impact_big?: Explosion-pack preset, tint: hex } */
// Tints saturated to the PACK's authored element colours (paler previews read washed out): fire =
// FlameFX orange-red · water = ElementalMagicFX cyan (impact_03 light_color) · air = ElectricFX white-cyan
// LIGHTNING (was a violet that fought its own cyan windup — now consistent) · neutral = BattleFX arcane violet ·
// heal = Paladin holy gold. tint_emitter keeps the white-hot light bloom white; only the coloured body takes it.
const IMPACT_3D = {
  fire: { impact: 'impact_05', impact_big: 'ground_explosion_01', tint: 0xff6a3d },
  water: { impact: 'impact_03', impact_big: 'ground_explosion_00', tint: 0x55d8ff },
  // AIR now plays the DEDICATED ElectricFX impact pack (Wave B) instead of the shared impact_07/nuke: a cyan
  // lightning discharge on a normal hit, a different pack index on the heavy hit. NOTE (verified): the 6
  // air_impact_pack_* are COLOUR/type variants (lightning ×4 + plasma ×2), NOT size tiers — [3] is a colour
  // pick per the coordinator's adjudication, not a "bigger" one; a future pass may prefer keeping a huge explosion
  // for the heavy-hit read (a one-line swap of impact_big). Both take air's cyan tint below.
  air: { impact: AIR_IMPACT_PRESETS[0], impact_big: AIR_IMPACT_PRESETS[3] ?? AIR_IMPACT_PRESETS[0], tint: 0x8fd8ff },
  neutral: { impact: 'impact_07', tint: 0xa762ff }, // neutral has no impact_big row
  heal: { impact: 'impact_01', impact_big: 'big_impact_01', tint: 0xffd070 }, // a gentle gold bloom, not a violent blast
}
const impact_preset = (/** @type {keyof typeof IMPACT_3D} */ element, /** @type {'impact'|'impact_big'} */ layer) => {
  const row = IMPACT_3D[element]
  return { preset: row[layer], tint: hex_rgb(row.tint) }
}

// ── FULL-BEAT (PROJECTILE-CLASS) ELEMENTS — the 5-LAYER CAST (attack anim, a cell-shake, a sky-drop delivery,
// the impact explosion, and a lingering colored mana remnant). ONE cast composes up to FIVE optional layers on
// the master beat clock, all data-driven
// from the row — fight_cast_vfx.cast_vfx sequences them, the map only says WHAT (each `preset_3d` names a 3D
// GPU-particle preset):
//   1. CASTER-CELL  `caster_cell` — a ground charge pulse UNDER the caster during the windup (the cell reacts).
//   2. WINDUP       `windup`      — the gathering-energy charge at the caster (always present).
//   3. DELIVERY     `delivery`+`orb` — the moving projectile. `'skyfall'` is now the STANDARD for EVERY spell
//                                    cast: the orb spawns
//                                    HIGH above the target (BEAT.sky_h) and falls fast onto the target cell. `'arc'`
//                                    (a bowed caster→target lob) is still supported by the renderer but no house
//                                    element uses it — flip a row back to `'arc'` to opt one spell out of the drop.
//                                    A projectile-LESS cast is a BURST_VFX row (impact-only, e.g. the MELEE weapon
//                                    slash + earth eruption — a sword strike stays a direct hit, never a sky drop).
//   4. IMPACT       `impact`(/`impact_big`) — the explosion at the target on the land (always present).
//   5. REMNANT      `remnant` — a lingering element residue LOOP on the TARGET cell that self-disposes over
//                               `duration_s` (~2–3 s). Decorative rising motes — must NOT read as a gameplay glyph.
// `m` = base footprint (world metres; the 3D path derives its particle scale from it); `anchor` = 'chest' (held at
// body height) | 'ground' (base on the feet, erupts up). `preset_3d` = { preset, tint? } — a name into PRESETS, the
// optional element tint recolours a SHARED library preset (impact/impact_big); the charge/bolt/remnant presets are
// already element-coloured (no tint). ──
export const CAST_VFX = {
  fire: {
    caster_cell: { preset_3d: { preset: 'charge_fire' }, m: 2.4 },
    windup: { preset_3d: { preset: 'charge_fire' }, m: 3.4, anchor: 'chest' },
    delivery: 'skyfall', // a meteor DROPS onto the target from the sky
    orb: { preset_3d: { preset: 'bolt_fire' }, m: 1.9 },
    impact: { preset_3d: impact_preset('fire', 'impact'), m: 4.6, anchor: 'ground' }, // impact_05
    impact_big: { preset_3d: impact_preset('fire', 'impact_big'), m: 6.0, anchor: 'ground' },
    remnant: { preset_3d: { preset: 'remnant_fire' }, m: 2.6, duration_s: 2.4 },
  },
  water: {
    caster_cell: { preset_3d: { preset: 'charge_water' }, m: 2.4 },
    windup: { preset_3d: { preset: 'charge_water' }, m: 2.6, anchor: 'ground' },
    delivery: 'skyfall', // an ice shard falls from the sky onto the target
    orb: { preset_3d: { preset: 'bolt_water' }, m: 1.5 },
    impact: { preset_3d: impact_preset('water', 'impact'), m: 4.0, anchor: 'ground' },
    impact_big: { preset_3d: impact_preset('water', 'impact_big'), m: 5.5, anchor: 'ground' },
    remnant: { preset_3d: { preset: 'remnant_water' }, m: 2.8, duration_s: 2.6 },
  },
  air: {
    caster_cell: { preset_3d: { preset: 'charge_air' }, m: 2.5 },
    windup: { preset_3d: { preset: 'charge_air' }, m: 2.6, anchor: 'chest' },
    delivery: 'skyfall', // the spell falls from the sky: the comet DROPS onto the target from BEAT.sky_h up
    orb: { preset_3d: { preset: 'bolt_air' }, m: 1.7 },
    impact: { preset_3d: impact_preset('air', 'impact'), m: 4.0, anchor: 'ground' },
    impact_big: { preset_3d: impact_preset('air', 'impact_big'), m: 5.5, anchor: 'ground' },
    remnant: { preset_3d: { preset: 'remnant_air' }, m: 2.8, duration_s: 2.6 },
  },
  neutral: {
    caster_cell: { preset_3d: { preset: 'charge_neutral' }, m: 2.4 },
    windup: { preset_3d: { preset: 'charge_neutral' }, m: 2.4, anchor: 'ground' },
    delivery: 'skyfall', // a chaos bolt drops from the sky onto the target
    orb: { preset_3d: { preset: 'bolt_neutral' }, m: 1.4 },
    impact: { preset_3d: impact_preset('neutral', 'impact'), m: 3.8, anchor: 'chest' },
    // neutral has no impact_big row (a physical/unknown hit never swaps to the big explosion)
    remnant: { preset_3d: { preset: 'remnant_neutral' }, m: 2.6, duration_s: 2.2 },
  },
  heal: {
    caster_cell: { preset_3d: { preset: 'charge_heal' }, m: 2.4 },
    windup: { preset_3d: { preset: 'charge_heal' }, m: 2.2, anchor: 'ground' },
    delivery: 'skyfall', // holy light descends from the sky onto the target
    orb: { preset_3d: { preset: 'bolt_heal' }, m: 1.4 },
    impact: { preset_3d: impact_preset('heal', 'impact'), m: 3.6, anchor: 'ground' },
    impact_big: { preset_3d: impact_preset('heal', 'impact_big'), m: 4.8, anchor: 'ground' },
    remnant: { preset_3d: { preset: 'remnant_heal' }, m: 2.6, duration_s: 2.0 },
  },
}

// ── BURST (IMPACT-ONLY) ELEMENTS — a single anchored 3D preset at the strike cell, NO windup/projectile.
// `contact_s` = the wait before it spawns: BEAT.travel_s (the swing/gesture beat still reads first) or 0
// (death fires the frame the kill lands). The earth eruption preset doubles as the herald sword-slam (fight_sword.js). ──
export const BURST_VFX = {
  earth: {
    preset_3d: { preset: 'eruption_earth' },
    m: 4.0,
    contact_s: BEAT.travel_s,
    anchor: 'ground',
  },
  death: {
    preset_3d: { preset: 'soul_death' },
    m: 3.4,
    contact_s: 0,
    anchor: 'ground',
  },
  weapon: {
    preset_3d: { preset: 'slash_weapon' },
    m: 3.2,
    contact_s: BEAT.travel_s,
    anchor: 'chest',
  },
}

/** Full-beat cast elements (own windup+orb+impact preset). Anything else NORMALISES to 'neutral' so a water/air
 *  spell still gets a clean beat until its own art lands — here, all five house elements have art, so the
 *  fallback only catches unknown/mob ids. @param {string} el */
export const asset_element = (el) => (el in CAST_VFX ? el : 'neutral')

/** Whether `element` renders as an impact-only BURST (BURST_VFX) instead of the full cast beat — the adapter's
 *  routing verdict, owned HERE so art coverage and routing never drift. @param {string} el */
export const is_burst_element = (el) => el in BURST_VFX

// ── DELIVERY-LAYER ROUTING (b_spell) — a per-spell variant preset (vfx_variants.variant_for) is NOT always a
// traveling orb: the naming carries WHICH cast layer it belongs on, so a ground zone never rides the projectile
// and a skyfall strike never masquerades as an orb. Classify by the name suffix (mirrors the vfx_variants families;
// the merge-drift test pins the full name set): a `*_area` / `*_zone_*` decal → the GROUND layer on the target
// cell; an `air_zap_strike_*` → the delivery STRIKE beat at impact; everything else → the traveling ORB (today's
// default). One home for the routing, same law as is_burst_element. Pure — unit-tested. ──
/** The cast layer a variant preset belongs on: 'zone' (ground decal on the target cell) | 'strike' (impact-beat
 *  delivery burst) | 'orb' (the traveling projectile — the default, incl. an empty/unmapped name).
 *  @param {string|null|undefined} name a variant_for() preset name */
export const variant_layer = (name) =>
  !name ? 'orb' : /_area$|_zone_/.test(name) ? 'zone' : /_strike_/.test(name) ? 'strike' : 'orb'

// ── MOB ELEMENT (phase-2 fix): a mob's basic attack isn't in the seed spellbook, so element_of_spell reads
// 'neutral' and EVERY mob cast fell back to the neutral violet (every dungeon mob looked the same).
// The mob's REAL element is its on-chain DungeonMob.element discriminant (0=fire 1=water 2=earth 3=air; 255/none
// → neutral — the ONE encoding rpc/views.ts + seed-effect-line.js + DeckCluster.jsx already agree on). ──
/** Element discriminant code → element name; anything outside 0..3 (incl. 255=none) reads neutral.
 *  @param {number|null|undefined} code */
export const ELEMENT_CODE_NAMES = /** @type {const} */ (['fire', 'water', 'earth', 'air'])
export const element_from_code = (/** @type {number|null|undefined} */ code) =>
  (code != null && ELEMENT_CODE_NAMES[code]) || 'neutral'

/** The VFX/SFX element for a cast: the spell's own element when it resolves, else — for a MOB caster whose basic
 *  attack isn't in the seed spellbook (element reads 'neutral') — the mob's OWN element code, so a fire/water/
 *  earth/air mob casts ITS element's VFX+SFX instead of the neutral fallback. weapon/heal are never 'neutral' ⇒
 *  they pass straight through untouched. Pure — unit-tested. @param {string} spell_element
 *  @param {number|null|undefined} mob_element_code the caster mob's DungeonMob.element (undefined for a non-mob) */
export const resolve_cast_element = (spell_element, mob_element_code) =>
  spell_element === 'neutral' && mob_element_code != null ? element_from_code(mob_element_code) : spell_element

// ── HEAVY-HIT IMPACT SWAP — a big nuke lands a BIGGER explosion. `impact_big` is an OPTIONAL per-element row
// (fire/water/air/heal ship one; neutral falls back to `impact`). The swap fires when the magnitude curve
// (magnitude_scale, TARGET-HP-RELATIVE — see MAG_HP_FRACTION) crosses IMPACT_BIG_AT — no per-frame growth, just a
// bigger preset + footprint. Relative ⇒ level-agnostic: a hit ≥~37% of the STRUCK TARGET's max HP crosses it at
// level 1 exactly as at level 100. fight_cast_vfx.spawn_impact reads this ONE selector so coverage + routing stay here. ──
export const IMPACT_BIG_AT = 1.25 // magnitude_scale multiplier (≈37%+ of the target's max HP) at/above which the big preset wins
/** The impact stage for a cast: the heavier `impact_big` on a big hit (magnitude ≥ IMPACT_BIG_AT), else the
 *  standard `impact`. Pure; a row without `impact_big` always falls back. @param {{ impact: object,
 *  impact_big?: object }} prof @param {number} magnitude the magnitude_scale multiplier (0.8–1.6) */
export const resolve_impact = (prof, magnitude) =>
  prof.impact_big && magnitude >= IMPACT_BIG_AT ? prof.impact_big : prof.impact

// ── PREWARM (D3 / the D221 terrain-prewarm class): the DISTINCT 3D presets a fight of these elements can mount —
// every cast layer's {preset, tint} + every burst preset. The renderer compiles these pipelines at fight-enter
// (under the intro beat, before any cast) so the first cast never eats the ~290ms first-draw GPU pipeline compile
// (mechanically confirmed as WebGPU pipeline compilation, zero JS longtask). Pure — one home for "what a fight
// can play"; the tint is part of the key because a tinted preset bakes different colour nodes ⇒ its own pipeline. ──
// THE COMPLETE CASTABLE UNIVERSE — every element a fight of ANY composition can mount. The caller can't
// know the PLAYER's spellbook elements at board-build time (a fire mage vs earth mobs would leave 'fire'
// cold → the first fire cast eats its ~290ms pipeline compile as a visible freeze). Warming this whole
// set at fight-enter (≈28 distinct pipelines, under the intro beat) is the guarantee: no castable preset
// is ever compiled on a live cast. Cheap + bounded — the union of the two choreography tables.
export const ALL_CAST_ELEMENTS = /** @type {string[]} */ ([...Object.keys(CAST_VFX), ...Object.keys(BURST_VFX)])

// FIRST-CAST-CRITICAL layers come FIRST (the first vfx used to still freeze): prewarm_fight_vfx
// mounts only a FEW presets per rAF (it can't compile all ~28 in one frame without re-introducing the
// fight-START hitch), so the emit ORDER here IS the compile priority. A cast's visible first beat is
// windup → orb → impact (+ the earth/death/weapon impact-only bursts); if those aren't at the HEAD of the
// list a fast player cast can beat its OWN element to the compile (the exact freeze). The SECONDARY layers —
// caster_cell (shares the windup's charge preset, so already warm), impact_big (heavy hits only) and the
// lingering remnant — trail behind, compiling once every element's core cast is already warm.
const PREWARM_CORE_LAYERS = /** @type {const} */ (['windup', 'orb', 'impact'])
const PREWARM_TAIL_LAYERS = /** @type {const} */ (['caster_cell', 'impact_big', 'remnant'])

/** @param {Iterable<string>} elements element names present in the fight (default: ALL_CAST_ELEMENTS)
 *  @returns {{ preset:string, tint?:[number,number,number] }[]} distinct preset specs, deduped by (preset+tint),
 *  ORDERED first-cast-critical → secondary (the mount order = the compile priority; see the note above) */
export function prewarm_specs(elements) {
  /** @type {Map<string, { preset:string, tint?:[number,number,number] }>} */
  const out = new Map()
  const add = (/** @type {any} */ spec) => {
    if (spec?.preset)
      out.set(spec.preset + (spec.tint ? '#' + spec.tint.join(',') : ''), { preset: spec.preset, tint: spec.tint })
  }
  const els = [...new Set(elements)]
  const cast_els = els.filter((el) => !is_burst_element(el))
  // 1) impact-only bursts (earth/death/weapon) — they ARE their element's whole first beat, warm them first.
  for (const el of els) if (is_burst_element(el)) add(BURST_VFX[el].preset_3d)
  // 2) every element's CORE cast beat (windup → orb → impact) — what any first projectile cast needs on screen.
  for (const layer of PREWARM_CORE_LAYERS) for (const el of cast_els) add(CAST_VFX[asset_element(el)][layer]?.preset_3d)
  // 3) the secondary layers, once the whole board of first casts is already covered.
  for (const layer of PREWARM_TAIL_LAYERS) for (const el of cast_els) add(CAST_VFX[asset_element(el)][layer]?.preset_3d)
  // 4) [b_spell 2026-07-13] EVERY per-spell VARIANT preset (vfx_variants.all_variant_names — the orb/zone/strike
  //    swaps variant_for routes per spell). The element beats above were warm but every first MAPPED cast still
  //    mounted a cold variant pipeline — still a source of freezes during fight vfx. +32 names
  //    (untinted — variants are pre-coloured), amortised like the rest (PREWARM_PER_FRAME), all behind the
  //    fight-start intro hold. Ordered AFTER the element cores: a variant only mounts where its element beat
  //    already covers the first visible frame.
  for (const name of all_variant_names()) add({ preset: name })
  return [...out.values()]
}

// ── IMPACT FEEL — the on-land presentation package the adapter fires (voxel_fight_adapter.impact_package):
// `shake` = base camera-shake magnitude (× the magnitude curve, × 1.4 on a crit); `flash` = the screen-edge
// vignette pulse colour (matches what the player SEES — the VFX read, which is why air/neutral are violet not
// the house sage/steel); `grade` = a brief full-screen grade moment: 'desaturate' (a death blow drains colour),
// 'warm' (a heal glows warm), or null. Big AoE (≥3 struck cells) upgrades to an element-colour edge wash in the
// adapter. All flashes/grades are cheap CSS pulses on the vignette layer — NO post-process pass.
// [2026-07-11 fight-feel retune, fixes too little camera shake] every non-heal base is ~1.6× its prior value: the
// camera's add_shake ceiling is a HARD 1.0 (embed_voxel_fight_camera.js), and even a crit-nuke used to peak ≈0.76
// of it — this retune (paired with the target-relative magnitude_scale) lands a routine LV1 hit at ≈40% of the
// ceiling (was ≈20%) and a crit/nuke well past 70%, never touching the camera file itself. ──
export const IMPACT_FEEL = {
  // flash colours track the VFX tints above (matches what the player SEES) — saturated to the pack palette.
  fire: { shake: 0.36, flash: '#ff6a3d', grade: null },
  water: { shake: 0.26, flash: '#55d8ff', grade: null },
  earth: { shake: 0.42, flash: '#c2a05e', grade: null }, // a ground eruption lands heaviest of the elements
  air: { shake: 0.26, flash: '#8fd8ff', grade: null },
  neutral: { shake: 0.24, flash: '#a762ff', grade: null },
  heal: { shake: 0.06, flash: '#ffd070', grade: 'warm' }, // gentle, a heal never jolts
  death: { shake: 0.48, flash: '#5fe39a', grade: 'desaturate' }, // the KO — the world briefly drains
  weapon: { shake: 0.32, flash: '#dc6058', grade: null },
}

const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
  Math.min(hi, Math.max(lo, v))

/** Magnitude-aware read: a bigger hit reads bigger (the floating-number "nuke > jab" idea). Soft log ramp on
 *  amount/reference → a size+shake multiplier: ratio 0 (optimistic cast) ≈0.85×, ratio 1 ≈1.0×, ratio ≈5.3
 *  ≈1.25× (IMPACT_BIG_AT), ratio ≈30.6 clamps at MAG_MAX. `reference` defaults to the legacy absolute 40 (a
 *  heal / no-target beat keeps the original mid-game-tuned curve); the adapter passes a TARGET-RELATIVE
 *  reference (max_health × MAG_HP_FRACTION) for damage beats, so a LV1 fight's small absolute numbers still climb
 *  the SAME curve a triple-digit hit does. Applied to BOTH the VFX footprint and the shake. Pure — unit-tested.
 *  @param {number} amount @param {number} [reference] */
export const MAG_MIN = 0.8
export const MAG_MAX = 1.6
const MAG_REF_DEFAULT = 40 // legacy absolute reference — heals / no-resolvable-target beats only
export const magnitude_scale = (amount, reference = MAG_REF_DEFAULT) =>
  clamp(0.85 + 0.5 * Math.log10(1 + Math.max(0, amount || 0) / Math.max(1, reference)), MAG_MIN, MAG_MAX)

// The fraction of a STRUCK TARGET's max HP that anchors its relative magnitude reference (reference =
// max_health × MAG_HP_FRACTION, fed to magnitude_scale). Tuned so a hit at/above ~37% of the target's max HP
// crosses IMPACT_BIG_AT — a LV1 12-damage crit on a 31-HP mob (38.7%) swaps to the big explosion without touching
// IMPACT_BIG_AT itself: one curve for every level bracket.
export const MAG_HP_FRACTION = 0.07

// ── RESERVED PRESET FAMILIES — 3D LOOP presets NOT wired to the one-shot beat, pre-sorted into the semantic slots
// the fight system will grow into — explosions for impacts, a halo for traps/glyphs, a title status effect.
// Each entry NAMES a persistent LOOP preset in PRESETS (vfx_presets_spell.js) — the same 3D
// runtime the cast beat uses. NO renderer is built here; a future lane consumes these directly. (Phase 2 replaced
// the old sprite-sheet catalogs with these preset names so no reserved sheet survives.) ─────────────────────────

// TITLE AURA / TRAIL — an equip-driven PERSISTENT emitter on the world + fight avatar: when a TITLE is equipped, an
// `aura` LOOP orbits the character and a `trail` LOOP drops a fading copy on movement. Seam = the avatar rig — an
// equip-driven emitter, NOT the cast beat.
export const TITLE_AURA = {
  auras: ['status_holy', 'status_arcane', 'status_soul', 'status_ice', 'status_dark', 'status_void'],
  trails: ['status_arcane'],
}

// ── TRAP / GLYPH BOARD DECALS: persistent cell-anchored decals that stay on the fight
// board until triggered/expired (spell_board::place_trap / place_glyph carry area_shape/area_size). TWO LAYERS:
//   • LAYER 1 (mandatory, readability-first) — the affected CELLS as SQUARED cell blobs on the grid so the zone
//     reads instantly, trap vs glyph a distinct element-tinted base. This REUSES the board_highlights cell-quad
//     machinery (@aresrpg/engine3 tactical/board_highlights.js CHANNELS — the same rounded-rect wash the move-
//     range/AoE highlights paint). `cell_channel` names the interim board_highlights channel per kind until
//     dedicated element-tinted `trap`/`glyph` channels + the voxel_fight_adapter paint-call land (the DECLARED
//     FOLLOW-UP — outside the VFX fence: add CHANNELS.trap/glyph + an adapter paint keyed off the on-chain
//     trap/glyph objects; one-line hook per layer).
//   • LAYER 2 (subtle, on top) — a persistent pack-sourced ground LOOP (engine ground_decal_preset): a fire trap
//     smoulders, an arcane glyph glows a rune circle. SUBTLE by construction (low emission, sustained halo
//     ceiling ⇒ never blooms). `trap.<element>` / `glyph.<type>` name the 3D LOOP preset the adapter mounts on
//     the zone centre. ONE home so art coverage + routing never drift.
export const TRAP_GLYPH_VFX = {
  // LAYER 1 — the interim board_highlights channel per kind (reuse the existing washes until dedicated
  // element-tinted trap/glyph channels land; the adapter paints the struck cells here). Readability-first.
  cell_channel: { trap: 'aoe', glyph: 'target' },
  // LAYER 2 — the subtle ground LOOP presets, element/type-tinted (all persistent LOOPs under the halo ceiling).
  trap: { fire: 'trap_fire', water: 'trap_water', air: 'trap_air', earth: 'trap_earth' },
  glyph: { arcane: 'glyph_arcane', holy: 'glyph_holy', dark: 'glyph_dark', nature: 'glyph_nature' },
}

// STATUS — persistent character-anchored blooms/loops for the future status system: a shield bloom on a buff, a
// poison drip/vortex on a debuff. Reserved presets + reads; the status renderer is a later lane.
export const STATUS_VFX = {
  // + the Wave B BattleFX shield-ward bloom (shield / reflect / buff_stat roles) — a big neutral ward is the
  // representative entry; the future status renderer resolves shield_ward_preset(element, tier) per fighter.
  buff: ['status_holy', 'status_arcane', shield_ward_preset('neutral', 2)],
  debuff: ['status_poison', 'status_nature', 'status_dark'],
}

// SUMMON — transform/manifest LOOP presets for a future pet/minion summon beat.
// NOTE: the Wave B DARK_VORTEX_PRESETS are ONE-SHOT bursts, NOT loops — SUMMON_VFX is a LOOP-only shelf (the
// vfx_map test enforces it), so the vortex pack does NOT belong here (a pull vortex isn't a persistent summon
// aura). It needs a burst/pull shelf, which doesn't exist yet — deferred to the melee lane / a follow-up.
export const SUMMON_VFX = ['status_soul', 'status_dark']
