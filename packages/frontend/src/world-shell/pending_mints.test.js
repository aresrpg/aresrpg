// pending_mints.js — the receipt-driven mint+burn queue, exercised through PLAIN INJECTED ARGS (the module is a
// deliberate leaf — the chain read / mint composer / /v1 fetch / toast all arrive as deps). ZERO `mock.module`
// (process-global collision law). Proves the stranded-loot recovery contract:
//   • the DECOUPLED GATE (leg①): a null display read no longer SKIPS the mint — the result STAYS queued and mints
//     the instant the chain object reads (the old ~5s give-up stranded 41 FightResults soulbound);
//   • IDEMPOTENT by construction (seat ⑴): mint+burn once → a re-run sweep composes ZERO (the burned tombstone);
//   • the BURN LAW: an EXECUTED mint failure (a digest) LATCHES — never auto-recomposed;
//   • the SWEEP (leg②): opened-but-un-burned results recover (loot → mint+burn, empty husk → bare burn), unopened
//     rows are skipped, and ONE summary toast is requested — never per-result spam.
import { afterEach, describe, expect, it } from 'bun:test'

import {
  enqueue_mint,
  process_mint,
  drain_pending_mints,
  sweep_stranded_results,
  pending_mint_status,
  reset_pending_mints_for_test,
} from './pending_mints.js'

afterEach(() => reset_pending_mints_for_test())

// A landed FightResult read (decode_fight_result shape): `is_opened` true, `rolled` a plain array (empty ⇒ husk).
const opened = (rolled) => ({ is_opened: true, rolled })
// An executed on-chain failure carries a digest (gas burned) — the burn-law latch signal (tx_digest_error.js).
const executed_error = () => Object.assign(new Error('mint_all_and_burn: on-chain abort'), { digest: '0xDEAD' })
// A pre-flight/network failure never reached execution — re-armable (is_preflight_failure matches the message class).
const network_error = () => new Error('fetch failed: network timeout')

// deps builder: a spy mint_and_burn (records [id, templates] calls) + an injectable read/clock. schedule defaults
// to a NO-OP so no real timer fires during a test (retries are driven explicitly via the clock + a second drain).
function make_deps({ read_result, mint_impl = async () => {}, now } = {}) {
  const minted = []
  return {
    minted,
    deps: {
      read_result,
      mint_and_burn: async (id, templates) => {
        minted.push({ id, templates })
        return mint_impl(id, templates)
      },
      now,
      schedule: () => null,
    },
  }
}

describe('process_mint — the mint DECISION is the chain object alone (never a read-layer answer)', () => {
  it('null read (lag/burned/race) ⇒ RETRY, NEVER a mint against a blind read', async () => {
    const { minted, deps } = make_deps({ read_result: async () => null })
    expect(await process_mint('0xR', deps)).toBe('retry')
    expect(minted).toEqual([]) // the root fix: a flaky read composes NOTHING (the old code strand-skipped here)
  })

  it('opened result WITH loot ⇒ mint every rolled template + burn, verdict minted', async () => {
    const { minted, deps } = make_deps({
      read_result: async () => opened([{ item_template: '0xA' }, { item_template: '0xB' }]),
    })
    expect(await process_mint('0xR', deps)).toBe('minted')
    expect(minted).toEqual([{ id: '0xR', templates: ['0xA', '0xB'] }]) // ONE atomic mint_all_and_burn call
  })

  it('opened EMPTY husk (defeat / no-drop) ⇒ a BARE burn (templates []), verdict minted', async () => {
    const { minted, deps } = make_deps({ read_result: async () => opened([]) })
    expect(await process_mint('0xR', deps)).toBe('minted')
    expect(minted).toEqual([{ id: '0xR', templates: [] }]) // burn_result alone — the 30 husks die in-sweep (seat ⑤)
  })

  it('EXECUTED mint failure (a digest) ⇒ LATCHED (burn law: never re-fire spent gas)', async () => {
    const { deps } = make_deps({
      read_result: async () => opened([{ item_template: '0xA' }]),
      mint_impl: async () => {
        throw executed_error()
      },
    })
    expect(await process_mint('0xR', deps)).toBe('latched')
  })

  it('PRE-FLIGHT/network mint failure (no digest) ⇒ RETRY (re-armable)', async () => {
    const { deps } = make_deps({
      read_result: async () => opened([{ item_template: '0xA' }]),
      mint_impl: async () => {
        throw network_error()
      },
    })
    expect(await process_mint('0xR', deps)).toBe('retry')
  })
})

describe('enqueue + drain — IDEMPOTENT by construction (seat ⑴: mints once, a re-run composes ZERO)', () => {
  it('a stranded result mints+burns exactly once; a re-enqueue (later sweep) is a NO-OP → ZERO recompose', async () => {
    const { minted, deps } = make_deps({ read_result: async () => opened([{ item_template: '0xA' }]) })
    enqueue_mint('0xR')
    await drain_pending_mints(deps)
    expect(minted.length).toBe(1)
    expect(pending_mint_status('0xR')).toBe('done') // burned tombstone

    enqueue_mint('0xR') // a later boot sweep re-encounters the same id
    await drain_pending_mints(deps)
    expect(minted.length).toBe(1) // STILL one — the burned result never recomposes (idempotency)
  })

  it('an EXECUTED-failure latch is terminal: a re-enqueue never recomposes the burned-gas tx', async () => {
    const { minted, deps } = make_deps({
      read_result: async () => opened([{ item_template: '0xA' }]),
      mint_impl: async () => {
        throw executed_error()
      },
    })
    enqueue_mint('0xR')
    await drain_pending_mints(deps)
    expect(minted.length).toBe(1) // one attempt, executed + failed
    expect(pending_mint_status('0xR')).toBe('latched')

    enqueue_mint('0xR')
    await drain_pending_mints(deps)
    expect(minted.length).toBe(1) // burn law: latched stays latched — ZERO recompose
  })
})

describe('THE DECOUPLED GATE (leg①): a null display read no longer strands the mint', () => {
  it('null read keeps the result QUEUED (not skipped), then mints the instant the chain object reads', async () => {
    let clock = 1000
    const now = () => clock
    let readable = false
    const { minted, deps } = make_deps({
      read_result: async () => (readable ? opened([{ item_template: '0xA' }]) : null),
      now,
    })
    enqueue_mint('0xR')

    await drain_pending_mints(deps) // the ~5s window: the object is not visible yet
    expect(minted).toEqual([]) // OLD behavior SKIPPED the mint here — the strand
    expect(pending_mint_status('0xR')).toBe('pending') // NEW: still queued for retry (never a silent give-up)

    readable = true // read-after-write lag clears
    clock += 60_000 // past the backoff
    await drain_pending_mints(deps)
    expect(minted).toEqual([{ id: '0xR', templates: ['0xA'] }]) // the decoupled retry mints once the read settles
    expect(pending_mint_status('0xR')).toBe('done')
  })
})

describe('sweep_stranded_results (leg②) — recover opened-but-un-burned results, ONE summary toast', () => {
  const rows = [
    { result_id: '0xLOOT', opened: true, loot_units: 2 }, // a victory that owes loot
    { result_id: '0xHUSK', opened: true, loot_units: 0 }, // an empty/defeat husk
    { result_id: '0xUNOPENED', opened: false }, // an unopened engine outcome — the auto-open path's concern, SKIP
  ]
  const chain = { '0xLOOT': opened([{ item_template: '0xA' }, { item_template: '0xB' }]), '0xHUSK': opened([]) }

  it('mints the loot result, bare-burns the husk, SKIPS the unopened row, requests ONE summary of the recovered count', async () => {
    const summaries = []
    const { minted, deps } = make_deps({ read_result: async (id) => chain[id] ?? null })
    const recovered = await sweep_stranded_results('0xowner', {
      ...deps,
      fetch_results: async () => rows,
      notify: (count) => summaries.push(count),
    })
    expect(recovered).toBe(2)
    expect(new Set(minted.map((m) => m.id))).toEqual(new Set(['0xLOOT', '0xHUSK'])) // never 0xUNOPENED (chain-gated)
    expect(minted.find((m) => m.id === '0xLOOT').templates).toEqual(['0xA', '0xB'])
    expect(minted.find((m) => m.id === '0xHUSK').templates).toEqual([]) // bare burn
    expect(summaries).toEqual([2]) // ONE quiet summary — no per-result spam
  })

  it('an executed-failure result LATCHES in the sweep and a RE-RUN composes ZERO (idempotent recovery)', async () => {
    const summaries = []
    const { minted, deps } = make_deps({
      read_result: async () => opened([{ item_template: '0xA' }]),
      mint_impl: async () => {
        throw executed_error()
      },
    })
    const shared = {
      ...deps,
      fetch_results: async () => [{ result_id: '0xR', opened: true }],
      notify: (c) => summaries.push(c),
    }

    expect(await sweep_stranded_results('0xowner', shared)).toBe(0)
    expect(pending_mint_status('0xR')).toBe('latched')
    expect(summaries).toEqual([]) // nothing recovered ⇒ no toast

    expect(await sweep_stranded_results('0xowner', shared)).toBe(0)
    expect(minted.length).toBe(1) // the burned-gas tx is NEVER recomposed
  })

  it('a /v1 read failure is swallowed (the next boot re-checks) — never throws into the boot wire', async () => {
    const { deps } = make_deps({ read_result: async () => null })
    const recovered = await sweep_stranded_results('0xowner', {
      ...deps,
      fetch_results: async () => {
        throw new Error('rpc down')
      },
      notify: () => {
        throw new Error('must not toast on a read failure')
      },
    })
    expect(recovered).toBe(0)
  })
})
