// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1661 RIDER 2 — AUTOMATION IS NEVER A GUARD BYPASS.
//
// The group loop seats an arrived alt with no press behind it. That submission used to enter the transaction
// lane anonymously: no `intent`, no `automated` — so the mechanical spend guard (#1262), the ONE home of "an
// executed failure is never resubmitted" and of the session ceiling on automated gas, did not cover the one
// join that fires without a human. A wire-fired join that aborts on chain could be composed and sent again by
// the very next fight the leader engaged, burning gas per attempt, with nothing in the machine to stop it —
// exactly #1383's defect at a different door.
//
// The fix is one door, not two: a press (FightsModal) and the auto-seat both reach the chain through
// `join_world_fight`, which now NAMES the intent for every caller and lets the wire declare itself automated.
// Automation therefore takes the manual join's every guard — the same simulate-before-sign choke, the same
// executed-digest latch — PLUS the circuit and ceiling a press is deliberately spared.
//
// These tests drive the REAL executor (`join_owned_world_fight`, the group loop's own effect door), the REAL
// builder, and the REAL spend guard. Only the wallet transport is mocked, so a shortcut reintroduced anywhere
// between the reducer's request and the lane is visible here.
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { reset_auth_mock, set_auth_mock_implementation } from '../../src/test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals()

const dungeon_actions = await import('../../src/world-shell/dungeon_actions.js')
const kiosk_resolve = await import('../../src/world-shell/kiosk_resolve.js')
const raised_spells = await import('../../src/world-shell/raised_spells.js')
const { join_owned_world_fight } = await import('../../src/world-shell/owned_team_actions.js')
const { reset_spend_guard, spend_guard_state } = await import('../../src/world-shell/spend_guard.js')
const { attach_executed_digest } = await import('../../src/world-shell/tx_digest_error.js')

afterAll(restore_browser_globals)

const pad = (tag) => `0x${tag.padStart(64, '0')}`
const FIGHT = pad('f1661')
const ALT = pad('a17')
const OWNER = pad('a1661')
const BURNED = pad('b1661')
const LANDED = pad('c1661')
const HANDLE = { kiosk_id: pad('c1'), personal_kiosk_cap_id: pad('c2') }

const SHARDS = Array.from({ length: 16 }, (_, i) => ({ id: pad(`5a4d${i.toString(16)}`), initial_shared_version: '1' }))
const LATCH_SHARDS = Array.from({ length: 16 }, (_, i) => ({
  id: pad(`1a7c${i.toString(16)}`),
  initial_shared_version: '1',
}))
const CTX = {
  network: 'localnet',
  ids: {
    aresrpg: {
      PACKAGE_ID: pad('a0e1'),
      LATEST_PACKAGE_ID: pad('a0e2'),
      ENGINE_PACKAGE_ID: pad('e0e1'),
      ENGINE_LATEST_PACKAGE_ID: pad('e0e2'),
      ENGINE_VERSION: pad('e0e3'),
      VERSION: pad('a0e4'),
      GAME_CONFIG: pad('a0e5'),
      CREATION: pad('a0e6'),
      CATALOG: pad('a0e7'),
      POOL_REGISTRY: pad('a0e8'),
      ITEM_POLICY: pad('a0e9'),
      CHARACTER_POLICY: pad('a0ea'),
      DUNGEON_PACKAGE_ID: pad('d0e1'),
      FIGHT_REGISTRY_SHARDS: SHARDS,
      FIGHT_LATCH_SHARDS: LATCH_SHARDS,
    },
  },
}

const landed = () => ({
  digest: LANDED,
  effects_result: {
    Transaction: {
      digest: LANDED,
      effects: { changedObjects: [], gasUsed: { computationCost: '2000000', storageCost: '1000000', storageRebate: '0' } },
      objectTypes: {},
      events: [],
    },
  },
})

/** The auto-seat door exactly as group_wiring calls it: the reducer's request, one arrived alt, queued. */
const auto_seat = () => join_owned_world_fight({ fight_id: FIGHT, party_id: null, members: [{ character_id: ALT }], queued: true })

/** The press door exactly as FightsModal calls it. */
const press = () => dungeon_actions.join_world_fight({ fight_id: FIGHT, character_id: ALT, party_id: null })

const door_of = (tx) => {
  const [command] = tx.getData().commands
  return `${command.MoveCall.module}::${command.MoveCall.function}`
}

describe('#1661 rider 2 · the auto-seat join carries every guard a press carries', () => {
  /** @type {any[]} */
  let submitted = []
  /** @type {any[]} */
  let spies = []

  beforeEach(() => {
    submitted = []
    reset_spend_guard()
    reset_auth_mock({ address: OWNER, wallet_name: 'test-wallet' })
    set_expedition_sdk_mock(async () => ({ grpc_client: {} }))
    spies = [
      spyOn(dungeon_actions, 'ctx_of').mockReturnValue({ ...CTX }),
      spyOn(kiosk_resolve, 'kiosk_for_character').mockResolvedValue(HANDLE),
      spyOn(raised_spells, 'raised_spell_ids_for').mockResolvedValue([]),
    ]
    set_auth_mock_implementation('sign_and_execute_transaction', async (_wallet_name, _address, tx) => {
      submitted = [...submitted, tx]
      return landed()
    })
  })

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    reset_spend_guard()
    reset_expedition_sdk_mock()
    reset_auth_mock()
  })

  test('RED: an EXECUTED auto-seat failure opens the circuit — the next auto-seat never reaches the wallet', async () => {
    set_auth_mock_implementation('sign_and_execute_transaction', async (_wallet_name, _address, tx) => {
      submitted = [...submitted, tx]
      // The wallet submitted it and the chain aborted: a digest exists, so the gas is gone.
      throw attach_executed_digest(new Error('fight::join aborted on chain'), BURNED)
    })

    await expect(auto_seat()).rejects.toThrow('fight::join aborted on chain')
    expect(submitted).toHaveLength(1)
    expect(door_of(submitted[0])).toBe('fight::join') // the same door a press opens — one home, not a shortcut

    // The mechanical circuit — not a comment — has to stop the second send, keyed by THIS alt in THIS fight.
    expect(spend_guard_state().circuits[`join_fight:${FIGHT}:${ALT}`]).toEqual({ digest: BURNED })

    const refusal = await auto_seat().catch((error) => error)
    expect(refusal.name).toBe('SpendGuardRefusal')
    expect(refusal.guard_reason).toBe('circuit_open')
    expect(submitted).toHaveLength(1) // ZERO resubmissions — the retry never touched the wallet
  })

  test('the PRESS is never blocked by that circuit — automation is guarded, the player is not', async () => {
    set_auth_mock_implementation('sign_and_execute_transaction', async (_wallet_name, _address, tx) => {
      submitted = [...submitted, tx]
      if (submitted.length === 1) throw attach_executed_digest(new Error('fight::join aborted on chain'), BURNED)
      return landed()
    })

    await expect(auto_seat()).rejects.toThrow('fight::join aborted on chain')
    expect(spend_guard_state().circuits[`join_fight:${FIGHT}:${ALT}`]).toBeTruthy()

    const receipt = await press()

    expect(receipt.digest).toBe(LANDED)
    expect(submitted).toHaveLength(2) // the player spending their own gas on purpose still reaches the chain
    expect(door_of(submitted[1])).toBe('fight::join')
  })

  test('the auto-seat accrues to the AUTOMATED spend ceiling; the same join by a press does not', async () => {
    await auto_seat()
    const after_wire = spend_guard_state().automated_spend_mist
    expect(after_wire).toBeGreaterThan(0n) // the wire's gas is on the session ledger the breaker reads

    await press()
    expect(spend_guard_state().automated_spend_mist).toBe(after_wire) // a press is not automation's spend
    expect(submitted).toHaveLength(2)
  })
})
