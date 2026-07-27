// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import * as project from '../src/project.js'
import { STATUS_FAILED, STATUS_WON } from '../src/board_state.js'
import { create_fight_store } from '../src/store.js'

const fight_id = '0xsettle-rearm'
const character_id = '0xhero'

const fight_at = (status) => ({
  id: fight_id,
  status,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xowner',
      character: character_id,
      team: 0,
      hp: 40,
      max_hp: 40,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: 20,
      ready: true,
    },
  ],
  mobs: [{ hp: status === 2 ? 0 : 5, max_hp: 5, cell: 100 }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 50_000,
  turn_entropy: 50_000,
  turn_ordinal: 1,
})

const victory_event = {
  type: '0xengine::fight_events::Victory',
  parsedJson: { fight: fight_id },
}

const fallback_request = (state, fired) => {
  if (fired.current) return null
  const status = project.board_view(state)?.status
  return status === STATUS_WON || status === STATUS_FAILED ? { signal: 'terminal-ref', status } : null
}

const take_request = (store, requests, fired) => {
  const request =
    typeof project.settlement_request === 'function'
      ? project.settlement_request(store.getState())
      : fallback_request(store.getState(), fired)
  if (!request) return
  requests.push(request)
  if (typeof project.settlement_request === 'function')
    store.getState().input({ type: 'settlement_attempt', signal: request.signal })
  else fired.current = true
}

describe('signal-driven settlement re-arm', () => {
  test('each newer terminal confirmation re-arms one refused preflight, but an executed failure never re-arms', () => {
    const store = create_fight_store()
    const requests = []
    const fired = { current: false }
    store.getState().input({
      type: 'init',
      fight_id,
      my_key: 'p0',
      ctx: { my_entity_id: character_id, rooms_total: 1 },
    })
    store.getState().input({ type: 'snapshot', fight: fight_at(1), version: 1 }, 1_000)

    store.getState().input({
      type: 'receipt',
      version: 2,
      fight_id,
      receipt: { events: [victory_event] },
    })
    take_request(store, requests, fired)
    expect(requests).toHaveLength(1)

    store.getState().input({
      type: 'settlement_outcome',
      signal: requests.at(-1).signal,
      verdict: 'transient',
    })
    // M2b · ONE INGRESS: a newer TERMINAL confirmation arrives as a Victory event through the canonical door (a
    // fresh version), never a re-adopted object read — the settlement machine re-arms on the newer signal.
    store.getState().input({ type: 'receipt', version: 3, fight_id, receipt: { events: [victory_event] } })
    take_request(store, requests, fired)
    take_request(store, requests, fired)
    expect(requests, 'one newer terminal confirmation produces exactly one re-armed request').toHaveLength(2)

    store.getState().input({
      type: 'settlement_outcome',
      signal: requests.at(-1).signal,
      verdict: 'transient',
    })
    store.getState().input({
      type: 'receipt',
      version: 4,
      fight_id,
      receipt: { events: [victory_event] },
    })
    take_request(store, requests, fired)
    take_request(store, requests, fired)
    expect(requests, 'a second newer confirmation produces one more request').toHaveLength(3)

    store.getState().input({
      type: 'settlement_outcome',
      signal: requests.at(-1).signal,
      verdict: 'executed_failure',
    })
    store.getState().input({ type: 'snapshot', fight: fight_at(2), version: 5 }, 3_000)
    take_request(store, requests, fired)
    expect(requests, 'a digest-bearing executed failure is permanently latched').toHaveLength(3)
  })
})
