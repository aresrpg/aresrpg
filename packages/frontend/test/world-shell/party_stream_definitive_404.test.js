// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// ROW #2261 — A 404 IS AN ANSWER. An owner live session logged `GET /v1/stream/party/<id> 404` dozens of times a
// minute: the carrier's backoff ladder was cleared on every tick by its own re-key check, so a location that
// simply does not serve the route was asked again every four seconds, forever, one narrated breadcrumb each.
//
// These gates drive the REAL carrier — the shipped `start_party_carriers` — with three seams injected and
// nothing stubbed away: the transport (a hand-rolled EventSource that fails the way a browser fails a non-200:
// readyState CLOSED, one bodiless `error`, no reconnect of its own), the reconciliation clock (a captured tick
// this test pumps by hand), and the status probe (what the location answers). No module is mocked.

import { beforeEach, describe, expect, test } from 'bun:test'

import { _reset_log_for_test, get_log_buffer } from '../../src/core/log.js'
import { probe_stream_status, start_party_carriers } from '../../src/world-shell/party_stream_link.js'

const CHARACTER = '0xchar'

/** The browser's own 404 shape: the connection is failed, the source is CLOSED, and it never retries itself. */
const make_source = (url) => {
  let listeners = new Map()
  const source = {
    url,
    readyState: 0,
    failed: false,
    addEventListener(type, listener) {
      listeners = new Map([...listeners, [type, listener]])
    },
    close() {
      source.readyState = 2
    },
    fail() {
      source.failed = true
      source.readyState = 2
      listeners.get('error')?.({})
    },
  }
  return source
}

/** Let the classification probe (and anything it chains) settle — the carrier holds no clock of its own here. */
const settle = async () => {
  for (let pass = 0; pass < 4; pass += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

const drive = (probe) => {
  const opened = []
  let refreshes = 0
  let tick = () => {}
  const stop = start_party_carriers({
    character_id: () => CHARACTER,
    refresh: () => {
      refreshes += 1
    },
    probe,
    base_url: 'https://rpc.test',
    event_source_factory: (url) => {
      const source = make_source(url)
      opened.push(source)
      return source
    },
    set_timeout: (fn) => {
      tick = fn
      return 'handle'
    },
    clear_timeout: () => {},
  })
  return {
    opened,
    stop,
    refreshes: () => refreshes,
    /** One reconciliation tick, then the endpoint answers every connect it just got. */
    async pump(times) {
      for (let pass = 0; pass < times; pass += 1) {
        tick()
        for (const source of opened) if (!source.failed) source.fail()
        await settle()
      }
    },
  }
}

const party_lines = () => get_log_buffer().filter((entry) => entry.ns === 'party')

beforeEach(() => {
  _reset_log_for_test()
})

describe('#2261 · a definitive status ends the retry, a transient one does not', () => {
  test('a 404 retires the wire for the session — zero reconnects, ONE honest breadcrumb', async () => {
    const probed = []
    const carriers = drive(async (url) => {
      probed.push(url)
      return 404
    })

    // The first connect is the one the boot already made; the location answers 404 to it.
    expect(carriers.opened).toHaveLength(1)
    carriers.opened[0].fail()
    await settle()

    // A whole minute of reconciliation ticks at the four-second cadence: not one more connect may be attempted.
    await carriers.pump(15)

    expect(carriers.opened).toHaveLength(1)
    expect(probed).toEqual([`https://rpc.test/v1/stream/party/${CHARACTER}`])
    const lines = party_lines()
    expect(lines).toHaveLength(1)
    expect(lines[0].message).toContain('404')
    expect(lines[0].message).toContain(`https://rpc.test/v1/stream/party/${CHARACTER}`)
    expect(lines[0].message).not.toContain('[object Object]')

    // The fallback is the whole point of retiring: the poll never stopped reconciling the party.
    expect(carriers.refreshes()).toBeGreaterThanOrEqual(15)
    carriers.stop()
  })

  test('THE CONTROL — a 503 stays transient: the bounded ladder still reconnects', async () => {
    const carriers = drive(async () => 503)

    expect(carriers.opened).toHaveLength(1)
    carriers.opened[0].fail()
    await settle()

    await carriers.pump(15)

    expect(carriers.opened.length).toBeGreaterThan(1)
    // Still not a narration: one line per distinct reason, however many attempts the ladder spends.
    expect(party_lines()).toHaveLength(1)
    carriers.stop()
  })

  test('a location that never answers at all is transient too — no status is not a 404', async () => {
    const carriers = drive(async () => null)

    carriers.opened[0].fail()
    await settle()
    await carriers.pump(15)

    expect(carriers.opened.length).toBeGreaterThan(1)
    carriers.stop()
  })
})

describe('#2261 · the probe reads the status without consuming the stream body', () => {
  test('the response head is the answer and the body is aborted immediately', async () => {
    let aborted = false
    const status = await probe_stream_status('https://rpc.test/v1/stream/party/0xchar', async (_url, options) => {
      options.signal.addEventListener('abort', () => {
        aborted = true
      })
      return { status: 404 }
    })

    expect(status).toBe(404)
    expect(aborted).toBe(true)
  })

  test('a request that never reaches a response is null — the transport-error class', async () => {
    const status = await probe_stream_status('https://rpc.test/v1/stream/party/0xchar', async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(status).toBe(null)
  })
})
