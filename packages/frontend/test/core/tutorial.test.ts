// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import type { Locale } from '../../src/i18n/locale.ts'
import { TUTORIAL_IDS, completed_tutorials_from, tutorial_id_for, tutorial_steps } from '../../src/tutorial/tutorial.ts'

const facts = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  page: 'world' as const,
  pathname: '/',
  dialog_open: false,
  player_ready: true,
  selected_character_id: '0xc1',
  fight_mounted: false,
  fight_owned: false,
  world_available: true,
  ...overrides,
})

describe('tutorial sequencing', () => {
  test('the loaded world tour follows the approved five anchors once', () => {
    expect(tutorial_id_for(facts(), [])).toBe('world')
    expect(tutorial_steps('world').map(({ target }) => target)).toEqual([
      { kind: 'dom', name: 'compass' },
      { kind: 'dom', name: 'overworld_hud' },
      { kind: 'dom', name: 'fps' },
      { kind: 'entity' },
      { kind: 'dom', name: 'character_tabs' },
    ])
    expect(tutorial_id_for(facts(), ['world'])).toBeNull()
  })

  test('the first owned fight suppresses the world tour and uses one centered explanation', () => {
    expect(tutorial_id_for(facts({ fight_mounted: true, fight_owned: true }), [])).toBe('fight')
    expect(tutorial_steps('fight')).toEqual([{ key: 'fight', target: null }])
    expect(tutorial_id_for(facts({ fight_mounted: true, fight_owned: false }), [])).toBeNull()
  })

  test('each character detail tab owns its independent first-open tutorial', () => {
    expect(tutorial_id_for(facts({ page: 'characters', pathname: '/characters/stats' }), [])).toBe('characters_stats')
    expect(
      tutorial_id_for(facts({ page: 'characters', pathname: '/characters/stats' }), ['characters_stats'])
    ).toBeNull()
    expect(tutorial_steps('characters_equipment')).toHaveLength(2)
    expect(tutorial_steps('characters_runeforge')).toEqual([
      { key: 'runeforge', target: { kind: 'dom', name: 'character_runeforge' } },
    ])
  })

  test('tutorials wait behind dialogs and reject malformed persisted identities', () => {
    expect(tutorial_id_for(facts({ dialog_open: true }), [])).toBeNull()
    expect(tutorial_id_for(facts({ world_available: false }), [])).toBeNull()
    expect(completed_tutorials_from(['world', 'bad', 'fight', 'world', 3])).toEqual(['world', 'fight'])
    expect(completed_tutorials_from(null)).toEqual([])
    expect(TUTORIAL_IDS).toContain('characters_jobs')
  })

  test('the stats reference assigns AP/MP loss resistance to Wisdom, not Agility', async () => {
    const copy = await load_app_copy('en')
    const text = copy_text(copy.characters_page)

    expect(text('stats.description.wisdom')).toContain('resistance to AP/MP loss')
    expect(text('stats.description.agility')).toContain('tackle escape')
    expect(text('stats.description.agility')).not.toContain('AP/MP loss')
  })

  test('every DOM coach mark has one stable semantic target', () => {
    const files = [
      'game/hud/CompassStrip.tsx',
      'game/hud/OverworldVitals.tsx',
      'components/FpsPanel.tsx',
      'components/CharacterTabs.tsx',
      'characters/EquipmentTab.tsx',
      'characters/StatsTab.tsx',
      'characters/SpellsTab.tsx',
      'characters/JobsTab.tsx',
      'characters/RuneforgeTab.tsx',
    ]
    const source = files.map((file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8')).join('\n')
    const targets = tutorial_steps('world')
      .concat(
        tutorial_steps('characters_equipment'),
        tutorial_steps('characters_stats'),
        tutorial_steps('characters_spells'),
        tutorial_steps('characters_jobs'),
        tutorial_steps('characters_runeforge')
      )
      .flatMap(({ target }) => (target?.kind === 'dom' ? [target.name] : []))

    targets.forEach((target) => expect(source).toContain(`data-tutorial-target="${target}"`))
    const hud = readFileSync(new URL('../../src/game/hud/OverworldVitals.tsx', import.meta.url), 'utf8')
    expect(hud).toContain('fight-hud__bar fight-hud__bar--overworld" data-tutorial-target="overworld_hud"')
    expect(hud).not.toContain('fight-hud fight-hud--overworld" data-tutorial-target')
  })

  test('maintenance and indexer catch-up prevent the tutorial host from mounting', () => {
    const host = readFileSync(new URL('../../src/tutorial/TutorialHost.tsx', import.meta.url), 'utf8')

    expect(host).toContain('game_frozen !== true')
    expect(host).toContain('!indexing_blocked(link_status, indexing_lag)')
  })

  test('all six locales ship the complete tutorial book', async () => {
    const locales: readonly Locale[] = ['en', 'fr', 'de', 'es', 'ja', 'uk']
    const copies = await Promise.all(locales.map(load_app_copy))
    const keys = Object.keys(copies[0]!.tutorial).sort()

    copies.forEach(({ fight_hud, tutorial }) => {
      expect(Object.keys(tutorial).sort()).toEqual(keys)
      expect(Object.values(tutorial).every((value) => value.trim().length > 0)).toBeTrue()
      expect(fight_hud.result_version_changed?.trim().length).toBeGreaterThan(0)
    })
  })
})
