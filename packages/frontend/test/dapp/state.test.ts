// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { bind_team } from '@aresrpg/protocol/strategies'

import { parse_observation } from '../../src/dapp/observation.ts'
import {
  activity_offer,
  fight_spec,
  free_heroes,
  hero_hosted,
  hero_status,
  idle_heroes,
  initial_dapp_state,
  picked_heroes,
  quest_heroes,
  quest_spec,
  raid_seats,
  reduce_dapp,
  running_position,
  selected_hero,
  send_again,
  tab_badges,
  work_spec,
  work_worker,
  type CommandOutcome,
  type DappInput,
  type DappState,
} from '../../src/dapp/state.ts'
import type { DappAccount } from '../../src/dapp/account.ts'
import { RAID_TEAM, type StartSpec } from '../../src/dapp/strategies.ts'

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
const DUNGEON = 'gilded_lorito'
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
type Activity = StartSpec['activity']
/** What each activity asks with nothing chosen: where each hero stands, the bot's own pick, the first dungeon. */
const SPECS: { readonly [K in Activity]: (hero_ids: readonly string[]) => StartSpec } = {
  train: (hero_ids) => ({ activity: 'train', hero_ids, place: null, difficulty: null, fee_cap_mist: null }),
  gather: (hero_ids) => ({ activity: 'gather', hero_ids, work: { mode: 'auto', job: null }, fee_cap_mist: null }),
  raid: (hero_ids) => ({ activity: 'raid', hero_ids, dungeon: DUNGEON, runs: null, fee_cap_mist: null }),
}
const start = (activity: Activity, hero_ids: readonly string[], id: string = activity): DappInput => ({
  type: 'dapp/start',
  id,
  spec: SPECS[activity](hero_ids),
  title: 'Title',
})
const offer = (state: DappState, account: DappAccount, activity: Activity, hero_ids: readonly string[]) =>
  activity_offer(state, account, SPECS[activity](hero_ids), 'Title')
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

test('one version: the page opens on Home, a tab is one field, and nothing of a mode or a second view exists', () => {
  expect(Object.keys(initial_dapp_state()).toSorted()).toEqual(
    [
      'bag_feed',
      'commands',
      'direct',
      'hero_id',
      'link',
      'market_panel',
      'observation',
      'observe_error',
      'positions',
      'proven_ms',
      'quest',
      'raid',
      'settled_ms',
      'tab',
    ].toSorted()
  )
  expect(connected.tab).toBe('home')
  const raiding = fold(connected, { type: 'dapp/tab', tab: 'raid' })
  expect(raiding.tab).toBe('raid')
  expect(fold(raiding, { type: 'dapp/tab', tab: 'raid' })).toBe(raiding)
  // The Market tab opens on Buy, or on the panel asked for; the next plain visit is Buy again.
  expect(connected.market_panel).toBe('BUY')
  const selling = fold(raiding, { type: 'dapp/tab', tab: 'market', panel: 'SELL' })
  expect([selling.tab, selling.market_panel]).toEqual(['market', 'SELL'])
  expect(fold(selling, { type: 'dapp/tab', tab: 'market', panel: 'SELL' })).toBe(selling)
  expect(fold(selling, { type: 'dapp/tab', tab: 'market' }).market_panel).toBe('BUY')
})

test('a quest proposes who goes when nobody is picked, and never a hero that fights, raids or is out', () => {
  // Nothing picked: the strongest hero that can go is proposed. The pick itself stays empty.
  expect(idle_heroes(connected, ACCOUNT).map(({ id }) => id)).toEqual([SECOND, HERO])
  expect(picked_heroes(connected, ACCOUNT)).toEqual([])
  expect(fight_spec(connected, ACCOUNT).hero_ids).toEqual([SECOND])
  expect(connected.quest.hero_ids).toEqual([])
  // Picked heroes go in the order picked.
  const picked = fold(connected, { type: 'dapp/quest_pick', pick: { hero_ids: [HERO, SECOND] } })
  expect(fight_spec(picked, ACCOUNT)).toEqual({ ...SPECS.train([HERO, SECOND]) })
  // A hero in a fight or a dungeon is not free to go, whatever the bot says of it; a hosted one neither.
  const fighting = account_fixture({ characters: [team[0]!, { ...team[1]!, active_fight: { id: 'f', seat: 0 } }] })
  expect(idle_heroes(connected, fighting).map(({ id }) => id)).toEqual([HERO])
  expect(fight_spec(picked, fighting).hero_ids).toEqual([HERO])
  const out = fold(picked, start('train', [SECOND]), settle(SECOND, 'train', done, 300))
  expect(picked_heroes(out, ACCOUNT).map(({ id }) => id)).toEqual([HERO])
  // Before the bot answered a hero claims no status: it can still be proposed, and nothing starts.
  expect(idle_heroes(initial_dapp_state(), ACCOUNT)).toHaveLength(2)

  // Work sends one worker: the pick, else the best free hero of the profession, else the strongest.
  const working = fold(connected, { type: 'dapp/quest_pick', pick: { kind: 'work' } })
  expect(work_worker(working, ACCOUNT)?.id).toBe(SECOND)
  const mining = fold(working, { type: 'dapp/quest_pick', pick: { work: { mode: 'auto', job: 'MINER' } } })
  const miners = account_fixture({
    characters: [
      { ...team[0]!, jobs: { MINER: '900000' } },
      { ...team[1]!, jobs: {} },
    ],
  })
  expect(work_worker(mining, miners)?.id).toBe(HERO)
  expect(work_spec(mining, miners)).toEqual({
    activity: 'gather',
    hero_ids: [HERO],
    work: { mode: 'auto', job: 'MINER' },
    fee_cap_mist: null,
  })
  expect(work_worker(fold(mining, { type: 'dapp/quest_pick', pick: { hero_ids: [SECOND] } }), miners)?.id).toBe(SECOND)
  expect(work_spec(working, account_fixture({ characters: [] })).hero_ids).toEqual([])
})

test('a second Start from a proposal sends nobody else: one press, one hero', () => {
  // Reported 2026-11-21: with nothing picked, the first press sent the proposed hero, the proposal moved
  // to the next free hero at once, and the second press of a double click sent that one too.
  const sent = (state: DappState) => Object.values(state.commands).map(({ hero_id: hero }) => hero)
  for (const kind of ['fight', 'work'] as const) {
    const picking = fold(connected, { type: 'dapp/quest_pick', pick: { kind } })
    const proposal = kind === 'fight' ? fight_spec(picking, ACCOUNT) : work_spec(picking, ACCOUNT)
    expect([kind, proposal.hero_ids, picking.quest.hero_ids]).toEqual([kind, [SECOND], []])
    const once = fold(picking, { type: 'dapp/start', id: 'a', spec: proposal, title: 'Title' })
    expect([kind, sent(once)]).toEqual([kind, [SECOND]])
    // The proposal became the pick, so the tab proposes nobody while that hero is out.
    expect([kind, once.quest.hero_ids]).toEqual([kind, [SECOND]])
    const next = kind === 'fight' ? fight_spec(once, ACCOUNT) : work_spec(once, ACCOUNT)
    expect([kind, next.hero_ids]).toEqual([kind, []])
    // The second press, with the spec the page drew before or after the first: nothing is issued.
    for (const spec of [proposal, next])
      expect(fold(once, { type: 'dapp/start', id: 'b', spec, title: 'Title' })).toBe(once)
    // The answer changes nothing of that: one run, and still nobody else proposed.
    const out = fold(once, settle(SECOND, 'a', done, 300))
    expect([kind, running(out).map(([hero]) => hero), sent(out)]).toEqual([kind, [SECOND], []])
    expect(fold(out, { type: 'dapp/start', id: 'c', spec: proposal, title: 'Title' })).toBe(out)
    expect((kind === 'fight' ? fight_spec(out, ACCOUNT) : work_spec(out, ACCOUNT)).hero_ids).toEqual([])
  }
})

test('the Heroes tab shows the strongest hero until the player chooses one; the default is never stored', () => {
  expect(connected.hero_id).toBeNull()
  expect(selected_hero(connected, ACCOUNT)?.id).toBe(SECOND)
  const chosen = fold(connected, { type: 'dapp/select_hero', hero_id: HERO }, observed({}, 300))
  expect(chosen.hero_id).toBe(HERO)
  expect(selected_hero(chosen, ACCOUNT)?.id).toBe(HERO)
  expect(fold(chosen, { type: 'dapp/select_hero', hero_id: 'ghost' })).toBe(chosen)
  // A chosen hero that left the account falls back to the strongest one that is there.
  expect(selected_hero(chosen, account_fixture({ characters: [team[1]!] }))?.id).toBe(SECOND)
  expect(selected_hero(chosen, account_fixture({ characters: [] }))).toBeNull()
  const pending: DappInput = {
    type: 'dapp/observed',
    observation: parse_observation({ status: 'pending' })!,
    requested_ms: 400,
    now: 400,
  }
  expect(fold(chosen, pending)).toMatchObject({ hero_id: HERO, positions: [] })
})

test('the picks keep what the player chose; who can still go is derived when it is read', () => {
  const picked = fold(
    connected,
    { type: 'dapp/quest_pick', pick: { hero_ids: [SECOND, HERO, SECOND, 'ghost'] } },
    { type: 'dapp/quest_pick', pick: { kind: 'work', work: { mode: 'auto', job: 'FARMER' } } },
    { type: 'dapp/quest_pick', pick: { fee_cap_mist: '900' } }
  )
  // A pick merges: the heroes stay while the kind and the work change. A hero is picked once.
  expect(picked.quest).toEqual({
    kind: 'work',
    hero_ids: [SECOND, HERO, 'ghost'],
    place: null,
    difficulty: null,
    work: { mode: 'auto', job: 'FARMER' },
    fee_cap_mist: '900',
  })
  expect(quest_heroes(picked, ACCOUNT).map(({ id }) => id)).toEqual([SECOND, HERO])
  expect(quest_spec(picked, ACCOUNT)).toEqual({
    activity: 'gather',
    hero_ids: [SECOND, HERO],
    work: { mode: 'auto', job: 'FARMER' },
    fee_cap_mist: '900',
  })
  const fighting = fold(picked, {
    type: 'dapp/quest_pick',
    pick: { kind: 'fight', place: { world: 'nauvis', city: 'thebes' }, difficulty: 'easy', fee_cap_mist: null },
  })
  expect(quest_spec(fighting, ACCOUNT)).toEqual({
    activity: 'train',
    hero_ids: [SECOND, HERO],
    place: { world: 'nauvis', city: 'thebes' },
    difficulty: 'easy',
    fee_cap_mist: null,
  })
  // A malformed cap is never read as "no cap": the whole pick is ignored.
  for (const fee_cap_mist of ['0', '-1', '1.5', 'much'])
    expect(fold(picked, { type: 'dapp/quest_pick', pick: { fee_cap_mist, kind: 'fight' } })).toBe(picked)
  expect(fold(connected, { type: 'dapp/raid_pick', pick: { runs: 0, dungeon: DUNGEON } })).toBe(connected)
  // A hero that is sent out leaves the derived pick and returns when it is free again.
  const out = fold(picked, start('gather', [SECOND]), settle(SECOND, 'gather', done, 300))
  expect(out.quest.hero_ids).toEqual([SECOND, HERO, 'ghost'])
  expect(quest_heroes(out, ACCOUNT).map(({ id }) => id)).toEqual([HERO])
  expect(free_heroes(out, ACCOUNT).map(({ id }) => id)).toEqual([HERO])
})

test('a raid seats a full fight side at most, in the order picked, and keeps its dungeon and its caps', () => {
  const crowd = Array.from({ length: 8 }, (_, index) => character_fixture({ id: hero_id(String(index + 1)) }))
  const account = account_fixture({ characters: crowd })
  const ids = crowd.map(({ id }) => id).toReversed()
  const seated = fold_under(account)(
    connected,
    { type: 'dapp/raid_pick', pick: { hero_ids: [...ids, ids[0]!] } },
    { type: 'dapp/raid_pick', pick: { dungeon: DUNGEON, runs: 3, fee_cap_mist: '5000' } }
  )
  expect(seated.raid).toEqual({ dungeon: DUNGEON, hero_ids: ids.slice(0, RAID_TEAM), runs: 3, fee_cap_mist: '5000' })
  expect(raid_seats(seated, account).map(({ id }) => id)).toEqual(ids.slice(0, RAID_TEAM))
  // Seats can be emptied again, and the caps removed.
  const emptied = fold_under(account)(seated, { type: 'dapp/raid_pick', pick: { hero_ids: [], runs: null } })
  expect(emptied.raid).toMatchObject({ hero_ids: [], runs: null, fee_cap_mist: '5000' })
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
  // The first bag seen is the feed's baseline: nothing has arrived yet.
  expect(both.bag_feed).toMatchObject({ seen: {}, gains: [] })
  const wheat = account_fixture({ characters: team, items: [item_fixture('wheat', 3)] })
  const runs = [hosted(HERO, 'fight_nearby'), hosted(SECOND, 'gather_craft')]
  const fed = fold_under(wheat)(both, observed({ observation_revision: 11, runs }, 700))
  expect(fed.bag_feed.gains).toEqual([{ item_type: 'wheat', amount: 3 }])
  // The socket pushes the bag by itself: any later input folds it, and the same bag is never counted twice.
  expect(fold_under(wheat)(both, { type: 'dapp/tab', tab: 'home' }).bag_feed.gains).toEqual([
    { item_type: 'wheat', amount: 3 },
  ])
  expect(fold_under(wheat)(fed, { type: 'dapp/tab', tab: 'home' })).toBe(fed)
  expect(offer(both, ACCOUNT, 'gather', [HERO, SECOND])).toMatchObject({ out: [{ id: SECOND }], free: [] })
  // The tabs count the heroes they follow, and each hero says what holds it.
  expect(tab_badges(both)).toEqual({ quest: 2, raid: 0 })
  expect(hero_status(both, team[0]!)).toBe('activity')
  expect(hero_status(connected, team[0]!)).toBe('free')
  expect(hero_status(initial_dapp_state(), team[0]!)).toBeNull()
  const seated = character_fixture({ custody: 'fight', active_fight: { id: 'f1', seat: 0 } })
  expect(hero_status(connected, seated)).toBe('fight')
  expect(hero_status(connected, character_fixture({ dungeon_run: { dungeon: DUNGEON, room: 1 } }))).toBe('dungeon')
})

test('a position this page opened keeps exactly what its Start asked, so the same request can be sent again', () => {
  const spec: StartSpec = {
    activity: 'train',
    hero_ids: [HERO, SECOND],
    place: { world: 'nauvis', city: 'thebes' },
    difficulty: 'easy',
    fee_cap_mist: '4000',
  }
  const asked: DappInput = { type: 'dapp/start', id: 'c1', spec, title: 'Title' }
  const out = fold(connected, asked, settle(HERO, 'c1', done, 300), settle(SECOND, 'c1', done, 310))
  expect(out.positions.map(({ sent, activity }) => [sent, activity])).toEqual([
    [spec, 'train'],
    [spec, 'train'],
  ])
  // Stopped, the finished position still holds the request: sending it again starts the free heroes.
  const stopped = fold(out, { type: 'dapp/stop', id: 's', hero_ids: [HERO] }, settle(HERO, 's', done, 400))
  const finished = stopped.positions.find(({ finished_ms }) => finished_ms !== null)!
  expect(finished.sent).toEqual(spec)
  const again = fold(stopped, { type: 'dapp/start', id: 'c2', spec: finished.sent!, title: 'Title' })
  expect(Object.keys(again.commands)).toEqual([HERO])
  // A start whose answer was lost keeps its request on the position its visible run opens.
  const lost = fold(
    connected,
    asked,
    settle(HERO, 'c1', { kind: 'uncertain' }, 300),
    observed({ observation_revision: 11, runs: [hosted(HERO, 'fight_nearby')] }, 400)
  )
  expect(running_position(lost, HERO)?.sent).toEqual(spec)
  // A run another client started carries no request of this page.
  const foreign = fold(connected, observed({ observation_revision: 11, runs: [hosted(HERO, 'fight_nearby')] }, 400))
  expect(running_position(foreign, HERO)?.sent).toBeNull()
  expect(send_again(foreign, ACCOUNT, running_position(foreign, HERO)!, 'Title')).toBeNull()
  // The same request is offered under the run's own title, and is ready only while its hero is free.
  expect(send_again(stopped, ACCOUNT, finished, 'Fallback')).toEqual({ title: 'Fallback', ready: true })
  expect(send_again(stopped, ACCOUNT, { ...finished, objective: 'Hunt' }, 'Fallback')?.title).toBe('Hunt')
  expect(send_again(again, ACCOUNT, finished, 'Fallback')?.ready).toBe(false)
  expect(send_again({ ...stopped, observation: null }, ACCOUNT, finished, 'Fallback')?.ready).toBe(false)
  // A raid whose team is now short of keys is not offered here: the Raid tab confirms that case first.
  const raid = { ...finished, sent: SPECS.raid([HERO, SECOND]) }
  const keyed = (keys: number) => account_fixture({ characters: team, items: [item_fixture(KEY, keys)] })
  expect(send_again(connected, keyed(1), raid, 'Raid')).toBeNull()
  expect(send_again(connected, keyed(2), raid, 'Raid')).toEqual({ title: 'Raid', ready: true })
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

test('heroes sent together hunt as a team: one tree per hero with its allies, and no build is ever bound', () => {
  const sent = fold(connected, start('train', [HERO, SECOND]))
  const scope = { title: 'Title', area: { world: 'nauvis', city: 'thebes' } }
  const scripts = (state: DappState) =>
    Object.values(state.commands).map((command) => command.kind === 'start' && command.script)
  expect(scripts(sent)).toEqual([...bind_team('team_hunt', [{ character: HERO }, { character: SECOND }], scope)])
  expect(scripts(fold(connected, start('train', [HERO])))).toEqual([
    ...bind_team('fight_nearby', [{ character: HERO }], scope),
  ])
  // A hero that is already out is left alone; only the free one is sent, on its own.
  const one_out = fold(connected, start('gather', [SECOND]), settle(SECOND, 'gather', done, 500))
  const rest = fold(one_out, start('train', [HERO, SECOND]))
  expect(Object.keys(rest.commands)).toEqual([HERO])
  expect(JSON.stringify(rest.commands[HERO])).toContain('"max_size":1')
  // The command keeps the whole request, so the position it opens can send it again.
  expect(rest.commands[HERO]).toMatchObject({ kind: 'start', spec: SPECS.train([HERO, SECOND]) })
})

test('a raid short of keys sends only the heroes that hold one; without any key, or anyone free, nothing is sent', () => {
  const keys = (amount: number, characters = team) =>
    account_fixture({ characters, items: amount ? [item_fixture(KEY, amount)] : [] })
  const [one, none, two] = [keys(1), keys(0), keys(2)]
  // One key for two heroes: the first seat enters alone, and the plan says who stays and what is missing.
  expect(offer(connected, one, 'raid', [SECOND, HERO]).plan).toMatchObject({
    starts: [{ hero_id: SECOND }],
    blocked: [{ hero_id: HERO, blocker: 'key_missing' }],
    missing_keys: { [KEY]: 1 },
  })
  const alone = fold_under(one)(connected, start('raid', [SECOND, HERO]))
  expect(Object.keys(alone.commands)).toEqual([SECOND])
  expect(JSON.stringify(alone.commands[SECOND])).toContain('"dungeon":"gilded_lorito"')
  expect(JSON.stringify(alone.commands[SECOND])).toContain('"allies":[]')
  expect(fold_under(none)(connected, start('raid', [HERO, SECOND]))).toBe(connected)
  expect(offer(connected, none, 'raid', [HERO, SECOND]).plan).toMatchObject({ starts: [], missing_keys: { [KEY]: 2 } })
  // A bag the socket is still reading counts no key at all: the raid is not planned from it.
  expect(offer(connected, { ...two, phase: 'loading' }, 'raid', [HERO, SECOND]).plan.blocked).toEqual(
    [HERO, SECOND].map((hero) => ({ hero_id: hero, blocker: 'hero_unknown' }))
  )
  const raiding = fold_under(two)(connected, start('raid', [SECOND, HERO]))
  expect(Object.keys(raiding.commands)).toEqual([SECOND, HERO])
  expect(JSON.stringify(raiding.commands[SECOND])).toContain(`"type":"dungeon","character_id":"${SECOND}"`)
  const fighting = character_fixture({ id: SECOND, custody: 'fight', active_fight: { id: 'f1', seat: 0 } })
  const busy = keys(2, [team[0]!, fighting])
  expect(offer(connected, busy, 'raid', [HERO, SECOND]).plan.blocked).toEqual([
    { hero_id: SECOND, blocker: 'hero_busy' },
  ])
  const all_out = fold_under(two)(raiding, settle(HERO, 'raid', done, 300), settle(SECOND, 'raid', done, 310))
  expect(tab_badges(all_out)).toEqual({ quest: 0, raid: 2 })
  expect(offer(all_out, two, 'train', [HERO, SECOND])).toMatchObject({ free: [], plan: { starts: [], blocked: [] } })
  expect(fold_under(two)(all_out, start('train', [HERO, SECOND]))).toBe(all_out)
  // Nothing is planned before the bot answered.
  expect(offer(initial_dapp_state(), two, 'raid', [HERO, SECOND]).plan.starts).toEqual([])
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
  expect(tab_badges(reloaded)).toEqual({ quest: 1, raid: 1 })
  expect(running_position(reloaded, SECOND)?.issue).toBe('no_matching_branch')
  expect(offer(reloaded, ACCOUNT, 'train', [HERO, SECOND]).free).toEqual([])
  expect(offer(reloaded, ACCOUNT, 'raid', [HERO, SECOND]).out.map(({ id }) => id)).toEqual([HERO])
  // A run that ends by itself finishes its position.
  const ended = fold(reloaded, observed({ observation_revision: 11, runs: [] }, 200))
  expect(running(ended)).toEqual([])
  const cleared = ended.positions.reduce(
    (state, { id }) => reduce_dapp(state, { type: 'dapp/dismiss', position_id: id }, ACCOUNT),
    ended
  )
  expect(cleared).toMatchObject({ positions: [] })
})

test('connect only leaves a signed-in disconnected link; sign-out keeps nothing, not even the picks', () => {
  const disconnected = fold(initial_dapp_state(), { type: 'dapp/link', link: { phase: 'disconnected', error: null } })
  expect(fold(disconnected, { type: 'dapp/connect' }).link.phase).toBe('authorizing')
  expect(fold(initial_dapp_state(), { type: 'dapp/connect' }).link.phase).toBe('idle')
  const chosen = fold(
    connected,
    { type: 'dapp/tab', tab: 'quest' },
    { type: 'dapp/quest_pick', pick: { hero_ids: [HERO], difficulty: 'hard' } },
    { type: 'dapp/raid_pick', pick: { hero_ids: [SECOND], dungeon: DUNGEON } },
    { type: 'dapp/select_hero', hero_id: HERO }
  )
  expect(fold(chosen, { type: 'dapp/link', link: { phase: 'idle' } })).toEqual(initial_dapp_state())
  // Observations without a grant are ignored, and Disconnect waits for unanswered commands.
  expect(fold(disconnected, observed({}, 1))).toBe(disconnected)
  const asking = fold(connected, start('train', [HERO]))
  expect(fold(asking, { type: 'dapp/disconnect' })).toBe(asking)
  expect(fold(chosen, { type: 'dapp/disconnect' })).toEqual({
    ...initial_dapp_state(),
    link: { phase: 'disconnected', error: null },
  })
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
  const offered = offer(after, ACCOUNT, 'train', [SECOND])
  expect(offered.free.map(({ id }) => id)).toEqual([SECOND])
  expect(offered.plan.starts).toHaveLength(1)
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
  // The fees the bot paid ride the same pushed status: for the wallet, and on each run's position.
  const paying = [{ ...gathering[0]!, fees_mist: '1500' }]
  const paid = fold(proven, pushed({ sampled_at: 10, runs: paying, fees_mist: '90000' }))
  expect(paid.observation?.fees_mist).toBe(90_000n)
  expect(running_position(paid, HERO)?.fees_mist).toBe(1_500n)
})
