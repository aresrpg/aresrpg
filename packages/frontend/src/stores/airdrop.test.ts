// airdrop.test.ts — the ONE-PIPELINE reducer (M2 twin of the M1 shop template). Pure reducer tests (no React,
// no RPC, no zustand store) proving the three doctrine reds for CLIENT_DESIGN_AUDIT row #8: a stale 30s poll
// must never flip a just-claimed card back to "eligible".
import { describe, test, expect } from 'bun:test'

import type { RpcAirdrop } from '../rpc/views'

import { reduce, empty_airdrop_state, type AirdropState } from './airdrop'

const airdrop = (over: Partial<RpcAirdrop> & { airdrop_id: string }): RpcAirdrop => ({
  template_id: 't',
  name: 'Drop',
  description: '',
  item: { template_id: 't', name: 'Cape', appearance: '' },
  minted: 0,
  eligible_count: 1,
  eligible_for: ['0xme'],
  ...over,
})

const row = (st: AirdropState, id: string) => st.airdrops.find((a) => a.airdrop_id === id)!
const snap = (airdrops: RpcAirdrop[]) => ({ type: 'snapshot' as const, airdrops })

describe('reduce — claim race (row #8): a stale snapshot must never flip a claimed card back to eligible', () => {
  test('RED #1: an optimistic claim holds through an indexer-lagged snapshot that still lists us eligible', () => {
    let st = empty_airdrop_state()
    st = reduce(st, snap([airdrop({ airdrop_id: 'X', minted: 0, eligible_for: ['0xme'] })])).state
    st = reduce(st, { type: 'receipt', airdrop_id: 'X' }).state
    expect(row(st, 'X').eligible_for).toEqual([]) // optimistic paint
    // the reported bug: a STALE poll (indexer hasn't projected the claim) arrives, still listing us eligible
    st = reduce(st, snap([airdrop({ airdrop_id: 'X', minted: 0, eligible_for: ['0xme'] })])).state
    expect(row(st, 'X').eligible_for).toEqual([]) // held by the pending ledger — NOT flipped back to eligible
    expect(row(st, 'X').minted).toBe(1)
  })

  test('the pending row self-drains once a snapshot proves the claim (minted reached the floor)', () => {
    let st = empty_airdrop_state()
    st = reduce(st, snap([airdrop({ airdrop_id: 'X', minted: 0, eligible_for: ['0xme'] })])).state
    st = reduce(st, { type: 'receipt', airdrop_id: 'X' }).state
    st = reduce(st, snap([airdrop({ airdrop_id: 'X', minted: 1, eligible_for: [] })])).state // chain caught up
    expect(row(st, 'X').eligible_for).toEqual([])
    expect(st.pending.X ?? 0).toBe(0) // drained
  })

  test('a drop omitted entirely from a fresh feed (genuinely gone) also drains the pending claim', () => {
    let st = empty_airdrop_state()
    st = reduce(st, snap([airdrop({ airdrop_id: 'X', minted: 0, eligible_for: ['0xme'] })])).state
    st = reduce(st, { type: 'receipt', airdrop_id: 'X' }).state
    st = reduce(st, snap([])).state // OMIT SEMANTICS: gone from the feed = genuinely gone, drain like M1's shop
    expect(st.pending.X ?? 0).toBe(0)
    expect(st.airdrops).toEqual([])
  })
})

describe('reduce — receipt_failed rolls back by re-deriving (never a stored snapshot)', () => {
  test('RED #2: a failed claim restores the current snapshot base, not a stale pre-claim snapshot', () => {
    let st = empty_airdrop_state()
    st = reduce(st, snap([airdrop({ airdrop_id: 'X', minted: 0, eligible_for: ['0xme'] })])).state
    st = reduce(st, { type: 'receipt', airdrop_id: 'X' }).state
    expect(row(st, 'X').eligible_for).toEqual([])
    // a concurrent poll lands WHILE the claim is in flight (proves the fix isn't a frozen-array replay)
    st = reduce(
      st,
      snap([
        airdrop({ airdrop_id: 'X', minted: 0, eligible_for: ['0xme'] }),
        airdrop({ airdrop_id: 'NEW', minted: 0, eligible_for: ['0xme'] }),
      ])
    ).state
    st = reduce(st, { type: 'receipt_failed', airdrop_id: 'X' }).state
    expect(row(st, 'X').eligible_for).toEqual(['0xme']) // re-derived from the CURRENT raw
    expect(st.airdrops.some((a) => a.airdrop_id === 'NEW')).toBe(true) // the concurrent poll's fresh drop survives
    expect(st.pending.X ?? 0).toBe(0)
  })
})

describe('reduce — divergence: predicted ≠ snapshot at the same version adopts chain + flags it', () => {
  test('RED #3: a same-minted snapshot with different eligibility is adopted and reported', () => {
    let st = empty_airdrop_state()
    st = reduce(st, snap([airdrop({ airdrop_id: 'X', minted: 0, eligible_for: ['0xme'] })])).state
    st = reduce(st, { type: 'receipt', airdrop_id: 'X' }).state // predict eligible_for=[] at minted 1
    const out = reduce(st, snap([airdrop({ airdrop_id: 'X', minted: 1, eligible_for: ['0xother'] })]))
    expect(out.divergence).not.toBeNull()
    expect(out.divergence?.predicted).toBe(0)
    expect(out.divergence?.snapshot).toBe(1)
    expect(row(out.state, 'X').eligible_for).toEqual(['0xother']) // chain adopted
  })
})
