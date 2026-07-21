// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fight — the game-core EDGE of the fight system. The `state.fight` MIRROR IS DEAD (ratified:
// the copy folded through game.js's ASYNC action pump, so every HUD read lagged the core ≥1
// dispatch cycle — the AP-desync / "two systems fighting" root). Fight truth now has ONE home
// (fight/store.js) and ONE read surface (fight/project.js `use_fight_view`/`fight_view` — synchronous).
// What remains here is exactly the edge work a game-core module owns:
//   · observe(): pump the sui roster into the core's ctx (display names — one home, ctx.roster), flip
//     `action/fight_mode` on the fight's null↔non-null EDGE (player.js folds it), and drive the D111
//     combat-music bed — effects at the edges, zero state copies.
//   · the spell-card/element seed lookups, the real-time combat-log composers (emit_*), the
//     WEAPON_ATTACK_* sentinel, and the arm/spectator helpers (all writing through the core's input() door).

import { set_combat } from '../audio/ambient_music.js'
import { combat_music_active } from '../../../fight-engine/combat_music.js'
import { game_log } from '../../../core/log.js'
import i18n from '../../../i18n'

import { CHANNEL } from './chat.js'
import { fight_spell, fight_spells_data } from '../../screens/hud/fight-spells.js'
import { resolve_character_docs, missing_roster_character_ids } from '../../../world-shell/character_name_resolve.js'
import { fight_store } from '@aresrpg/fight/store'
import { fight_view } from '@aresrpg/fight/project'

// The live chain corpus, normalized through @aresrpg/sim by fight-spells' door — keyed by armed name_key AND
// template_id. LIVE (a function, not a module-load const): the corpus loads async as a runtime blob
// (game/data/spell_corpus.js), so a captured snapshot would freeze empty before it arrives. Memoized on the
// projected-rows reference (changes only on (re)load) so reads stay O(1).
let templates_for = null
let templates_map = new Map()
export function spell_templates() {
  const spells = fight_spells_data.spells
  if (spells === templates_for) return templates_map
  templates_for = spells
  templates_map = new Map(
    spells.filter((spell) => spell.template).flatMap((spell) => [[spell.name_key, spell.template], [spell.template_id, spell.template]])
  )
  return templates_map
}

/**
 * Resolve a hand card's display + targeting info. MVP: every player spell is level 1, so we read
 * levels[0]. Tolerant of unknown ids (renders a neutral slot). `crit_rate` (1-in-X; 0 = never) +
 * `life.crit_value` (the crit-swapped base) feed the §7 turn-seed crit preview (deck-crit-glow.js).
 * @param {string} spell_id
 * @returns {{ id: string, name: string, icon: string, cost: number, mp: number, range: [number, number], level: import('@aresrpg/sim').SpellLevel | null, spell_level: number, crit_rate: number, life: { value: number, kind: 'damage' | 'heal', crit_value: number } | null }}
 */
// The hand always holds a class starter at RANK 1: the on-chain `learn` sets level 1 and MVP applies no
// upgrades (spellbook-data.grimoire likewise reports current_level 1 for every unlocked spell). Surfaced on
// the deck box as its "Lv" so the label already reflects the rank once spell upgrades wire through.
const HAND_SPELL_RANK = 1

/**
 * The LIFE swing a spell surfaces on its deck box (D249): the FIRST health-changing effect only — a DAMAGE
 * effect's fixed `base` (a trap's DAMAGE payload counts as its damage), or a HEAL's amount. Buff / control /
 * utility spells carry no life impact and return null (the box then shows only its AP cost). Seed taxonomy.
 * `crit_value` = the same line's CRIT-swapped base (the chain's effects_for(true) list, folded per-effect as
 * `crit_base` by the seed projection) — the §7 "next hit" preview when the slot crits. Traps resolve on board
 * ticks (deterministic, never crit) and rows without a crit line honestly fall back to the base.
 * @param {{ effects?: Array<{ kind?: string, base?: number, crit_base?: number, amount?: number, payload?: { base?: number } }> } | null | undefined} level
 * @returns {{ value: number, kind: 'damage' | 'heal', crit_value: number } | null}
 */
function seed_life(level) {
  for (const fx of level?.effects ?? []) {
    if (fx.kind === 'DAMAGE') return { value: fx.base ?? 0, kind: 'damage', crit_value: fx.crit_base ?? fx.base ?? 0 }
    if (fx.kind === 'PLACE_TRAP') {
      const base = fx.payload?.base ?? 0
      return { value: base, kind: 'damage', crit_value: base }
    }
    if (fx.kind === 'HEAL') {
      const base = fx.base ?? fx.amount ?? 0
      return { value: base, kind: 'heal', crit_value: fx.crit_base ?? base }
    }
  }
  return null
}

/**
 * Normalized-chain twin of seed_life. A SPELL_TEMPLATES level carries a min/max damage
 * roll, so surface the top end as the box's single life figure (no chain crit list → crit_value = value).
 * @param {{ base_effects?: Array<{ type?: string, min?: number, max?: number }> } | null | undefined} level
 * @returns {{ value: number, kind: 'damage' | 'heal', crit_value: number } | null}
 */
function template_life(level) {
  for (const fx of level?.base_effects ?? []) {
    const value = fx.max ?? fx.min ?? 0
    if (fx.type === 'DAMAGE') return { value, kind: 'damage', crit_value: value }
    if (fx.type === 'HEAL') return { value, kind: 'heal', crit_value: value }
  }
  return null
}

/** Localize an on-chain spell name if a `spells.spell_<key>` key exists, else keep the on-chain name (never a
 * broken raw key for an un-localized seeded spell — the chain name is the single source). @param {any} chain */
const chain_spell_name = (chain) => {
  const key = `spells.spell_${chain.name_key}`
  const translated = i18n.t(key)
  return translated === key ? chain.name : translated
}

export function spell_card(spell_id) {
  // ON-CHAIN fight spell FIRST: display facts + level-1 AP/range come straight from the chain corpus projection.
  const chain = fight_spell(spell_id)
  if (chain) {
    const l1 = chain.levels?.[0] ?? {}
    return {
      id: spell_id,
      name: chain_spell_name(chain),
      icon: chain.name_key, // /spells/<key>.png — the tinted-letter fallback covers missing art (D53)
      cost: l1.ap ?? 0,
      mp: l1.mp ?? 0,
      range: l1.range ?? [0, 0],
      level: null,
      spell_level: HAND_SPELL_RANK,
      crit_rate: l1.crit_rate ?? 0, // 1-in-X off the chain SpellLevel (0 = never) — the §7 crit-glow input
      life: seed_life(l1),
    }
  }
  // Raw-id callers can still resolve the same normalized chain map; an unknown id gets the neutral card below.
  const template = spell_templates().get(spell_id)
  const level = template?.levels[0] ?? null
  return {
    id: spell_id,
    name: template?.name ?? spell_id,
    icon: spell_id,
    cost: level?.cost ?? 0,
    mp: level?.mp ?? 0,
    range: level?.range ?? [0, 0],
    level,
    spell_level: HAND_SPELL_RANK,
    crit_rate: level?.critical_chance ?? 0,
    life: template_life(level),
  }
}

/**
 * The primary damage element of a spell (for floating-number coloring — pure render, the wire SpellEffect
 * carries no element). Reads the first DAMAGE base-effect's element off the level-1 template; null when the
 * spell heals or is non-elemental. The sim's normalized element is UPPERCASE ('FIRE'|'WATER'|'EARTH'|'AIR').
 * @param {string} spell_id
 * @returns {'FIRE' | 'WATER' | 'EARTH' | 'AIR' | null}
 */
export function spell_element(spell_id) {
  const chain = fight_spell(spell_id)
  if (chain) {
    const dmg = (chain.levels?.[0]?.effects ?? []).find((e) => e.kind === 'DAMAGE')
    return /** @type {any} */ (dmg?.element ? String(dmg.element).toUpperCase() : null)
  }
  const level = spell_templates().get(spell_id)?.levels[0]
  const dmg = level?.base_effects.find((e) => e.type === 'DAMAGE')
  return /** @type {any} */ (dmg?.element ?? null)
}

// COSMETIC-ONLY cast ids the dungeon driver synthesises from on-chain hp deltas — no deck template, so
// spell_card() falls back to the RAW SLUG (chain jargon, D14). Translated display names; any other unknown
// id is humanised, so a slug can NEVER leak.
const COSMETIC_SPELL_NAMES = /** @type {const} */ ({
  dungeon_strike: { key: 'combat_log.spell_strike', en: 'Strike' },
  mob_attack_dungeon: { key: 'combat_log.spell_mob_attack', en: 'Attack' },
})

/** A spell's PLAYER-FACING display name — never a raw slug. @param {string} spell_id @returns {string} */
function spell_display_name(spell_id) {
  const template = spell_templates().get(spell_id)
  if (template?.name) return template.name
  const cosmetic = COSMETIC_SPELL_NAMES[/** @type {keyof typeof COSMETIC_SPELL_NAMES} */ (spell_id)]
  if (cosmetic) return i18n.t(cosmetic.key, { defaultValue: cosmetic.en })
  return spell_id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * The post-fight summary recap (winner, participants, duration, xp, loot) for the end-of-fight modal.
 * @typedef {object} FightSummary
 * @property {number} winner    winning team (0 / 1)
 * @property {{ id: string, name: string, team: number, level: number, is_player: boolean, alive: boolean }[]} participants
 * @property {number} duration_ms
 * @property {number} xp
 * @property {{ item_type: string, amount: number }[]} loot
 */

// Combat-log line ids: a monotonic client counter (presentation only — NOT sim state, so a plain counter
// is fine and avoids Date.now/Math.random). Each landed cast appends a context line + one colour-coded
// damage/heal line per affected target (emit_cast_log), then a death line for anyone it killed.
let combat_log_seq = 0

/**
 * One TOKEN run of a combat-log line. `cls` is a token class (clog-name / clog-verb / clog-target /
 * clog-spell / clog-num …) whose colour + weight live in the theme (tokens.css → --clog-* / hud.css), so
 * design retunes the whole palette in one place. `ref`, when set, is the fighter/participant id this segment
 * NAMES (caster/target/death) — the renderer (WorldChat.jsx `resolve_segment_text`) prefers the LIVE fighters
 * map over `text` at render time, so a name that resolves AFTER this line was emitted (mob identity async
 * resolve racing the fight's first hit — the dungeon_store `_resolve_mob_identities` race) heals every past
 * line referencing it on the very next render. `text` stays the AT-EMIT-TIME best guess, used verbatim once
 * the fighter is gone (fight ended) — never worse than the old snapshot-forever behaviour.
 * @typedef {{ text: string, cls?: string, ref?: string }} LogSegment
 */

/**
 * Split an i18n-RESOLVED template string into coloured LogSegments by locating each named value inside it —
 * greedily claims whichever remaining token's text occurs EARLIEST at-or-after the current cursor, so the
 * TEMPLATE's own word order (a translation is free to reorder "hit {{target}} for {{amount}}" however that
 * locale's grammar wants — French/German/Japanese all do) never has to match the order `tokens` is passed in.
 * Advancing the cursor past each claimed match also disambiguates repeated identical values (a caster healing
 * itself: `caster` and `target` resolve to the SAME name text — the second occurrence, not the first, wins the
 * second token). Unmatched text between/around claimed tokens renders `fallback_cls` (connective prose); a
 * token whose value a translation dropped entirely just never gets its own coloured span — never throws.
 * @param {string} resolved  i18n.t(...) output, already interpolated
 * @param {{ value: string, cls: string, ref?: string }[]} tokens  one entry per named placeholder
 * @param {string} [fallback_cls]  class for the unclaimed connective text (default 'clog-verb')
 * @returns {LogSegment[]}
 */
const segment_template = (resolved, tokens, fallback_cls = 'clog-verb') => {
  const remaining = tokens.filter((t) => t.value)
  const hits = []
  let cursor = 0
  while (remaining.length) {
    let best = -1
    let best_at = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const at = resolved.indexOf(remaining[i].value, cursor)
      if (at !== -1 && at < best_at) {
        best_at = at
        best = i
      }
    }
    if (best === -1) break // no remaining token's value appears further in the string — stop; leave it as text
    hits.push({ ...remaining[best], at: best_at })
    cursor = best_at + remaining[best].value.length
    remaining.splice(best, 1)
  }
  hits.sort((a, b) => a.at - b.at)
  const segments = []
  let pos = 0
  for (const h of hits) {
    if (h.at > pos) segments.push({ text: resolved.slice(pos, h.at), cls: fallback_cls })
    segments.push({ text: h.value, cls: h.cls, ...(h.ref ? { ref: h.ref } : {}) })
    pos = h.at + h.value.length
  }
  if (pos < resolved.length) segments.push({ text: resolved.slice(pos), cls: fallback_cls })
  return segments
}

/**
 * Build a CLIENT-side combat-log chat line from TOKENISED segments — pure presentation derived from the
 * authoritative event stream every participant already receives (so each client renders its own identical
 * line; never server-sent). Rides the client-only COMBAT channel: WorldChat.jsx renders it headerless with the
 * emerald log wash (fight lines must be client-side, headerless) and paints each segment by its token
 * class, resolving any `ref`-carrying segment against the LIVE fighters map first (see LogSegment). `message`
 * is the concatenated AT-EMIT-TIME plain text — the a11y/history fallback once the fight slice is gone; the
 * rendered spans may show a FRESHER name than `message` once an identity resolve lands (that's the healing
 * fix, not drift).
 * @param {string} id_prefix @param {LogSegment[]} segments
 */
const combat_log_line = (id_prefix, segments) => ({
  id: `${id_prefix}-${++combat_log_seq}`,
  message: segments.map((s) => s.text).join(''),
  segments,
  address: '',
  name: '',
  channel: CHANNEL.combat,
  target: '',
  from_me: false,
})

/**
 * Emit the CONTEXT line for one cast — "<caster> casted <spell>" (system tone). Split out of emit_cast_log
 * (below) so the voxel adapter fires it AT the caster's swing beat, real-time, instead of the whole cast's
 * lines flushing at packet-dispatch time (the combat log must stream at its beats, not dump).
 * `spell_display_name` resolves the id to a real name (NEVER the raw slug — D14 chain jargon). The name segment
 * carries `ref` so a late mob-identity resolve heals it (see LogSegment). @param {() => any} get_state
 * @param {(type: string, payload: any) => void} dispatch @param {{ entity_id: string, spell_id: string }} cast
 */
export const emit_cast_context_line = (get_state, dispatch, { entity_id, spell_id }) => {
  const fighters = get_state().fight?.fighters
  if (!fighters) return
  const caster = fighters.get(entity_id)?.name || i18n.t('world_chat.log_unknown_fighter')
  const spell = spell_display_name(spell_id)
  // The EN copy for world_chat.log_cast keeps the literal word "cast" (the golden-path mouse harness counts
  // landed casts via `/ cast /` on the log text) — never reword it in en.json.
  dispatch(
    'action/chat_message',
    combat_log_line(
      'cast',
      segment_template(i18n.t('world_chat.log_cast', { caster, spell }), [
        { value: caster, cls: 'clog-name', ref: entity_id },
        { value: spell, cls: 'clog-spell' },
      ])
    )
  )
}

/**
 * Emit ONE colour-coded result line for a single resolved effect — "<caster> hit <target> for N" in the number's
 * damage-red (crit prefixes "CRIT!" in gold), "<caster> healed <target> for +N" pink, an AP/MP drain, or a
 * fully-absorbed (0-damage) hit muted. Damage/heal are the AUTHORITATIVE wire fields. A status-only effect
 * (SHIELD/STUN/POISON/TRAP/GLYPH — no health change, no drain) emits nothing (covered by the cast line). Split
 * out of emit_cast_log so the voxel adapter fires each line AT its victim's flinch/floater beat (real-time).
 * Every name segment carries `ref: <fighter id>` — a mob whose identity hasn't resolved yet (dungeon_store
 * `_resolve_mob_identities` in flight) emits the literal 'Mob' placeholder here, but the renderer re-resolves
 * `ref` against the LIVE fighters map every render, so the line heals the moment the async resolve lands.
 * @param {() => any} get_state @param {(type: string, payload: any) => void} dispatch
 * @param {{ entity_id: string, effect: any, is_critical: boolean }} arg
 */
export const emit_effect_line = (get_state, dispatch, { entity_id, effect, is_critical }) => {
  const fighters = get_state().fight?.fighters
  if (!fighters) return
  const unknown = i18n.t('world_chat.log_unknown_fighter')
  const caster = fighters.get(entity_id)?.name || unknown
  const target = fighters.get(effect.target_id)?.name || unknown
  const heal = effect.heal ?? 0
  const damage = effect.damage ?? 0
  if (heal > 0) {
    const amount = `+${heal}`
    dispatch(
      'action/chat_message',
      combat_log_line(
        'heal',
        segment_template(i18n.t('world_chat.log_heal', { caster, target, amount }), [
          { value: caster, cls: 'clog-name', ref: entity_id },
          { value: target, cls: 'clog-target', ref: effect.target_id },
          { value: amount, cls: 'clog-num clog-num--heal' },
        ])
      )
    )
  } else if (damage > 0) {
    const amount = `${damage}`
    const num_cls = is_critical ? 'clog-num clog-num--crit' : 'clog-num'
    const base = segment_template(i18n.t('world_chat.log_hit', { caster, target, amount }), [
      { value: caster, cls: 'clog-name', ref: entity_id },
      { value: target, cls: 'clog-target', ref: effect.target_id },
      { value: amount, cls: num_cls },
    ])
    dispatch(
      'action/chat_message',
      combat_log_line(is_critical ? 'crit' : 'hit', [
        ...(is_critical ? [{ text: `${i18n.t('world_chat.log_crit_prefix')} `, cls: 'clog-num clog-num--crit' }] : []),
        ...base,
      ])
    )
    // AP/MP REMOVAL debuffs (colour-grammar) — composer half only, NOT YET WIRED: no producer sets
    // `ap_loss`/`mp_loss` on a resolved effect today (K_REMOVE_POINTS has no discrete on-chain event/diff yet).
    // Dormant but unit-tested — fires with zero further composer work the moment a producer sets these fields.
  } else if (effect.ap_loss > 0) {
    const amount = `${effect.ap_loss}`
    dispatch(
      'action/chat_message',
      combat_log_line(
        'ap-drain',
        segment_template(i18n.t('world_chat.log_ap_drain', { caster, target, amount }), [
          { value: caster, cls: 'clog-name', ref: entity_id },
          { value: target, cls: 'clog-target', ref: effect.target_id },
          { value: amount, cls: 'clog-num clog-num--ap' },
        ])
      )
    )
  } else if (effect.mp_loss > 0) {
    const amount = `${effect.mp_loss}`
    dispatch(
      'action/chat_message',
      combat_log_line(
        'mp-drain',
        segment_template(i18n.t('world_chat.log_mp_drain', { caster, target, amount }), [
          { value: caster, cls: 'clog-name', ref: entity_id },
          { value: target, cls: 'clog-target', ref: effect.target_id },
          { value: amount, cls: 'clog-num clog-num--mp' },
        ])
      )
    )
  } else if (effect.has_health)
    // a health-bearing hit that dealt 0 (fully shielded/absorbed) — muted, no number to celebrate
    dispatch(
      'action/chat_message',
      combat_log_line(
        'absorb',
        segment_template(i18n.t('world_chat.log_absorb', { caster, target }), [
          { value: caster, cls: 'clog-name', ref: entity_id },
          { value: target, cls: 'clog-target', ref: effect.target_id },
        ])
      )
    )
}

/**
 * Emit ONE "<target> triggered a trap for N" line — a player's placed trap detonating on a mob that walked onto
 * it (contract: trap fires → its line). Fired by the adapter's play_trap_trigger AT the pause
 * beat, so it streams with the flinch+floater. No caster (the trap is placement, not a live cast); the number is
 * damage-red, the mob-name segment carries `ref` for late-identity healing.
 * @param {() => any} get_state @param {(type: string, payload: any) => void} dispatch
 * @param {{ target_id: string, damage: number }} arg
 */
export const emit_trap_line = (get_state, dispatch, { target_id, damage }) => {
  const fighters = get_state().fight?.fighters
  if (!fighters) return
  const target = fighters.get(target_id)?.name || i18n.t('world_chat.log_unknown_fighter')
  const amount = `${damage}`
  dispatch(
    'action/chat_message',
    combat_log_line(
      'trap',
      segment_template(i18n.t('world_chat.log_trap', { target, amount }), [
        { value: target, cls: 'clog-target', ref: target_id },
        { value: amount, cls: 'clog-num' },
      ])
    )
  )
}

/**
 * Compose the full combat-log lines for one resolved cast — the context line + one result line per effect. The
 * COMPOSITION HOME (segment_template + i18n) is SHARED with the adapter's real-time beat emission through the
 * granular emitters above; this batch wrapper is the unit-test entry point (and any non-beat caller). Reads the
 * PRE-fold fighters map (names still resolve); status-only effects are covered by the cast line.
 * @param {() => any} get_state @param {(type: string, payload: any) => void} dispatch
 * @param {{ entity_id: string, spell_id: string, effects: any[], is_critical: boolean }} cast
 */
export const emit_cast_log = (get_state, dispatch, { entity_id, spell_id, effects, is_critical }) => {
  const fighters = get_state().fight?.fighters
  if (!fighters) return
  emit_cast_context_line(get_state, dispatch, { entity_id, spell_id })
  for (const effect of effects ?? []) emit_effect_line(get_state, dispatch, { entity_id, effect, is_critical })
}

/**
 * Emit a red-toned client-side "<name> died" combat line for each fighter this effect list NEWLY kills. Reads the
 * PRE-fold slice (the kill action is dispatched async, so the fighters map still holds the pre-effect `dead`
 * flag) and skips an already-dead target, so a death is announced exactly once even if a later effect re-hits
 * the corpse. The name segment carries `ref: effect.target_id` (see LogSegment) so a late mob-identity resolve
 * heals this line too. @param {() => any} get_state @param {(type: string, payload: any) => void} dispatch
 * @param {Array<{ target_id: string, new_health?: number, has_health?: boolean, killed?: boolean }>} effects
 */
export const emit_deaths = (get_state, dispatch, effects) => {
  const fighters = get_state().fight?.fighters
  if (!fighters) return
  for (const effect of effects ?? []) {
    // A death is real only on killed OR a health-bearing effect that hit 0. A placement/status-only effect
    // (TRAP/GLYPH) wires new_health:0 with has_health:false; without this guard it announced "<caster> died"
    // on every trap cast (c215).
    const lethal = effect.killed || (effect.has_health && (effect.new_health ?? 1) <= 0)
    if (!lethal) continue
    const target = fighters.get(effect.target_id)
    if (!target || target.dead) continue
    emit_death_line(get_state, dispatch, { target_id: effect.target_id })
  }
}

/**
 * Emit ONE red-toned "<name> died" line for a fighter — UNCONDITIONAL (no pre-fold dead-check): the caller owns
 * the timing. The voxel adapter fires it AT the death beat, where the fold has ALREADY marked the target dead
 * (a dead-check would wrongly swallow it there); emit_deaths (above) keeps the pre-fold dedup for its own batch
 * callers. fallback_cls 'clog-death' keeps the connective " died" its damage-red weight; the name segment gets
 * clog-name + `ref` so a late mob-identity resolve heals it. @param {() => any} get_state
 * @param {(type: string, payload: any) => void} dispatch @param {{ target_id: string }} arg
 */
export const emit_death_line = (get_state, dispatch, { target_id }) => {
  const fighters = get_state().fight?.fighters
  if (!fighters) return
  const name = fighters.get(target_id)?.name || i18n.t('world_chat.log_unknown_fighter')
  dispatch(
    'action/chat_message',
    combat_log_line(
      'death',
      segment_template(
        i18n.t('world_chat.log_death', { target: name }),
        [{ value: name, cls: 'clog-name', ref: target_id }],
        'clog-death'
      )
    )
  )
}

// The equipped-WEAPON basic-attack sentinel + pre-read fallbacks now LIVE in the fight core
// (fight/weapon.js — fight-session vocabulary; the move broke the fight-sfx→this-module dependency cycle).
// Re-exported verbatim so every existing importer keeps working.
export { WEAPON_ATTACK_ID, WEAPON_ATTACK_RANGE, WEAPON_ATTACK_AP } from '@aresrpg/fight/weapon'

// Arm (or toggle off) a hand card for casting. THE ONE DOOR (fight/store.js): the core owns the toggle; every
// consumer reads `armed_spell_id` synchronously off the projected view (use_fight_view). The board reads it to
// highlight cast-range and route the next board click into a cast command.
/** @param {string} spell_id */
export function arm_spell(spell_id) {
  fight_store.getState().input({ type: 'arm', spell_id })
}

// Passively hover a hand card (or clear with null) — the D299a/msg-3254 readout driver: a simple hover on a
// deck socket shows the tuned spell detail card (DungeonSpellReadout), no grab needed. SAME one-door pattern
// as arm_spell: the core owns `hovered_spell_id`, projected on the same view.
/** @param {string | null} spell_id */
export function hover_spell(spell_id) {
  fight_store.getState().input({ type: 'hover_spell', spell_id })
}

// Whether the CURRENT live fight is a view-only spectate (hides all controls) — the core's projected
// `spectator` flag. Spectate isn't wired through the S2 core yet (engine_view hardcodes false), so this
// honestly reports false until that lands.
export function is_spectator() {
  return !!fight_view()?.spectator
}

/**
 * Fold one `action/fight_summary/*` into the PERSISTENT end-fight recap slice (separate from the `fight`
 * slice so the DEFEAT/abandon modal survives a fight teardown). Mirrors the win path's `fight_result`.
 * @param {{ summary: FightSummary, won: boolean } | null} slice
 * @param {string} type
 * @param {any} payload
 * @returns {{ summary: FightSummary, won: boolean } | null}
 */
const fold_summary = (slice, type, payload) => {
  switch (type) {
    case 'action/fight_summary/open':
      return { summary: payload.summary, won: !!payload.won }
    case 'action/fight_summary/close':
      return null
    default:
      return slice
  }
}

/**
 * Fold the board-hover slice (combat-only cursor target → the EntityTooltip). Pure presentation: the
 * imperative roam layer publishes `set` on pointermove while a fighter sprite is under the cursor and
 * `clear` when it leaves, so React can show that fighter's name + HP. Never authoritative — the tooltip
 * resolves the actual fighter off the `fight` slice; this only carries the id + viewport cursor coords.
 * @param {{ entity_id: string, x: number, y: number } | null} slice
 * @param {string} type
 * @param {any} payload
 * @returns {{ entity_id: string, x: number, y: number } | null}
 */
const fold_hover = (slice, type, payload) => {
  switch (type) {
    case 'action/fight_hover/set':
      return { entity_id: payload.entity_id, x: payload.x, y: payload.y }
    case 'action/fight_hover/clear':
      return null
    default:
      return slice
  }
}

/** @type {import('../game.js').Module} */
export default function fight() {
  return {
    /** @param {import('../game.js').State} state @param {import('../game.js').Action} action */
    reduce(state, { type, payload }) {
      // the persistent end-fight DEFEAT recap is a SEPARATE slice (survives a fight teardown); the '_' keeps
      // 'action/fight_summary/'  and 'action/fight_hover/' off the legacy 'action/fight/' vocabulary.
      if (type.startsWith('action/fight_summary/'))
        return { ...state, fight_summary: fold_summary(state.fight_summary, type, payload) }
      // the board-hover tooltip target is its OWN transient slice — a cursor move must not clone the fighters Map.
      if (type.startsWith('action/fight_hover/'))
        return { ...state, fight_hover: fold_hover(state.fight_hover ?? null, type, payload) }
      // THE MIRROR IS DEAD: fight truth has ONE home (fight/store.js) and ONE synchronous
      // read surface (use_fight_view/fight_view) — no `state.fight` copy exists to write.
      return state
    },
    /** @param {import('../game.js').Context} context */
    observe({ events, get_state, dispatch }) {
      // THE FIGHT EDGE (S2 mirror kill): no state copy — three edge effects only.
      // 1) ROSTER → CORE CTX: sui.characters PLUS every OTHER seated fighter (a co-fighter outside
      //    my own alts fell to the raw-address fallback) resolves via character_name_resolve into ctx.roster
      //    (engine_view's ONE home). `known`: doc once resolved, `undefined` mid-flight (dedupes either way).
      const known = new Map()
      let last_mine = null,
        last_known_size = -1,
        last_roster = /** @type {any[]} */ ([])
      const push_roster = () => {
        const mine = get_state().sui?.characters ?? []
        if (mine !== last_mine || known.size !== last_known_size) {
          last_mine = mine
          last_known_size = known.size
          last_roster = known.size ? [...mine, ...[...known.values()].filter(Boolean)] : mine
        }
        if (last_roster.length && fight_store.getState().ctx?.roster !== last_roster)
          fight_store.getState().input({ type: 'ctx', ctx: { roster: last_roster } })
      }
      const ensure_roster = () => {
        const missing = missing_roster_character_ids(fight_view()?.fighters, get_state().sui?.characters, known)
        for (const id of missing) known.set(id, undefined)
        if (missing.length)
          void resolve_character_docs(missing).then((docs) => {
            for (const id of missing) known.set(id, docs.get(id))
            if (docs.size) push_roster() // a resolution landed mid-fight — heal ctx.roster now, not next tick
          })
        push_roster()
      }
      // 2) FIGHT-MODE EDGE + 3) COMBAT MUSIC: flip `action/fight_mode` only on the null↔non-null EDGE
      //    (player.js folds it, unchanged) and drive the D111 battle bed off the FRESH synchronous view.
      let was_active = fight_view() != null
      const sync = () => {
        ensure_roster()
        const view = fight_view()
        if ((view != null) !== was_active) {
          was_active = view != null
          dispatch('action/fight_mode', view != null)
        }
        // EFFECT ISOLATION (the game.js observer never-freeze law, applied at this edge): this subscriber runs
        // INSIDE every core input()'s set — a throwing audio engine must never break the reducer's caller.
        try {
          set_combat(combat_music_active({ fight_mode: view != null, fight: view }))
        } catch (error) {
          game_log('fight', 'combat-music edge threw (isolated); the input that triggered it is unaffected', error)
        }
      }
      fight_store.subscribe(sync)
      events.on('action/sui_data', ensure_roster) // roster arrives late on a reconnect — names heal via ctx
    },
  }
}
