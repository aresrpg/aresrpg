// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1368 · THE FIGHT WIRE GETS THE SAME DEFINITIVE-STATUS POLICY AS PARTY. A route that answers 404/410
// is absent for this location, so the REST journal remains the carrier and the stream is retired for the
// session. A transient response still spends the bounded reconnect ladder. Every seam below is injected; no
// module is mocked.

import { beforeEach, describe, expect, test } from 'bun:test'

import { _reset_log_for_test, get_log_buffer } from '../../src/core/log.js'
import { bind_fight_stream } from '../../src/world-shell/fight_stream_link.js'

const FIGHT = '0xfight'

const settle = async () => {
  for (let pass = 0; pass < 4; pass += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

const drive = (answer) => {
  const opened = []
  let timers = []
  const link = bind_fight_stream({
    fight_id: FIGHT,
    catch_up: async () => {},
    base_url: 'https://rpc.test',
    probe: async () => answer,
    open: ({ set_status }) => {
      const source = {
        fail() {
          set_status('failed', 'Fight stream unavailable after 6 attempts')
        },
      }
      opened.push(source)
      return () => {}
    },
    set_timeout: (fn) => {
      timers = [...timers, fn]
      return fn
    },
    clear_timeout: (handle) => {
      timers = timers.filter((timer) => timer !== handle)
    },
  })
  return {
    link,
    opened,
    async pump(times) {
      for (let pass = 0; pass < times; pass += 1) {
        const timer = timers.shift()
        timer?.()
        opened.at(-1)?.fail()
        await settle()
      }
    },
  }
}

const fight_lines = () => get_log_buffer().filter((entry) => entry.ns === 'fight')

beforeEach(() => {
  _reset_log_for_test()
})

describe('#1368 · fight stream definitive status', () => {
  test('a stubbed 404 retires the stream for the session and leaves one breadcrumb', async () => {
    const stream = drive(404)

    stream.opened[0].fail()
    await settle()
    await stream.pump(8)

    expect(stream.opened).toHaveLength(1)
    expect(stream.link.is_live()).toBe(false)
    expect(fight_lines()).toHaveLength(1)
    expect(fight_lines()[0].message).toContain('404')
    expect(fight_lines()[0].message).toContain(`https://rpc.test/v1/stream/fight/${FIGHT}`)
    stream.link.close()
  })

  test('THE CONTROL — a 503 stays transient and reconnects on the bounded ladder', async () => {
    const stream = drive(503)

    stream.opened[0].fail()
    await settle()
    await stream.pump(2)

    expect(stream.opened.length).toBeGreaterThan(1)
    expect(stream.link.is_live()).toBe(false)
    stream.link.close()
  })
})
