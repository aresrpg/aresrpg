// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'

import { audio_snapshot, create_game_audio_observer, game_audio_cues } from '../../../src/modules/audio.ts'
import type { FightResult, ResultParticipant } from '../../../src/modules/fight_result.ts'
import { initial_app_state, reduce_app_state, type AppState } from '../../../src/store.ts'

const initial = (): AppState => {
  const base = initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
  return {
    ...base,
    session: {
      ...base.session,
      wallet: { address: 'owner' } as never,
      link_status: 'ready',
      roster_loaded: true,
      characters: [
        {
          id: 'character',
          equipment: [],
          available_points: 5,
          available_spell_points: 3,
          world: 'nauvis',
          jobs: {},
        } as unknown as CharacterRow,
      ],
    },
  }
}

const participant = (id: string, kares = 0n): ResultParticipant => ({
  seat: 0,
  team: 0,
  character_id: id,
  name: id,
  level_before: 1,
  level_after: 1,
  experience_before: 0,
  experience_after: 0,
  hp: 100,
  max_hp: 100,
  dead: false,
  forfeited: false,
  settled: true,
  xp_awarded: 0,
  kares,
  loot: [],
})
const result = (kares = 0n): FightResult => ({
  fight: 'boss-fight',
  boss_weight: 10,
  dungeon: null,
  kolizeum: null,
  kolizeum_wager: null,
  winner: 0,
  duration_ms: 1000,
  gas_spent_mist: 0n,
  participants: [participant('character', kares)],
  own_seat: 0,
  loot_types: [],
  settlement_confirmed: true,
  progression_synced: true,
  error: null,
  result_open: true,
  level_up_open: false,
  level_up_acknowledged: false,
})
const with_results = (state: AppState, current_by_character: Readonly<Record<string, FightResult>>): AppState => ({
  ...state,
  fight_result: { ...state.fight_result, current_by_character },
})
const cues = (before: AppState, after: AppState) => game_audio_cues(audio_snapshot(before), audio_snapshot(after))

test('payouts, projection refreshes and additional owned seats do not replay fight-over audio', () => {
  const before = with_results(initial(), { character: result() })
  const paid = with_results(before, { character: result(25n) })
  expect(cues(before, paid)).toEqual([])
  expect(cues(paid, with_results(paid, { character: result(25n) }))).toEqual([])
  const another = with_results(paid, {
    ...paid.fight_result.current_by_character,
    other: { ...result(25n), participants: [participant('other', 25n)] },
  })
  expect(cues(paid, another)).toEqual([])
  expect(cues(paid, { ...paid, session: { ...paid.session, kares_balance: 900n } })).toEqual([])
})

test('payout amount and boss status changes do not replay an already visible result', () => {
  const before = with_results(initial(), { character: result() })
  expect(cues(before, with_results(before, { character: result() }))).toEqual([])
  expect(cues(before, with_results(before, { character: { ...result(25n), boss_weight: 0 } }))).not.toContain(
    'fight_over'
  )
  expect(
    cues(
      before,
      with_results(before, {
        character: { ...result(), participants: [participant('character'), participant('other', 25n)] },
      })
    )
  ).not.toContain('fight_over')
})

test('initial connection and account changes stay silent when results are hydrated', () => {
  const before = initial()
  const paid = with_results(before, { character: result(25n) })
  expect(cues(before, paid)).toEqual(['fight_over'])
  expect(cues({ ...before, session: { ...before.session, roster_loaded: false } }, paid)).toEqual([])
  expect(cues(before, { ...paid, session: { ...paid.session, wallet: { address: 'someone-else' } as never } })).toEqual(
    []
  )
})

test('craft sounds follow distinct confirmed outcomes, including failed and zero-XP batches', () => {
  const before = initial()
  const action = {
    type: 'character/crafted',
    digest: 'craft-1',
    attempts: 2,
    output_type: 'hat',
    successes: 2,
    character_id: 'character',
    job: 'TAILOR',
    xp: 0,
  } as const
  const crafted = reduce_app_state(before, action)
  expect(cues(before, crafted)).toEqual(['craft_completed'])
  expect(cues(crafted, reduce_app_state(crafted, action))).toEqual([])
  const failed = reduce_app_state(crafted, { ...action, digest: 'craft-2', successes: 0, xp: 20 })
  expect(cues(crafted, failed)).toEqual(['craft_failed'])
  expect(
    reduce_app_state(failed, { ...action, digest: 'craft-2', successes: 0, xp: 20 }).session.characters[0]?.jobs.TAILOR
  ).toBe('20')
})

test('invitation ID sets ignore cloned packets, order changes, removals, and baseline trades', () => {
  const before = initial()
  const invited = { ...before, party: { ...before.party, invitation_ids_by_character: { character: ['p1', 'p2'] } } }
  expect(cues(before, invited)).toEqual(['notification'])
  expect(
    cues(invited, { ...invited, party: { ...invited.party, invitation_ids_by_character: { character: ['p2', 'p1'] } } })
  ).toEqual([])
  expect(cues(invited, before)).toEqual([])
  const row = { id: 'trade', a: 'other', b: 'owner', phase: 'requested' } as const
  const loaded = { ...before, trade: { ...before.trade, loaded: true, rows: [row] as never } }
  expect(cues(before, loaded)).toEqual([])
  expect(cues({ ...loaded, trade: { ...loaded.trade, rows: [] } }, loaded)).toEqual(['notification'])
})

test('snapshots copy equipment identity; stat refreshes and selection do not sound like equipping', () => {
  const before = initial()
  const changed = {
    ...before,
    session: {
      ...before.session,
      characters: [{ ...before.session.characters[0]!, equipment: [{ id: 'hat', slot: 'hat' }] as never }],
    },
  }
  expect(cues(before, changed)).toEqual(['button_confirm'])
  expect(cues(changed, { ...changed, session: { ...changed.session, selected_character_id: 'other' } })).toEqual([])
  const snapshot = audio_snapshot(changed)
  expect(snapshot.equipment.character).toBe('hat:hat')
})

test('the observer establishes a silent baseline and stops effects on disposal', () => {
  let state = with_results(initial(), { character: result(25n) })
  let listener: ((state: AppState, previous: AppState) => void) | undefined
  const played: string[] = []
  const controller = new AbortController()
  create_game_audio_observer((key) => played.push(key))({
    events: {
      on: (name, callback) => {
        if (name === 'STATE_UPDATED') listener = callback as typeof listener
      },
    },
    get_state: () => state,
    dispatch: () => undefined,
    signal: controller.signal,
  })
  expect(played).toEqual([])
  const previous = state
  state = {
    ...state,
    session: { ...state.session, craft_result: { digest: 'craft', successes: 1, attempts: 1, output_type: 'hat' } },
  }
  listener?.(state, previous)
  listener?.(state, state)
  expect(played).toEqual(['craft_completed'])
  controller.abort()
  state = {
    ...state,
    session: { ...state.session, craft_result: { digest: 'later', successes: 1, attempts: 1, output_type: 'hat' } },
  }
  listener?.(state, previous)
  expect(played).toEqual(['craft_completed'])
})

test('mastery baseline is silent; starting and completing the same quest each ring once', () => {
  const before = initial()
  const row = {
    id: 'mastery',
    owner: 'owner',
    points: '0',
    last_completed_epoch: null,
    quest_epoch: '10',
    quest_started_ms: '20',
    quest_world: 'nauvis',
    quest_dungeon: 'dungeon',
    quest_reward: 10,
    quest_completed: false,
  }
  const started = { ...before, mastery: { ...before.mastery, loaded: true, row } }
  expect(cues(before, started)).toEqual([])
  expect(cues({ ...before, mastery: { ...before.mastery, loaded: true } }, started)).toEqual(['quest_started'])
  const completed = {
    ...started,
    mastery: { ...started.mastery, row: { ...row, quest_completed: true, points: '10' } },
  }
  expect(cues(started, completed)).toEqual(['quest_completed'])
  expect(cues(completed, { ...completed, mastery: { ...completed.mastery } })).toEqual([])
})

test('fight result and level-up cues wait for their presentation surfaces', () => {
  const base = initial()
  const fighting = {
    ...with_results(base, { character: result() }),
    fight: { ...base.fight, checkpoint: { contract: { id: 'boss-fight' } } as never },
  }
  expect(cues(base, fighting)).toEqual([])
  const shown = { ...fighting, fight: base.fight }
  expect(cues(fighting, shown)).toEqual(['fight_over'])
  const level = with_results(shown, {
    character: {
      ...result(),
      result_open: false,
      level_up_open: true,
      participants: [{ ...participant('character'), level_after: 2 }],
    },
  })
  expect(cues(shown, level)).toEqual(['level_up'])
  expect(cues(level, { ...level })).toEqual([])
})

test('consumption receipts have their own cue and duplicate receipts do not reapply healing', () => {
  const before = initial()
  const action = {
    type: 'character/consumed',
    digest: 'consumed',
    character_id: 'character',
    item_id: 'potion',
    effect: 'recall',
    heal: 0,
  } as const
  const consumed = reduce_app_state(before, action)
  expect(cues(before, consumed)).toEqual(['teleport'])
  expect(cues(consumed, reduce_app_state(consumed, action))).toEqual([])
  const potion = {
    ...consumed,
    session: { ...consumed.session, consumption_result: { digest: 'potion', effect: 'heal' as const } },
  }
  expect(cues(consumed, potion)).toEqual(['consume'])
})

test('every completed fight uses the former boss reward sound, without requiring KARES', () => {
  const before = initial()
  for (const winner of [0, 1, null]) {
    const completed = with_results(before, { character: { ...result(), boss_weight: 0, winner } })
    expect(cues(before, completed)).toEqual(['fight_over'])
    expect(cues(completed, with_results(completed, { character: { ...result(25n), boss_weight: 0, winner } }))).toEqual(
      []
    )
  }
})

test('demo fight-over presentation plays without a wallet', () => {
  const before = initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
  const completed = { ...before, adventure: { ...before.adventure, phase: 'reward' as const, result: result() } }
  expect(cues(before, completed)).toEqual(['fight_over'])
  expect(cues(completed, { ...completed, adventure: { ...completed.adventure, result: { ...result() } } })).toEqual([])
})

test('the visible level-up overlay sounds even while the result underneath remains open', () => {
  const before = initial()
  const shown = with_results(before, {
    character: { ...result(), level_up_open: true, participants: [{ ...participant('character'), level_after: 2 }] },
  })
  expect(cues(before, shown)).toContain('level_up')
  expect(cues(shown, { ...shown })).toEqual([])
  expect(
    cues(
      shown,
      with_results(shown, {
        character: { ...shown.fight_result.current_by_character.character!, level_up_open: false },
      })
    )
  ).not.toContain('level_up')
})

test('adventure quest progress sounds once, independent of journal opening or a wallet', async () => {
  const { adventure_character } = await import('../../../src/adventure/character.ts')
  const base = initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
  const before = { ...base, adventure: { ...base.adventure, character: adventure_character() } }
  const completed = { ...before, adventure: { ...before.adventure, encounter: 1 } }
  expect(cues(before, completed)).toEqual(['quest_completed'])
  expect(cues(completed, { ...completed, adventure: { ...completed.adventure, journal_open: true } })).toEqual([])
})
