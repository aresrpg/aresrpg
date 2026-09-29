// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { DEFAULT_ADMIN_ADDRESS } from '@aresrpg/protocol'

import { player_caption } from '../../src/components/player_caption.ts'

const player = { name: 'Sceat', title: null, owner: null, admin_label: 'Admin', veteran_label: 'Veteran' }

test('admin appearance follows wallet ownership, never the character name or equipped title', () => {
  expect(player_caption(player).tone).toBe('neutral')
  expect(player_caption({ ...player, owner: '0x123', name: 'Admin' }).tone).toBe('neutral')
  const caption = player_caption({ ...player, owner: DEFAULT_ADMIN_ADDRESS.toUpperCase() })
  expect(caption.tone).toBe('red')
  expect(caption.suffix).toBeUndefined()
  expect(caption.lines).toEqual([{ text: 'Admin' }])
  expect(player_caption({ ...player, owner: `${DEFAULT_ADMIN_ADDRESS}0` }).tone).toBe('neutral')
})

test('equipped veteran title supplies its Veteran subtitle and green frame; unequip removes both', () => {
  const caption = player_caption({ ...player, title: 'title_veteran' })
  expect(caption.tone).toBe('green')
  expect(caption.lines?.map(({ text }) => text)).toEqual(['Veteran'])
  expect(player_caption(player).lines).toEqual([])
  expect(player_caption(player).tone).toBe('neutral')
})

test('admin frame takes precedence with one localized subtitle while preserving speech', () => {
  const caption = player_caption({
    ...player,
    owner: DEFAULT_ADMIN_ADDRESS,
    title: 'title_veteran',
    admin_label: 'Administrateur',
    speech: 'Hello there!',
  })
  expect(caption.variant).toBe('nameplate')
  expect(caption.tone).toBe('red')
  expect(caption.suffix).toBeUndefined()
  expect(caption.lines).toEqual([{ text: 'Administrateur' }])
  expect(caption.speech).toBe('Hello there!')
})
