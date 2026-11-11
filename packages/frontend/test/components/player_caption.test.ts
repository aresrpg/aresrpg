// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { DEFAULT_ADMIN_ADDRESS } from '@aresrpg/protocol'

import { player_caption } from '../../src/components/player_caption.ts'
import { items } from '../../src/content/items.ts'

const player = {
  name: 'Sceat',
  title: null,
  owner: null,
  admin_label: 'Admin',
  title_names: { title_veteran: 'Veteran' },
}
const artwork_url = (basename: string | undefined) => (basename ? `/art/${basename}.png` : undefined)
const caption = (input: Parameters<typeof player_caption>[0]) => player_caption(input, artwork_url)

test('admin identity follows wallet ownership, never name or community title', () => {
  expect(caption(player).artwork_url).toBeUndefined()
  expect(caption({ ...player, name: 'Admin', owner: '0x123' }).artwork_url).toBeUndefined()
  const admin = caption({
    ...player,
    owner: DEFAULT_ADMIN_ADDRESS.toUpperCase(),
    title: 'title_aeonkeeper',
    speech: 'Hi',
  })
  expect(admin.artwork_url).toBe('/art/admin_dragon_plate.png')
  expect(admin.lines).toEqual([{ text: 'Admin', color: '#ffb8b9' }])
  expect(admin.speech).toBe('Hi')
  expect(caption({ ...player, owner: `${DEFAULT_ADMIN_ADDRESS}0` }).artwork_url).toBeUndefined()
})

test('veteran presentation migrates through the generic seed artwork path and reverts on unequip', () => {
  const veteran = caption({ ...player, title: 'title_veteran' })
  expect(veteran.artwork_url).toBe('/art/veteran_ethereal_plate.png')
  expect(veteran.lines).toEqual([{ text: 'Veteran', color: '#a9f5cb' }])
  expect(caption(player).lines).toEqual([])
})

test('every model title resolves its authored artwork and generic localized subtitle', () => {
  const titles = items.filter((item) => item.category === 'title' && item.title_model)
  expect(titles).toHaveLength(10)
  for (const item of titles) {
    const result = caption({ ...player, title: item.item_type, title_names: { [item.item_type]: 'Localized title' } })
    expect(result.artwork_url).toBe(`/art/${item.title_nameplate}.png`)
    expect(result.lines?.[0]?.text).toBe('Localized title')
    expect(result.color).toBeUndefined()
    expect(result.health).toBeUndefined()
  }
  expect(caption({ ...player, title: 'missing_title' }).lines).toEqual([])
})
