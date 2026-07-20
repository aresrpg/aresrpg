import { describe, expect, test } from 'bun:test'

import { selected_item_for_route } from './item_catalog'

describe('encyclopedia item route selection', () => {
  const items = [
    { id: '0xtemplate-bouloute', slug: 'pet_bouloute' },
    { id: '0xtemplate-timon', slug: 'pet_timon' },
  ]

  test('preselects by canonical template object id', () => {
    expect(selected_item_for_route(items, '0xtemplate-bouloute')).toBe(items[0])
  })

  test('preselects a loot-box deep link by stable item slug', () => {
    expect(selected_item_for_route(items, 'pet_timon')).toBe(items[1])
  })

  test('an unknown route segment honestly selects nothing', () => {
    expect(selected_item_for_route(items, 'pet_missing')).toBeNull()
  })
})
