import { readFileSync } from 'node:fs'

import { describe, expect, mock, test } from 'bun:test'
import { GrpcWebFetchTransport, SuiGrpcClient } from '@mysten/sui/grpc'
import { board_view, create_fight_store, subscribe_commit_due } from '@aresrpg/fight'

import { normalize_receipt } from '../chain/receipt.ts'
import { humanize_abort } from '../game/core/abort_copy.js'

const T0 = 1_000_000
const FIGHT = '0xf1647'
const ME = '0xchar_a'
const event = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })
const active_store = () => {
  const store = create_fight_store()
  store.getState().input(
    {
      type: 'init',
      fight_id: FIGHT,
      my_key: 'p0',
      ctx: { my_entity_id: ME, address: '0xa11ce', beat_ctx: { grid_width: 20 } },
    },
    T0
  )
  store.getState().input(
    {
      type: 'snapshot',
      version: 1,
      fight: {
        id: FIGHT,
        status: 1,
        width: 20,
        height: 19,
        participants: [
          {
            owner: '0xa11ce',
            character: ME,
            class: 'warrior',
            team: 0,
            hp: 50,
            max_hp: 50,
            ap: 12,
            mp: 3,
            base_ap: 12,
            base_mp: 3,
            cell: 21,
            ready: true,
          },
        ],
        mobs: [{ template: '0xmob_t', hp: 20, max_hp: 20, ap: 6, mp: 3, cell: 45 }],
        obstacles: [],
        holes: [],
        shape_mask: [],
        start_cells_a: [21],
        start_cells_b: [],
        queue: [],
        turn_ptr: 0,
        turn_deadline_ms: T0 + 30_000,
        placement_deadline_ms: 0,
        last_action_ms: 0,
      },
    },
    T0 + 10
  )
  store.getState().input(
    {
      type: 'receipt',
      version: 2,
      receipt: { events: [event('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 30_000 })] },
    },
    T0 + 100
  )
  return store
}

const captured_abort = readFileSync(
  new URL('./fixtures/grpc_abort_response.b64.bin', import.meta.url),
  'utf8'
).trimEnd()

const decode_captured_abort = async () => {
  const transport = new GrpcWebFetchTransport({
    baseUrl: 'https://captured.invalid',
    fetch: async () =>
      new Response(captured_abort, {
        status: 200,
        headers: { 'content-type': 'application/grpc-web-text' },
      }),
  })
  const client = new SuiGrpcClient({ network: 'testnet', transport })
  const raw = await client.core.executeTransaction({
    transaction: new Uint8Array([0]),
    signatures: [],
    include: { effects: true, objectTypes: true, events: true },
  })
  return normalize_receipt(raw)
}

describe('deadline flush execution honesty', () => {
  test('transport-200 MoveAbort is ok:false, invokes abort_copy, and rolls prediction back through input', async () => {
    const receipt = await decode_captured_abort()
    expect(receipt.effects.status.status).toBe('failure')
    expect(JSON.stringify(receipt.effects.status.error)).toContain('begin_action')

    const store = active_store()
    store.getState().input({ type: 'stage', intent: { kind: 1, target: 45 } })
    store
      .getState()
      .input(
        { type: 'intent', intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 0 } },
        T0 + 1_000
      )
    expect(board_view(store.getState()).mobs[0].alive).toBe(false)

    const decoder = mock((error) => humanize_abort(error))
    const stop = subscribe_commit_due(store, {
      submit: () => ({
        ok: receipt.effects.status.status === 'success',
        error: receipt.effects.status.error,
      }),
      on_error: decoder,
    })
    store.getState().input({ type: 'tick' }, T0 + 29_100)
    await Promise.resolve()
    await Promise.resolve()

    expect(decoder, 'the shared humanizing decoder receives the execution abort').toHaveBeenCalledTimes(1)
    expect(board_view(store.getState()).mobs[0].alive, 'rollback input removes the phantom kill').toBe(true)
    expect(Object.values(store.getState().entries).filter((entry) => entry.source === 'intent')).toEqual([])
    stop()
  })
})
