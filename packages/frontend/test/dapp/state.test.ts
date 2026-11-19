// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { basic_build, bind_team } from '@aresrpg/protocol/strategies'

import { parse_observation } from '../../src/dapp/observation.ts'
import {
  activity_offer,
  hero_hosted,
  initial_dapp_state,
  reduce_dapp,
  running_position,
  type CommandOutcome,
  type DappInput,
  type DappState,
} from '../../src/dapp/state.ts'
import type { DappAccount } from '../../src/dapp/account.ts'

import {
  HERO,
  account_fixture,
  character_fixture,
  hero_id,
  item_fixture,
  observation_fixture,
  run_fixture,
} from './fixtures.ts'

const SECOND = hero_id('2')
const KEY = 'key_of_gilded_lorito'
const team = [character_fixture(), character_fixture({ id: SECOND, name: 'Bran', level: 7 })]
/** The reducer reads the account the game socket pushes; each test names the account it folds under. */
const fold_under =
  (account: DappAccount) =>
  (state: DappState, ...inputs: readonly DappInput[]) =>
    inputs.reduce((next, input) => reduce_dapp(next, input, account), state)
const ACCOUNT = account_fixture({ characters: team })
const fold = fold_under(ACCOUNT)
const observed = (overrides: Readonly<Record<string, unknown>>, requested_ms: number): DappInput => ({
  type: 'dapp/observed',
  observation: observation_fixture(overrides),
  requested_ms,
  now: requested_ms,
})
const connected = fold(initial_dapp_state(), { type: 'dapp/link', link: { phase: 'connected' } }, observed({}, 100))
const start = (
  activity: 'train' | 'gather' | 'raid',
  hero_ids: readonly string[],
  id: string = activity
): DappInput => ({
  type: 'dapp/start',
  id,
  activity,
  hero_ids,
  title: 'Title',
})
const settle = (hero: string, id: string, outcome: CommandOutcome, now: number): DappInput => ({
  type: 'dapp/command_settled',
  hero_id: hero,
  id: `${id}:${hero}`,
  outcome,
  now,
})
const done: CommandOutcome = { kind: 'done' }
/** A run as the bot lists it: every tree bound from the catalogue names its entry. */
const hosted = (hero: string, strategy: string) => run_fixture(hero, 'active', undefined, strategy)
const running = (state: DappState) =>
  state.positions.flatMap(({ hero_id: hero, activity, finished_ms }) =>
    finished_ms === null ? [[hero, activity]] : []
  )

test('Advanced starts on the strongest hero, keeps an explicit selection and survives a pending answer', () => {
  expect(connected.hero_id).toBe(SECOND)
  const chosen = fold(connected, { type: 'dapp/select_hero', hero_id: HERO }, observed({}, 300))
  expect(chosen.hero_id).toBe(HERO)
  expect(fold(chosen, { type: 'dapp/select_hero', hero_id: 'ghost' }).hero_id).toBe(HERO)
  const pending: DappInput = {
    type: 'dapp/observed',
    observation: parse_observation({ status: 'pending' })!,
    requested_ms: 400,
    now: 400,
  }
  expect(fold(chosen, pending)).toMatchObject({ hero_id: HERO, positions: [] })
})

test('two heroes run different activities at once; a hosted hero never gets a second start', () => {
  const sent = fold(connected, start('train', [HERO]), start('gather', [SECOND]))
  expect(Object.values(sent.commands).map(({ hero_id: hero, kind, status }) => [hero, kind, status])).toEqual([
    [HERO, 'start', 'pending'],
    [SECOND, 'start', 'pending'],
  ])
  // Repeated taps and another activity for a hero that is already asked for change nothing.
  expect(fold(sent, start('train', [HERO], 'again'))).toBe(sent)
  expect(fold(sent, start('raid', [HERO, SECOND]))).toBe(sent)
  const both = fold(sent, settle(HERO, 'train', done, 600), settle(SECOND, 'gather', done, 650))
  expect(both.commands).toEqual({})
  expect(running(both)).toEqual([
    [SECOND, 'gather'],
    [HERO, 'train'],
  ])
  expect(fold(both, start('gather', [HERO]))).toBe(both)
  // The haul begins from the bag as it was when the heroes went out, and is told once for both.
  expect(both.haul).toMatchObject({ found: {} })
  const wheat = account_fixture({ characters: team, items: [item_fixture('wheat', 3)] })
  const runs = [hosted(HERO, 'fight_nearby'), hosted(SECOND, 'gather_craft')]
  const fed = fold_under(wheat)(both, observed({ observation_revision: 11, runs }, 700))
  expect(fed.haul?.found).toEqual({ wheat: 3 })
  // The socket pushes the bag by itself: any later input folds it, and the same bag is never counted twice.
  expect(fold_under(wheat)(both, { type: 'dapp/view', view: 'play' }).haul?.found).toEqual({ wheat: 3 })
  expect(fold_under(wheat)(fed, { type: 'dapp/view', view: 'play' })).toBe(fed)
  expect(activity_offer(both, ACCOUNT, 'gather', [HERO, SECOND], 'Title')).toMatchObject({
    out: [{ id: SECOND }],
    free: [],
  })
})

test('stopping one hero leaves the other running, and a stale observation never reopens it', () => {
  const both = fold(
    connected,
    start('train', [HERO]),
    start('gather', [SECOND]),
    settle(HERO, 'train', done, 600),
    settle(SECOND, 'gather', done, 650)
  )
  const stopping = fold(both, { type: 'dapp/stop', id: 's', hero_ids: [HERO] })
  expect(Object.values(stopping.commands)).toMatchObject([{ kind: 'stop', hero_id: HERO, status: 'pending' }])
  expect(fold(stopping, { type: 'dapp/stop', id: 's2', hero_ids: [HERO] })).toBe(stopping)
  const stopped = fold(stopping, settle(HERO, 's', done, 800))
  expect(running(stopped)).toEqual([[SECOND, 'gather']])
  expect(hero_hosted(stopped, HERO)).toBe(false)
  // An observation requested before the stop was answered still lists the run: it proves nothing.
  const gathering = hosted(SECOND, 'gather_craft')
  const stale = fold(
    stopped,
    observed({ observation_revision: 11, runs: [hosted(HERO, 'fight_nearby'), gathering] }, 790)
  )
  expect(running(stale)).toEqual([[SECOND, 'gather']])
  const fresh = fold(stopped, observed({ observation_revision: 11, runs: [gathering] }, 900))
  expect(running(fresh)).toEqual([[SECOND, 'gather']])
  // A refused stop keeps the hero running and says why; it blocks nothing else.
  const refused = fold(stopping, settle(HERO, 's', { kind: 'refused', error: 'unavailable' }, 800))
  expect(running(refused)).toHaveLength(2)
  expect(refused.commands[HERO]).toMatchObject({ status: 'refused', error: 'unavailable' })
  expect(fold(refused, { type: 'dapp/stop', id: 's3', hero_ids: [HERO] }).commands[HERO]?.status).toBe('pending')
})

test('a lost start reply stays uncertain and resolves only from a later observation, never by resending', () => {
  const uncertain = fold(
    connected,
    start('gather', [HERO]),
    start('train', [SECOND]),
    settle(HERO, 'gather', { kind: 'uncertain' }, 600),
    settle(SECOND, 'train', done, 610)
  )
  expect(uncertain.commands[HERO]?.status).toBe('uncertain')
  expect(fold(uncertain, start('gather', [HERO], 'again'))).toBe(uncertain)
  // An observation requested before the failure proves nothing.
  const training = hosted(SECOND, 'fight_nearby')
  const both_runs = { observation_revision: 11, runs: [hosted(HERO, 'gather_craft'), training] }
  expect(fold(uncertain, observed(both_runs, 550)).commands[HERO]?.status).toBe('uncertain')
  const seen = fold(uncertain, observed(both_runs, 700))
  expect(seen.commands).toEqual({})
  expect(running(seen)).toEqual([
    [HERO, 'gather'],
    [SECOND, 'train'],
  ])
  const absent = fold(uncertain, observed({ observation_revision: 11, runs: [training] }, 700))
  expect(absent.commands[HERO]).toMatchObject({ status: 'refused', error: 'start_unconfirmed' })
  expect(running(absent)).toEqual([[SECOND, 'train']])
  // The refusal is only a message: the hero is free again and the next request clears it.
  expect(fold(absent, start('gather', [HERO], 'retry')).commands[HERO]).toMatchObject({
    id: `retry:${HERO}`,
    status: 'pending',
  })
})

test('Basic sends every free hero at once: a team hunt is one tree per hero with its allies and its build', () => {
  const sent = fold(connected, start('train', [HERO, SECOND]))
  const scope = { title: 'Title', area: { world: 'nauvis', city: 'thebes' } }
  // Both fixture heroes are archers, so Basic binds the seed's archer build to each.
  const archers = [HERO, SECOND].map((character) => ({ character, ...basic_build('yogan') }))
  const scripts = (state: DappState) =>
    Object.values(state.commands).map((command) => command.kind === 'start' && command.script)
  expect(scripts(sent)).toEqual([...bind_team('team_hunt', archers, scope)])
  // Advanced acts on one hero and binds no build: the growth leaves it carries list nothing.
  const advanced = fold(connected, { type: 'dapp/mode', mode: 'advanced' }, start('train', [HERO]))
  expect(scripts(advanced)).toEqual([...bind_team('fight_nearby', [{ character: HERO }], scope)])
  // A hero that is already out is left alone; only the free one is sent, on its own.
  const one_out = fold(connected, start('gather', [SECOND]), settle(SECOND, 'gather', done, 500))
  const rest = fold(one_out, start('train', [HERO, SECOND]))
  expect(Object.keys(rest.commands)).toEqual([HERO])
  expect(JSON.stringify(rest.commands[HERO])).toContain('"max_size":1')
})

test('a raid short of keys sends only the heroes that hold one; without any key, or anyone free, nothing is sent', () => {
  const keys = (amount: number, characters = team) =>
    account_fixture({ characters, items: amount ? [item_fixture(KEY, amount)] : [] })
  const [one, none, two] = [keys(1), keys(0), keys(2)]
  // One key for two heroes: the stronger one enters alone, and the plan says who stays and what is missing.
  expect(activity_offer(connected, one, 'raid', [HERO, SECOND], 'Title').plan).toMatchObject({
    starts: [{ hero_id: SECOND }],
    blocked: [{ hero_id: HERO, blocker: 'key_missing' }],
    missing_keys: { [KEY]: 1 },
  })
  const alone = fold_under(one)(connected, start('raid', [HERO, SECOND]))
  expect(Object.keys(alone.commands)).toEqual([SECOND])
  expect(JSON.stringify(alone.commands[SECOND])).toContain('"dungeon":"gilded_lorito"')
  expect(JSON.stringify(alone.commands[SECOND])).toContain('"allies":[]')
  expect(fold_under(none)(connected, start('raid', [HERO, SECOND]))).toBe(connected)
  expect(activity_offer(connected, none, 'raid', [HERO, SECOND], 'Title').plan).toMatchObject({
    starts: [],
    missing_keys: { [KEY]: 2 },
  })
  // A bag the socket is still reading counts no key at all: the raid is not planned from it.
  expect(activity_offer(connected, { ...two, phase: 'loading' }, 'raid', [HERO, SECOND], 'Title').plan.blocked).toEqual(
    [HERO, SECOND].map((hero) => ({ hero_id: hero, blocker: 'hero_unknown' }))
  )
  const raiding = fold_under(two)(connected, start('raid', [HERO, SECOND]))
  expect(Object.keys(raiding.commands)).toEqual([SECOND, HERO])
  expect(JSON.stringify(raiding.commands[SECOND])).toContain(`"type":"dungeon","character_id":"${SECOND}"`)
  const fighting = character_fixture({ id: SECOND, custody: 'fight', active_fight: { id: 'f1', seat: 0 } })
  const busy = keys(2, [team[0]!, fighting])
  expect(activity_offer(connected, busy, 'raid', [HERO, SECOND], 'Title').plan.blocked).toEqual([
    { hero_id: SECOND, blocker: 'hero_busy' },
  ])
  const all_out = fold_under(two)(raiding, settle(HERO, 'raid', done, 300), settle(SECOND, 'raid', done, 310))
  expect(activity_offer(all_out, two, 'train', [HERO, SECOND], 'Title')).toMatchObject({
    free: [],
    plan: { starts: [], blocked: [] },
  })
  expect(fold_under(two)(all_out, start('train', [HERO, SECOND]))).toBe(all_out)
})

test('the bot owns the run limit: its refusal is kept per hero and the dapp adds no cap of its own', () => {
  const crowd = Array.from({ length: 31 }, (_, index) =>
    character_fixture({ id: `0x${String(index + 10).padStart(64, '0')}`, name: `Hero ${index}` })
  )
  const ids = crowd.map(({ id }) => id)
  const sent = fold_under(account_fixture({ characters: crowd }))(connected, start('gather', ids))
  expect(Object.keys(sent.commands)).toHaveLength(31)
  const last = ids.at(-1)!
  const refused = fold(sent, settle(last, 'gather', { kind: 'refused', error: 'run_limit_reached' }, 300))
  expect(refused.commands[last]).toMatchObject({ status: 'refused', error: 'run_limit_reached' })
  expect(hero_hosted(refused, last)).toBe(false)
  expect(hero_hosted(refused, ids[0]!)).toBe(true)
})

test('a reload names every running hero from the first observation: the bot says what each run is', () => {
  const runs = [
    run_fixture(HERO, 'active', undefined, 'dungeon_raid'),
    run_fixture(SECOND, 'awaiting_ai', 'no_matching_branch'),
  ]
  const reloaded = fold(
    initial_dapp_state(),
    { type: 'dapp/link', link: { phase: 'connected' } },
    observed({ runs }, 100)
  )
  // The raid is named at once, with no tree read; a tree bound from no catalogue entry has no activity.
  expect(running(reloaded)).toEqual([
    [HERO, 'raid'],
    [SECOND, null],
  ])
  expect(running_position(reloaded, SECOND)?.issue).toBe('no_matching_branch')
  expect(activity_offer(reloaded, ACCOUNT, 'train', [HERO, SECOND], 'Title').free).toEqual([])
  expect(activity_offer(reloaded, ACCOUNT, 'raid', [HERO, SECOND], 'Title').out.map(({ id }) => id)).toEqual([HERO])
  // A run that ends by itself finishes its position; dismissing the last one ends the haul too.
  const ended = fold(reloaded, observed({ observation_revision: 11, runs: [] }, 200))
  expect(running(ended)).toEqual([])
  expect(ended.haul).not.toBeNull()
  const cleared = ended.positions.reduce(
    (state, { id }) => reduce_dapp(state, { type: 'dapp/dismiss', position_id: id }, ACCOUNT),
    ended
  )
  expect(cleared).toMatchObject({ positions: [], haul: null })
})

test('connect only leaves a signed-in disconnected link; sign-out keeps only the device mode', () => {
  const disconnected = fold(initial_dapp_state(), { type: 'dapp/link', link: { phase: 'disconnected', error: null } })
  expect(fold(disconnected, { type: 'dapp/connect' }).link.phase).toBe('authorizing')
  expect(fold(initial_dapp_state(), { type: 'dapp/connect' }).link.phase).toBe('idle')
  const advanced = fold(
    connected,
    { type: 'dapp/mode', mode: 'advanced' },
    { type: 'dapp/link', link: { phase: 'idle' } }
  )
  expect(advanced).toEqual({ ...initial_dapp_state(), mode: 'advanced' })
  // Observations without a grant are ignored, and Disconnect waits for unanswered commands.
  expect(fold(disconnected, observed({}, 1))).toBe(disconnected)
  const asking = fold(connected, start('train', [HERO]))
  expect(fold(asking, { type: 'dapp/disconnect' })).toBe(asking)
  expect(fold(connected, { type: 'dapp/disconnect' }).link).toEqual({ phase: 'disconnected', error: null })
})

test('a stat or spell change is one direct request at a time and waits for no hosted hero', () => {
  const action: DappInput = {
    type: 'dapp/hero_action',
    id: 'h1',
    hero_id: HERO,
    action: 'raise_spell',
    payload: { character_id: HERO, spell: 's' },
  }
  const changing = fold(connected, action)
  expect(changing.commands[HERO]).toMatchObject({ kind: 'hero_action', action: 'raise_spell', status: 'pending' })
  // The bot signs it in turn with its heroes, so another hero starts without waiting for the answer.
  expect(Object.keys(fold(changing, start('train', [SECOND])).commands)).toEqual([HERO, SECOND])
  // The bot holds one direct request at a time: a second change waits for the first.
  expect(fold(changing, { ...action, id: 'h2', hero_id: SECOND })).toBe(changing)
  expect(fold(changing, settle(HERO, 'h1', done, 300)).commands).toEqual({ [HERO]: changing.commands[HERO] })
  const answered = fold(changing, { type: 'dapp/command_settled', hero_id: HERO, id: 'h1', outcome: done, now: 300 })
  expect(answered.commands).toEqual({})
  // A hero out on an activity no longer locks the others.
  const elsewhere = fold(connected, observed({ observation_revision: 11, runs: [run_fixture(SECOND)] }, 200))
  expect(fold(elsewhere, action).commands[HERO]).toMatchObject({ kind: 'hero_action', status: 'pending' })
  // The answer only says the bot took the request: while the bot still holds it, the next one waits.
  const direct = { id: 'c1', kind: 'raise_spell', status: 'executing', payload: {} }
  const held = fold(answered, observed({ observation_revision: 12, direct }, 400))
  expect(fold(held, { ...action, id: 'h2', hero_id: SECOND })).toBe(held)
  const over = fold(held, observed({ observation_revision: 13, direct: { ...direct, status: 'completed' } }, 500))
  expect(fold(over, { ...action, id: 'h2', hero_id: SECOND }).commands[SECOND]).toMatchObject({ status: 'pending' })
})

test('a stopped run the bot still lists is not running: the hero is free and nothing reopens', () => {
  const stopping = fold(
    connected,
    start('train', [SECOND]),
    settle(SECOND, 'train', done, 300),
    { type: 'dapp/stop', id: 'halt', hero_ids: [SECOND] },
    settle(SECOND, 'halt', done, 400)
  )
  // The bot lists a stopped run until its next queue pass.
  const listed = run_fixture(SECOND, 'stopped', 'explicit_stop', 'fight_nearby')
  const after = fold(stopping, observed({ observation_revision: 11, runs: [listed] }, 500))
  expect(running(after)).toEqual([])
  expect(after.positions).toHaveLength(1)
  expect(hero_hosted(after, SECOND)).toBe(false)
  const offer = activity_offer(after, ACCOUNT, 'train', [SECOND], 'Title')
  expect(offer.free.map(({ id }) => id)).toEqual([SECOND])
  expect(offer.plan.starts).toHaveLength(1)
  // A reload sees the same: a stopped, failed or completed run opens no position.
  for (const status of ['stopped', 'failed', 'completed', 'paused']) {
    const reloaded = fold(connected, observed({ observation_revision: 11, runs: [run_fixture(SECOND, status)] }, 200))
    expect(running(reloaded)).toEqual([])
  }
  expect(
    running(fold(connected, observed({ observation_revision: 11, runs: [run_fixture(SECOND, 'awaiting_ai')] }, 200)))
  ).toEqual([[SECOND, null]])
})

test('a pushed status follows runs once a read proved the view, and proves nothing after a new answer', () => {
  const pushed = (overrides: Readonly<Record<string, unknown>>): DappInput => ({
    type: 'dapp/observed',
    observation: observation_fixture(overrides),
    requested_ms: null,
    now: 500,
  })
  const gathering = [run_fixture(HERO, 'active', undefined, 'gather_craft')]
  // The read at connect proved the view: the bot's own pushes open and finish positions with no read.
  const out = fold(connected, pushed({ sampled_at: 5, runs: gathering }))
  expect(running_position(out, HERO)?.activity).toBe('gather')
  expect(running_position(fold(out, pushed({ sampled_at: 6 })), HERO)).toBeNull()
  // A status older than the one on screen never replaces it.
  expect(fold(out, pushed({ sampled_at: 4 }))).toEqual(out)
  // A start was just answered: a status pushed before that answer could miss the run, so it finishes nothing.
  const started = fold(connected, start('gather', [SECOND]), settle(SECOND, 'gather', { kind: 'done' }, 600))
  const stale = fold(started, pushed({ sampled_at: 7 }))
  expect(running_position(stale, SECOND)?.activity).toBe('gather')
  // Only a read requested after the answer says the run is gone; from then on pushes count again.
  const proven = fold(stale, observed({ sampled_at: 8 }, 700))
  expect(running_position(proven, SECOND)).toBeNull()
  expect(running_position(fold(proven, pushed({ sampled_at: 9, runs: gathering })), HERO)?.activity).toBe('gather')
})
