// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1741 (a) — A WHIFF MUST NEVER READ AS A HIT. For the spells that keep genuine empty-cell semantics
// (AoE on a vacant centre, traps, free_cell aims), a cast that resolves ZERO victims used to be presented exactly
// like a landed one: the same context line, the same charge/resolve/impact package (thwack + shake + flash), AP
// gone, and nothing anywhere saying "nothing was there".
//
// This file owns the LOG half: `emit_cast_whiff_line` (game/core/modules/fight.js — the ONE log-composition
// home) — its OWN copy, in all six locales, never a hit's line.
//
// The VERDICT half moved (#1993 WP5): the whiff is no longer a classifier of its own but the negative of the
// cast-resolution record's `landed`, whose law lives in `packages/fight/test/cast_record.test.js` and whose
// #1859 seal (the two homes that used to disagree) lives in `cast_landing_one_home.test.js`.

import { describe, expect, test } from 'bun:test'

import { emit_cast_whiff_line } from '../../src/game/core/modules/fight.js'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']

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

  // #1859 — THE LINE MAY ONLY CLAIM WHAT THE VERDICT PROVES. the whiff is a RESOLUTION verdict: nobody hit,
  // nothing placed, nothing moved. It reads no cell and knows no occupancy, so "struck empty ground" asserted a
  // position fact nothing in this path establishes — and a live session watched a mob cast visibly AT the player
  // and read back that it hit the dirt. The copy is re-scoped to the resolution; the canonical cast-resolution
  // record that could honestly speak about cells is #1993's, not this line's.
  const GROUND_WORDS = {
    en: ['ground', 'empty'],
    fr: ['vide', 'sol'],
    de: ['boden', 'leer'],
    es: ['suelo', 'vacío'],
    ja: ['地面', '何もない'],
    uk: ['місце', 'землю'],
  }

  test.each(LOCALES)('%s.json — the whiff line claims no position, only the resolution', async (lang) => {
    const json = await Bun.file(new URL(`../../src/i18n/locales/${lang}.json`, import.meta.url)).json()
    const copy = String(json?.world_chat?.log_whiff).toLowerCase()

    for (const word of GROUND_WORDS[lang]) expect(copy).not.toContain(word)
  })
})
