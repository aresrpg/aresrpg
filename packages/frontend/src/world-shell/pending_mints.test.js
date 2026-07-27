// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
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

import { get_log_buffer, _reset_log_for_test } from '../core/log.js'

import {
  enqueue_mint,
  process_mint,
  drain_pending_mints,
  sweep_stranded_results,
  mint_recovery_detail,
  mint_recovery_line,
  recovery_item_summary,
  pending_mint_status,
  reset_pending_mints_for_test,
} from './pending_mints.js'

afterEach(() => {
  reset_pending_mints_for_test()
  _reset_log_for_test()
})

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
    expect(await process_mint('0xR', deps)).toEqual({ verdict: 'retry', result_id: '0xR' })
    expect(minted).toEqual([]) // the root fix: a flaky read composes NOTHING (the old code strand-skipped here)
  })

  it('opened result WITH loot ⇒ mint every rolled template + burn, verdict minted', async () => {
    const { minted, deps } = make_deps({
      read_result: async () => opened([{ item_template: '0xA' }, { item_template: '0xB' }]),
    })
    expect(await process_mint('0xR', deps)).toEqual({ verdict: 'minted', result_id: '0xR', settlement: undefined })
    expect(minted).toEqual([{ id: '0xR', templates: ['0xA', '0xB'] }]) // ONE atomic mint_all_and_burn call
  })

  it('opened EMPTY husk (defeat / no-drop) ⇒ a BARE burn (templates []), verdict minted', async () => {
    const { minted, deps } = make_deps({ read_result: async () => opened([]) })
    expect(await process_mint('0xR', deps)).toEqual({ verdict: 'minted', result_id: '0xR', settlement: undefined })
    expect(minted).toEqual([{ id: '0xR', templates: [] }]) // burn_result alone — the 30 husks die in-sweep (seat ⑤)
  })

  it('EXECUTED mint failure (a digest) ⇒ LATCHED (burn law: never re-fire spent gas)', async () => {
    const { deps } = make_deps({
      read_result: async () => opened([{ item_template: '0xA' }]),
      mint_impl: async () => {
        throw executed_error()
      },
    })
    expect(await process_mint('0xR', deps)).toEqual({ verdict: 'latched', result_id: '0xR' })
  })

  it('PRE-FLIGHT/network mint failure (no digest) ⇒ RETRY (re-armable)', async () => {
    const { deps } = make_deps({
      read_result: async () => opened([{ item_template: '0xA' }]),
      mint_impl: async () => {
        throw network_error()
      },
    })
    expect(await process_mint('0xR', deps)).toEqual({ verdict: 'retry', result_id: '0xR' })
  })
})

describe('enqueue + drain — IDEMPOTENT by construction (seat ⑴: mints once, a re-run composes ZERO)', () => {
  it('RED #265: a successful mint yields its settlement outcome for the inventory reducer door', async () => {
    const settlement = {
      receipt: {
        events: [
          {
            type: '0xares::item::ItemMinted',
            parsedJson: { item: '0xloot', template: '0xtemplate', item_type: 'razkin_hide', amount: '1' },
          },
        ],
      },
      kiosk_id: '0xkiosk',
      kiosk_cap_id: '0xcap',
    }
    const { deps } = make_deps({
      read_result: async () => opened([{ item_template: '0xtemplate' }]),
      mint_impl: async () => settlement,
    })

    const settled = enqueue_mint('0xR')
    await drain_pending_mints(deps)

    expect(await settled).toEqual({
      verdict: 'minted',
      result_id: '0xR',
      settlement,
    })
  })

  it('a stranded result mints+burns exactly once; a re-enqueue (later sweep) is a NO-OP → ZERO recompose', async () => {
    const { minted, deps } = make_deps({ read_result: async () => opened([{ item_template: '0xA' }]) })
    const settled = enqueue_mint('0xR')
    await drain_pending_mints(deps)
    expect(minted.length).toBe(1)
    expect(pending_mint_status('0xR')).toBe('done') // burned tombstone
    expect(await settled).toEqual({ verdict: 'minted', result_id: '0xR', settlement: undefined })

    void enqueue_mint('0xR') // a later boot sweep re-encounters the same id
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
    const settled = enqueue_mint('0xR')
    await drain_pending_mints(deps)
    expect(minted.length).toBe(1) // one attempt, executed + failed
    expect(pending_mint_status('0xR')).toBe('latched')
    expect(await settled).toEqual({ verdict: 'latched', result_id: '0xR' })

    void enqueue_mint('0xR')
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
    const settled = enqueue_mint('0xR')

    await drain_pending_mints(deps) // the ~5s window: the object is not visible yet
    expect(minted).toEqual([]) // OLD behavior SKIPPED the mint here — the strand
    expect(pending_mint_status('0xR')).toBe('pending') // NEW: still queued for retry (never a silent give-up)

    readable = true // read-after-write lag clears
    clock += 60_000 // past the backoff
    await drain_pending_mints(deps)
    expect(minted).toEqual([{ id: '0xR', templates: ['0xA'] }]) // the decoupled retry mints once the read settles
    expect(pending_mint_status('0xR')).toBe('done')
    expect(await settled).toEqual({ verdict: 'minted', result_id: '0xR', settlement: undefined })
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
    const { minted, deps } = make_deps({
      read_result: async (id) => chain[id] ?? null,
      mint_impl: async (id, templates) => ({
        receipt: {
          digest: `digest-${id}`,
          events: templates.map((template, index) => ({
            type: '0xares::item::ItemMinted',
            parsedJson: {
              item: `${id}-item-${index}`,
              template,
              item_type: `loot_${index}`,
              amount: '1',
            },
          })),
        },
      }),
    })
    const recovered = await sweep_stranded_results('0xowner', {
      ...deps,
      fetch_results: async () => rows,
      notify: (count, details) => summaries.push({ count, details }),
    })
    expect(recovered).toBe(2)
    expect(new Set(minted.map((m) => m.id))).toEqual(new Set(['0xLOOT', '0xHUSK'])) // never 0xUNOPENED (chain-gated)
    expect(minted.find((m) => m.id === '0xLOOT').templates).toEqual(['0xA', '0xB'])
    expect(minted.find((m) => m.id === '0xHUSK').templates).toEqual([]) // bare burn
    expect(summaries).toEqual([{ count: 2, details: 'loot_0 ×1, loot_1 ×1' }])
    // ONE quiet summary, PLAYER-READABLE: item names/slugs only. No object id, no digest, no `∅` glyph ever
    // reaches the toast (#1223 rider) — the digest keeps its provenance in the dev log below.
    expect(get_log_buffer().map(({ message }) => message)).toEqual([
      'mint-sweep recovered stranded reward: digest-0xLOOT → loot_0 ×1 (0xLOOT-item-0), loot_1 ×1 (0xLOOT-item-1)',
      'mint-sweep recovered stranded reward: digest-0xHUSK → ∅',
    ]) // one bounded log per tx means a large sweep cannot truncate later digests
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

describe('mint recovery instrumentation', () => {
  it('projects the digest plus collected object/positive-balance deltas without changing the settlement', () => {
    const settlement = {
      receipt: {
        digest: '0xdigest',
        events: [
          {
            type: '0xares::item::ItemMinted',
            parsedJson: { item: '0xitem', template: '0xtemplate', item_type: 'razkin_hide', amount: '2' },
          },
        ],
        balanceChanges: [
          { coinType: '0x2::sui::SUI', amount: '25' },
          { coinType: '0x2::sui::SUI', amount: '-7' }, // gas/payment is not value collected
        ],
      },
    }
    const detail = mint_recovery_detail({
      verdict: 'minted',
      result_id: '0xresult',
      settlement,
    })

    expect(detail).toEqual({
      result_id: '0xresult',
      digest: '0xdigest',
      object_deltas: [{ object_id: '0xitem', item_type: 'razkin_hide', name: '', amount: 2 }],
      balance_deltas: [{ coin_type: '0x2::sui::SUI', amount: '25' }],
    })
    expect(mint_recovery_line(detail)).toBe('0xdigest → razkin_hide ×2 (0xitem), +25 0x2::sui::SUI')
    expect(settlement.receipt.events[0].parsedJson.amount).toBe('2') // projection is read-only
  })

  it('names a bare result burn as an empty delta while retaining its digest', () => {
    expect(
      mint_recovery_line({
        result_id: '0xhusk',
        digest: '0xhusktx',
        object_deltas: [],
        balance_deltas: [],
      })
    ).toBe('0xhusktx → ∅')
  })

  it('resolves the CATALOG name for a minted template (the toast never has to show a slug)', () => {
    const templates = new Map([['0xtemplate', { name: 'Razkin Hide', item_type: 'razkin_hide', category: 'RESOURCE' }]])
    expect(
      mint_recovery_detail(
        {
          verdict: 'minted',
          result_id: '0xresult',
          settlement: {
            receipt: {
              digest: '0xdigest',
              events: [
                {
                  type: '0xares::item::ItemMinted',
                  parsedJson: { item: '0xitem', template: '0xtemplate', item_type: 'razkin_hide', amount: '2' },
                },
              ],
            },
          },
        },
        templates
      ).object_deltas
    ).toEqual([{ object_id: '0xitem', item_type: 'razkin_hide', name: 'Razkin Hide', amount: 2 }])
  })

  it('falls back to created objectChanges when an ItemMinted event is unavailable', () => {
    expect(
      mint_recovery_detail({
        verdict: 'minted',
        result_id: '0xresult',
        settlement: {
          receipt: {
            digest: '0xdigest',
            objectChanges: [{ type: 'created', objectId: '0xitem', objectType: '0xares::item::Item' }],
          },
        },
      }).object_deltas
    ).toEqual([{ object_id: '0xitem', item_type: '0xares::item::Item', name: '', amount: 1 }])
  })
})

// #1223 rider — the legacy collector survives ONLY as the pre-fix sweeper, so its one toast must read like a
// game message, not a chain dump: item NAMES, merged quantities, a bounded list, and NEVER an object id or a
// digest (those keep their provenance in the dev log). The toast body is language-neutral by construction —
// names come from the localized catalog and `×`/`…` are symbols, so no new i18n key is owed.
describe('recovery_item_summary — the player-facing recovery line (names, never hex)', () => {
  const delta = (name, item_type, amount, object_id = '0xdeadbeef') => ({ object_id, item_type, name, amount })

  it('renders catalog names with merged quantities, newest-first order preserved', () => {
    expect(
      recovery_item_summary([
        { object_deltas: [delta('Razkin Hide', 'razkin_hide', 2), delta('Iron Ore', 'iron_ore', 1)] },
        { object_deltas: [delta('Razkin Hide', 'razkin_hide', 3)] },
      ])
    ).toBe('Razkin Hide ×5, Iron Ore ×1')
  })

  it('NEVER emits an object id or a digest — the hex ban is the whole rider', () => {
    const line = recovery_item_summary([{ digest: '0xabc123', object_deltas: [delta('', '', 1, '0xfeed')] }])
    expect(line).not.toMatch(/0x/)
  })

  it('degrades to the item_type slug when the catalog misses, never to the id', () => {
    expect(recovery_item_summary([{ object_deltas: [delta('', 'razkin_hide', 1)] }])).toBe('razkin_hide ×1')
  })

  it('drops a row that can only be named by its id (honest silence beats a hex address)', () => {
    expect(recovery_item_summary([{ object_deltas: [delta('', '', 4)] }])).toBe('')
  })

  it('bounds a big sweep with an ellipsis instead of a wall of text', () => {
    const many = Array.from({ length: 9 }, (_, i) => delta(`Item ${i}`, `item_${i}`, 1))
    expect(recovery_item_summary([{ object_deltas: many }])).toBe(
      'Item 0 ×1, Item 1 ×1, Item 2 ×1, Item 3 ×1, Item 4 ×1, Item 5 ×1…'
    )
  })

  it('an all-husk sweep summarises to NOTHING — the toast title alone is the honest message', () => {
    expect(recovery_item_summary([{ digest: '0xhusktx', object_deltas: [] }])).toBe('')
  })
})
