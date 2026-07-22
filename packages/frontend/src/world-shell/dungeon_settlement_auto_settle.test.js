// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LEAF-2 auto-settle mirror — split out of dungeon_settlement.test.js to respect the ≤600-LoC law
// (docs/CODE_LAW.md; the recap-truth lane's leg② additions pushed the parent file over it). dungeon_settlement.js
// itself is unloadable headless: it pulls the whole SDK/auth/i18n/game-store graph (same class as
// fight_bridge.js, see death_beat_sequencing.test.js) — this mirrors auto_settle_terminal_fights 1:1, per the
// established d36-suite house pattern. pending_outcomes.js is a genuine leaf (zero mock.module, per its own
// header) — safe to import FOR REAL here, so these tests exercise the ACTUAL single-flight/latch registry
// rather than a second hand-rolled fake of it.
import { afterEach, describe, expect, it } from 'bun:test'

import { begin_attempt, end_attempt, attempt_state, reset_attempts_for_test } from './pending_outcomes.js'

/**
 * Mirror of auto_settle_terminal_fights (dungeon_settlement.js, LEAF-2 — "unopened stuff should always
 * auto-open whenever DETECTED", design ruling 2026-07-10/2026-07-12): closes the gap where a defeated/won WORLD fight never got
 * settled (no FightOutcome row exists yet, so the leaf-3 pending-outcomes loop above it can't see it either) —
 * left unsettled, the character's HUD shows stale full HP forever. NOT exported (module-private), and
 * dungeon_settlement.js itself is unloadable headless (see this file's header) — deps arrive as injected
 * functions instead of the real get_dungeon_runs/get_fights/settle_chain/context.get_state()/load_roster
 * imports. `characters` stands in for the ALREADY-RESOLVED roster (the real fn's load_roster-retry-on-empty is
 * a roster-POPULATION nicety, not a settle-DECISION branch — out of scope for this mirror). Uses the REAL
 * pending_outcomes.js attempt registry (begin_attempt/end_attempt/attempt_state) rather than a second hand-
 * rolled fake of it.
 *
 * CONTRACT AS READ (dungeon_settlement.js:374-421, 07-13): the function's ONLY exclusion is "this fight_id is
 * dungeon-run-bound" (`runs.some(...)`) — there is NO third branch for arena/kolizeum, and victory/defeat get
 * IDENTICAL treatment (no win-path special-case). See the "(c)" test below for the kolizeum finding traced
 * through fight.move/the indexer/results.move — documented honestly, not assumed.
 * @param {{ characters: {id:string}[], get_dungeon_runs: () => Promise<any[]>, get_fights: (character_id: string) => Promise<any[]>,
 *           settle_chain: (args: any) => Promise<boolean>,
 *           get_settling_state: () => { _settling: boolean, busy: boolean, fight_id: any, run_pass_id: any } }} deps
 */
async function auto_settle_terminal_fights_mirror({
  characters,
  get_dungeon_runs,
  get_fights,
  settle_chain,
  get_settling_state,
}) {
  if (!characters.length) return
  let runs = []
  let runs_ok = true
  try {
    runs = (await get_dungeon_runs()) ?? []
  } catch {
    runs_ok = false
  }
  for (const character of characters) {
    const character_id = character?.id
    if (!character_id) continue
    let fights = []
    try {
      fights = (await get_fights(character_id)) ?? []
    } catch {
      continue // read hiccup → skip; the next signal re-checks
    }
    const terminal = fights.find((f) => f && (f.status === 'victory' || f.status === 'defeat'))
    const fight_id = terminal && (terminal.fight_id ?? terminal.fight)
    if (!fight_id || attempt_state(fight_id)) continue // none, or inflight/latched — never double-fire
    if (!runs_ok || runs.some((r) => r && (r.fight_id ?? r.fight) === fight_id)) continue // dungeon-bound/unprovable
    if (!begin_attempt(fight_id)) continue // single-flight / already-latched (burn law)
    const settling = get_settling_state()
    if (settling._settling || settling.busy || settling.fight_id || settling.run_pass_id) {
      end_attempt(fight_id, 'transient') // never stomp a live session on ANY character of this wallet
      continue
    }
    const ok = await settle_chain({ terminal: true, fight_id, world_id: terminal.world ?? null, character_id })
    end_attempt(fight_id, ok ? 'settled' : 'executed_failure')
  }
}

/** Idle store snapshot (no live session anywhere) — the common "safe to settle" get_settling_state fixture. */
const idle_state = () => ({ _settling: false, busy: false, fight_id: null, run_pass_id: null })

/** Let every already-resolved mock promise's continuation drain before asserting (fight-liquidation.test.js's proven idiom). */
const flush = () => new Promise((r) => setTimeout(r, 5))

describe('auto_settle_terminal_fights mirror — LEAF-2 stranded-fight auto-recovery', () => {
  afterEach(() => reset_attempts_for_test())

  it('(a) a terminal DEFEAT world fight, unsettled + not dungeon-bound + no live session → settles EXACTLY ONCE', async () => {
    const settle_calls = []
    await auto_settle_terminal_fights_mirror({
      characters: [{ id: 'char-1' }],
      get_dungeon_runs: async () => [],
      get_fights: async () => [{ fight: 'fight-1', world: 'world-1', status: 'defeat' }],
      settle_chain: async (args) => {
        settle_calls.push(args)
        return true // landed
      },
      get_settling_state: idle_state,
    })
    expect(settle_calls).toEqual([{ terminal: true, fight_id: 'fight-1', world_id: 'world-1', character_id: 'char-1' }])
    expect(attempt_state('fight-1')).toBe(null) // a settled fight clears the slot — result-id tombstones are separate
  })

  it('(b) a DUNGEON-bound terminal fight (its fight_id is in get_dungeon_runs) → left to the manual press, never settled', async () => {
    let settle_calls = 0
    await auto_settle_terminal_fights_mirror({
      characters: [{ id: 'char-1' }],
      get_dungeon_runs: async () => [{ pass: 'pass-1', fight: 'fight-1' }], // RpcDungeonRun's real field name is `fight`
      get_fights: async () => [{ fight: 'fight-1', world: 'world-1', status: 'defeat' }],
      settle_chain: async () => {
        settle_calls += 1
        return true
      },
      get_settling_state: idle_state,
    })
    expect(settle_calls).toBe(0)
    expect(attempt_state('fight-1')).toBe(null) // never even claimed the slot (stop-rule: auto never improvises settle_run)
  })

  it('(b2) an UNPROVABLE dungeon-run read (get_dungeon_runs throws) → conservatively treated as dungeon-bound, never settled', async () => {
    let settle_calls = 0
    await auto_settle_terminal_fights_mirror({
      characters: [{ id: 'char-1' }],
      get_dungeon_runs: async () => {
        throw new Error('route not live yet')
      },
      get_fights: async () => [{ fight: 'fight-1', world: 'world-1', status: 'defeat' }],
      settle_chain: async () => {
        settle_calls += 1
        return true
      },
      get_settling_state: idle_state,
    })
    expect(settle_calls).toBe(0) // an unprovable read never improvises — same conservative rule as a proven dungeon-bind
  })

  it('(c) FINDING: the function has NO kolizeum/pvp discriminator — its only exclusion is dungeon-run membership', async () => {
    // Traced through the Move/indexer layer (not assumed): a kolizeum bout creates a REAL `Fight` via the SAME
    // `engine::create_pvp` (packages/move/engine/sources/fight.move:358-359 calls the IDENTICAL
    // `fight_events::emit_created`/emit_joined as a world fight), and the indexer's FightCreated/Victory/Defeat
    // handlers (packages/rpc/indexer/src/handlers/ares/project.rs:694-751) have ZERO mode/pvp discrimination —
    // any Fight doc, regardless of origin, is indexed and status-flipped identically. RpcFight (rpc/views.ts:375)
    // carries no origin/pvp field at all. So a terminal kolizeum bout CAN structurally reach get_fights({character})
    // with status victory/defeat, and — since a kolizeum fight_id is never dungeon-run-bound either — THIS loop
    // cannot tell it apart from a world fight. Kolizeum's OWN close-out (`kolizeum::open`, sdk/src/kolizeum.js:160)
    // deliberately bypasses `results::open`'s XP/HP write-back and separately releases the arena pot via
    // `kolizeum::settle` — neither of which this function (or settle_chain) knows how to drive. This test proves
    // the HONEST current contract — settle_calls is 1, NOT 0 — documenting the gap rather than asserting a
    // protection that doesn't exist in the code. NOT fixed here: the fix needs an origin tag on RpcFight itself
    // (Move event + indexer + wire shape), a multi-package change outside a unit-test ticket's fence — see report.
    const settle_calls = []
    await auto_settle_terminal_fights_mirror({
      characters: [{ id: 'char-1' }],
      get_dungeon_runs: async () => [], // a kolizeum bout is never dungeon-run-bound
      get_fights: async () => [{ fight: 'arena-fight-1', world: 'kolizeum-lobby-1', status: 'victory' }],
      settle_chain: async (args) => {
        settle_calls.push(args)
        return true
      },
      get_settling_state: idle_state,
    })
    expect(settle_calls.length).toBe(1) // current behavior: settled anyway — see the finding above
  })

  it('(d) a CONCURRENT second pass (two wires firing close together) sees the slot already inflight → settles AT MOST ONCE', async () => {
    const settle_calls = []
    const resolvers = []
    const deps = {
      characters: [{ id: 'char-1' }],
      get_dungeon_runs: async () => [],
      get_fights: async () => [{ fight: 'fight-1', world: 'world-1', status: 'defeat' }],
      settle_chain: async (args) => {
        settle_calls.push(args)
        return new Promise((r) => resolvers.push(r)) // held open — never resolves until we say so
      },
      get_settling_state: idle_state,
    }
    const p1 = auto_settle_terminal_fights_mirror(deps) // claims the slot, then awaits the held-open settle_chain
    const p2 = auto_settle_terminal_fights_mirror(deps) // must see 'inflight' and skip — never a second settle_chain call
    await flush()
    expect(settle_calls.length).toBe(1) // the second concurrent pass never re-fired
    resolvers.forEach((r) => r(true))
    await Promise.all([p1, p2])
    expect(attempt_state('fight-1')).toBe(null) // cleared by the ONE call that actually landed
  })

  it('(d2) a PRIOR executed-failure LATCH on the same fight_id → never auto-refired (burn law: a digest exists = gas burned)', async () => {
    expect(begin_attempt('fight-1')).toBe(true)
    end_attempt('fight-1', 'executed_failure') // simulates a previous run's on-chain abort
    let settle_calls = 0
    await auto_settle_terminal_fights_mirror({
      characters: [{ id: 'char-1' }],
      get_dungeon_runs: async () => [],
      get_fights: async () => [{ fight: 'fight-1', world: 'world-1', status: 'defeat' }],
      settle_chain: async () => {
        settle_calls += 1
        return true
      },
      get_settling_state: idle_state,
    })
    expect(settle_calls).toBe(0) // latched — auto never re-fires a digest-exists failure
    expect(attempt_state('fight-1')).toBe('latched') // stays latched — only a MANUAL press may retry
  })

  it('(e) a WON (status: victory) world fight settles the SAME as a defeat — no separate win-path special-case', async () => {
    const settle_calls = []
    await auto_settle_terminal_fights_mirror({
      characters: [{ id: 'char-1' }],
      get_dungeon_runs: async () => [],
      get_fights: async () => [{ fight: 'fight-1', world: 'world-1', status: 'victory' }],
      settle_chain: async (args) => {
        settle_calls.push(args)
        return true
      },
      get_settling_state: idle_state,
    })
    expect(settle_calls).toEqual([{ terminal: true, fight_id: 'fight-1', world_id: 'world-1', character_id: 'char-1' }])
  })

  it('a live session on ANY character (_settling/busy/fight_id/run_pass_id set) → never stomped; re-armable, not latched', async () => {
    let settle_calls = 0
    await auto_settle_terminal_fights_mirror({
      characters: [{ id: 'char-1' }],
      get_dungeon_runs: async () => [],
      get_fights: async () => [{ fight: 'fight-1', world: 'world-1', status: 'defeat' }],
      settle_chain: async () => {
        settle_calls += 1
        return true
      },
      get_settling_state: () => ({ _settling: true, busy: false, fight_id: null, run_pass_id: null }),
    })
    expect(settle_calls).toBe(0) // never stomps a live session
    expect(attempt_state('fight-1')).toBe(null) // transient — re-armable on the next signal, NOT latched
  })

  it('no unsettled terminal fight (status is placement/active) → no-op, zero settle attempts', async () => {
    let settle_calls = 0
    await auto_settle_terminal_fights_mirror({
      characters: [{ id: 'char-1' }],
      get_dungeon_runs: async () => [],
      get_fights: async () => [{ fight: 'fight-1', world: 'world-1', status: 'active' }],
      settle_chain: async () => {
        settle_calls += 1
        return true
      },
      get_settling_state: idle_state,
    })
    expect(settle_calls).toBe(0)
  })

  it('an empty roster (no characters) → no-op, never even reads get_dungeon_runs/get_fights', async () => {
    let runs_calls = 0
    let fights_calls = 0
    await auto_settle_terminal_fights_mirror({
      characters: [],
      get_dungeon_runs: async () => {
        runs_calls += 1
        return []
      },
      get_fights: async () => {
        fights_calls += 1
        return []
      },
      settle_chain: async () => true,
      get_settling_state: idle_state,
    })
    expect(runs_calls).toBe(0)
    expect(fights_calls).toBe(0)
  })

  it("one character's get_fights read failing does NOT block a sibling character's settle", async () => {
    const settle_calls = []
    await auto_settle_terminal_fights_mirror({
      characters: [{ id: 'char-broken' }, { id: 'char-2' }],
      get_dungeon_runs: async () => [],
      get_fights: async (character_id) => {
        if (character_id === 'char-broken') throw new Error('read hiccup')
        return [{ fight: 'fight-2', world: 'world-1', status: 'defeat' }]
      },
      settle_chain: async (args) => {
        settle_calls.push(args)
        return true
      },
      get_settling_state: idle_state,
    })
    expect(settle_calls).toEqual([{ terminal: true, fight_id: 'fight-2', world_id: 'world-1', character_id: 'char-2' }])
  })

  it('settle_chain returns false (an executed abort) → end_attempt LATCHES the fight_id, never auto-refired next signal', async () => {
    await auto_settle_terminal_fights_mirror({
      characters: [{ id: 'char-1' }],
      get_dungeon_runs: async () => [],
      get_fights: async () => [{ fight: 'fight-1', world: 'world-1', status: 'defeat' }],
      settle_chain: async () => false, // settle_chain's own contract: false = halted (raced-gone or executed abort)
      get_settling_state: idle_state,
    })
    expect(attempt_state('fight-1')).toBe('latched')
  })
})
