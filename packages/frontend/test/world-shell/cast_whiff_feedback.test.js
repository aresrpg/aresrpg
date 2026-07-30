// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1741 (a) — A WHIFF MUST NEVER READ AS A HIT. For the spells that keep genuine empty-cell semantics
// (AoE on a vacant centre, traps, free_cell aims), a cast that resolves ZERO victims used to be presented exactly
// like a landed one: the same context line, the same charge/resolve/impact package (thwack + shake + flash), AP
// gone, and nothing anywhere saying "nothing was there".
//
// Two halves, both proved here:
//   · `cast_whiffed` (voxel_fight_folds) — the PURE verdict the adapter gates its impact package on. It is judged
//     over the SOURCE TURN's beat list on purpose: a queued cast renders `split_render`, so its own beat carries
//     only status rows and every victim rides a SEPARATE damage/heal/displacement beat behind it. Reading the cast
//     beat alone would call every ordinary hit a whiff — the trap this row exists to keep shut.
//   · `emit_cast_whiff_line` (game/core/modules/fight.js — the ONE log-composition home) — its OWN copy, in all
//     six locales, never a hit's line.

import { describe, expect, test } from 'bun:test'

import { emit_cast_whiff_line } from '../../src/game/core/modules/fight.js'
import { cast_whiffed } from '../../src/world-shell/voxel_fight_folds.js'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']

describe('cast_whiffed — nothing resolved', () => {
  test('an AoE on a vacant centre (nothing follows the cast beat) is a whiff', () => {
    expect(cast_whiffed({ following: [{ kind: 'arrival' }], own_effects: [] })).toBe(true)
  })

  test('a bare cast with no beats behind it at all is a whiff', () => {
    expect(cast_whiffed()).toBe(true)
  })

  test('THE SPLIT-RENDER TRAP: an ordinary hit carries its victim on a SEPARATE damage beat — never a whiff', () => {
    expect(cast_whiffed({ following: [{ kind: 'damage' }], own_effects: [] })).toBe(false)
  })

  test('a heal, a push, a teleport and a trap placement each resolve the cast', () => {
    for (const kind of ['heal', 'displacement', 'teleport_arrival', 'trap_place', 'trap_trigger', 'status'])
      expect(cast_whiffed({ following: [{ kind }], own_effects: [] })).toBe(false)
  })

  test('a self-buff resolves on its OWN status row (no sibling beat needed)', () => {
    expect(cast_whiffed({ following: [], own_effects: [{ status: 'INVISIBILITY' }] })).toBe(false)
  })

  test('the scan stops at the NEXT cast — a later cast’s victims are not this cast’s', () => {
    expect(cast_whiffed({ following: [{ kind: 'cast' }, { kind: 'damage' }], own_effects: [] })).toBe(true)
  })
})

describe('emit_cast_whiff_line — the whiff speaks its own line', () => {
  const fighters = new Map([['p0', { id: 'p0', name: 'Alice' }]])
  const emit = () => {
    const lines = []
    emit_cast_whiff_line(
      () => ({ fight: { fighters } }),
      (type, payload) => type === 'action/chat_message' && lines.push(payload),
      { entity_id: 'p0', spell_id: 'warcleave' }
    )
    return lines
  }

  test('one line, tagged as a whiff, naming the caster and the spell', () => {
    const [line] = emit()

    expect(String(line.id).replace(/-\d+$/, '')).toBe('whiff')
    expect(line.message).toContain('Alice')
    expect(line.segments.some((segment) => segment.ref === 'p0')).toBe(true)
  })

  test('it is NOT a hit line — no damage number, no hit copy, and never the harness’ landed-cast token', () => {
    const [line] = emit()

    expect(line.message).not.toMatch(/\bhit\b/i)
    expect(line.message).not.toMatch(/ cast /i)
    expect(line.segments.some((segment) => (segment.cls ?? '').includes('clog-num'))).toBe(false)
  })

  test('a fighters-less state emits nothing (never a line about no one)', () => {
    const lines = []
    emit_cast_whiff_line(
      () => ({}),
      (_type, payload) => lines.push(payload),
      { entity_id: 'p0', spell_id: 'warcleave' }
    )

    expect(lines).toHaveLength(0)
  })

  test.each(LOCALES)('%s.json carries a non-empty world_chat.log_whiff', async (lang) => {
    const json = await Bun.file(new URL(`../../src/i18n/locales/${lang}.json`, import.meta.url)).json()
    const copy = json?.world_chat?.log_whiff

    expect(typeof copy).toBe('string')
    expect(copy.trim().length).toBeGreaterThan(0)
    expect(copy).toContain('{{caster}}')
    expect(copy).toContain('{{spell}}')
  })
})
