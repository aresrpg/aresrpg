// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Redis-free coverage for the RunPass character projection. The integration suite remains the store oracle.

import { describe, expect, mock, test } from 'bun:test'

import { handle_dungeon_runs } from './views.js'

const params = (values) => new URLSearchParams(values)
const pass = `0x${'1'.repeat(64)}`
const world = `0x${'2'.repeat(64)}`
const player = `0x${'3'.repeat(64)}`
const character = `0x${'4'.repeat(64)}`

function reads(run_doc = null, indexed = []) {
  return {
    get_json: mock(async () => run_doc),
    read_index: mock(async () => indexed),
  }
}

describe('/v1/dungeon-runs character projection', () => {
  test('a pass exposes its activation-time character', async () => {
    const store = reads({ pass, world, player, character, status: 'active', room: 2, fight: null })
    const { status, data } = await handle_dungeon_runs(params({ pass }), store)

    expect(status).toBe(200)
    expect(data.runs).toEqual([{ pass_id: pass, world, player, character, status: 'active', room: 2, fight_id: null }])
    expect(store.get_json).toHaveBeenCalledWith(`rpc:run:${pass}`)
  })
  test('missing query parameters does not touch the store', async () => {
    const store = reads()
    const { status } = await handle_dungeon_runs(params({}), store)

    expect(status).toBe(400)
    expect(store.get_json).not.toHaveBeenCalled()
    expect(store.read_index).not.toHaveBeenCalled()
  })
})
