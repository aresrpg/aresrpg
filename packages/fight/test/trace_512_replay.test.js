// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ISSUE #512 — REAL LIVE CAPSULE, captured from fight
// 0x3f6103fb3fb842bac763a3d275f607d33e49fcde787f004229c18e900e95c33a on app v1.12.50 at
// 1784752468344. This is the exported fight/store wire payload, not a model-generated twin: replay every raw
// `{msg, at}` through a fresh store exactly as trace_recorder.js specifies.
//
// RED provenance: input index 695 (trace seq 699, `receipt`) canonically displaces mob-0 onto the live trap at
// cell 8, then the same receipt advances the mob away. The committed fold must retain that entry transition;
// presentation may pace the beats, but it must never decide whether chain truth was consumed.

import { describe, expect, test } from 'bun:test'

import { engine_view } from '../src/project.js'
import { create_fight_store } from '../src/store.js'
import { parse_trace } from '../src/trace_recorder.js'

const FIGHT_ID = '0x3f6103fb3fb842bac763a3d275f607d33e49fcde787f004229c18e900e95c33a'
const FIXTURE = new URL(`./fixtures/traces/trace_${FIGHT_ID}.json`, import.meta.url)
const CONSUMPTION_INDEX = 695
const CONSUMED_CELL = 8

const load_trace = async () => parse_trace(await Bun.file(FIXTURE).text())

describe('issue #512 — the live fold never starves behind trap presentation', () => {
  test('all 1307 captured inputs fold through the one door and the consumed trap never resurrects', async () => {
    const trace = await load_trace()
    expect({
      trace_format: trace.trace_format,
      fight_id: trace.fight_id,
      app_version: trace.app_version,
      captured_at: trace.captured_at,
      inputs: trace.inputs.length,
    }).toEqual({
      trace_format: 1,
      fight_id: FIGHT_ID,
      app_version: '1.12.50',
      captured_at: 1784752468344,
      inputs: 1307,
    })

    const store = create_fight_store()
    let processed = 0
    let jam = null
    for (const [input_index, { seq, msg, at }] of trace.inputs.entries()) {
      store.getState().input(msg, at)
      processed += 1
      if (input_index < CONSUMPTION_INDEX) continue
      const consumed = store.getState().my_traps.find((trap) => trap.cells.includes(CONSUMED_CELL))
      if (!jam && consumed?.gone !== true)
        jam = {
          input_index,
          trace_seq: seq,
          kind: msg.type,
          applied_version: store.getState().applied_version,
          accept_head: store.getState().accept_state.head,
          presented_seq: store.getState().presented_seq,
          wave_seq: store.getState().wave_seq,
          trap: consumed,
        }
    }

    const final = store.getState()
    const final_anchor = trace.inputs.at(-1).anchors
    expect(processed, 'the replay must consume the complete captured payload').toBe(trace.inputs.length)
    expect(
      {
        applied_version: final.applied_version,
        view_version: final.view_version,
        receipt_seq: final.receipt_seq,
      },
      'the fresh fold must reach the final captured reducer anchors'
    ).toEqual(final_anchor)
    expect(jam, 'canonical trap consumption must not wait for, or be undone by, presentation').toBeNull()
    expect(engine_view(final).my_traps, 'neither consumed trap cell may repaint at the end of the capsule').toEqual(
      []
    )
  })
})
