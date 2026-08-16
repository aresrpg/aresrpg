// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import type { SimulatorCharacter } from '../../src/modules/simulator.ts'
import { install_simulator_roster_persistence } from '../../src/simulator/persistence.ts'

const character = (name: string): SimulatorCharacter =>
  Object.freeze({
    id: 'sim_c1',
    name,
    classe: 'senshi',
    male: true,
    colors: Object.freeze(['#ffffff', '#d9af57', '#8b6539'] as const),
    level: 1,
    vitality: 0,
    wisdom: 0,
    strength: 0,
    intelligence: 0,
    chance: 0,
    agility: 0,
    spell_levels: Object.freeze({}),
    loadout: Object.freeze({}),
  })

describe('simulator roster persistence', () => {
  test('hydrates once and flushes edited characters when the app stops', async () => {
    const loaded = Object.freeze([character('Created')])
    const saved: (readonly SimulatorCharacter[])[] = []
    const controller = new AbortController()
    let changed = (): void => undefined
    let current = loaded
    let hydrated: readonly unknown[] = []

    install_simulator_roster_persistence({
      storage: Object.freeze({
        load: async () => loaded,
        save: async (characters) => {
          saved.push(characters)
        },
      }),
      signal: controller.signal,
      hydrate: (characters) => {
        hydrated = characters
      },
      read_characters: () => current,
      on_characters_changed: (listener) => {
        changed = listener
      },
      delay_ms: 60_000,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(hydrated).toEqual(loaded)
    current = Object.freeze([character('Edited')])
    changed()
    controller.abort()
    await Promise.resolve()

    expect(saved).toEqual([current])
  })
})
