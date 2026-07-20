import { describe, expect, it } from 'bun:test'

import {
  apply_fight_participant_names,
  fight_participant_ids,
  resolve_fight_participant_names,
} from './fight_participant_names.js'

const seat = (character, owner, name = '') => ({ character, addr: owner, name })
const owner_a = `0x${'a'.repeat(64)}`
const owner_b = `0x${'b'.repeat(64)}`

describe('fight participant name enrichment', () => {
  it('deduplicates character ids in stable seat order for one batched /v1 read', () => {
    const view = { escrow: [seat('char-b', owner_b), seat('char-a', owner_a), seat('char-b', owner_b), seat('', '')] }
    expect(fight_participant_ids(view)).toEqual(['char-b', 'char-a'])
  })

  it('joins every returned Character name by id and preserves an explicit view name', async () => {
    const calls = []
    const view = {
      escrow: [seat('char-a', owner_a), seat('char-b', owner_b, 'Already Known'), seat('char-c', owner_b)],
    }
    const resolved = await resolve_fight_participant_names(
      view,
      async (query) => {
        calls.push(query)
        return [
          { id: 'char-a', name: 'Ares' },
          { id: 'char-b', name: 'Should Not Override' },
        ]
      },
      new Map()
    )

    expect(calls).toEqual([{ ids: ['char-a', 'char-b', 'char-c'] }])
    expect(resolved.escrow.map((participant) => participant.name)).toEqual(['Ares', 'Already Known', ''])
  })

  it('reuses successful names while retrying unresolved ids on the next refresh', async () => {
    const calls = []
    const cache = new Map()
    const load = async (query) => {
      calls.push(query.ids)
      return query.ids.includes('char-a') ? [{ id: 'char-a', name: 'Ares' }] : []
    }
    const first = await resolve_fight_participant_names(
      { escrow: [seat('char-a', owner_a), seat('char-b', owner_b)] },
      load,
      cache
    )
    const second = await resolve_fight_participant_names(
      { escrow: [seat('char-a', owner_a), seat('char-b', owner_b)] },
      load,
      cache
    )

    expect(first.escrow.map((participant) => participant.name)).toEqual(['Ares', ''])
    expect(second.escrow.map((participant) => participant.name)).toEqual(['Ares', ''])
    expect(calls).toEqual([['char-a', 'char-b'], ['char-b']])
  })

  it('leaves unresolved rows blank on read failure so build_fighters owns the address fallback', async () => {
    const view = { escrow: [seat('char-a', owner_a)] }
    const resolved = await resolve_fight_participant_names(
      view,
      async () => {
        throw new Error('read unavailable')
      },
      new Map()
    )
    expect(resolved).toBe(view)
    expect(resolved.escrow[0].name).toBe('')
  })

  it('does not mutate the source view while applying cached names', () => {
    const view = { escrow: [seat('char-a', owner_a)] }
    const resolved = apply_fight_participant_names(view, new Map([['char-a', 'Ares']]))
    expect(resolved).not.toBe(view)
    expect(resolved.escrow[0].name).toBe('Ares')
    expect(view.escrow[0].name).toBe('')
  })
})
