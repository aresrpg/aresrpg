// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fights and the loot they leave: a streamed fight through the game's real store and socket, a whole practice run
// through the practice page's own modules, the settlement rules of a result, and the claims that collect the loot.
import { afterEach, expect, test } from 'bun:test'
import { create_character_source, create_fight, CONTRACT_CONSTANTS } from '@aresrpg/fight'
import type { TournamentRow } from '@aresrpg/protocol'

import { catalog_spell_sources } from '../src/content/fight_sources.ts'
import { rolled_item_types } from '../src/content/item_templates.ts'
import { GAME_MODULES } from '../src/game/game_modules.ts'
import { claim_is_settleable } from '../src/modules/claims.ts'
import {
  aggregate_result_loot,
  fight_duration,
  fight_experience_after,
  kolizeum_wager_outcome,
  merge_result_loot,
} from '../src/modules/fight_result.ts'
import { settlement_needs_close } from '../src/modules/fight_result_observer.ts'
import { practice_setup } from '../src/modules/practice.ts'
import { automatic_actions } from '../src/modules/tournament.ts'
import { collected_tournament_rewards, combined_tournament_rewards } from '../src/modules/tournament_rewards.ts'
import { advance_practice, next_practice_match, practice_bracket } from '../src/practice/bracket.ts'
import { PRACTICE_MODULES } from '../src/practice/modules.ts'
import { practice_bot_input } from '../src/practice/policy.ts'
import { practice_roster } from '../src/practice/roster.ts'
import { pre_submission_version_race, retry_after_version_race } from '../src/transaction_guard.ts'

import { fight_state } from './fixtures/fight_state.ts'
import { character_row, fake_wallet, memory_storage, settle, sign_in, start_surface, type Started } from './harness.ts'

const running: Started[] = []
afterEach(() => running.splice(0).forEach(({ stop }) => stop()))
const REMEMBERED = 'Sign in with Google'

test('a fight the account holds a seat in mounts its board, a repeated witness changes nothing, and the roster ends it', async () => {
  const wallet = fake_wallet()
  const game = await start_surface(GAME_MODULES, { seat: true, account: { wallet, remembered: REMEMBERED } })
  running.push(game)
  await sign_in(game, { characters: [character_row('0xa', { custody: 'fight' })] })
  game.dispatch({ type: 'character/select', character_id: '0xa' })
  game.receive(fight_state(wallet.address))
  expect(game.state().fight).toMatchObject({ mode: 'remote', mounted: true, error: null })
  expect(game.state().fight.checkpoint?.contract.id).toBe('0xf1')
  game.receive({ type: 'packet/turn_seed', fight: '0xf1', seat: '1', seed: '999' })
  const witnessed = game.state().fight.checkpoint
  const shown = game.state().fight.presentations.length
  game.receive({ type: 'packet/turn_seed', fight: '0xf1', seat: '1', seed: '999' })
  expect(game.state().fight.checkpoint).toEqual(witnessed)
  expect(game.state().fight.presentations).toHaveLength(shown)
  // The roster says the hero left the fight's custody: the board closes.
  game.receive({ type: 'packet/characters', characters: [character_row('0xa', { custody: 'kiosk' })] })
  expect(game.state().fight.mode).toBeNull()
  // A fight the account holds no seat in stays an unmounted preview.
  game.receive(fight_state('0xstranger'))
  expect(game.state().fight.mounted).toBe(false)
})

test('loot claims collect in one batch once rolled, are tried once across reloads, and recovery is explicit', async () => {
  const [rolled_template] = [...rolled_item_types()].find(([, type]) => type === 'wheat_barley')!
  expect(claim_is_settleable({ id: '0x1', kind: 'box' })).toBe(false)
  expect(claim_is_settleable({ id: '0x1', kind: 'box', rolled_template })).toBe(true)
  expect(claim_is_settleable({ id: '0x2', kind: 'crush' })).toBe(true)
  const batches: number[] = []
  const crushes: string[] = []
  const wallet = fake_wallet({
    character: {
      claim_loot_batch: async ({ claims }: { claims: unknown[] }) => {
        batches.push(claims.length)
        return { digest: 'batch' }
      },
      claim_loot: async () => Promise.reject(new Error('one batch only')),
      redeem_crush: async () => {
        crushes.push('crush')
        throw new Error('transaction outcome uncertain')
      },
    },
  })
  const storage = memory_storage({ last_wallet: REMEMBERED })
  const load = async () => {
    const game = await start_surface(GAME_MODULES, { seat: true, account: { wallet, remembered: REMEMBERED }, storage })
    running.push(game)
    await sign_in(game)
    return game
  }
  const game = await load()
  game.dispatch({
    type: 'inventory/boxes_opened',
    claims: Array.from({ length: 14 }, (_, index) => ({
      id: `batch-${index}`,
      kind: 'box',
      rolled_template,
      amount: 50,
    })),
  })
  await settle(5)
  expect(batches).toEqual([14])
  expect(game.state().session.claims).toEqual([])
  // A late snapshot from before the redemption cannot bring a consumed claim back.
  game.receive({ type: 'packet/claims', claims: [{ id: 'batch-0', kind: 'box', rolled_template, amount: 50 }] })
  await settle(5)
  expect(game.state().session.claims).toEqual([])
  expect(batches).toEqual([14])
  // A crush whose outcome is uncertain is tried once, and not again after a reload.
  game.receive({ type: 'packet/claims', claims: [{ id: '0xcrush', kind: 'crush' }] })
  await settle(5)
  game.stop()
  const reloaded = await load()
  reloaded.receive({ type: 'packet/claims', claims: [{ id: '0xcrush', kind: 'crush' }] })
  await settle(5)
  expect(crushes).toHaveLength(1)
  reloaded.dispatch({ type: 'claims/redeem', claim_id: '0xcrush' } as never)
  await settle(5)
  expect(crushes).toHaveLength(2)
})

/** A draw of six played to its end, the first fighter winning every match it plays. */
const play_bracket = (seed: bigint) => {
  const step = (matches: ReturnType<typeof practice_bracket>): ReturnType<typeof practice_bracket> => {
    const index = next_practice_match(matches)
    if (index < 0) return matches
    return step(
      advance_practice(
        matches.map((row, ordinal) => (ordinal === index ? { ...row, done: true, winner: 0 } : row)),
        seed
      )
    )
  }
  return { seed, matches: step(advance_practice(practice_bracket(seed), seed)) }
}
/** One turn of a local fight: the human ends its turn, a bot plays its own; the error of a refused command, if any. */
const play_turn = (runtime: ReturnType<typeof create_fight>): string | null => {
  const checkpoint = runtime.state()
  if (checkpoint.contract.ended) return null
  const active = checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)]!
  if (active !== 0n) return runtime.apply(practice_bot_input(checkpoint)!).error?.code ?? null
  if (practice_bot_input(checkpoint) !== null) return 'a bot played the human seat'
  const observed_ms = checkpoint.contract.turn_started_ms + CONTRACT_CONSTANTS.turn_min_ms
  return runtime.apply({ type: 'end_turn', fighter: 0n, observed_ms }).error?.code ?? null
}

test('a practice run plays local fights to one champion with no account, link or transaction', async () => {
  const practice = await start_surface(PRACTICE_MODULES, { seat: true, href: 'https://aresrpg.world/world/practice' })
  running.push(practice)
  const before = practice.state()
  const hero = create_character_source({ name: 'Hero', classe: 'senshi', level: 30n })
  practice.dispatch({ type: 'practice/start', source: hero, seed: 2n })
  practice.dispatch({ type: 'practice/next' })
  expect(practice.state().fight).toMatchObject({ mode: 'local', mounted: true, error: null })
  practice.dispatch({ type: 'fight/input', fight: null, origin: 'local', input: { type: 'forfeit', fighter: 0n } })
  Array.from({ length: 100 }, () => practice.state().fight.presentations[0]).forEach(() => {
    const [presentation] = practice.state().fight.presentations
    if (presentation) practice.dispatch({ type: 'fight/presented', presentation })
  })
  const after = practice.state()
  expect(after.practice.active).toBeNull()
  expect(after.practice.matches[6]?.done).toBe(true)
  expect(after.session).toBe(before.session)
  expect(after.fight_result).toEqual(before.fight_result)
  expect(practice.sockets()).toHaveLength(0)
  // Every draw of six advances to one champion; a resolved match is never replayed.
  const draws = Array.from({ length: 20 }, (_, seed) => play_bracket(BigInt(seed)))
  expect(draws.map(({ matches }) => matches[6]?.winner)).toEqual(draws.map(() => 0))
  expect(draws.map(({ seed, matches }) => advance_practice(matches, seed + 1n))).toEqual(
    draws.map(({ matches }) => matches)
  )
  // The bots play legal commands through a whole fight and never play the human's seat.
  const matches = advance_practice(practice_bracket(5n), 5n)
  const setup = practice_setup({
    seed: 5n,
    entrants: practice_roster(hero, 5n),
    matches,
    active: next_practice_match(matches),
  })
  const runtime = create_fight({ mode: 'local', setup, seed: 5n })
  expect(runtime.apply({ type: 'start', observed_ms: 0n }).error).toBeNull()
  const refusals = Array.from({ length: 300 }, () => play_turn(runtime)).filter(Boolean)
  expect(refusals).toEqual([])
  expect(runtime.state().contract.ended).toBe(true)
  expect(Object.keys(catalog_spell_sources()).length).toBeGreaterThan(0)
}, 20_000)

test('a result settles once: one retried version race, loot that never shrinks, XP counted once, wager outcome', async () => {
  expect(settlement_needs_close({ closable: true, closed: false })).toBe(true)
  expect(settlement_needs_close({ closable: true, closed: true })).toBe(false)
  const waits: number[] = []
  let attempts = 0
  const settled = await retry_after_version_race(
    async () => {
      attempts += 1
      if (attempts === 1) throw new Error("[sdk] NOT submitted: provided version doesn't match")
      return 'settled'
    },
    async (milliseconds) => void waits.push(milliseconds)
  )
  expect({ attempts, settled, waits }).toEqual({ attempts: 2, settled: 'settled', waits: [250] })
  // A transaction that reached the chain is never retried.
  expect(pre_submission_version_race(new Error('[sdk] transaction abc failed on-chain: version'))).toBe(false)
  const declared = aggregate_result_loot([
    { item_type: 'silk', qty: 2 },
    { item_type: 'silk', qty: 3 },
    { item_type: 'fang', qty: 1 },
  ])
  expect(declared).toEqual([
    { item_type: 'silk', qty: 5 },
    { item_type: 'fang', qty: 1 },
  ])
  expect(merge_result_loot(declared, [{ item_type: 'silk', qty: 2 }])).toEqual(declared)
  expect(fight_experience_after(800, 577, false)).toBe(1_377)
  expect(fight_experience_after(1_377, 577, true)).toBe(1_377)
  expect(fight_duration(2_000, 1_000)).toBe(0)
  // Testnet KolizeumPaid in 8UtiTYgFB7nHm2DS7ADgb5wbZ6Q3uU4gC8jx95tyjARb, captured 2026-08-28.
  expect(kolizeum_wager_outcome({ stake_mist: 1_000_000_000n, payout_mist: 1_350_000_000n })).toEqual({
    kind: 'won',
    mist: 1_350_000_000n,
  })
  expect(kolizeum_wager_outcome({ stake_mist: 200_000_000n, payout_mist: 0n })).toEqual({
    kind: 'lost',
    mist: 200_000_000n,
  })
  expect(kolizeum_wager_outcome(null)).toBeNull()
})

test('a durable result settles through its own hand, waits for Retry after a refusal, and a wager pays through escrow', async () => {
  const settles: unknown[] = []
  const escrow: unknown[] = []
  const wallet = fake_wallet({
    fight: {
      settle: async (args: unknown) => {
        settles.push(args)
        throw new Error('wallet cancelled')
      },
      gas_spent: () => 0n,
    },
    kolizeum: {
      settle: async (args: unknown) => {
        escrow.push(args)
        return { digest: 'settled', paid_mist: 9n, closed: true }
      },
    },
  })
  const game = await start_surface(GAME_MODULES, { seat: true, account: { wallet, remembered: REMEMBERED } })
  running.push(game)
  await sign_in(game, {
    characters: [
      character_row('0xc1', { kiosk: '0xk', kiosk_cap: '0xcap' }),
      character_row('0xc2', { kiosk: '0xk2', kiosk_cap: '0xcap2' }),
    ],
  })
  const resolution = (overrides: Readonly<Record<string, unknown>>) => ({
    fight: '0xf1',
    world: 'nauvis',
    dungeon: null,
    dungeon_room: null,
    kolizeum: null,
    fighter: 0,
    character: '0xc1',
    team: 0,
    winner: 0,
    dead: false,
    settled: false,
    boss_weight: 0,
    kares: '0',
    loot_types: [],
    drops: [],
    ...overrides,
  })
  game.receive({ type: 'packet/fight_resolutions', resolutions: [resolution({})] })
  await settle(5)
  expect(settles).toHaveLength(1)
  // A refused signature is never reopened by itself: only the player's Retry signs again.
  await settle(5)
  expect(settles).toHaveLength(1)
  game.dispatch({ type: 'fight_result/retry', character_id: '0xc1' })
  await settle(5)
  expect(settles).toHaveLength(2)
  // A wagered fight settles through the Kolizeum escrow, never the generic hand, with the hero's own custody.
  game.receive({
    type: 'packet/fight_resolutions',
    resolutions: [resolution({}), resolution({ fight: '0xf2', kolizeum: '0xk1', character: '0xc2' })],
  })
  await settle(5)
  expect(escrow).toEqual([
    expect.objectContaining({
      kolizeum: '0xk1',
      fight: '0xf2',
      fighter_idx: 0n,
      custody: { kiosk: '0xk2', kiosk_cap: '0xcap2' },
    }),
  ])
  expect(settles).toHaveLength(2)
})

test('a tournament prize counts only a certified, successful claim of the account, exact to the base unit', () => {
  const seat = { character: 'hero', owner: 'owner', sui_claimed: false, token_claimed: false, items_claimed: '0' }
  const row = {
    id: 'cup',
    version: '5',
    name: 'Cup',
    status: 'finished',
    organizer: 'admin',
    format: 3,
    entry_fee_mist: '0',
    max_level: null,
    start_before_ms: 10_000,
    sui_bps: [10000, 0, 0, 0, 0],
    token_bps: [10000, 0, 0, 0, 0],
    sui_pool: '0',
    kares_pool: 'pool',
    token_version: '0',
    token_refunded: false,
    token_pool: '0',
    sui_total: '1001',
    token_total: '2000',
    rewards: [{ place: 1, template: 'wood', amount: 2 }],
    teams: [
      {
        name: 'A',
        revision: '0',
        allowed: [],
        place: 1,
        seats: [0, 1, 2].map((index) => ({ ...seat, character: `hero-${index}` })),
      },
    ],
    matches: [],
  } as const
  const receipt = (digest = 'confirmed') => ({
    $kind: 'Transaction',
    Transaction: { digest, effects: { status: { success: true } } },
  })
  const coins = { kind: 'coins' as const, team: 0, seat: 0 }
  const collection = (digest: string) => collected_tournament_rewards(row as never, coins, receipt(digest), 'owner')!
  // A three-seat team splits the pool by seat, rounding down: 1001 / 3 and 2000 / 3.
  expect(collection('confirmed')).toEqual({
    digest: 'confirmed',
    tournament: 'cup',
    rewards: [
      { asset: 'sui', amount: 334n },
      { asset: 'kares', amount: 667n },
    ],
  })
  expect(collected_tournament_rewards(row as never, coins, undefined, 'owner')).toBeNull()
  expect(
    collected_tournament_rewards(
      row as never,
      coins,
      { $kind: 'FailedTransaction', FailedTransaction: receipt().Transaction },
      'owner'
    )
  ).toBeNull()
  expect(
    collected_tournament_rewards(
      row as never,
      coins,
      { Transaction: { digest: 'failed', effects: { status: { success: false } } } },
      'owner'
    )
  ).toBeNull()
  expect(collected_tournament_rewards(row as never, coins, receipt(), 'someone-else')).toBeNull()
  expect(
    combined_tournament_rewards([
      collection('a'),
      collection('b'),
      { digest: 'c', tournament: 'cup', rewards: [{ asset: 'item', template: 'wood', amount: 2n }] },
    ])
  ).toEqual([
    { asset: 'sui', amount: 668n },
    { asset: 'kares', amount: 1334n },
    { asset: 'item', template: 'wood', amount: 2n },
  ])
})

test('tournament prizes: stale snapshots never resurrect a claim, and recovery pays only what is still owed', async () => {
  const me = `0x${'a'.repeat(64)}`
  const claims: unknown[] = []
  const wallet = fake_wallet({
    tournament: {
      claim_coins: async (...args: unknown[]) => {
        claims.push(args)
        return { digest: 'paid' }
      },
    },
  })
  const game = await start_surface(GAME_MODULES, { seat: true, account: { wallet, remembered: REMEMBERED } })
  running.push(game)
  await sign_in(game, { characters: [character_row('a')] })
  const seat = (owner: string, character: string, claimed = { sui_claimed: false, token_claimed: false }) => ({
    character,
    owner,
    ...claimed,
    items_claimed: '0',
  })
  const row: TournamentRow = {
    id: 'cup',
    version: '5',
    name: 'Cup',
    status: 'finished',
    organizer: 'admin',
    format: 3,
    entry_fee_mist: '0',
    max_level: null,
    start_before_ms: 10_000,
    sui_bps: [6000, 2500, 1000, 500, 0],
    token_bps: [6000, 2500, 1000, 500, 0],
    sui_pool: '100',
    kares_pool: 'pool',
    token_version: '0',
    token_refunded: false,
    token_pool: '20',
    sui_total: '100',
    token_total: '20',
    rewards: [{ place: 1, template: 'sword', amount: 1 }],
    teams: [
      { name: 'A', revision: '0', allowed: [], place: 1, seats: [seat(me, 'a')] },
      { name: 'B', revision: '0', allowed: [], place: 2, seats: [seat('0xother', 'c')] },
    ],
    matches: [],
  }
  // Manual recovery claims only the currencies still owed: never an empty claim.
  for (const [sui_claimed, token_claimed] of [
    [true, false],
    [false, true],
    [true, true],
  ] as const) {
    const owed = {
      ...row,
      teams: [{ ...row.teams[0]!, seats: [seat(me, 'a', { sui_claimed, token_claimed })] }, row.teams[1]!],
    }
    game.receive({ type: 'packet/tournaments', tournaments: [owed] })
    game.dispatch({ type: 'tournament/action', id: 'cup', action: { kind: 'coins', team: 0, seat: 0 } })
    await settle(5)
  }
  expect(claims).toEqual([
    ['cup', 0, 0, { sui: false, pool: 'pool' }],
    ['cup', 0, 0, { sui: true, pool: null }],
  ])
  // An older snapshot cannot reopen a finished tournament; a sign-out forgets the account's view.
  const finished = { ...row, version: '9' }
  game.receive({ type: 'packet/tournaments', tournaments: [finished] })
  game.receive({ type: 'packet/tournaments', tournaments: [{ ...row, version: '4', status: 'in_progress' }] })
  expect(game.state().tournament.rows[0]).toMatchObject({ version: '9', status: 'finished' })
  // A prize with no coin to pay never starts an automatic write; an item prize does.
  const items_only = { ...finished, sui_total: '0', token_total: '0' }
  const state = { ...game.state(), tournament: { ...game.state().tournament, rows: [items_only] } }
  expect(automatic_actions(state, 99_000)).toEqual([
    { id: 'cup', action: { kind: 'item', team: 0, seat: 0, reward: 0 } },
  ])
  game.dispatch({ type: 'auth/disconnected' })
  expect(game.state().tournament.rows).toEqual([])
})

test('a crush whose outputs never show frees the claim slot: the next loot box still settles', async () => {
  const [rolled_template] = [...rolled_item_types()].find(([, type]) => type === 'wheat_barley')!
  const crushes: string[] = []
  const boxes: string[] = []
  const wallet = fake_wallet({
    character: {
      redeem_crush: async () => {
        crushes.push('crush')
        return { digest: '0xd', item_ids: ['0xgone'], received_amounts: { '0xgone': 1 } }
      },
      claim_loot: async () => {
        boxes.push('box')
        return { digest: '0xb' }
      },
      claim_loot_batch: async () => {
        boxes.push('box')
        return { digest: '0xb' }
      },
    },
  })
  const game = await start_surface(GAME_MODULES, { seat: true, account: { wallet, remembered: REMEMBERED } })
  running.push(game)
  await sign_in(game)
  game.receive({ type: 'packet/claims', claims: [{ id: '0xcrush', kind: 'crush' }] })
  await settle(5)
  game.receive({ type: 'packet/claims', claims: [{ id: '0xbox', kind: 'box', rolled_template, amount: 1 }] })
  await settle(5)
  expect(crushes).toEqual(['crush'])
  expect(boxes).toEqual(['box'])
})
