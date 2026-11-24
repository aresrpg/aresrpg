// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Release safety at run time: an open game recovers from a new deployment once and never mid-transaction, it
// checks for updates without flooding, its error reports carry no secret, and the portrait service serves only
// what its fresh masks describe.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { afterAll, expect, mock, test } from 'bun:test'
import { close, flush, type ErrorEvent } from '@sentry/react'
import { AgentHandoverIncomplete } from '@aresrpg/sdk/agent-handover'
import { pre_submission_failure, transaction_resolution_error } from '@aresrpg/sdk/transaction-error'

import manifest from '../../../seed/portraits/manifest.json' with { type: 'json' }
import { parse_portrait_query, portrait_url } from '../../immutable/src/portrait.ts'
import { serve_portrait } from '../server/portrait.ts'
import { parse_portrait_layout, portrait_poster_url, POSTER_GEAR } from '../src/components/portrait_share.ts'
import { agent_transfer_error, agent_transfer_needs_gas } from '../src/agents/transfer_error.ts'
import type { AppCopy } from '../src/i18n/copy.ts'
import { failure_copy_key } from '../src/i18n/player_error.ts'
import { observe_service_worker_updates } from '../src/pwa.ts'
import { before_send, init_reporting, scrub_report } from '../src/reporting.ts'
import { reporting_config, require_reporting_dsn } from '../src/reporting_config.ts'
import {
  failed_asset_url,
  finish_startup_recovery,
  missing_asset_issue,
  observe_startup_recovery,
  recover_missing_asset,
  reload_after_update,
  RELOAD_CHECK,
} from '../src/startup_recovery.ts'
import { on_error_translate, toast } from '../src/toast.ts'
import { create_single_flight } from '../src/transaction_guard.ts'

import { replace_globals, restore_globals } from './harness.ts'

afterAll(restore_globals)

const settled = () => new Promise<void>((resolve) => setImmediate(resolve))
/** Replaces browser globals for one case and gives them back afterwards. */
const with_globals = async (overrides: Readonly<Record<string, unknown>>, run: () => Promise<void>): Promise<void> => {
  const restore = replace_globals(overrides)
  try {
    await run()
  } finally {
    restore()
  }
}
const recovery_browser = () => {
  const tab = new EventTarget()
  const update = mock(async () => {})
  const workers = Object.assign(new EventTarget(), {
    controller: Object.assign(new EventTarget(), { state: 'activated' }),
    getRegistration: async () => ({ scope: 'https://game.test/', update }),
  })
  const storage = new Map([['wallet-recovery', 'preserve-me']])
  const reload = mock(() => {})
  const timers: (() => void)[] = []
  const globals = {
    navigator: { serviceWorker: workers },
    location: { origin: 'https://game.test', reload },
    window: { setTimeout: (callback: () => void) => timers.push(callback) },
    clearTimeout: () => {},
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    fetch: mock(async () => ({ status: 404 })),
    addEventListener: tab.addEventListener.bind(tab),
    dispatchEvent: tab.dispatchEvent.bind(tab),
  }
  const activate = (status = 'activated') => {
    workers.controller = Object.assign(new EventTarget(), { state: status })
    workers.dispatchEvent(new Event('controllerchange'))
  }
  return { tab, update, workers, storage, reload, timers, globals, activate }
}
const city_missing = () =>
  recover_missing_asset({
    state: 'failed',
    backend: 'none',
    issue: { code: 'asset_missing', detail: 'missing city artifact' },
  })

test('a game whose assets left with a deployment reloads once, after the new worker activates, never mid-transaction', async () => {
  expect(
    failed_asset_url(
      new Error('Failed to fetch dynamically imported module: https://game.test/assets/app-abcd.js?dpl=a'),
      'https://game.test'
    )?.pathname
  ).toBe('/assets/app-abcd.js')
  expect(failed_asset_url(new Error('https://other.test/assets/app.js'), 'https://game.test')).toBeNull()
  expect(missing_asset_issue({ code: 'webgpu_initialization_failed', detail: '404' })).toBe(false)
  const browser = recovery_browser()
  await with_globals(browser.globals, async () => {
    observe_startup_recovery()
    browser.tab.dispatchEvent(
      Object.assign(new Event('vite:preloadError'), {
        payload: new Error('Unable to preload CSS for https://game.test/assets/entry-abc.css'),
      })
    )
    await settled()
    expect(browser.update).toHaveBeenCalledTimes(1)
    browser.activate('activating')
    expect(browser.reload).not.toHaveBeenCalled()
    browser.workers.controller.state = 'activated'
    browser.workers.controller.dispatchEvent(new Event('statechange'))
    browser.workers.controller.dispatchEvent(new Event('statechange'))
    expect(browser.reload).toHaveBeenCalledTimes(1)
    expect(browser.storage.get('wallet-recovery')).toBe('preserve-me')
    // The retry marker holds: a second failure in the same session asks no second update.
    finish_startup_recovery()
    observe_startup_recovery()
    city_missing()
    await settled()
    expect(browser.update).toHaveBeenCalledTimes(1)
    finish_startup_recovery()
  })
  // A transaction in flight vetoes the reload and keeps the retry for later.
  const busy = recovery_browser()
  await with_globals(busy.globals, async () => {
    observe_startup_recovery()
    busy.tab.addEventListener(RELOAD_CHECK, (event) => event.preventDefault())
    city_missing()
    await settled()
    busy.activate()
    expect(busy.reload).not.toHaveBeenCalled()
    expect(busy.storage.size).toBe(1)
    finish_startup_recovery()
  })
  // After startup, a late update never restarts gameplay; an update during a healthy startup waits for ready.
  const late = recovery_browser()
  await with_globals(late.globals, async () => {
    observe_startup_recovery()
    reload_after_update()
    expect(late.reload).not.toHaveBeenCalled()
    finish_startup_recovery()
    expect(late.reload).toHaveBeenCalledTimes(1)
  })
})

test('an open game checks for a new version on a slow clock and on return, never twice at once', async () => {
  const tab = new EventTarget()
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const navigator = { onLine: true }
  const timers: { callback: () => void; interval: number }[] = []
  const update = mock(async () => {})
  await with_globals(
    {
      document,
      navigator,
      addEventListener: tab.addEventListener.bind(tab),
      setInterval: (callback: () => void, interval: number) => timers.push({ callback, interval }),
    },
    async () => {
      observe_service_worker_updates({ update })
      expect(timers[0]!.interval).toBe(15_000)
      document.visibilityState = 'hidden'
      timers[0]!.callback()
      document.visibilityState = 'visible'
      navigator.onLine = false
      tab.dispatchEvent(new Event('focus'))
      expect(update).not.toHaveBeenCalled()
      navigator.onLine = true
      tab.dispatchEvent(new Event('online'))
      tab.dispatchEvent(new Event('focus'))
      expect(update).toHaveBeenCalledTimes(1)
      await settled()
      document.dispatchEvent(new Event('visibilitychange'))
      await settled()
      timers[0]!.callback()
      expect(update).toHaveBeenCalledTimes(3)
    }
  )
})

test('error reports keep the chain diagnosis and drop every bearer, credential and private header', async () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signature'
  const original = {
    message: `Failed https://aresrpg.world/claim#bearer-secret ${jwt}`,
    request: { url: 'https://aresrpg.world/?token=secret', headers: { Authorization: 'secret' } },
    exception: { values: [{ value: `cause ${jwt} suiprivkey1secret` }] },
    breadcrumbs: [{ data: { to: '/gift#another-secret', id_token: jwt } }],
  }
  const scrubbed = JSON.stringify(scrub_report(original))
  expect(scrubbed).not.toContain('secret')
  expect(scrubbed).not.toContain(jwt)
  expect(scrubbed).toContain('https://aresrpg.world/claim')
  const agent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)'
  const report = before_send(
    {
      type: undefined,
      request: {
        url: 'https://aresrpg.world/world#private-bearer',
        headers: { 'user-agent': agent, Authorization: 'Bearer private-token', Cookie: 'session=private-cookie' },
      },
    },
    {}
  )
  expect(report?.request?.headers).toEqual({ 'User-Agent': agent })
  expect(JSON.stringify(report)).not.toContain('private-')
  // A wallet cancellation is no error; a refused dry run is.
  expect(before_send({ type: undefined, message: 'User rejected the request' }, {})).toBeNull()
  expect(before_send({ type: undefined, message: 'NOT submitted: abort code: 1723' }, {})).not.toBeNull()
  expect(
    reporting_config({ MODE: 'development', VITE_SENTRY_DSN: 'https://public@example.com/1', VITE_NETWORK: 'mainnet' })
      .enabled
  ).toBe(false)
  expect(() => require_reporting_dsn({ VERCEL_ENV: 'production' })).toThrow('VITE_SENTRY_DSN')
  // A caught MoveAbort reaches the report once, fingerprinted by its module and code, before the toast translates it.
  const events: ErrorEvent[] = []
  init_reporting(
    {
      MODE: 'production',
      VITE_SENTRY_DSN: 'https://public@example.com/1',
      VITE_NETWORK: 'testnet',
      VITE_RELEASE: 'test-release',
    },
    () => ({
      send: async ([, items]) => {
        for (const [header, payload] of items) if (header.type === 'event') events.push(payload as ErrorEvent)
        return { statusCode: 200 }
      },
      flush: async () => true,
    })
  )
  const failure = new Error(
    "[sdk] transaction resolution failed — NOT submitted: MoveAbort in 2nd command, abort code: 1723, in '0x6a::combat::start' (instruction 28)"
  )
  on_error_translate(() => 'Please wait for the fight.')
  try {
    toast.add(failure, 'error', { area: 'fight', action: 'start', fight: '0xf' })
    await flush(2_000)
    expect(events).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain('Please wait for the fight.')
    expect(events[0]?.fingerprint).toEqual(['move-abort', '0x6a', 'combat', 'start', '1723'])
    expect(events[0]?.release).toBe('test-release')
  } finally {
    on_error_translate(null)
    await close()
  }
})

test('the portrait service reads only fresh masks and answers reads alone, for valid palettes only', async () => {
  expect(Object.keys(manifest.portraits)).toHaveLength(24)
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  const root = new URL('../../../seed/', import.meta.url)
  for (const [name, entry] of Object.entries(manifest.portraits)) {
    expect(hash(await readFile(new URL(`icons/characters/${name}_hd.png`, root)))).toBe(entry.source_sha256)
    expect(hash(await readFile(new URL(`portraits/${name}.png`, root)))).toBe(entry.mask_sha256)
    expect(hash(await readFile(new URL(`models/characters/${name}.glb`, root)))).toBe(entry.model_sha256)
  }
  const appearance = { classe: 'senshi', sex: 'male', color_1: 0xffffff, color_2: 0xd9af57, color_3: 0x8b6539 }
  const path = portrait_url(appearance)!
  expect(parse_portrait_query(new URL(path, 'https://example.test').searchParams)).toEqual(appearance)
  expect(portrait_url({ ...appearance, classe: '../../secret' })).toBeNull()
  expect(portrait_url({ ...appearance, color_1: 16_777_216 })).toBeNull()
  const query = new URL(path, 'https://example.test').searchParams
  query.set('color_2', '1.2')
  expect(parse_portrait_query(query)).toBeNull()
  const url = `https://example.test${path}`
  expect((await serve_portrait(new Request(url, { method: 'POST' }))).status).toBe(405)
  expect((await serve_portrait(new Request('https://example.test/api/portrait'))).status).toBe(400)
  const response = await serve_portrait(new Request(url))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/png')
  expect(response.headers.get('cache-control')).toContain('immutable')
  expect(
    (await serve_portrait(new Request(url, { headers: { 'if-none-match': response.headers.get('etag')! } }))).status
  ).toBe(304)
  // A hero's poster: the shared card. Every fact comes from the caller, so each one is bounded before any paint.
  const poster = { name: 'kaori', level: 34, power: 1240, gear: ['crowani_warbelt', 'broodstep_boots', 'not_an_item'] }
  const poster_path = portrait_poster_url(appearance, { ...poster, gear: [...poster.gear, ...Array(20).fill('x')] })!
  const poster_query = () => new URL(poster_path, 'https://example.test').searchParams
  const parsed = parse_portrait_layout(poster_query())
  expect(parsed).toEqual({
    kind: 'poster',
    poster: { ...poster, gear: [...poster.gear, ...Array(POSTER_GEAR - 3).fill('x')] },
  })
  expect(portrait_poster_url(appearance, { ...poster, name: 'a<b' })).toBeNull()
  const refused = [
    ['name', 'abc'],
    ['name', 'x'.repeat(20)],
    ['name', 'kaoré'],
    ['level', '0'],
    ['level', '201'],
    ['level', '3.5'],
    ['power', '1e9'],
    ['power', '123456789'],
    ['gear', '../../secret'],
    ['gear', `${'x,'.repeat(POSTER_GEAR)}x`],
    ['card', 'banner'],
    ['export_revision', 'old'],
    ['bg', 'fire'],
    ['extra', '1'],
  ] as const
  for (const [key, value] of refused) {
    const query = poster_query()
    query.set(key, value)
    expect(parse_portrait_layout(query)).toBeNull()
    expect((await serve_portrait(new Request(`https://example.test/api/portrait?${query}`))).status).toBe(400)
  }
  const doubled = poster_query()
  doubled.append('name', 'other')
  expect(parse_portrait_layout(doubled)).toBeNull()
  const card = await serve_portrait(new Request(`https://example.test${poster_path}`))
  expect(card.status).toBe(200)
  expect(card.headers.get('cache-control')).toContain('immutable')
  const png = new Uint8Array(await card.arrayBuffer())
  // The PNG header's width and height: the large X card.
  expect(new DataView(png.buffer).getUint32(16)).toBe(1200)
  expect(new DataView(png.buffer).getUint32(20)).toBe(630)
}, 30_000)

test('one transaction at a time, and a chain refusal reaches the player as its own sentence, never a gas prompt it is not', async () => {
  // A rapid repeat is refused while the first runs; settling, or failing, releases the flight.
  const run = create_single_flight()
  const release = Promise.withResolvers<void>()
  const calls: string[] = []
  const first = run(async () => (calls.push('first'), await release.promise))
  expect(first).not.toBeNull()
  expect(run(async () => void calls.push('repeat'))).toBeNull()
  release.resolve()
  await first
  await expect(run(async () => Promise.reject(new Error('nope')))).rejects.toThrow('nope')
  await run(async () => void calls.push('next'))
  expect(calls).toEqual(['first', 'next'])
  // Known aborts name what happened, only in the module that raises them.
  const keys: readonly (readonly [string, string | null])[] = [
    ["MoveAbort abort code: 1725 in '0xgame::fight::walk_path'", 'fight_path_changed_toast'],
    ["MoveAbort abort code: 1724 in '0xgame::fight::crank'", 'fight_turn_already_forced_toast'],
    ["MoveAbort abort code: 1724 in '0xgame::fight::end_turn'", null],
    ["MoveAbort abort code: 2002 in '0xgame::party::accept'", null],
    ['abort code: 305 in 0xgame::another_module', null],
  ]
  expect(keys.map(([message]) => failure_copy_key(message) as string | null)).toEqual(keys.map(([, key]) => key))
  // An executed or uncertain transaction never reads as an unsubmitted gas refusal.
  const executed = [
    '[sdk] transaction D failed on-chain: gas budget exceeded',
    '[sdk] transaction outcome unknown: D; gas budget unavailable',
    '[sdk] previous transaction recovered: D',
  ]
  expect(
    executed.filter(
      (message) => pre_submission_failure(new Error(message)) || failure_copy_key(message) === 'gas_budget_toast'
    )
  ).toEqual([])
  const error = new Error(executed[0]!)
  expect(transaction_resolution_error(error)).toBe(error)
  // A handover that stopped after its offer keeps its real cause; only a gas shortage asks for funds.
  const copy = {
    ui: {},
    airdrop_page: {},
    kares_page: { error_generic: 'Generic', error_funds: 'Add funds', error_rejected: 'Signature rejected' },
  } as unknown as AppCopy
  const refused = new AgentHandoverIncomplete(new Error('Royalty policy refused this item'), 'offer-digest')
  expect(agent_transfer_error(copy, refused)).toMatchObject({
    message: 'Royalty policy refused this item',
    cause: refused,
  })
  expect(agent_transfer_needs_gas(refused)).toBe(false)
  expect(
    agent_transfer_error(copy, new AgentHandoverIncomplete(new Error('GasBalanceTooLow: insufficient funds'), 'offer'))
      .message
  ).toBe('Add funds')
})
