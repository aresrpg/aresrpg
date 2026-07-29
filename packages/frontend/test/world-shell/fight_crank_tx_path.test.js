// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1606 — A FRESH EXPIRED TURN MUST REACH THE WALLET AFTER AN OLDER DEADLINE'S CRANK BURNED GAS.
//
// The liquidation probe deduplicates by deadline, but the transaction lane used to identify every crank in a
// fight as `advance_turn:<fight_id>`. One executed failure therefore opened the spend circuit for the WHOLE
// fight: the next deadline composed its PTB, then the client refused it before submission forever. This drives
// the real dungeon_actions crank builder and sign lane. Transport alone is mocked so the test proves both facts:
// the fresh deadline reaches submission, and the submitted PTB is the permissionless `turns::crank` door.

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { reset_auth_mock, set_auth_mock_implementation } from '../../src/test_helpers/auth_mock.js'
import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals()

const dungeon_actions = await import('../../src/world-shell/dungeon_actions.js')
const { reset_spend_guard } = await import('../../src/world-shell/spend_guard.js')
const { attach_executed_digest } = await import('../../src/world-shell/tx_digest_error.js')

const pad = (tag) => `0x${tag.padStart(64, '0')}`
const FIGHT_ID = pad('f1606')
const OWNER = pad('a1606')
const OLD_DEADLINE_MS = 1_784_000_000_000
const FRESH_DEADLINE_MS = OLD_DEADLINE_MS + 45_000

const success_result = (digest) => ({
  digest,
  effects_result: {
    Transaction: {
      digest,
      effects: { changedObjects: [], gasUsed: {} },
      objectTypes: {},
      events: [],
    },
  },
})

/** @type {any[]} */
let submitted = []

beforeEach(() => {
  submitted = []
  reset_spend_guard()
  reset_auth_mock({ address: OWNER, wallet_name: 'test-wallet' })
  set_expedition_sdk_mock(async () => ({
    grpc_client: {
      core: {
        getObject: async () => ({
          object: {
            owner: {
              $kind: 'Shared',
              Shared: { initialSharedVersion: '1606' },
            },
          },
        }),
      },
    },
  }))
  set_auth_mock_implementation('sign_and_execute_transaction', async (_wallet_name, _address, tx) => {
    submitted = [...submitted, tx]
    if (submitted.length === 1)
      throw attach_executed_digest(new Error('older deadline crank executed but its receipt failed'), pad('b1606'))
    return success_result(pad('c1606'))
  })
})

afterEach(() => {
  reset_spend_guard()
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(restore_browser_globals)

describe('#1606 · expired-turn crank transaction path', () => {
  test('a fresh past-deadline fight composes and submits turns::crank after an older deadline failure', async () => {
    await expect(dungeon_actions.crank(FIGHT_ID, true, OLD_DEADLINE_MS)).rejects.toThrow(
      'older deadline crank executed but its receipt failed'
    )
    expect(submitted).toHaveLength(1)

    const receipt = await dungeon_actions.crank(FIGHT_ID, true, FRESH_DEADLINE_MS)

    expect(receipt.digest).toBe(pad('c1606'))
    expect(submitted).toHaveLength(2)
    const [command] = submitted[1].getData().commands
    expect(command.$kind).toBe('MoveCall')
    expect(`${command.MoveCall.module}::${command.MoveCall.function}`).toBe('turns::crank')
    expect(command.MoveCall.arguments).toHaveLength(4)
  })
})
