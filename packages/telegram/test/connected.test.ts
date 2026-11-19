// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { BOT_FAILURES } from '@aresrpg/protocol/hosted-bot-client'

import { FAILURE_CODES } from '../src/connected.ts'
import { card } from '../src/transport.ts'

import { MIRA, THOR, deferred, hero, limits } from './helpers/connected_fixture.ts'
import { buttons, calls, en, input, labels, linked, plain, redeliver, tree_area } from './helpers/runtime_fixture.ts'

test('each hero has its own run: two heroes play different strategies at once and Status lists both in one message', async () => {
  const f = await linked()
  expect(plain(await f.launch('Mira', 'fight_nearby'))).toBe(
    `Mira · ${en.strategies.fight_nearby} · ${en.strategy_active}`
  )
  expect(plain(await f.launch('Thor', 'gather_craft'))).toBe(
    `Thor · ${en.strategies.gather_craft} · ${en.strategy_active}`
  )
  // Each start is one request that names its own hero through its tree: no run id, no wallet-wide slot.
  expect(f.bot.sent('bot_start_behavior').map(({ arguments: args }) => Object.keys(args).toSorted())).toEqual([
    ['decision_revision', 'idempotency_key', 'observation_revision', 'script'],
    ['decision_revision', 'idempotency_key', 'observation_revision', 'script'],
  ])
  expect([...f.bot.runs.keys()]).toEqual([MIRA, THOR])
  expect(tree_area(f.bot.runs.get(MIRA))).toEqual({ world: 'nauvis', city: 'thebes' })
  expect(tree_area(f.bot.runs.get(THOR))).toEqual({ world: 'nauvis' })
  const before = f.cards.length
  const status = await f.say('/status')
  expect(f.cards).toHaveLength(before + 1)
  expect(plain(status).split('\n').slice(0, 3)).toEqual([
    `${en.balance}: 1 SUI`,
    `Mira · ${en.strategies.fight_nearby} · ${en.strategy_active}`,
    `Thor · ${en.strategies.gather_craft} · ${en.strategy_active}`,
  ])
  // A hero with a run shows its state in that list; a free one says so on its button.
  f.bot.heroes.push(hero(`0x${'c'.repeat(64)}`, 'Zed'))
  expect(labels(await f.say('/menu')).slice(0, 3)).toEqual(['Mira', 'Thor', `Zed · ${en.idle}`])
})

test('a run another client started is listed under one generic label and can be stopped; listing reads no run', async () => {
  const f = await linked()
  const run = (character_id: string, status: string, script: unknown) =>
    f.bot.runs.set(character_id, { id: `run-${character_id}`, character_id, status, issue: null, revision: 1, script })
  // The web dapp runs a team hunt with Thor; an AI client authored Mira's tree by hand.
  run(THOR, 'active', { strategy: 'team_hunt' })
  run(MIRA, 'awaiting_ai', { tree: { type: 'complete' } })
  const status = await f.say('/status')
  expect(plain(status).split('\n').slice(1, 3)).toEqual([
    `Thor · ${en.external_strategy} · ${en.strategy_active}`,
    `Mira · ${en.external_strategy} · ${en.attention}`,
  ])
  expect(labels(await f.say('/stop'))).toEqual(['Thor', 'Mira', en.stop_all, en.back, en.status])
  // Choosing the hero asks first; nothing is sent until the choice is confirmed.
  expect(plain(await f.press('Thor'))).toBe(`${en.stop} · Thor\n${en.stop_scope}`)
  expect(f.bot.sent('bot_stop_behavior')).toEqual([])
  expect(plain(await f.press(en.approve))).toBe(`Thor · ${en.stopped}`)
  expect(f.bot.sent('bot_stop_behavior').map((call) => call.arguments)).toEqual([{ character_id: THOR }])
  expect(f.bot.runs.get(MIRA)!.status).toBe('awaiting_ai')
  // Neither the status nor the Stop card read a run: the observation lists every one of them.
  expect(f.bot.sent('bot_behavior_status')).toEqual([])
})

test('stopping one hero leaves the other running; Stop all is one extra button on the same card', async () => {
  const f = await linked()
  await f.launch('Mira', 'fight_nearby')
  await f.launch('Thor', 'gather_craft')
  const choice = await f.say('/stop')
  expect(plain(choice)).toBe(`${en.stop}\n${en.stop_scope}`)
  expect(labels(choice)).toEqual(['Mira', 'Thor', en.stop_all, en.back, en.status])
  // Opening the card stopped nothing.
  expect(f.bot.sent('bot_stop_behavior')).toEqual([])
  await f.press('Mira')
  expect(plain(await f.press(en.approve))).toBe(`Mira · ${en.stopped}`)
  expect(f.bot.sent('bot_stop_behavior').map((call) => call.arguments)).toEqual([{ character_id: MIRA }])
  expect([f.bot.runs.get(MIRA)!.status, f.bot.runs.get(THOR)!.status]).toEqual(['stopped', 'active'])
  // One running hero: no Stop all.
  expect(labels(await f.say('/stop'))).toEqual(['Thor', en.back, en.status])
  // A stopped hero is free again, and starts instead of replacing.
  expect(plain(await f.review('Mira', 'gather_craft'))).not.toContain(en.replace_strategy)
  await f.press('approve:')
  expect(f.bot.runs.get(MIRA)!.status).toBe('active')
  await f.say('/stop')
  expect(plain(await f.press(en.stop_all))).toBe(`${en.stop} · Mira, Thor\n${en.stop_scope}`)
  expect(plain(await f.press(en.approve))).toBe(`Mira · ${en.stopped}\nThor · ${en.stopped}`)
  expect([...f.bot.runs.values()].map(({ status }) => status)).toEqual(['stopped', 'stopped'])
  expect(buttons(await f.say('/menu'))).not.toContain('/stop')
})

test('replacing a strategy targets that hero at its current revision and leaves the other hero untouched', async () => {
  const f = await linked()
  await f.launch('Mira', 'fight_nearby')
  await f.launch('Thor', 'gather_craft')
  const reviewed = await f.review('Mira', 'gather_craft')
  expect(plain(reviewed).split('\n').slice(0, 4)).toEqual([
    en.review,
    `Mira · ${en.strategies.gather_craft}`,
    en.world_review.replace('{world}', 'nauvis'),
    en.replace_strategy,
  ])
  expect(f.bot.sent('bot_replace_behavior')).toEqual([])
  expect(plain(await f.press('approve:'))).toBe(`Mira · ${en.strategies.gather_craft} · ${en.strategy_active}`)
  const [replacement] = f.bot.sent('bot_replace_behavior')
  expect(replacement!.arguments).toMatchObject({ character_id: MIRA, expected_revision: 1 })
  expect(Object.keys(replacement!.arguments)).not.toContain('run_id')
  expect(tree_area(f.bot.runs.get(MIRA))).toEqual({ world: 'nauvis' })
  expect([f.bot.runs.get(MIRA)!.revision, f.bot.runs.get(THOR)!.revision]).toEqual([2, 1])
  expect(f.bot.sent('bot_start_behavior')).toHaveLength(2)
})

test('a lost start reply is unknown for that hero only: it is observed, never sent again, and the other hero stays usable', async () => {
  const f = await linked()
  f.bot.lost.add('bot_start_behavior')
  const answer = await f.launch('Mira', 'fight_nearby')
  expect(plain(answer)).toBe(en.unknown)
  expect(buttons(answer)).toEqual(['/status'])
  // Telegram redelivers the same approval: it is stale, and the request is not sent a second time.
  const approval = f.cards.at(-2)!.reply_markup.inline_keyboard[0]![0]!.callback_data
  await f.runtime.fetch(input(900, approval, true))
  expect(f.bot.sent('bot_start_behavior')).toHaveLength(1)
  f.bot.lost.clear()
  // The other hero is not fenced by it.
  expect(plain(await f.launch('Thor', 'gather_craft'))).toBe(
    `Thor · ${en.strategies.gather_craft} · ${en.strategy_active}`
  )
  // Status asks the bot, which did accept the lost request. Telegram keeps no copy of the outcome.
  expect(plain(await f.press('/status'))).toContain(
    `Mira · ${en.strategies.fight_nearby} · ${en.strategy_active}\nThor · ${en.strategies.gather_craft} · ${en.strategy_active}`
  )
  // The hero the bot now plays can only be replaced after a new review, never started twice.
  expect(plain(await f.review('Mira', 'fight_nearby'))).toContain(en.replace_strategy)
  expect(f.bot.sent('bot_start_behavior')).toHaveLength(2)
})

test('a start the bot never received leaves that hero free; a new approval is a new request', async () => {
  const f = await linked()
  f.overrides.handler = async (url, init) => {
    if (JSON.parse(String(init.body)).params?.name === 'bot_start_behavior') throw new Error('never reached the bot')
    return f.respond(url, init)
  }
  expect(plain(await f.launch('Mira', 'fight_nearby'))).toBe(en.unknown)
  f.overrides.handler = undefined
  const status = await f.press('/status')
  expect(plain(status)).toContain(en.no_strategy)
  expect(labels(status)).toContain(`Mira · ${en.idle}`)
  expect(plain(await f.launch('Mira', 'fight_nearby'))).toContain(en.strategy_active)
  const keys = f.sent
    .filter(({ body }) => body.params?.name === 'bot_start_behavior')
    .map(({ body }) => body.params.arguments.idempotency_key)
  expect(new Set(keys).size).toBe(2)
})

test('the run limit and a busy or paused agent each answer one sentence and one next step', async () => {
  const f = await linked()
  f.bot.run_limit = 1
  await f.launch('Mira', 'fight_nearby')
  const full = await f.launch('Thor', 'gather_craft')
  expect([plain(full), buttons(full)]).toEqual([en.failure_run_limit, ['/stop']])
  expect(f.bot.runs.has(THOR)).toBe(false)
  // Its one step lists who can be stopped.
  expect(labels(await f.press(en.stop))).toContain('Mira')
  f.bot.run_limit = 30
  f.bot.paused = true
  const busy = await f.launch('Thor', 'gather_craft')
  expect([plain(busy), buttons(busy)]).toEqual([en.failure_busy, ['/status']])
  expect(f.bot.runs.has(THOR)).toBe(false)
  for (const sentence of [en.failure_run_limit, en.failure_busy]) expect(sentence).not.toMatch(/_|\berror\b/i)
})

test('recovery mode keeps the login: the bot answers 503, nothing is revoked, and the next update works', async () => {
  const f = await linked()
  f.overrides.handler = async (url, init) =>
    url.endsWith('/mcp') ? Response.json({ error: 'service_unavailable' }, { status: 503 }) : f.respond(url, init)
  const grant_calls = () => calls(f, (url) => ['/oauth/revoke', '/oauth/token'].some((path) => url.endsWith(path)))
  const before = grant_calls()
  const refused = await f.say('/menu')
  expect([plain(refused), buttons(refused)]).toEqual([en.failure_temporary, []])
  // The grant is neither revoked nor refreshed away: recovery is the service's state, not a fault of the login.
  expect((await f.user())?.refresh_token).toBe('refresh')
  expect(grant_calls()).toBe(before)
  f.overrides.handler = undefined
  expect(labels(await f.say('/menu'))).toContain(`Mira · ${en.idle}`)
})

test('a Stop button for a hero that no longer runs stops nothing and shows the current state', async () => {
  const f = await linked()
  await f.launch('Mira', 'fight_nearby')
  await f.say('/stop')
  // The run ended at the bot while the card was open.
  f.bot.runs.delete(MIRA)
  const before = f.cards.length
  await f.press('Mira')
  expect(f.bot.sent('bot_stop_behavior')).toEqual([])
  expect(plain(f.cards[before]!)).toBe(en.failure_changed)
  expect(plain(f.last())).toContain(en.no_strategy)
  expect(labels(f.last())).toContain(`Mira · ${en.idle}`)
})

test('Pause and Resume are confirmed on their own card, act on the wallet once, and report only what the bot confirmed', async () => {
  const f = await linked()
  const scope = await f.say('/pause')
  expect(plain(scope)).toBe(`${en.pause}\n${en.wallet_scope}`)
  expect(f.bot.paused).toBe(false)
  const confirm = buttons(scope)[0]!
  expect(plain(await f.press('pause:'))).toBe(en.paused)
  await f.runtime.fetch(input(901, confirm, true))
  expect(f.bot.sent('bot_pause')).toHaveLength(1)
  expect(f.bot.paused).toBe(true)
  f.bot.observation_revision = 9
  await f.say('/resume')
  expect(plain(await f.press('resume:'))).toBe(en.resumed)
  expect(f.bot.sent('bot_resume').map((call) => call.arguments)).toEqual([
    { decision_revision: 3, observation_revision: 9 },
  ])
  // A lost answer is unknown: it claims nothing, offers Status only, and is not sent again.
  f.bot.lost.add('bot_pause')
  await f.say('/pause')
  const unknown = await f.press('pause:')
  expect([plain(unknown), buttons(unknown)]).toEqual([en.unknown, ['/status']])
  expect(f.bot.sent('bot_pause')).toHaveLength(2)
})

test('the pause brake does not wait for the roster', async () => {
  const f = await linked()
  f.overrides.handler = async (url, init) => {
    const body = JSON.parse(String(init.body))
    return body.params?.name === 'bot_observe'
      ? Response.json({ result: { structuredContent: { status: 'pending' } } })
      : f.respond(url, init)
  }
  expect(plain(await f.say('/menu'))).toBe(en.loading)
  await f.say('/pause')
  expect(plain(await f.press('pause:'))).toBe(en.paused)
  expect(f.bot.paused).toBe(true)
})

test('approval sends what was reviewed or nothing: an expired, moved or overtaken review starts no run', async () => {
  const f = await linked()
  // Another hero acting moves the observation revision; the approval uses this update's own.
  await f.review('Mira', 'fight_nearby')
  f.bot.observation_revision = 12
  await f.press('approve:')
  expect(f.bot.sent('bot_start_behavior')[0]!.arguments).toMatchObject({
    decision_revision: 3,
    observation_revision: 12,
  })
  // Past its deadline.
  await f.review('Thor', 'fight_nearby')
  f.clock.now += limits.proposal_ttl_ms
  const before = f.cards.length
  await f.press('approve:')
  expect(plain(f.cards[before]!)).toBe(en.failure_changed)
  // The hero left the reviewed city.
  await f.review('Thor', 'fight_nearby')
  f.bot.heroes[1] = { ...f.bot.heroes[1], x: 0, z: 0 }
  expect(plain(await f.press('approve:'))).toBe(en.city_required)
  f.bot.heroes[1] = hero(THOR, 'Thor')
  // Another client started this hero meanwhile: the card reviewed a start, not a replacement.
  await f.review('Thor', 'fight_nearby')
  f.bot.runs.set(THOR, { ...f.bot.runs.get(MIRA)!, id: 'run-thor', character_id: THOR })
  const overtaken = f.cards.length
  await f.press('approve:')
  expect(plain(f.cards[overtaken]!)).toBe(en.failure_changed)
  expect(f.bot.sent('bot_start_behavior')).toHaveLength(1)
  expect(f.bot.sent('bot_replace_behavior')).toEqual([])
})

test('every code Telegram refuses with, throws or receives from the hosted client chooses one failure kind', async () => {
  const directory = new URL('../src/', import.meta.url)
  const sources = await Promise.all(
    [...new Bun.Glob('*.ts').scanSync(directory.pathname)].map((file) => Bun.file(new URL(file, directory)).text())
  )
  const raised = new Set<string>(BOT_FAILURES)
  for (const source of sources)
    for (const match of source.matchAll(
      /(?:throw new Error\(|\brefuse\((?:[a-z.]+, )?|\{ ok: false, error: )(['"`])([a-z_]+)\1/g
    ))
      raised.add(match[2]!)
  expect(raised.size).toBeGreaterThan(40)
  const mapped = Object.values(FAILURE_CODES).flat()
  expect(new Set(mapped).size).toBe(mapped.length)
  expect([...raised].filter((code) => !mapped.includes(code))).toEqual([])
  // No dead row: any other mapped code is one the hosted bot or the shared binder really answers.
  const hosted = await Promise.all(
    ['../../bot/src/', '../../protocol/src/'].flatMap((path) => {
      const root = new URL(path, import.meta.url)
      return [...new Bun.Glob('*.ts').scanSync(root.pathname)].map((file) => Bun.file(new URL(file, root)).text())
    })
  )
  const answered = (code: string) => hosted.some((source) => source.includes(`'${code}'`))
  expect(mapped.filter((code) => !raised.has(code) && !answered(code))).toEqual([])
})

test('every authored line is declared and read by the source; no line is left behind in the locales', async () => {
  const directory = new URL('../src/', import.meta.url)
  const read = (file: string) => Bun.file(new URL(file, directory)).text()
  const { strategies: _names, ...lines } = en
  const declared = [...(await read('copy.ts')).matchAll(/^ {4}\| '([a-z_]+)',?$/gm)].map((match) => match[1]!)
  expect(declared.toSorted()).toEqual(Object.keys(lines).toSorted())
  const readers = (
    await Promise.all(
      [...new Bun.Glob('*.ts').scanSync(directory.pathname)].filter((file) => file !== 'copy.ts').map(read)
    )
  ).join('\n')
  // Read as copy.<key>, or named as a key of the copy in a table or a union.
  const used = (key: string) =>
    new RegExp(`copy(?:_for\\(input\\))?\\.${key}\\b|'${key}'|\\b${key}: [[{]`).test(readers)
  expect(Object.keys(lines).filter((key) => !used(key))).toEqual([])
})

test('a stale action is answered 200 with the current state', async () => {
  const f = await linked()
  await f.say('/menu')
  const stale = buttons(f.last())[0]!
  await f.say('/menu')
  const before = f.cards.length
  const answered = await f.runtime.fetch(input(10, stale, true))
  expect(answered.status).toBe(200)
  // No error: a short update line, then the fresh menu with its own navigation.
  expect(f.cards[before]!.text).toBe(card(en.failure_changed).text)
  expect(buttons(f.last())).toContain('/status')
  expect(f.runtime.sessions.get(42)?.character).toBeNull()
  for (const forged of ['approve:1', 'stop:1:all', 'strategy:1:fight_nearby', 'pause:1', 'resume:1'])
    await f.runtime.fetch(input(11, forged, true))
  expect(f.bot.calls.filter(({ name }) => !['bot_identity', 'bot_observe'].includes(name))).toEqual([])
})

test('a redelivered approval reaches the hosted bot once', async () => {
  const f = await linked()
  await f.review('Mira', 'fight_nearby')
  const approve = buttons(f.last())[0]!
  await redeliver(f, () => input(41, approve, true))
  expect(f.bot.sent('bot_start_behavior')).toHaveLength(1)
})

test('a start whose reply could not be delivered is redelivered without a second start', async () => {
  const f = await linked()
  await f.review('Mira', 'fight_nearby')
  const approve = buttons(f.last())[0]!
  f.outage.delivery = true
  expect((await f.runtime.fetch(input(5, approve, true))).status).toBe(503)
  f.outage.delivery = false
  expect((await f.runtime.fetch(input(5, approve, true))).status).toBe(200)
  expect(f.bot.sent('bot_start_behavior')).toHaveLength(1)
  // The redelivery is answered with what is true now: the hero runs.
  expect(f.cards.some((shown) => shown.text === card(en.failure_changed).text)).toBe(true)
  expect(plain(f.last())).toContain(`Mira · ${en.strategies.fight_nearby} · ${en.strategy_active}`)
})

test('updates of one sender are handled one at a time, in order, including after a failure', async () => {
  const f = await linked()
  const gate = deferred<undefined>()
  let held = false
  f.overrides.handler = async (url, init) => {
    if (!held) {
      held = true
      await gate.promise
      throw new Error('unavailable')
    }
    return f.respond(url, init)
  }
  const before = f.sent.length
  const first = f.runtime.fetch(input(1, '/menu'))
  await Bun.sleep(0)
  const second = f.runtime.fetch(input(2, '/menu'))
  await Bun.sleep(0)
  // The second update waits behind the first one's held hosted read.
  expect(f.sent.length - before).toBe(1)
  gate.resolve(undefined)
  expect([(await first).status, (await second).status]).toEqual([200, 200])
  expect(f.runtime.sessions.get(42)?.revision).toBe(2)
})
