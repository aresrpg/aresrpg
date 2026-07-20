// RED-FIRST (07-19): before this file existed, FightsModal and fight.js each hand-rolled their own
// "ids → /v1/characters docs" glue — this proves the extracted ONE HOME resolves real names off a batched
// read and only ever falls back to the truncated id when a doc is genuinely missing (never invents one).
import { describe, expect, it } from 'bun:test'

import { resolve_character_docs, short_fighter_id, missing_roster_character_ids } from './character_name_resolve.js'

describe('character_name_resolve — the ONE HOME (raw addresses leaking onto fighter rows)', () => {
  it('resolves a batch of ids to their character docs, keyed by id', async () => {
    const fetch_characters = async ({ ids }) => {
      expect(ids).toEqual(['0xa', '0xb'])
      return [
        { id: '0xa', name: 'Ares', level: 12 },
        { id: '0xb', name: 'Vex', level: 7 },
      ]
    }
    const docs = await resolve_character_docs(['0xa', '0xb'], fetch_characters)
    expect(docs.get('0xa')?.name).toBe('Ares')
    expect(docs.get('0xb')?.name).toBe('Vex')
  })

  it('dedupes + drops empties before the request, and short-circuits to an empty Map with none left', async () => {
    let called = false
    const fetch_characters = async () => {
      called = true
      return []
    }
    const docs = await resolve_character_docs([null, undefined, ''], fetch_characters)
    expect(called).toBe(false)
    expect(docs.size).toBe(0)
  })

  it('a genuinely missing doc is absent from the Map (caller falls back to short_fighter_id, never invents a name)', async () => {
    const fetch_characters = async () => [{ id: '0xa', name: 'Ares' }] // '0xb' never indexed
    const docs = await resolve_character_docs(['0xa', '0xb'], fetch_characters)
    expect(docs.has('0xa')).toBe(true)
    expect(docs.has('0xb')).toBe(false)
  })

  it('a failed read degrades to an empty Map (never throws into the caller)', async () => {
    const fetch_characters = async () => {
      throw new Error('RPC_UNAVAILABLE')
    }
    const docs = await resolve_character_docs(['0xa'], fetch_characters)
    expect(docs.size).toBe(0)
  })

  it('shortens an unresolved long id without losing both ends', () => {
    expect(short_fighter_id('0x1234567890abcdef1234567890')).toBe('0x12345…67890')
  })
})

// RED-FIRST (07-19: the fight-HUD fighter row showed "0XDEE0…AD38 LV 1" for a party member). ctx.roster
// (project.js's engine_view: `roster.find(c => c.id === character_id)`) used to carry ONLY `sui.characters` (my
// own alts) — any co-fighter outside my own roster fell straight to the raw-address fallback. This proves the
// pure "who still needs a /v1 doc" selector fight.js's ensure_roster now widens off.
describe('missing_roster_character_ids — fight.js ctx.roster widening', () => {
  it('finds player fighters not yet in "mine" or already-resolved — the raw-address repro', () => {
    const fighters = new Map([
      ['e1', { is_player: true, character_id: '0xmine' }],
      ['e2', { is_player: true, character_id: '0xparty-member' }], // NOT in sui.characters — the bug
      ['mob-0', { is_player: false, character_id: null }],
    ])
    const mine = [{ id: '0xmine', name: 'Ares' }]
    expect(missing_roster_character_ids(fighters, mine, new Set())).toEqual(['0xparty-member'])
  })

  it('excludes ids already resolved or already pending (never re-requests)', () => {
    const fighters = new Map([['e2', { is_player: true, character_id: '0xparty-member' }]])
    expect(missing_roster_character_ids(fighters, [], new Set(['0xparty-member']))).toEqual([])
  })

  it('dedupes repeated character ids across fighter entries', () => {
    const fighters = new Map([
      ['e2', { is_player: true, character_id: '0xdupe' }],
      ['e3', { is_player: true, character_id: '0xdupe' }],
    ])
    expect(missing_roster_character_ids(fighters, [], new Set())).toEqual(['0xdupe'])
  })

  it('mobs (is_player false) never enter the character-resolution request', () => {
    const fighters = new Map([['mob-0', { is_player: false, character_id: 'mob-template-x' }]])
    expect(missing_roster_character_ids(fighters, [], new Set())).toEqual([])
  })

  it('an empty/undefined fighters map yields no work', () => {
    expect(missing_roster_character_ids(undefined, [], new Set())).toEqual([])
    expect(missing_roster_character_ids(new Map(), [], new Set())).toEqual([])
  })
})
