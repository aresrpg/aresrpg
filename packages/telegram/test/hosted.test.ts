// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { perform, read_view } from '../src/hosted.ts'
import { binding_of } from '../src/link.ts'

import { MIRA, THOR, fixture, hero, identity } from './helpers/connected_fixture.ts'

const session = async () => {
  const f = fixture()
  await f.link()
  return { ...f, session: (await f.links.authenticate(42)).bot }
}
const view = async (f: Awaited<ReturnType<typeof session>>) => {
  const read = await read_view(f.session, identity)
  if (!read.ok) throw new Error(read.error)
  return read.value
}

test('one observation is the whole view: heroes the agent holds, every hosted run, and nothing kept', async () => {
  const f = await session()
  f.bot.heroes.push(
    { ...hero('0xfight', 'Fighter'), custody: 'fight', active_fight: { id: 'fight' } },
    { ...hero('0xseat', 'Seated'), custody: 'fight' },
    { ...hero('0xambush', 'Farmer'), ambush: { id: 'protector' } },
    { ...hero('0xdungeon', 'Delver'), dungeon_run: { id: 'run' } },
    { ...hero('0xpersonal', 'Personal'), custody: 'personal' },
    { name: 'Nameless', custody: 'kiosk' },
    null as never
  )
  f.bot.runs.set(MIRA, { id: 'run', character_id: MIRA, status: 'waiting', issue: null, revision: 1, script: {} })
  const observed = await view(f)
  expect(observed.binding).toBe(binding_of(identity))
  expect(observed.balance).toBe('1 SUI')
  expect(observed.runs).toEqual({ [MIRA]: { status: 'waiting', strategy: null } })
  expect(observed.items).toBeNull()
  expect(observed.roster?.revisions).toEqual({ decision_revision: 3, observation_revision: 4 })
  // A personal or malformed row is not an agent hero; a fighting or ambushed one stays visible.
  expect(observed.roster?.heroes.map(({ name, usable, activity }) => [name, usable, activity])).toEqual([
    ['Mira', true, 'idle'],
    ['Thor', true, 'idle'],
    ['Fighter', true, 'fight'],
    ['Seated', false, 'fight'],
    ['Farmer', true, 'ambush'],
    ['Delver', false, 'observation_unknown'],
  ])
  // The observation is the whole read: listing a run costs no read of its own.
  expect(f.bot.calls.map(({ name }) => name).filter((name) => name !== 'bot_identity')).toEqual(['bot_observe'])
  // Only the update that shows the bag reads it: the bot's own bag read, one line per item.
  const bagged = await read_view(f.session, identity, true)
  expect(bagged.ok && bagged.value.items).toEqual([{ item_type: 'wheat', name: 'Wheat', amount: 12 }])
  expect(
    f.bot.calls
      .map(({ name }) => name)
      .slice(-2)
      .toSorted()
  ).toEqual(['bot_inventory', 'bot_observe'])
})

test('a listed run carries the catalogue entry it was bound from; an authored tree carries none', async () => {
  const f = await session()
  const run = (character_id: string, script: unknown) =>
    f.bot.runs.set(character_id, { id: 'run', character_id, status: 'active', issue: null, revision: 1, script })
  run(MIRA, { strategy: 'gather_craft' })
  run(THOR, { strategy: 'team_hunt' })
  run('0xauthored', { tree: { type: 'complete' } })
  run('0xmalformed', { strategy: 7 })
  expect((await view(f)).runs).toEqual({
    [MIRA]: { status: 'active', strategy: 'gather_craft' },
    [THOR]: { status: 'active', strategy: 'team_hunt' },
    '0xauthored': { status: 'active', strategy: null },
    '0xmalformed': { status: 'active', strategy: null },
  })
  expect(f.bot.sent('bot_behavior_status')).toEqual([])
})

test('a pending baseline is no roster, and a failed read is its code, never an empty wallet', async () => {
  const f = await session()
  f.overrides.handler = async (url, init) =>
    JSON.parse(String(init.body)).params?.name === 'bot_observe'
      ? Response.json({ result: { structuredContent: { status: 'pending' } } })
      : f.respond(url, init)
  expect(await view(f)).toMatchObject({ roster: null, runs: {}, items: null, balance: null })
  f.overrides.handler = async () => {
    throw new Error('connection refused')
  }
  expect(await read_view(f.session, identity)).toEqual({ ok: false, error: 'unavailable' })
})

test('balance refuses foreign custody, stale samples and a changed unit scale', async () => {
  const f = await session()
  const sample = {
    address: identity.address,
    unit: 'MIST',
    mist_per_sui: '1000000000',
    clock: 'monotonic_ms',
    balance_mist: '1234500000',
    sampled_at: 90,
    expires_at: 110,
  }
  const with_balance = (balance: unknown) => {
    f.overrides.handler = async (url, init) => {
      if (JSON.parse(String(init.body)).params?.name !== 'bot_observe') return f.respond(url, init)
      const reply = await (await f.respond(url, init)).json()
      const observed = { ...reply.result.structuredContent, balance }
      return Response.json({ ...reply, result: { ...reply.result, structuredContent: observed } })
    }
    return view(f)
  }
  expect((await with_balance(sample)).balance).toBe('1.2345 SUI')
  for (const balance of [
    { ...sample, address: '0xother' },
    { ...sample, expires_at: 100 },
    { ...sample, mist_per_sui: '100' },
    { ...sample, sampled_at: Number.NaN },
    null,
  ])
    expect((await with_balance(balance)).balance).toBeNull()
})

test('a replacement reads the hero’s revision right before it is sent; a missing run sends nothing', async () => {
  const f = await session()
  const script = { version: '1', objective: { title: 'Fixture' }, tree: { type: 'complete' } } as const
  const revisions = { decision_revision: 3, observation_revision: 4 }
  const replace = { type: 'replace', character: THOR, script, revisions, subject: 'Thor' } as const
  expect(await perform(f.session, replace)).toEqual({ ok: false, error: 'behavior_run_not_found' })
  expect(f.bot.sent('bot_replace_behavior')).toEqual([])
  f.bot.runs.set(THOR, { id: 'run', character_id: THOR, status: 'active', issue: null, revision: 7, script })
  f.overrides.handler = async (url, init) => {
    const body = JSON.parse(String(init.body))
    // The fixture tree names no hero; only the request Telegram sends is under test here.
    return body.params?.name === 'bot_replace_behavior'
      ? Response.json({ result: { structuredContent: { status: 'active', revision: 8 } } })
      : f.respond(url, init)
  }
  expect(await perform(f.session, replace)).toMatchObject({ ok: true, value: { revision: 8 } })
  expect(f.sent.at(-1)!.body.params).toEqual({
    name: 'bot_replace_behavior',
    arguments: { script, character_id: THOR, expected_revision: 7, ...revisions },
  })
})
