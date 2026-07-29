// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1381 ②③ — A STALLED TURN IS OFFERED, NOT AUTO-FIRED, AND THE OFFER SUBMITS AT MOST ONCE.
//
// Live finding: a teammate who never ends their turn freezes the fight for everyone, and the client fired
// turn-advance transactions against stale state that aborted RED — gas burned per attempt. The cure has two
// halves and both are proved here:
//   ② the OTHER participants get a clicked door (never automatic — auto-forcing griefs a slow-but-alive player
//     and pays gas to do it), single-shot per fight@deadline through the store's own latch door;
//   ③ the door is SIMULATE-FIRST: the dry run inside the submission choke is the discriminator between
//     "genuinely stalled" (submit once) and "we were merely desynced" (turns::107 / 105 — zero gas, resync
//     silently, zero submissions). An EXECUTED failure is surfaced once and never retried.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { force_pass_verdict, force_pass_key, run_force_pass } from '../../src/world-shell/turn_stall.js'
import { attach_executed_digest } from '../../src/world-shell/tx_digest_error.js'
import { tx_error } from '../../src/game/core/abort_copy.js'
import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals()
const { use_dungeon } = await import('../../src/world-shell/dungeon_store.js')

afterAll(restore_browser_globals)

/** The gas-guard's zero-gas dry-run refusal for a `turns` abort code — what the choke throws BEFORE signing. */
const dry_run_abort = (code) =>
  tx_error(
    {
      $kind: 'MoveAbort',
      message: `MoveAbort in 1st command, abort code: ${code}, in '0xe25d::turns::crank' (instruction 12)`,
      MoveAbort: { abortCode: String(code), location: { package: '0xe25d', module: 'turns', instruction: 12 } },
    },
    { preflight: true }
  )

describe('force_pass_verdict — the dry run is the discriminator', () => {
  test('no error at all is a landed pass', () => {
    expect(force_pass_verdict(null)).toBe('passed')
  })

  test('RED: turns::107 ENotYetExpired means the turn ALREADY advanced — we were desynced, not stalled', () => {
    expect(force_pass_verdict(dry_run_abort(107))).toBe('already_advanced')
  })

  test('turns::105 ENotActive (the fight ended while we watched) reads the same way', () => {
    expect(force_pass_verdict(dry_run_abort(105))).toBe('already_advanced')
  })

  test('a DIGEST outranks the abort code: an executed 107 burned gas and is never re-read as a resync', () => {
    expect(force_pass_verdict(attach_executed_digest(dry_run_abort(107), '0xburned'))).toBe('executed')
  })

  test('another turns abort (ESomeoneOverdue 108) is a genuine refusal, never a silent resync', () => {
    expect(force_pass_verdict(dry_run_abort(108))).toBe('refused')
  })

  test('an unrelated failure is a refusal (never assume the turn moved)', () => {
    expect(force_pass_verdict(new Error('Failed to fetch'))).toBe('refused')
  })
})

describe('force_pass_key — one press per fight per deadline', () => {
  test('the deadline is part of the key, so a FRESH stall re-arms and the same one never repeats', () => {
    expect(force_pass_key('0xf', 1_784_000_000_000)).toBe('0xf:1784000000000')
    expect(force_pass_key('0xf', 1_784_000_045_000)).not.toBe(force_pass_key('0xf', 1_784_000_000_000))
  })

  test('nothing to latch without a fight or a real deadline', () => {
    expect(force_pass_key(null, 1)).toBeNull()
    expect(force_pass_key('0xf', 0)).toBeNull()
    expect(force_pass_key('0xf', null)).toBeNull()
  })
})

describe('run_force_pass — at most ONE submission, ever', () => {
  /** The store's single-shot latch door, in miniature: it admits exactly one claim per key. */
  const one_shot_latch = () => {
    let claimed = false
    return () => {
      if (claimed) return false
      claimed = true
      return true
    }
  }

  test('RED: the button pressed twice composes exactly ONE crank (the second press is held by the latch)', async () => {
    const claim = one_shot_latch()
    let cranks = 0
    let resyncs = 0
    const deps = {
      claim,
      crank: async () => {
        cranks += 1
      },
      resync: async () => {
        resyncs += 1
      },
    }
    await expect(run_force_pass(deps)).resolves.toEqual({ verdict: 'passed', error: null })
    await expect(run_force_pass(deps)).resolves.toEqual({ verdict: 'held', error: null })
    expect(cranks).toBe(1)
    expect(resyncs).toBe(1) // the held press composes nothing at all — not even a read
  })

  test('RED: an already-advanced turn resyncs SILENTLY and submits nothing further', async () => {
    let cranks = 0
    let resyncs = 0
    const verdict = await run_force_pass({
      claim: one_shot_latch(),
      crank: async () => {
        cranks += 1
        throw dry_run_abort(107)
      },
      resync: async () => {
        resyncs += 1
      },
    })
    expect(verdict).toEqual({ verdict: 'already_advanced', error: null }) // no error to shout about
    expect(cranks).toBe(1)
    expect(resyncs).toBe(1) // the fold re-reads the turn we did not know had passed
  })

  test('an EXECUTED failure returns its cause ONCE and is never re-fired', async () => {
    let cranks = 0
    const executed = attach_executed_digest(new Error('crank aborted on chain'), '0xburned')
    const result = await run_force_pass({
      claim: one_shot_latch(),
      crank: async () => {
        cranks += 1
        throw executed
      },
      resync: async () => {},
    })
    expect(result).toEqual({ verdict: 'executed', error: executed })
    expect(cranks).toBe(1)
  })

  test('a zero-gas refusal surfaces honestly (nothing was spent, but nothing advanced either)', async () => {
    const refusal = new Error('Failed to fetch')
    const result = await run_force_pass({
      claim: one_shot_latch(),
      crank: async () => {
        throw refusal
      },
      resync: async () => {},
    })
    expect(result).toEqual({ verdict: 'refused', error: refusal })
  })

  test('a claim that is refused composes NOTHING — no crank, no read', async () => {
    let touched = 0
    const result = await run_force_pass({
      claim: () => false,
      crank: async () => {
        touched += 1
      },
      resync: async () => {
        touched += 1
      },
    })
    expect(result).toEqual({ verdict: 'held', error: null })
    expect(touched).toBe(0)
  })
})

// ── THE LATCH IS A REDUCER FACT, NOT A COMPONENT REF ────────────────────────────────────────────────────────
// The press can arrive from any mount of the fight bar, and React can re-render either of them at any moment.
// The store's claim door is therefore the single home of "this fight@deadline already had its one attempt": a
// second claim is refused there, so no re-render, no double-click and no second mount can compose a second
// transaction against the same deadline.
describe('#1381 ③ · claim_force_pass — the store admits exactly one press per fight@deadline', () => {
  const FIGHT = '0xf1381'
  const DEADLINE = 1_784_000_000_000

  beforeEach(() => {
    use_dungeon.setState({ _force_pass_key: null, _force_passing: false })
  })

  test('RED: the same key is admitted once and refused forever after', () => {
    const key = force_pass_key(FIGHT, DEADLINE)
    expect(use_dungeon.getState().claim_force_pass(key)).toBe(true)
    expect(use_dungeon.getState()._force_passing).toBe(true)
    expect(use_dungeon.getState().claim_force_pass(key)).toBe(false)
    // even once that flight settled, the SAME deadline never gets a second transaction
    use_dungeon.setState({ _force_passing: false })
    expect(use_dungeon.getState().claim_force_pass(key)).toBe(false)
  })

  test('a FRESH deadline re-arms (the turn advanced and then stalled again — a genuinely new stall)', () => {
    expect(use_dungeon.getState().claim_force_pass(force_pass_key(FIGHT, DEADLINE))).toBe(true)
    use_dungeon.setState({ _force_passing: false })
    expect(use_dungeon.getState().claim_force_pass(force_pass_key(FIGHT, DEADLINE + 45_000))).toBe(true)
  })

  test('a null key (no fight, or no deadline to speak of) is never admitted', () => {
    expect(use_dungeon.getState().claim_force_pass(null)).toBe(false)
    expect(use_dungeon.getState()._force_passing).toBe(false)
  })
})
