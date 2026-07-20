import { describe, expect, test } from 'bun:test'

import { normalize_equip_items, reconcile_equip_state } from './equip_state_refresh.js'

const character_view = (equipment) => ({ characters: [{ id: '0xcharacter', equipment }] })
const item_view = (template_id) => ({
  items: [
    {
      id: '0xitem',
      item_category: 'resource',
      template_id,
      listed: false,
    },
  ],
})

describe('reconcile_equip_state', () => {
  test('drains older reads, applies the second cache-bypassed projection, then reports success', async () => {
    const calls = []
    const responses = [character_view(['old']), item_view('0xold'), character_view(['fresh']), item_view('0xfresh')]
    let written = null
    const refreshed = await reconcile_equip_state(
      { address: '0xowner', character_id: '0xcharacter' },
      {
        read: async (...args) => {
          calls.push(args)
          return responses.shift()
        },
        get_state: () => ({ sui: { characters: [{ id: '0xcharacter', vitality: 9 }] } }),
        write: (payload) => {
          written = payload
        },
        map_character: (row) => row,
        mask_items: (rows) => rows,
        merge_items: (rows) => rows,
      }
    )

    expect(refreshed).toBe(true)
    expect(calls).toHaveLength(4)
    expect(calls.every(([, , , fresh]) => fresh === true)).toBe(true)
    expect(written.characters[0]).toEqual({ id: '0xcharacter', vitality: 9, equipment: ['fresh'] })
    expect(written.items[0]).toMatchObject({ template_id: '0xfresh', stackable: true })
  })

  test('an incomplete authoritative wave rejects without writing', async () => {
    let writes = 0
    const responses = [character_view([]), item_view('0xold'), { characters: [] }, item_view('0xfresh')]
    await expect(
      reconcile_equip_state(
        { address: '0xowner', character_id: '0xcharacter' },
        {
          read: async () => responses.shift(),
          write: () => {
            writes += 1
          },
        }
      )
    ).rejects.toThrow('did not return the selected character')
    expect(writes).toBe(0)
  })

  test('an owner change before the atomic store write leaves state untouched', async () => {
    let checks = 0
    let writes = 0
    const responses = [character_view([]), item_view('0xold'), character_view(['fresh']), item_view('0xfresh')]
    await expect(
      reconcile_equip_state(
        { address: '0xowner', character_id: '0xcharacter' },
        {
          read: async () => responses.shift(),
          get_state: () => ({ sui: { characters: [] } }),
          write: () => {
            writes += 1
          },
          map_character: (row) => row,
          is_current: () => (checks += 1) === 1,
        }
      )
    ).rejects.toThrow('owner changed before store write')
    expect(writes).toBe(0)
  })

  test('normalization preserves exact template provenance and excludes listed rows', () => {
    const rows = [item_view('0xexact').items[0], { ...item_view('0xlisted').items[0], listed: true }]
    expect(normalize_equip_items(rows)).toEqual([expect.objectContaining({ template_id: '0xexact', stackable: true })])
  })

  test('waits past a stale post-tx projection, then replaces only the confirmed character row', async () => {
    const cloak = {
      id: '0xcloak',
      template_id: '0xtemplate',
      item_type: 'cloak',
      item_category: 'cloak',
      listed: false,
    }
    const projected = { item_id: cloak.id, template: cloak.template_id, category: 'cloak' }
    const characters = (equipment, other_name) => ({
      characters: [
        { id: '0xcharacter', equipment },
        { id: '0xother', equipment: [], name: other_name },
      ],
    })
    const responses = [
      characters([], 'old drain'),
      { items: [cloak] },
      characters([], 'stale wave'),
      { items: [cloak] },
      characters([projected], 'stale unrelated row'),
      { items: [] },
    ]
    const current_other = { id: '0xother', equipment: [{ item_id: '0xkeep' }], name: 'Keep me' }
    const writes = []
    const calls = []

    await reconcile_equip_state(
      {
        address: '0xowner',
        character_id: '0xcharacter',
        expected_change: { equipped_ids: [cloak.id], unequipped_ids: [] },
      },
      {
        read: async (...args) => {
          calls.push(args)
          return responses.shift()
        },
        get_state: () => ({
          sui: { characters: [{ id: '0xcharacter', equipment: [], vitality: 9 }, current_other] },
        }),
        write: (payload) => writes.push(payload),
        map_character: (row) => row,
        mask_items: (rows) => rows,
        merge_items: (rows) => rows,
        wait: async () => {},
      }
    )

    expect(calls).toHaveLength(6)
    expect(calls.every(([, , , fresh]) => fresh === true)).toBe(true)
    expect(writes).toHaveLength(1)
    expect(writes[0].characters).toEqual([{ id: '0xcharacter', equipment: [projected], vitality: 9 }, current_other])
    expect(writes[0].items).toEqual([])
  })
})
