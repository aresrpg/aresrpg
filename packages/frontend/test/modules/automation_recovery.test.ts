// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, spyOn, test } from 'bun:test'

import { publish_pose } from '../../src/game/core/pose_feed.ts'
import { automation_command, observe_automation, reduce_automation } from '../../src/modules/automation.ts'
import { reduce_app_state, type AppContext, type AppState } from '../../src/store.ts'

import { automation_fixture, character, key, tick } from './automation_fixture.ts'

test('reselecting the controlled character retains automation movement; switching cancels it', () => {
  const initial = automation_fixture()
  const moving = reduce_automation(initial, { ...tick(), pose: { ...tick().pose!, x: -100 } })
  const running = reduce_app_state(moving, automation_command(moving, initial)!)
  const reselected = reduce_app_state(running, { type: 'character/select', character_id: 'alice' })
  expect(running.run_to.run).not.toBeNull()
  expect(reselected.run_to.run).toBe(running.run_to.run)
  expect(reselected.automation.run).toBe(running.automation.run)
  const roster = reduce_app_state(reselected, {
    type: 'server/packet',
    packet: { type: 'packet/characters', characters: [character(), { ...character(), id: 'bob' }] },
  })
  const switched = reduce_app_state(roster, { type: 'character/select', character_id: 'bob' })
  expect(switched.run_to.run).toBeNull()
  expect(switched.automation.run).toBeNull()
})

test('an expired retry sleeps without a clock and resumes on the readiness delta', () => {
  const initial = automation_fixture()
  let state: AppState = {
    ...initial,
    chain_clock: null,
    automation: {
      ...initial.automation,
      run: {
        ...initial.automation.run!,
        step: { type: 'retrying', target: { key, x: 50_000, z: 50_000, node: null }, retry_at_ms: 0 },
      },
    },
  }
  publish_pose(tick().pose)
  const timer = spyOn(globalThis, 'setTimeout')
  const controller = new AbortController()
  let notify!: (current: AppState, previous: AppState) => void
  observe_automation({
    events: {
      on: (_event: string, listener: typeof notify) => {
        notify = listener
      },
    } as AppContext['events'],
    get_state: () => state,
    dispatch: (input) => {
      state = reduce_automation(state, input)
    },
    signal: controller.signal,
  })
  try {
    expect(timer).not.toHaveBeenCalled()
    const previous = state
    state = { ...state, chain_clock: { chain_ms: 100_000, received_ms: performance.now() } }
    notify(state, previous)
    expect(state.automation.run?.step.type).not.toBe('retrying')
    expect(timer).toHaveBeenCalled()
  } finally {
    controller.abort()
    publish_pose(null)
    timer.mockRestore()
  }
})

test('an expired retry without a live pose uses the normal poll interval', () => {
  const initial = automation_fixture()
  const state: AppState = {
    ...initial,
    chain_clock: { chain_ms: 100_000, received_ms: performance.now() },
    automation: {
      ...initial.automation,
      run: {
        ...initial.automation.run!,
        step: { type: 'retrying', target: { key, x: 50_000, z: 50_000, node: null }, retry_at_ms: 0 },
      },
    },
  }
  publish_pose(null)
  const timer = spyOn(globalThis, 'setTimeout')
  const controller = new AbortController()
  observe_automation({
    events: { on: () => {} } as unknown as AppContext['events'],
    get_state: () => state,
    dispatch: () => {},
    signal: controller.signal,
  })
  try {
    expect(timer.mock.calls[0]![1]).toBeGreaterThanOrEqual(250)
  } finally {
    controller.abort()
    timer.mockRestore()
  }
})
