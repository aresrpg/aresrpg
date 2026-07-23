// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { submit } from './sui.js'
import { is_terminal_fight_status, poll_fight, read_fight, win_fight } from './world_flow.js'

const fight_object = (status, version, mob_hp = null) => ({
  data: {
    version: String(version),
    content: {
      fields: {
        status,
        placement_deadline_ms: 0,
        participants: [
          {
            fields: {
              character: '0xcharacter',
              cell: 1,
              hp: 100,
              ap: 6,
              mp: 6,
              base_mp: 6,
            },
          },
        ],
        mobs: mob_hp == null ? [] : [{ fields: { cell: 2, hp: mob_hp } }],
        board: { fields: { obstacles: [], holes: [], start_cells_a: [1] } },
      },
    },
  },
})

const tx_stub = () => ({
  setSender() {},
  setGasBudget() {},
  getData() {
    return { gasData: {} }
  },
})

describe('world-flow terminal visibility', () => {
  test('only raw victory/defeat statuses are terminal', () => {
    expect([-1, 0, 1].map(is_terminal_fight_status)).toEqual([false, false, false])
    expect([2, 3].map(is_terminal_fight_status)).toEqual([true, true])
  })

  test('polls through a stale active Fight until terminal is visible', async () => {
    let reads = 0
    const client = {
      async getObject() {
        reads += 1
        return fight_object(reads === 1 ? 1 : 2, reads)
      },
    }
    const result = await poll_fight({
      client,
      fight_id: '0xfight',
      character_id: '0xcharacter',
      predicate: (fight) => is_terminal_fight_status(fight.status),
      timeout_ms: 100,
      interval_ms: 0,
    })
    expect(result.matched).toBe(true)
    expect(result.fight.status).toBe(2)
    expect(reads).toBe(2)
  })

  test('retries one transient fight fetch', async () => {
    let reads = 0
    const client = {
      async getObject() {
        reads += 1
        if (reads === 1) throw new TypeError('fetch failed')
        return fight_object(2, reads)
      },
    }
    expect((await read_fight(client, '0xfight', '0xcharacter')).status).toBe(2)
    expect(reads).toBe(2)
  })

  test('does not poll-retry a permanent fight read failure', async () => {
    let reads = 0
    const result = await poll_fight({
      client: {
        async getObject() {
          reads += 1
          throw new TypeError('invalid params')
        },
      },
      fight_id: '0xfight',
      character_id: '0xcharacter',
      predicate: (fight) => is_terminal_fight_status(fight.status),
      timeout_ms: 100,
      interval_ms: 0,
    })
    expect(result.matched).toBe(false)
    expect(result.fight.read_error).toBe('invalid params')
    expect(reads).toBe(1)
  })

  test('the shared win driver observes terminal before settlement', async () => {
    let fight = fight_object(0, 1, 1)
    let stale_after_weapon = null
    let terminal_observed = false
    const calls = []
    const event_result = (events) => ({
      ok: true,
      gasMist: 1,
      events,
      event(suffix) {
        return events.find((event) => event.type.endsWith(suffix))?.parsedJson ?? null
      },
    })
    const driver = {
      async create_fight() {
        calls.push('create')
        return { fight_id: '0xfight', res: event_result([]) }
      },
      async place() {
        calls.push('place')
        fight = fight_object(1, 2, 1)
        return { res: event_result([]) }
      },
      async act_weapon() {
        calls.push('weapon')
        stale_after_weapon = fight_object(1, 2, 1)
        fight = fight_object(2, 3, 0)
        return {
          res: event_result([
            {
              type: '0xengine::fight_events::Hit',
              parsedJson: { victim_is_mob: true, remaining_hp: 0 },
            },
            { type: '0xengine::fight_events::Victory', parsedJson: { fight: '0xfight' } },
          ]),
        }
      },
      async act_move() {
        throw new Error('adjacent leveler mob must not move')
      },
      async act_pass() {
        throw new Error('terminal fight must not pass')
      },
      async force_start() {
        throw new Error('solo place must auto-start')
      },
      async settle_open_world() {
        calls.push('settle')
        expect(terminal_observed).toBe(true)
        expect(fight.data.content.fields.status).toBe(2)
        return {
          result_id: '0xresult',
          res: event_result([
            {
              type: '0xcore::results::ResultOpened',
              parsedJson: { result: '0xresult', xp_share: 95_886_000 },
            },
          ]),
        }
      },
    }
    const result = await win_fight({
      driver,
      client: {
        async getObject() {
          if (stale_after_weapon) {
            const stale = stale_after_weapon
            stale_after_weapon = null
            return stale
          }
          if (fight.data.content.fields.status === 2) terminal_observed = true
          return fight
        },
      },
      ids: {
        character_id: '0xcharacter',
        kiosk_id: '0xkiosk',
        personal_kiosk_cap_id: '0xcap',
      },
      world: { id: '0xworld' },
      zone: {
        zx: 0,
        zy: 0,
        mob: { spawn_id: '1', template_id: '0xmob' },
      },
    })
    expect(calls).toEqual(['create', 'place', 'weapon', 'settle'])
    expect(result).toMatchObject({
      won: true,
      xp_share: 95_886_000,
      result_id: '0xresult',
    })
  })
})

describe('submit retry money law', () => {
  test('a wait race after a digest never resubmits an executed abort', async () => {
    let submits = 0
    let waits = 0
    const result = await submit({
      client: {
        async signAndExecuteTransaction() {
          submits += 1
          return {
            digest: '0xdigest',
            effects: {
              status: {
                status: 'failure',
                error: 'MoveAbort(MoveLocation { module: Identifier("settlement") }, 101)',
              },
            },
            objectChanges: [],
            events: [],
          }
        },
        async waitForTransaction() {
          waits += 1
          throw new TypeError('fetch failed')
        },
      },
      tx: tx_stub(),
      sender: '0xsender',
      max_retries: 1,
    })
    expect(submits).toBe(1)
    expect(waits).toBe(1)
    expect(result).toMatchObject({
      digest: '0xdigest',
      class: 'move_abort',
      abort_code: 101,
      attempts: 1,
      wait_error: 'fetch failed',
    })
  })

  test('one pre-execution fetch race rebuilds once', async () => {
    let submits = 0
    let rebuilds = 0
    const result = await submit({
      client: {
        async signAndExecuteTransaction() {
          submits += 1
          if (submits === 1) throw new TypeError('fetch failed')
          return {
            digest: '0xdigest',
            effects: { status: { status: 'success' } },
            objectChanges: [],
            events: [],
          }
        },
      },
      tx: tx_stub(),
      rebuild: () => {
        rebuilds += 1
        return tx_stub()
      },
      sender: '0xsender',
      max_retries: 1,
    })
    expect(submits).toBe(2)
    expect(rebuilds).toBe(1)
    expect(result).toMatchObject({
      class: 'success',
      attempts: 2,
      retried: ['network'],
    })
  })

  test('one retry is the hard cap for a persistent pre-execution race', async () => {
    let submits = 0
    const result = await submit({
      client: {
        async signAndExecuteTransaction() {
          submits += 1
          throw new TypeError('fetch failed')
        },
      },
      tx: tx_stub(),
      rebuild: tx_stub,
      sender: '0xsender',
      max_retries: 1,
    })
    expect(submits).toBe(2)
    expect(result).toMatchObject({
      class: 'network',
      attempts: 2,
      retried: ['network'],
    })
  })
})
