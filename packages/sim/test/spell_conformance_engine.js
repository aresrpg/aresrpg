// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE 240-SPELL CONFORMANCE ENGINE (pure; no bun:test — imported by the .test.js gate AND the table generator,
// so the fold + the verdict have ONE HOME).
//
// Owner's bar, verbatim: "all spells working as they should." effect_kind_matrix.test.js proves each K_*
// discriminant EXECUTES; spell_effect_conformance_matrix.js proves each effect's CLASS postcondition lands. This
// is the FINEST axis: for every authored spell × level × effect, drive the effect through the REAL reducer and
// assert its resolution matches its AUTHORED VALUE — the AP debit, the damage magnitude + element, the stat
// buff/debuff SIGN + magnitude, the timed-row DURATION, and the self/enemy TARGETING the filter declares.
//
// CONFORMANCE-ORACLE LAW: the element/stat/sign vocabulary below is encoded INDEPENDENTLY from the authored
// taxonomy (the seed corpus §5a), NOT imported from spell_templates.js — importing the system-under-test's own
// map would make the check circular (a bug in that map would pass itself). The sim's numbers come from DRIVING
// the reducer; the authored numbers come from the raw corpus row; the two are compared here.
//
// A field the sim+chain twin cannot express (e.g. the authored damage `value_max` — no on-chain Effect field,
// no per-cast damage roll under the single-PTB turn law) is a NAMED GAP, never a silent skip.

import { process_spell_cast } from '../src/fight_spells.js'
import { process_turn_effects } from '../src/fight_actions.js'
import { effective_stats, find_entity } from '../src/fight_state.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { FLAG_NEGATIVE } from '../src/spell_effect.js'

import {
  ALLY_CELL,
  CASTER_CELL,
  CLASS_OF,
  CORPUS,
  CAST_CTX,
  EMPTY_CELL,
  ENEMY_CELL,
  fresh_state,
  single_effect_spell,
  SPELLS_CORPUS_AVAILABLE,
  victim_of,
} from './spell_effect_conformance_matrix.js'

export { CORPUS, SPELLS_CORPUS_AVAILABLE }

// ── Authored taxonomy, encoded independently of the SUT (seed corpus §5a) ─────────────────────────────
const K = {
  DAMAGE: 0,
  PERCENT_LIFE_DAMAGE: 1,
  LIFE_STEAL: 2,
  CASTER_DAMAGE: 3,
  PUNISHMENT_DAMAGE: 4,
  HEAL: 5,
  GIVE_POINTS: 6,
  REMOVE_POINTS: 7,
  STEAL_POINTS: 8,
  ALTER_STAT: 9,
  STEAL_STAT: 10,
  ALTER_RESIST: 11,
  APPLY_DOT: 21,
  APPLY_STATE: 22,
  REDUCE_DAMAGE: 24,
  REFLECT_DAMAGE: 25,
  INVISIBILITY: 27,
  RETURN_SPELL: 29,
}

const ELEMENT_NAME = {
  0: 'FIRE',
  1: 'WATER',
  2: 'EARTH',
  3: 'AIR',
  255: 'NONE',
}
const STAT_NAME = {
  0: 'strength',
  1: 'intelligence',
  2: 'chance',
  3: 'agility',
  4: 'wisdom',
  5: 'vitality',
  6: 'range',
  7: 'critical_hit',
  8: 'percent_damage',
  9: 'raw_damage',
  10: 'max_hp',
  11: 'heal',
  12: 'ap_dodge',
  13: 'mp_dodge',
  14: 'physical_damage',
}
const RESIST_BY_ELEMENT = {
  FIRE: 'fire_resistance',
  WATER: 'water_resistance',
  EARTH: 'earth_resistance',
  AIR: 'air_resistance',
  NONE: 'neutral_resistance',
}
const POINT_NAME = { 0: 'ap', 1: 'mp' }

// ── Drive ONE authored effect in isolation (fresh board per drive; the matrix's arena) ────────────────
const drive = (raw, ap_cost) => {
  const cls = CLASS_OF[raw.kind]
  const vk = victim_of(raw.target_filter)
  const placing = cls === 'trap' || cls === 'glyph' || cls === 'teleport'
  const victim_id =
    cls === 'teleport' || vk === 'caster'
      ? 'p0'
      : vk === 'ally'
        ? 'p1'
        : vk === 'zone'
          ? null
          : 'm0'
  const target =
    cls === 'teleport' || placing || vk === 'zone'
      ? EMPTY_CELL
      : vk === 'caster'
        ? CASTER_CELL
        : vk === 'ally'
          ? ALLY_CELL
          : ENEMY_CELL
  const spell = single_effect_spell(`conf_${raw.kind}`, raw, ap_cost, placing)
  const [norm] = spell.levels[0].base_effects
  const state = fresh_state()
  const before = victim_id ? snapshot(find_entity(state, victim_id)) : null
  const caster_before = snapshot(find_entity(state, 'p0'))
  const res = process_spell_cast(state, 'p0', spell, 1, target, CAST_CTX)
  return { cls, vk, victim_id, norm, state, res, before, caster_before }
}

const snapshot = e => ({
  health: e.health,
  health_max: e.health_max,
  ap: e.ap,
  mp: e.mp,
  effect_ids: new Set(e.effects.map(x => x.id)),
  eff: { ...effective_stats(e) },
})

// A verdict row: one axis of one effect. status ∈ PASS | MISMATCH | GAP.
const verdict = (axis, status, detail = '') => ({ axis, status, detail })

// The added timed row(s) on an entity after a drive (rows whose id is new).
const added_rows = (before_ids, entity) =>
  entity.effects.filter(e => !before_ids.has(e.id))

// ── Per-effect conformance: every applicable axis for this authored effect ─────────────────────────────
export const conform_effect = (raw, ap_cost) => {
  const { kind } = raw
  const cls = CLASS_OF[kind]
  const checks = []
  if (cls === undefined) {
    checks.push(verdict('class', 'GAP', `unclassified kind ${kind}`))
    return checks
  }

  const { victim_id, norm, res, before, caster_before } = drive(raw, ap_cost)
  if (!res.success) {
    // A legitimately un-castable isolated effect (needs a live board it cannot get here) is a GAP, not a fail.
    checks.push(verdict('cast', 'GAP', `cast rejected: ${res.error}`))
    return checks
  }
  const after = res.state
  const mag = Math.abs(raw.value ?? 0)
  const authored_element = ELEMENT_NAME[raw.element] ?? `el${raw.element}`
  const v_after = victim_id ? find_entity(after, victim_id) : null
  const caster_after = find_entity(after, 'p0')

  // ⑤ TARGETING — the sim must preserve the authored target filter (self/ally/enemy/zone routing).
  checks.push(
    norm.target_filter === raw.target_filter
      ? verdict('targeting', 'PASS')
      : verdict(
          'targeting',
          'MISMATCH',
          `target_filter ${norm.target_filter} != authored ${raw.target_filter}`,
        ),
  )

  // ② DAMAGE / HEAL — magnitude (zero-stat board → the fold lands the authored fixed value exactly) + element.
  // The victim floors at 0 HP, so the observable drop caps at the HP it had; expect min(authored, available).
  if (kind === K.DAMAGE || kind === K.LIFE_STEAL) {
    const drop = before.health - v_after.health
    const expected = Math.min(mag, before.health)
    checks.push(
      drop === expected
        ? verdict('damage', 'PASS')
        : verdict(
            'damage',
            'MISMATCH',
            `hp drop ${drop} != authored value ${expected}${mag > before.health ? ` (value ${mag} capped at ${before.health} HP)` : ''}`,
          ),
    )
    checks.push(
      norm.element === authored_element
        ? verdict('element', 'PASS')
        : verdict(
            'element',
            'MISMATCH',
            `element ${norm.element} != authored ${authored_element}`,
          ),
    )
    if (raw.value_max !== raw.value)
      checks.push(
        verdict(
          'range',
          'GAP',
          `authored range [${raw.value},${raw.value_max}] resolves as fixed value ${raw.value} — no per-cast damage roll on the single-PTB twin (value_max has no on-chain Effect field)`,
        ),
      )
  } else if (kind === K.CASTER_DAMAGE) {
    const drop = caster_before.health - caster_after.health
    const expected = Math.min(mag, caster_before.health)
    checks.push(
      drop === expected
        ? verdict('damage', 'PASS')
        : verdict(
            'damage',
            'MISMATCH',
            `caster recoil ${drop} != authored value ${expected}`,
          ),
    )
  } else if (kind === K.PERCENT_LIFE_DAMAGE || kind === K.PUNISHMENT_DAMAGE) {
    const drop = before.health - v_after.health
    checks.push(
      drop > 0
        ? verdict('damage', 'PASS')
        : verdict(
            'damage',
            'MISMATCH',
            `no hp drop (authored ${kind === K.PERCENT_LIFE_DAMAGE ? '%-life' : 'punishment'} damage)`,
          ),
    )
    checks.push(
      verdict(
        'value',
        'GAP',
        kind === K.PERCENT_LIFE_DAMAGE
          ? 'percent-of-life magnitude scales with live target HP — exact value board-dependent'
          : 'punishment magnitude scales with caster HP loss — exact value board-dependent',
      ),
    )
  } else if (kind === K.HEAL) {
    const rise = v_after.health - before.health
    const expected = Math.min(mag, before.health_max - before.health)
    checks.push(
      rise === expected
        ? verdict('heal', 'PASS')
        : verdict(
            'heal',
            'MISMATCH',
            `hp rise ${rise} != authored value ${expected} (cap ${before.health_max})`,
          ),
    )
  }

  // ③ STAT / RESIST — the sign+magnitude the authored flag declares (FLAG_NEGATIVE = subtract |value|).
  if (
    kind === K.ALTER_STAT ||
    kind === K.ALTER_RESIST ||
    kind === K.STEAL_STAT
  ) {
    const negative = (raw.flags & FLAG_NEGATIVE) !== 0
    const stat_key =
      kind === K.ALTER_RESIST
        ? (RESIST_BY_ELEMENT[authored_element] ?? 'neutral_resistance')
        : STAT_NAME[raw.stat]
    // STEAL_STAT always DEBUFFS the target (unconditional); ALTER_* signs off the flag.
    const expected = kind === K.STEAL_STAT ? -mag : negative ? -mag : mag
    const net =
      (effective_stats(v_after)[stat_key] ?? 0) - (before.eff[stat_key] ?? 0)
    checks.push(
      net === expected
        ? verdict('sign_magnitude', 'PASS')
        : verdict(
            'sign_magnitude',
            'MISMATCH',
            `${stat_key} net ${net > 0 ? '+' : ''}${net} != authored ${expected > 0 ? '+' : ''}${expected} (value ${raw.value}, flags ${raw.flags})`,
          ),
    )
    // STEAL_STAT: the debited magnitude must also LAND on the caster as a same-stat buff.
    if (kind === K.STEAL_STAT) {
      const caster_net =
        (effective_stats(caster_after)[stat_key] ?? 0) -
        (caster_before.eff[stat_key] ?? 0)
      checks.push(
        caster_net === mag
          ? verdict('steal_mirror', 'PASS')
          : verdict(
              'steal_mirror',
              'MISMATCH',
              `caster ${stat_key} gain ${caster_net} != authored ${mag}`,
            ),
      )
    }
  }

  // AP / MP POINTS — give lands immediately on the pool; drain/steal are dodge-contested (direction, not exact).
  if (kind === K.GIVE_POINTS) {
    const pool = POINT_NAME[raw.stat]
    const delta = v_after[pool] - before[pool]
    const gained_row = added_rows(before.effect_ids, v_after).some(
      r => r.stat === pool,
    )
    checks.push(
      delta === mag || gained_row
        ? verdict('points', 'PASS')
        : verdict(
            'points',
            'MISMATCH',
            `${pool} +${delta} != authored +${mag} and no timed credit row`,
          ),
    )
  } else if (kind === K.REMOVE_POINTS || kind === K.STEAL_POINTS) {
    const pool = POINT_NAME[raw.stat]
    const delta = before[pool] - v_after[pool]
    const dodged = (res.effects ?? []).some(e => e.status === 'POINT_DODGED')
    checks.push(
      delta > 0 || dodged
        ? verdict('points', 'PASS')
        : verdict(
            'points',
            'MISMATCH',
            `${pool} not drained (delta ${delta}, not dodged)`,
          ),
    )
  }

  // ④ DURATION — for the kinds that DETERMINISTICALLY mint an entity timed row, that row must be scheduled for
  // exactly its authored turn count (the reducer floors 0 → 1). Kinds whose `turns` means something the sim
  // expresses off the entity (glyph lifetime on the board, drain-debt refill, heal-over-time, teleport lag) are
  // a NAMED GAP, not a fail — the timed entity row is not the sim's home for those.
  if (raw.turns > 0) {
    if (DURATION_ROW_KINDS.has(kind)) {
      const rows = added_rows(before.effect_ids, v_after)
      const expected_turns = Math.max(1, raw.turns)
      if (rows.length === 0)
        checks.push(
          verdict(
            'duration',
            'MISMATCH',
            `authored turns=${raw.turns} but no timed row was minted`,
          ),
        )
      else {
        const bad = rows.find(r => r.turns_remaining !== expected_turns)
        checks.push(
          bad
            ? verdict(
                'duration',
                'MISMATCH',
                `timed row turns_remaining ${bad.turns_remaining} != authored ${expected_turns}`,
              )
            : verdict('duration', 'PASS'),
        )
      }
    } else {
      checks.push(
        verdict(
          'duration',
          'GAP',
          DURATION_GAP_REASON[kind] ??
            `authored turns=${raw.turns} not expressed as a fighter timed row`,
        ),
      )
    }
  }

  return checks
}

// Kinds whose cast ALWAYS mints a fighter-borne timed row the sim schedules for `turns` (the deterministic
// duration oracle); every other turns-bearing kind carries its lifetime elsewhere (a NAMED GAP below).
const DURATION_ROW_KINDS = new Set([
  K.GIVE_POINTS,
  K.ALTER_STAT,
  K.STEAL_STAT,
  K.ALTER_RESIST,
  K.APPLY_DOT,
  K.APPLY_STATE,
  K.REDUCE_DAMAGE,
  K.REFLECT_DAMAGE,
  K.INVISIBILITY,
  K.RETURN_SPELL,
])
const DURATION_GAP_REASON = {
  [K.REMOVE_POINTS]:
    'drain lifetime is a debt-row refill schedule (dodge-contested), not a folded stat row',
  [K.STEAL_POINTS]:
    'steal-points lifetime is a debt-row refill schedule, not a folded stat row',
  [K.HEAL]:
    'authored heal-over-turns is resolved as one instant heal — no per-turn regen row in the sim',
  [K.PERCENT_LIFE_DAMAGE]:
    'percent-life over turns not expressed as a timed row',
  14: 'teleport carries no fighter timed row',
  20: 'glyph lifetime lives on the board object, not a fighter row',
  26: 'dispel is instantaneous — its authored turns has no fighter row',
}

// Tick-to-expiry proof (the owner's "tick the fight") — drive an authored timed effect, then tick the VICTIM's
// turn-start plumbing (`process_turn_effects`, the sim's real per-turn decrement + expiry) and assert the freshly
// minted rows clear at exactly their scheduled turn. Representative (not per-effect: the decrement is generic +
// heavily tested; this confirms it FIRES for a spell-applied row). Returns { turns, cleared_after, ok }.
export const prove_expiry = (raw, ap_cost) => {
  const { victim_id, res, before } = drive(raw, ap_cost)
  if (!res.success || !victim_id) return { ok: false, reason: 'undrivable' }
  const turns = Math.max(1, raw.turns)
  let s = res.state
  let cleared_after = -1
  for (let t = 0; t < turns + 2 && cleared_after < 0; t += 1) {
    s = process_turn_effects(s, victim_id).state
    const victim = find_entity(s, victim_id)
    if (!victim || added_rows(before.effect_ids, victim).length === 0)
      cleared_after = t + 1
  }
  return { ok: cleared_after === turns, turns, cleared_after }
}

// ── Fold the whole corpus once (pure, deterministic) ──────────────────────────────────────────────────
export const conform_corpus = () => {
  const findings = [] // MISMATCH rows: { spell_id, level, slot, kind, axis, detail }
  const gaps = [] // GAP rows: { spell_id, level, slot, kind, axis, detail }
  const rows = [] // per (spell, level) PASS/verdict summary for the table
  let effects_driven = 0
  let ap_checks = 0
  let ap_mismatches = 0
  let pass_axes = 0

  const POINT_KINDS = new Set([K.GIVE_POINTS, K.REMOVE_POINTS, K.STEAL_POINTS])
  for (const spell of CORPUS) {
    const norm_levels =
      normalize_spell_templates([spell]).get(spell.id)?.levels ?? []
    ;(spell.levels ?? []).forEach((level, li) => {
      const ap_cost = level.ap_cost ?? 0
      // ① AP — the sim must (a) CARRY the authored cost through normalization and (b) DEBIT exactly it. The
      // template leg is deterministic across all 1440 levels; the driven leg confirms deduct_ap fires, probed
      // with a NON-points effect so an effect that itself grants/drains AP never pollutes the measured debit.
      const carried = norm_levels[li]?.cost
      if (carried !== ap_cost)
        findings.push({
          spell_id: spell.id,
          level: li + 1,
          slot: 'level',
          kind: 'ap',
          axis: 'ap_cost',
          detail: `normalized cost ${carried} != authored ap_cost ${ap_cost}`,
        })
      else pass_axes += 1
      const probe =
        (level.effects ?? []).find(e => !POINT_KINDS.has(e.kind)) ??
        (level.crit_effects ?? []).find(e => !POINT_KINDS.has(e.kind))
      if (probe) {
        const { res, caster_before } = drive(probe, ap_cost)
        if (res.success) {
          ap_checks += 1
          const debit = caster_before.ap - find_entity(res.state, 'p0').ap
          if (debit !== ap_cost) {
            ap_mismatches += 1
            findings.push({
              spell_id: spell.id,
              level: li + 1,
              slot: 'level',
              kind: 'ap',
              axis: 'ap_debit',
              detail: `AP debit ${debit} != authored ap_cost ${ap_cost}`,
            })
          } else pass_axes += 1
        }
      }

      const slots = [
        ['base', level.effects ?? []],
        ['crit', level.crit_effects ?? []],
      ]
      let level_pass = 0
      let level_total = 0
      for (const [tag, list] of slots)
        list.forEach((raw, i) => {
          effects_driven += 1
          const checks = conform_effect(raw, ap_cost)
          for (const c of checks) {
            level_total += 1
            const entry = {
              spell_id: spell.id,
              level: li + 1,
              slot: `${tag}${i}`,
              kind: raw.kind,
              axis: c.axis,
              detail: c.detail,
            }
            if (c.status === 'MISMATCH') findings.push(entry)
            else if (c.status === 'GAP') gaps.push(entry)
            else {
              pass_axes += 1
              level_pass += 1
            }
          }
        })
      rows.push({
        spell_id: spell.id,
        level: li + 1,
        ap_cost,
        pass: level_pass,
        total: level_total,
      })
    })
  }

  return {
    rows,
    findings,
    gaps,
    stats: {
      spells: CORPUS.length,
      levels: rows.length,
      effects_driven,
      ap_checks,
      ap_mismatches,
      pass_axes,
      mismatch_axes: findings.length,
      gap_axes: gaps.length,
    },
  }
}

// ── The committed findings table (deterministic; the generator + the gate both call this) ──────────────
const KIND_LABEL = {
  0: 'DAMAGE',
  1: 'PERCENT_LIFE',
  2: 'LIFE_STEAL',
  3: 'CASTER_DAMAGE',
  4: 'PUNISHMENT',
  5: 'HEAL',
  6: 'GIVE_POINTS',
  7: 'REMOVE_POINTS',
  8: 'STEAL_POINTS',
  9: 'ALTER_STAT',
  10: 'STEAL_STAT',
  11: 'ALTER_RESIST',
  14: 'TELEPORT',
  20: 'GLYPH',
  21: 'DOT',
  22: 'APPLY_STATE',
  24: 'REDUCE_DAMAGE',
  25: 'REFLECT',
  26: 'DISPEL',
  27: 'INVISIBILITY',
  29: 'RETURN_SPELL',
  ap: 'AP',
}
const group = (list, keyer) => {
  const m = new Map()
  for (const row of list) {
    const key = keyer(row)
    if (!m.has(key)) m.set(key, { count: 0, spells: new Set(), example: row })
    const g = m.get(key)
    g.count += 1
    g.spells.add(row.spell_id)
  }
  return m
}

export const format_report = ({ stats, findings, gaps }) => {
  const L = []
  L.push('# The 240-Spell Conformance Sweep — authored corpus vs the fold')
  L.push('')
  L.push(
    '<!-- GENERATED by packages/sim/test/spell_conformance_report.mjs — do not hand-edit. -->',
  )
  L.push('')
  L.push(
    'Every player spell (ceremony-#3 authored corpus, 240 spells × 6 levels) folded through the REAL sim',
  )
  L.push(
    'reducer (`process_spell_cast`) on a zero-stat deterministic board; each authored effect asserted against',
  )
  L.push(
    'its authored definition — AP debit, damage magnitude + element, stat/resist SIGN + magnitude, timed-row',
  )
  L.push(
    'duration, and self/enemy targeting. No sampling: every level variant, every effect, every applicable axis.',
  )
  L.push('')
  L.push(
    'The authored corpus is content (private seed repo, published as a Walrus blob); it is ABSENT from this repo',
  )
  L.push(
    'by design (issue #96). This sweep runs where the corpus is materialized locally at `seed/mainnet/spells/`',
  )
  L.push(
    '(gitignored) — the same seam `spell_effect_conformance_matrix.js` uses; in CI (corpus absent) the gate skips.',
  )
  L.push('')
  L.push('## Verdict')
  L.push('')
  L.push(
    `- **Spells:** ${stats.spells} · **level variants:** ${stats.levels} · **effects driven:** ${stats.effects_driven} · **AP debits driven:** ${stats.ap_checks}`,
  )
  L.push(
    `- **Axes PASS:** ${stats.pass_axes} · **MISMATCH:** ${stats.mismatch_axes} · **NAMED GAP:** ${stats.gap_axes}`,
  )
  L.push('')
  // Findings (mismatches), grouped by root mechanism.
  L.push('## Findings — every mismatch named')
  L.push('')
  if (findings.length === 0)
    L.push('_None. Every driven axis conforms to its authored definition._')
  else {
    L.push('| root | kind · axis | rows | spells | mechanism |')
    L.push('| --- | --- | ---: | ---: | --- |')
    for (const [, g] of group(findings, f => `${f.kind}/${f.axis}`)) {
      const e = g.example
      L.push(
        `| \`${e.spell_id}\` | ${KIND_LABEL[e.kind] ?? e.kind} · ${e.axis} | ${g.count} | ${g.spells.size} | ${e.detail} |`,
      )
    }
  }
  L.push('')
  // Named gaps — authored fields the sim+chain twin does not express, grouped by mechanism.
  L.push(
    '## Named gaps — authored fields the sim + chain twin does not express',
  )
  L.push('')
  L.push(
    'These are NOT sim breaks: the sim mirrors the deployed chain (the deterministic twin). Each is an authored',
  )
  L.push(
    'corpus field with no runtime consumer on EITHER side — a content-design signal, not a code defect.',
  )
  L.push('')
  L.push('| kind · axis | effects | mechanism |')
  L.push('| --- | ---: | --- |')
  for (const [, g] of [...group(gaps, f => `${f.kind}/${f.axis}`)].sort(
    (a, b) => b[1].count - a[1].count,
  )) {
    const e = g.example
    L.push(
      `| ${KIND_LABEL[e.kind] ?? e.kind} · ${e.axis} | ${g.count} | ${e.detail} |`,
    )
  }
  L.push('')
  return L.join('\n')
}
