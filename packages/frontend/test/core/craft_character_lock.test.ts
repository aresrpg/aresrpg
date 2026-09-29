// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',

  music_enabled: true,
  render_distance: null,
  always_craft_from_character_id: '0xb',
} as const)
const character = (id: string) => ({ id, name: id, jobs: {}, equipment: [], kiosk: `kiosk-${id}` })

test('opening Jobs selects and locks the configured crafting character', () => {
  const base = initial_app_state(settings)
  const roster = [character('0xa'), character('0xb')]
  const state = {
    ...base,
    session: { ...base.session, characters: roster, selected_character_id: '0xa', roster_loaded: true },
  }
  const jobs = reduce_app_state(state as never, { type: 'path/open', pathname: '/characters/jobs?job=TAILOR' })
  const refused_switch = reduce_app_state(jobs, { type: 'character/select', character_id: '0xa' })
  const stats = reduce_app_state(refused_switch, { type: 'path/open', pathname: '/characters/stats' })
  const allowed_switch = reduce_app_state(stats, { type: 'character/select', character_id: '0xa' })

  expect(jobs.session.selected_character_id).toBe('0xb')
  expect(refused_switch.session.selected_character_id).toBe('0xb')
  expect(allowed_switch.session.selected_character_id).toBe('0xa')
})

test('a direct Jobs reload applies the lock when the roster arrives', () => {
  const base = initial_app_state(settings)
  const routed = reduce_app_state(base, { type: 'route/changed', pathname: '/characters/jobs' })
  const loaded = reduce_app_state(routed, {
    type: 'server/packet',
    packet: { type: 'packet/characters', characters: [character('0xa'), character('0xb')] as never },
  })

  expect(loaded.session.selected_character_id).toBe('0xb')
})

test('an authoritative roster removes a stale crafting lock', () => {
  const base = initial_app_state(settings)
  const loaded = reduce_app_state(base, {
    type: 'server/packet',
    packet: { type: 'packet/characters', characters: [character('0xa')] as never },
  })

  expect(loaded.settings.always_craft_from_character_id).toBeNull()
  expect(loaded.session.selected_character_id).toBe('0xa')
})

test('the HUD Jobs modal locks the configured crafter without requiring a Jobs URL', () => {
  const base = initial_app_state(settings)
  const state = {
    ...base,
    session: { ...base.session, characters: [character('0xa'), character('0xb')], selected_character_id: '0xa' },
  }
  const jobs = reduce_app_state(state as never, { type: 'dialog/open', dialog: 'character_jobs' })
  expect(jobs.navigation.pathname).toBe('/')
  expect(jobs.session.selected_character_id).toBe('0xb')
  expect(reduce_app_state(jobs, { type: 'character/select', character_id: '0xa' }).session.selected_character_id).toBe(
    '0xb'
  )
  const closed = reduce_app_state(jobs, { type: 'dialog/open', dialog: null })
  expect(
    reduce_app_state(closed, { type: 'character/select', character_id: '0xa' }).session.selected_character_id
  ).toBe('0xa')
})

test('item crafting resolves the preference independently of the selected or inspected character', async () => {
  const { crafting_character } = await import('../../src/modules/craft_character_lock.ts')
  const base = initial_app_state(settings)
  const state = {
    ...base,
    session: { ...base.session, characters: [character('0xa'), character('0xb')], selected_character_id: '0xa' },
  }
  expect(crafting_character(state as never)?.id).toBe('0xb')
  expect(crafting_character(state as never, character('0xa') as never)?.id).toBe('0xb')
  expect(
    crafting_character({ ...state, settings: { ...settings, always_craft_from_character_id: 'missing' } } as never)?.id
  ).toBe('0xa')
})
