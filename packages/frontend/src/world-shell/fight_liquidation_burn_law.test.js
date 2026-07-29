// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1262 — THE EXPIRED-TURN ADVANCE FIRES AT MOST ONCE PER OBSERVED DEADLINE EXPIRY.
//
// The reported burn: a character escrowed in a stale fight, the client re-attempting `turns::crank` every poll,
// each attempt an EXECUTED failing transaction — 0.0213 SUI gone in one boot. The reason it looped is in this
// file's subject: fight-liquidation.js classified "did this burn gas?" with a LOCAL heuristic (a `.cause`
// property or an abort-shaped MESSAGE) while the codebase already computes the only structural proof there is —
// the DIGEST that dungeon_actions' sign() stamps onto every post-submission failure.
//
// So the failure shape below is the one the heuristic misses and the chain charges for: a submission that got a
// digest and then failed on the finality leg. Its message names no abort and it carries no `.cause`, so the old
// code read "pre-flight, nothing burned" and RE-ARMED the deadline — one fresh executed transaction per poll.
// RED against that classifier, green against the structural one (tx_digest_error.js's `error_executed_digest`,
// the same predicate the spend guard's circuit keys on).

import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'

import { reset_auth_mock } from '../test_helpers/auth_mock.js'
import { install_browser_globals } from '../test_helpers/browser_globals.js'

import { attach_executed_digest } from './tx_digest_error.js'

/** @type {{ id: string, silent: boolean }[]} */
let crank_calls = []
let crank_impl = /** @type {(id: string, silent: boolean) => Promise<any>} */ (
  (id, silent) => {
    crank_calls.push({ id, silent })
    return Promise.resolve({})
  }
)

// #1564 — one home for the test browser surface: this file used to hand-roll its own byte-shaped copy of
// install_browser_globals(), a second home for the same fact.
const restore_browser_globals = install_browser_globals()

reset_auth_mock()
const dungeon_actions = await import('./dungeon_actions')
const dungeon_engage_actions = await import('./dungeon_engage_actions')
const inert_action = async () => ({})
const action_spies = [
  spyOn(dungeon_actions, 'as_one_toast').mockImplementation(inert_action),
  spyOn(dungeon_engage_actions, 'create_world_fight').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'join_world_fight').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'activate_run').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'next_room_fight').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'join_room_fight').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'abandon_run').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'place').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'force_start').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'crank').mockImplementation((id, silent) => crank_impl(id, silent)),
  spyOn(dungeon_actions, 'commit_turn_batch').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'abandon_fight').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'settle_and_open').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'settle_run_and_open').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'open_outcome').mockImplementation(inert_action),
  spyOn(dungeon_engage_actions, 'mint_rolled').mockImplementation(inert_action),
  spyOn(dungeon_engage_actions, 'burn_result').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'mint_all_and_burn').mockImplementation(inert_action),
]

const { maybe_liquidate, reset_liquidation } = await import('./fight-liquidation.js')
const { run_character_action } = await import('./tx.js')
const { reset_spend_guard, spend_guard_state } = await import('./spend_guard.js')

const STATUS_ACTIVE = 1
const FIGHT_ID = '0xb294e4fc'

/** The #1262 fight: ACTIVE, its turn deadline long past, nothing advancing it. */
const stale_fight = (deadline_ms = Date.now() - 600_000) => ({
  id: FIGHT_ID,
  status: STATUS_ACTIVE,
  turn_deadline_ms: deadline_ms,
  placement_deadline_ms: 0,
})

const make_get = (dungeon) => () => ({ dungeon, busy: false, refresh: () => Promise.resolve() })
const flush = () => new Promise((resolve) => setTimeout(resolve, 5))

/**
 * The shape the chain charges for and the old heuristic missed: submission returned a DIGEST (gas burned) and the
 * failure surfaced on the finality leg — no `.cause`, and a message naming no abort.
 */
const executed_finality_failure = () =>
  attach_executed_digest(new Error('Transaction was not observable before the timeout'), '0xburnedgas')

const real_random = Math.random
beforeEach(() => {
  crank_calls = []
  crank_impl = (id, silent) => {
    crank_calls.push({ id, silent })
    return Promise.resolve({})
  }
  reset_liquidation()
  reset_spend_guard()
  globalThis.Math.random = () => 0 // jitter pinned to 0 — the fire is deterministic
})
afterEach(() => {
  reset_liquidation()
  reset_spend_guard()
  Math.random = real_random
})
afterAll(() => {
  for (const spy of action_spies) spy.mockRestore()
  restore_browser_globals()
})

describe('#1262 · the stale fight never becomes a gas-burn loop', () => {
  it('LATCHES a crank whose failure carries a DIGEST — the poll after it sends NOTHING', async () => {
    crank_impl = (id, silent) => {
      crank_calls.push({ id, silent })
      return Promise.reject(executed_finality_failure())
    }
    const fight = stale_fight()
    const get = make_get(fight)

    maybe_liquidate(fight, get) // poll 1 — the one legal attempt; it executes and fails (gas burned)
    await flush()
    expect(crank_calls.length).toBe(1)

    // #1262 IS THIS LINE: every later poll re-observes the SAME expired deadline. A digest was returned, so the
    // burn law forbids a second send — the client must stay quiet until the deadline itself changes.
    for (const _poll of [2, 3, 4, 5]) maybe_liquidate(fight, get)
    await flush()
    expect(crank_calls.length).toBe(1)
  })

  it('still re-arms on a genuine PRE-EXECUTION refusal — nothing was signed, nothing burned', async () => {
    crank_impl = (id, silent) => {
      crank_calls.push({ id, silent })
      return Promise.reject(Object.assign(new Error('simulate failed'), { name: 'SimulationError' }))
    }
    const fight = stale_fight()
    const get = make_get(fight)

    maybe_liquidate(fight, get)
    await flush()
    expect(crank_calls.length).toBe(1)

    maybe_liquidate(fight, get)
    await flush()
    expect(crank_calls.length).toBe(2)
  })

  // THE SEAM ITSELF. Above, the site is proven; here, the lane every submission door funnels through — tx.js's
  // `run()` and dungeon_actions' `sign()` both enter the chain via `run_character_action`, so a guard sitting on
  // it covers every automated caller, including ones written after this fix.
  it('THE LANE refuses the second automated submission of a burned intent — the task never runs again', async () => {
    let attempts = 0
    const submit = () =>
      run_character_action(
        () => {
          attempts += 1
          return Promise.reject(executed_finality_failure())
        },
        { intent: `advance_turn:${FIGHT_ID}`, automated: true }
      )

    await expect(submit()).rejects.toThrow('Transaction was not observable before the timeout')
    expect(attempts).toBe(1)

    // Second call: refused at the door. The wallet is never asked, so `attempts` cannot move.
    await expect(submit()).rejects.toMatchObject({ name: 'SpendGuardRefusal', guard_reason: 'circuit_open' })
    expect(attempts).toBe(1)
    expect(spend_guard_state().circuits[`advance_turn:${FIGHT_ID}`]).toEqual({ digest: '0xburnedgas' })
  })

  it('THE LANE leaves the player alone — the same burned intent still runs when user-initiated', async () => {
    let attempts = 0
    const intent = `advance_turn:${FIGHT_ID}`
    await expect(
      run_character_action(
        () => {
          attempts += 1
          return Promise.reject(executed_finality_failure())
        },
        { intent, automated: true }
      )
    ).rejects.toThrow()

    await run_character_action(
      () => {
        attempts += 1
        return Promise.resolve({})
      },
      { intent } // a player pressing the button: automated is false
    )
    expect(attempts).toBe(2)
  })

  it('a FRESH deadline (the turn genuinely advanced) is a new expiry and fires once more', async () => {
    crank_impl = (id, silent) => {
      crank_calls.push({ id, silent })
      return Promise.reject(executed_finality_failure())
    }
    const first = stale_fight(Date.now() - 600_000)
    maybe_liquidate(first, make_get(first))
    await flush()
    expect(crank_calls.length).toBe(1)

    const advanced = stale_fight(Date.now() - 1_000) // a different turn, a different deadline
    maybe_liquidate(advanced, make_get(advanced))
    await flush()
    expect(crank_calls.length).toBe(2)
  })
})
