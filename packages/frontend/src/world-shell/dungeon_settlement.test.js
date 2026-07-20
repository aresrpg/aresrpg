// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ATOMIC mint+burn settlement (recurring abort-105, 07-11 — the TRUE fix): `results::burn_result`
// aborts 105 ENotEmpty while `rolled` loot remains (results.move:170). The ROOT was NOT mint-failure tracking:
// `decode_fight_result` mis-modelled the CURRENT plain `vector<RolledLoot>` as the pre-S-46 `Option<vector>` and
// THREW on the real non-empty shape → the caller's `.catch(()=>null)` blanked the result → the client's mint plan
// was EMPTY → the old `all_minted` gate went vacuously true → burn fired against a FULL result. The decoder fix
// lives in @aresrpg/sdk (fight_read.js, regression-guarded in packages/sdk/test/fight.test.js). Here the
// STRUCTURAL fix: finish_result / mint_owed now drive ONE atomic PTB — mint every rolled template (&mut result)
// then burn it (by value, LAST) — via dungeon_actions.mint_all_and_burn. The burn's own on-chain
// `rolled.is_empty()` assert gates it, so CHAIN truth — never a client read — decides; any mint abort reverts the
// WHOLE PTB (loot safe, retriable). The whole "client read diverges from the burn's chain execution" staleness
// class dies with the two-phase flow.
//
// dungeon_settlement.js is NOT imported here: it pulls the whole SDK/auth/i18n/game-store graph (unloadable
// headless — same class as fight_bridge.js, see death_beat_sequencing.test.js), and `./dungeon_actions` is
// already mock.module-owned by fight-liquidation.test.js — bun's mock.module is PROCESS-GLOBAL (no un-mock API),
// so a second `mock.module('./dungeon_actions', …)` here would collide/order-flicker the suite (memory law:
// "never double-mock shared modules", 3 incidents 07-10). Per the established d36-suite house pattern, this
// MIRRORS the exact control-flow shape of finish_result's loot tail, mint_owed, and the mint_all_and_burn
// composer (kept 1:1 with dungeon_settlement.js / dungeon_actions.js) rather than importing the modules.
import { describe, expect, it } from 'bun:test'

// loot_from_rolled is the REAL receipt→card mapper (fight_result_receipt.js — leaf import, no mock.module):
// the finish_loot mirror runs it 1:1 with finish_result's loot dispatch (v30 receipt law). The LEAF-2
// auto_settle_terminal_fights mirror (its own pending_outcomes.js leaf import) lives in the sibling
// dungeon_settlement_auto_settle.test.js — split out to respect the ≤600-LoC law (docs/CODE_LAW.md).
import { loot_from_rolled } from './fight_result_receipt.js'

/**
 * Mirror of the mint_all_and_burn COMPOSER (dungeon_actions.js): thread ONE tx across every mint builder, then
 * the burn builder LAST — the client-side shape of the Sui &mut-per-mint-then-consume-by-value-last PTB. An
 * `undefined` tx seeds a fresh one via the first builder's default; each builder returns the same threaded tx.
 * @param {string[]} templates
 * @param {(a: { item_template_id: string, tx: any }) => any} mint_builder
 * @param {(a: { tx: any }) => any} burn_builder
 * @returns {{ tx: any, order: string[] }}
 */
function compose_mint_all_and_burn(templates, mint_builder, burn_builder) {
  const order = []
  let tx
  for (const item_template_id of templates) {
    order.push(`mint:${item_template_id}`)
    tx = mint_builder({ item_template_id, tx })
  }
  order.push('burn')
  tx = burn_builder({ tx })
  return { tx, order }
}

describe('mint_all_and_burn composer — every mint composes BEFORE the single burn, on ONE threaded tx', () => {
  it('N templates: mint×N then burn, in order, all sharing ONE tx (burn is the by-value-consume LAST command)', () => {
    const seen_tx = []
    const mint_builder = ({ tx }) => {
      const t = tx ?? { id: 'tx-seed' } // first builder seeds the tx (the real builder defaults new Transaction())
      seen_tx.push(t)
      return t
    }
    const burn_builder = ({ tx }) => {
      seen_tx.push(tx)
      return tx
    }
    const { order } = compose_mint_all_and_burn(['0xA', '0xB', '0xC'], mint_builder, burn_builder)
    expect(order).toEqual(['mint:0xA', 'mint:0xB', 'mint:0xC', 'burn']) // burn strictly last
    expect(new Set(seen_tx).size).toBe(1) // ONE tx object threaded through every command (single input)
  })

  it('empty templates (defeat / already-emptied result): a BARE burn, no mint commands', () => {
    const order = []
    const { order: seen } = compose_mint_all_and_burn(
      [],
      () => {
        order.push('mint')
        return {}
      },
      ({ tx }) => tx ?? {}
    )
    expect(order).toEqual([]) // zero mints composed
    expect(seen).toEqual(['burn'])
  })
})

/**
 * Mirror of finish_result's loot tail (dungeon_settlement.js): read the FightResult (null on a degraded read),
 * and ONLY when it landed, (1) dispatch the card's loot lines from the receipt's OWN `rolled` — mapped through
 * the REAL loot_from_rolled (v30 receipt law: never a bag diff; note this mirror holds NO bag at all,
 * proving the derivation needs none) — then (2) run the ATOMIC mint+burn (all-or-nothing). `result_id` clears
 * ONLY on success; a null read or an on-chain revert KEEPS it (the loot dispatch rides the READ, not the mint —
 * a reverted mint keeps the tiles honest: the chain still owes exactly those lines). `item_qty` is the full
 * rolled total on success, 0 otherwise.
 * @param {{ rolled: { item_template: string, qty: number }[] } | null} result the get_fight_result read (or null)
 * @param {(templates: string[]) => Promise<void>} mint_all_and_burn
 * @param {Map<string, any>} [template_map]
 * @returns {Promise<{ result_id: string | null, item_qty: number, called: string[] | null, loot_dispatched: any[] | null }>}
 */
async function finish_loot(result, mint_all_and_burn, template_map = new Map()) {
  let result_id = 'result-1'
  let item_qty = 0
  let called = null
  let loot_dispatched = null
  const rolled = result?.rolled ?? []
  if (result) loot_dispatched = loot_from_rolled(rolled, template_map) // receipt → card, BEFORE the mint tx
  if (result) {
    try {
      const templates = rolled.map((e) => e.item_template)
      called = templates
      await mint_all_and_burn(templates)
      item_qty = rolled.reduce((s, e) => s + Number(e.qty ?? 0), 0)
      result_id = null
    } catch {
      // atomic PTB reverted — result_id stays for the retry surface, item_qty stays 0
    }
  }
  return { result_id, item_qty, called, loot_dispatched }
}

/**
 * Mirror of finish_result's FightResult READ (dungeon_settlement.js): a BOUNDED, READ-ONLY retry —
 * kiosk_resolve.js's `join_kiosk_for_character` idiom. settle_and_open/settle_run_and_open/open_outcome already
 * landed on-chain, so a null/thrown read here is the serving node's read-after-write lag on the object THIS
 * SAME PTB just minted — never a reason to retry any tx, only the read. ~3 tries, then the honest absence
 * (null) — finish_loot's existing "hold, never invent" contract still applies (skeletons stand; mint_loot
 * remains the eventual manual retry surface).
 * @param {() => Promise<any>} read_once @param {(ms:number)=>Promise<void>} sleep
 */
async function read_result_with_retry(read_once, sleep) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await read_once().catch(() => null)
    if (result) return result
    if (attempt < 3) await sleep(1600)
  }
  return null
}

describe('finish_result FightResult read retry — a transient miss self-heals, never stuck forever', () => {
  it('RED-FIRST: the read misses TWICE (read-after-write lag on the just-minted result) then lands on the 3rd try', async () => {
    let calls = 0
    const sleeps = []
    const result = await read_result_with_retry(
      async () => {
        calls += 1
        if (calls < 3) return null // the settle+open PTB's own object, not yet visible to this read
        return { rolled: [{ item_template: '0xA', qty: 2 }] }
      },
      async (ms) => sleeps.push(ms)
    )
    expect(calls).toBe(3)
    expect(result).toEqual({ rolled: [{ item_template: '0xA', qty: 2 }] }) // landed — the tile can now resolve
    expect(sleeps).toEqual([1600, 1600]) // backoff only BETWEEN attempts, never after the last
  })

  it('the fast path (first attempt lands) never sleeps — zero added latency on the common case', async () => {
    let calls = 0
    const sleeps = []
    const result = await read_result_with_retry(
      async () => {
        calls += 1
        return { rolled: [] }
      },
      async (ms) => sleeps.push(ms)
    )
    expect(calls).toBe(1)
    expect(sleeps).toEqual([])
    expect(result).toEqual({ rolled: [] })
  })

  it("a SUSTAINED failure (all 3 attempts miss) still gives up honestly — null, feeding finish_loot(null, …)'s existing hold-not-invent contract", async () => {
    let calls = 0
    const result = await read_result_with_retry(
      async () => {
        calls += 1
        return null
      },
      async () => {}
    )
    expect(calls).toBe(3)
    expect(result).toBe(null)
  })

  it('a THROWING read (transport error, not just a missing object) is treated the same as a miss — retried, never left to reject the caller', async () => {
    let calls = 0
    const result = await read_result_with_retry(
      async () => {
        calls += 1
        if (calls < 2) throw new Error('simulated transport error')
        return { rolled: [{ item_template: '0xB', qty: 1 }] }
      },
      async () => {}
    )
    expect(calls).toBe(2)
    expect(result).toEqual({ rolled: [{ item_template: '0xB', qty: 1 }] })
  })
})

/** Mirror of dungeon_settlement.js's floor_loot — the ONE event-floor placeholder entry (leg②). */
const floor_loot_mirror = (units) => (units > 0 ? [{ item_type: '', name: '', amount: units }] : [])

/**
 * Mirror of finish_result's LOOT-ITEM dispatch sequence (dungeon_settlement.js, recap-truth lane leg②): the
 * ResultOpened event names ONLY a total unit count (results.move's `total_units` — no per-template identity;
 * that lives solely in the FightResult object's `rolled` declaration). So the FIRST dispatch is a receipt-FLOOR
 * placeholder (resolved:false) the INSTANT loot_units is known — never an indefinite pulsing skeleton while
 * the slow object read (the ONLY source of per-template identity, already internally retried — see
 * read_result_with_retry above) is still in flight or has permanently failed. If/when that read lands, its
 * OWN `rolled` declaration dispatches SECOND (resolved:true) — richer, reconciling BEHIND the floor. A
 * permanently failing read (`read_result` resolves null) simply never fires the second dispatch: the floor
 * stands, unwiped. player_experience.test.js pins the REDUCER half of this contract (same-version
 * discard/richer adopt); this mirror pins the DISPATCH SEQUENCE half.
 * @param {{ loot_units: number | null }} args event-carried field
 * @param {() => Promise<{ rolled: { item_template: string, qty: number }[] } | null>} read_result the
 *   (already internally-retried) FightResult read — null means every retry inside it was exhausted
 * @param {Map<string, any>} [template_map]
 * @returns {Promise<Array<{ loot: any[], resolved: boolean }>>} every action/fight_result/loot payload, IN ORDER
 */
async function finish_result_loot_dispatch({ loot_units }, read_result, template_map = new Map()) {
  const dispatched = []
  const rolled_units = Number(loot_units ?? 0)
  if (rolled_units > 0) dispatched.push({ loot: floor_loot_mirror(rolled_units), resolved: false })
  const result = await read_result()
  if (result) dispatched.push({ loot: loot_from_rolled(result.rolled ?? [], template_map), resolved: true })
  return dispatched
}

describe('finish_result loot-item dispatch — the event floor renders INSTANTLY, the slow read reconciles behind (leg②)', () => {
  it('RED-FIRST: loot_units known, the slow read NEVER resolves (null forever) → the floor tile is the ONLY dispatch, and it STANDS (never an indefinite skeleton)', async () => {
    const dispatched = await finish_result_loot_dispatch({ loot_units: 3 }, async () => null)
    expect(dispatched).toEqual([{ loot: [{ item_type: '', name: '', amount: 3 }], resolved: false }])
  })

  it('loot_units known, the slow read LANDS richer (real templates) → the floor fires first, the real resolved list adopts SECOND — no regression', async () => {
    const template_map = new Map([['0xA', { item_type: 'razkin_hide', name: 'Razkin Hide' }]])
    const dispatched = await finish_result_loot_dispatch(
      { loot_units: 2 },
      async () => ({ rolled: [{ item_template: '0xA', qty: 2 }] }),
      template_map
    )
    expect(dispatched).toEqual([
      { loot: [{ item_type: '', name: '', amount: 2 }], resolved: false }, // the instant floor
      { loot: [{ item_type: 'razkin_hide', name: 'Razkin Hide', amount: 2 }], resolved: true }, // reconciled behind
    ])
  })

  it('loot_units is 0 (a genuine no-drop win): NO floor tile — nothing to show honestly, only the landed-empty real dispatch', async () => {
    const dispatched = await finish_result_loot_dispatch({ loot_units: 0 }, async () => ({ rolled: [] }))
    expect(dispatched).toEqual([{ loot: [], resolved: true }])
  })

  it('loot_units unknown (receipt-parse miss, null): no premature floor — the object read alone resolves it once it lands', async () => {
    const dispatched = await finish_result_loot_dispatch(
      { loot_units: null },
      async () => ({ rolled: [{ item_template: '0xA', qty: 1 }] }),
      new Map([['0xA', { item_type: 'razkin_hide', name: 'Razkin Hide' }]])
    )
    expect(dispatched).toEqual([
      { loot: [{ item_type: 'razkin_hide', name: 'Razkin Hide', amount: 1 }], resolved: true },
    ])
  })

  it('loot_units unknown AND the read also never resolves: honestly nothing dispatches (no data anywhere — never a fabricated floor)', async () => {
    const dispatched = await finish_result_loot_dispatch({ loot_units: null }, async () => null)
    expect(dispatched).toEqual([])
  })
})

describe('finish_result loot tail — ATOMIC mint+burn, never a burn on a blind read', () => {
  it('degraded/failed FightResult read (null — the ROOT class): NO PTB is even composed, result_id KEPT', async () => {
    let calls = 0
    const { result_id, item_qty, called, loot_dispatched } = await finish_loot(null, () => {
      calls += 1
      return Promise.resolve()
    })
    expect(called).toBe(null) // mint_all_and_burn never invoked — a null read never fires a burn
    expect(calls).toBe(0)
    expect(result_id).toBe('result-1') // KEPT — the retry surface (mint_loot) re-reads and picks it up
    expect(item_qty).toBe(0)
    expect(loot_dispatched).toBe(null) // hold-not-invent: no receipt read → NO loot dispatch (skeletons stand)
  })

  it('landed read, empty rolled (defeat / no-drop): one atomic call with [], result_id cleared', async () => {
    const seen = []
    const { result_id, item_qty, called } = await finish_loot({ rolled: [] }, (templates) => {
      seen.push(templates)
      return Promise.resolve()
    })
    expect(called).toEqual([]) // a bare burn (chain rolled genuinely empty)
    expect(seen).toEqual([[]])
    expect(result_id).toBe(null)
    expect(item_qty).toBe(0)
  })

  it('landed read with loot, atomic success: ONE call carries EVERY template, result_id cleared, item_qty summed', async () => {
    const seen = []
    const rolled = [
      { item_template: '0xA', qty: 2 },
      { item_template: '0xB', qty: 1 },
    ]
    const templates = new Map([
      ['0xA', { item_type: 'razkin_hide', name: 'Razkin Hide' }],
      ['0xB', { item_type: 'razkin_fang', name: 'Razkin Fang' }],
    ])
    const { result_id, item_qty, called, loot_dispatched } = await finish_loot(
      { rolled },
      (t) => {
        seen.push(t)
        return Promise.resolve()
      },
      templates
    )
    expect(called).toEqual(['0xA', '0xB']) // the FULL plan in ONE atomic PTB — never a per-entry burn decision
    expect(seen.length).toBe(1)
    expect(result_id).toBe(null)
    expect(item_qty).toBe(3)
    // The card lines ARE the receipt's rolled — this mirror holds no bag anywhere
    expect(loot_dispatched).toEqual([
      { item_type: 'razkin_hide', name: 'Razkin Hide', amount: 2 },
      { item_type: 'razkin_fang', name: 'Razkin Fang', amount: 1 },
    ])
  })

  it('landed read with loot, atomic REVERT (a mint OR the burn aborted): result_id KEPT, item_qty 0 — the regression case now reverts SAFELY', async () => {
    const rolled = [{ item_template: '0xA', qty: 2 }]
    const { result_id, item_qty, loot_dispatched } = await finish_loot({ rolled }, () =>
      Promise.reject(new Error('mint_all_and_burn: simulated on-chain abort (whole PTB reverted)'))
    )
    expect(result_id).toBe('result-1') // loot stays on the result, retriable — NEVER a stranded burn against a full result
    expect(item_qty).toBe(0)
    // the loot dispatch rides the READ, not the mint: the chain still owes exactly these lines (D53 key = raw id
    // here — the empty template map degrades honestly, never drops the line)
    expect(loot_dispatched).toEqual([{ item_type: '0xA', name: '', amount: 2 }])
  })
})

/**
 * Mirror of the FIXED mint_owed (dungeon_settlement.js — the manual loot-retry surface): the SAME atomic call as
 * finish_result. A null/degraded read returns early (result_id KEPT — never burn on a blind read); on a landed
 * read it runs mint_all_and_burn and clears `result_id` ONLY on a successful atomic PTB (a revert keeps it).
 * @param {{ rolled: { item_template: string }[] } | null} result
 * @param {(templates: string[]) => Promise<void>} mint_all_and_burn
 * @returns {Promise<{ result_id: string | null, called: boolean }>}
 */
async function mint_owed_mirror(result, mint_all_and_burn) {
  let result_id = 'result-1'
  if (!result) return { result_id, called: false } // read failed — kept, never a blind burn
  const called = true
  try {
    await mint_all_and_burn((result.rolled ?? []).map((e) => e.item_template))
    result_id = null
  } catch {
    // atomic PTB reverted — result_id stays so a later press can retry the remainder
  }
  return { result_id, called }
}

describe('mint_owed retry surface — result_id clears ONLY once the atomic mint+burn lands', () => {
  it('degraded/failed read (null): no PTB, result_id KEPT for the next press', async () => {
    let calls = 0
    const { result_id, called } = await mint_owed_mirror(null, () => {
      calls += 1
      return Promise.resolve()
    })
    expect(called).toBe(false)
    expect(calls).toBe(0)
    expect(result_id).toBe('result-1')
  })

  it('landed read, atomic success: burn landed, result_id cleared', async () => {
    const { result_id, called } = await mint_owed_mirror({ rolled: [{ item_template: '0xA' }] }, () =>
      Promise.resolve()
    )
    expect(called).toBe(true)
    expect(result_id).toBe(null)
  })

  it('landed read, atomic REVERT (a mint or the burn aborted): result_id KEPT — not stranded', async () => {
    const { result_id, called } = await mint_owed_mirror({ rolled: [{ item_template: '0xA' }] }, () =>
      Promise.reject(new Error('atomic mint+burn: simulated on-chain abort'))
    )
    expect(called).toBe(true)
    expect(result_id).toBe('result-1') // loot remains — the surface can fire again
  })
})

/**
 * Mirror of finish_result's REWARD-DISPATCH ordering (dungeon_settlement.js, design ruling 2026-07-12): the reducer that
 * shows +XP/loot on the victory card resolves off the ALREADY-HELD ResultOpened event data (xp_share/loot_units
 * — the atomic settle_and_open PTB's own tx result) BEFORE the chain re-read + mint/burn tail runs ("the xp
 * appearing is really slow" — a WHOLE second on-chain mint/burn transaction used to sit between the number
 * landing and the dispatch that shows it). A genuine zero loot roll rides through as the NUMBER 0, never
 * `|| null` ("if there is no items, don't show a slot" — the old `|| null` collapsed a real zero into "unknown,"
 * and the reducer's `??` fallback (player_experience.js fold) kept a stale prior value instead of clearing it).
 * @param {{ xp_share: number|null, loot_units: number|null, character_id: string }} args event-carried fields
 * @param {() => Promise<{ xp_share: number, rolled: { qty: number }[] } | null>} read_result the fallback FightResult read
 * @param {() => Promise<void>} mint_all_and_burn
 * @returns {Promise<{ calls: string[], dispatched: { xp: number, loot_units: number }[] }>} calls in FIRING order
 */
async function finish_result_reward({ xp_share, loot_units, character_id }, read_result, mint_all_and_burn) {
  const calls = []
  const dispatched = []
  let rolled_units = Number(loot_units ?? 0)
  let xp = Number(xp_share ?? 0)
  const resolve_reward = (xp_value, rolled_value) => {
    if (!(xp_value > 0 && character_id)) return
    calls.push('resolve')
    dispatched.push({ xp: xp_value, loot_units: rolled_value })
  }
  resolve_reward(xp, rolled_units) // FAST path — fires off the event data alone, before any read/mint below

  const result = await read_result()
  if (loot_units == null) rolled_units = (result?.rolled ?? []).reduce((s, e) => s + Number(e.qty ?? 0), 0)
  if (xp_share == null) {
    xp = Number(result?.xp_share ?? 0)
    resolve_reward(xp, rolled_units) // fallback — ONLY when the receipt carried no event
  }
  if (result) {
    calls.push('mint_and_burn')
    await mint_all_and_burn()
  }
  return { calls, dispatched }
}

describe('finish_result reward dispatch — XP/loot resolve off event data, never gated behind mint/burn', () => {
  it('event data present: resolve fires BEFORE the chain read + mint/burn (the latency fix)', async () => {
    const { calls, dispatched } = await finish_result_reward(
      { xp_share: 102, loot_units: 0, character_id: 'me' },
      async () => ({ xp_share: 999, rolled: [{ qty: 99 }] }), // deliberately WRONG — must never be used
      async () => {}
    )
    expect(calls).toEqual(['resolve', 'mint_and_burn']) // resolve strictly before the read/mint tail
    expect(dispatched).toEqual([{ xp: 102, loot_units: 0 }]) // the REAL event numbers, not the read's
  })

  it('a genuine zero-loot win dispatches loot_units: 0 — never null (the empty-slot fix)', async () => {
    const { dispatched } = await finish_result_reward(
      { xp_share: 40, loot_units: 0, character_id: 'me' },
      async () => ({ xp_share: 40, rolled: [] }),
      async () => {}
    )
    expect(dispatched).toEqual([{ xp: 40, loot_units: 0 }])
    expect(dispatched[0].loot_units).toBe(0) // not null/undefined — a stale prior value can't survive via `??`
  })

  it('receipt-parse miss (no ResultOpened event): the fast path no-ops, the fallback read resolves it ONCE', async () => {
    const { calls, dispatched } = await finish_result_reward(
      { xp_share: null, loot_units: null, character_id: 'me' },
      async () => ({ xp_share: 77, rolled: [{ qty: 4 }] }),
      async () => {}
    )
    expect(calls).toEqual(['resolve', 'mint_and_burn']) // exactly one resolve — the fast attempt was a real no-op
    expect(dispatched).toEqual([{ xp: 77, loot_units: 4 }])
  })
})
