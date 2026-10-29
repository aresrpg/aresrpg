// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createStore } from 'zustand/vanilla'
import type { BlastCommitment, BlastPhase } from '@aresrpg/sdk/blast'
import type { SpotProof } from '@aresrpg/immutable/allocation'

import type { AuthSession } from '../auth.ts'
import { FUNDING_CUSHION_MIST } from '../funding/near.ts'

const SUI = 1_000_000_000n
const PRESETS = [10n * SUI, 25n * SUI, 50n * SUI]

export type SpotStage = 'soon' | 'live' | 'full' | 'waiting' | 'claim' | 'settled' | 'checking'
// Phases whose stage does not depend on the wallet's commitment.
const PHASE_STAGE: Readonly<Record<BlastPhase, SpotStage | null>> = {
  soon: 'soon',
  live: null,
  closing: 'waiting',
  funded: 'waiting',
  complete: null,
  cancelled: null,
}
/** Undefined commitment means not read yet; null means none on chain (never bought, or claimed). */
export const spot_stage = (
  phase: BlastPhase,
  commitment: BlastCommitment | null | undefined,
  cap: bigint
): SpotStage => {
  const fixed = PHASE_STAGE[phase]
  if (fixed) return fixed
  if (phase === 'live') return (commitment?.quote ?? 0n) >= cap ? 'full' : 'live'
  if (commitment === undefined) return 'checking'
  return commitment ? 'claim' : 'settled'
}

export type BuyLimits = Readonly<{
  remaining: bigint
  spendable: bigint | null
  max: bigint
  presets: readonly bigint[]
}>
export const buy_limits = (cap: bigint, bought: bigint, balance: bigint | null): BuyLimits => {
  const remaining = cap > bought ? cap - bought : 0n
  // Max keeps the same gas cushion that Add funds tops up to, so both amounts agree.
  const spendable = balance === null ? null : balance > FUNDING_CUSHION_MIST ? balance - FUNDING_CUSHION_MIST : 0n
  const max = spendable !== null && spendable < remaining ? spendable : remaining
  return { remaining, spendable, max, presets: PRESETS.filter((amount) => amount < max) }
}
/** What the entered amount needs: a purchase, a smaller amount, or more SUI in the wallet. */
export const buy_check = (amount: bigint | null, limits: BuyLimits) => {
  if (amount === null) return { kind: 'empty' } as const
  if (amount > limits.remaining) return { kind: 'over_cap' } as const
  if (limits.spendable !== null && amount > limits.spendable)
    return { kind: 'short', missing: amount - limits.spendable } as const
  return { kind: 'ready' } as const
}

export type SaleTask =
  | Readonly<{ kind: 'buy'; wallet: AuthSession; amount: bigint; proof: SpotProof }>
  | Readonly<{ kind: 'claim'; wallet: AuthSession }>
export type SaleReceipt = Readonly<{ kind: SaleTask['kind']; address: string; amount: bigint; digest: string }>
export type SaleState = Readonly<{
  commitments: Readonly<Record<string, BlastCommitment | null>>
  balances: Readonly<Record<string, bigint>>
  task: SaleTask | null
  sequence: number
  receipt: SaleReceipt | null
  error: Readonly<{ address: string; message: string }> | null
}>
export type SaleInput =
  | Readonly<{
      type: 'read'
      commitments: Readonly<Record<string, BlastCommitment | null>>
      balances: Readonly<Record<string, bigint>>
    }>
  | Readonly<{ type: 'request'; task: SaleTask }>
  | Readonly<{ type: 'result'; sequence: number; receipt: SaleReceipt | null; error: SaleState['error'] }>
  | Readonly<{ type: 'dismiss' }>

export const initial_sale = (): SaleState => ({
  commitments: {},
  balances: {},
  task: null,
  sequence: 0,
  receipt: null,
  error: null,
})
export const reduce_sale = (state: SaleState, input: SaleInput): SaleState => {
  switch (input.type) {
    case 'read':
      return {
        ...state,
        commitments: { ...state.commitments, ...input.commitments },
        balances: { ...state.balances, ...input.balances },
      }
    case 'request':
      return state.task
        ? state
        : { ...state, task: input.task, sequence: state.sequence + 1, receipt: null, error: null }
    case 'result':
      return state.sequence === input.sequence
        ? { ...state, task: null, receipt: input.receipt, error: input.error }
        : state
    case 'dismiss':
      return { ...state, receipt: null, error: null }
  }
}

type Reader = Readonly<{ commitment: (address: string) => Promise<BlastCommitment | null> }>
const settle = async <T>(work: Promise<T>, what: string): Promise<readonly [T] | readonly []> => {
  try {
    return [await work]
  } catch (error) {
    console.warn(`Sale ${what} read failed.`, error)
    return []
  }
}
const execute = async (task: SaleTask): Promise<SaleReceipt> => {
  const { address } = task.wallet
  if (task.kind === 'claim')
    return { kind: 'claim', address, amount: 0n, digest: (await task.wallet.blast.claim()).digest }
  const { digest } = await task.wallet.blast.purchase({ method: 'allowlisted', amount: task.amount, proof: task.proof })
  return { kind: 'buy', address, amount: task.amount, digest }
}

/** Reads and signing re-enter the reducer as inputs. A failed read stays unknown instead of zero. */
export const create_sale_runtime = (reader: Reader) => {
  const store = createStore<SaleState>(initial_sale)
  const dispatch = (input: SaleInput): void => store.setState((state) => reduce_sale(state, input), true)
  const refresh = async (addresses: readonly string[], signers: readonly AuthSession[]): Promise<void> => {
    const [commitments, balances] = await Promise.all([
      Promise.all(
        addresses.map(async (address) => [address, await settle(reader.commitment(address), 'commitment')] as const)
      ),
      Promise.all(
        signers.map(async (wallet) => [wallet.address, await settle(wallet.read_sui_balance(), 'balance')] as const)
      ),
    ])
    const known = <T>(rows: readonly (readonly [string, readonly [T] | readonly []])[]) =>
      Object.fromEntries(rows.flatMap(([address, value]) => (value.length ? [[address, value[0]]] : [])))
    dispatch({ type: 'read', commitments: known(commitments), balances: known(balances) })
  }
  const start = (): (() => void) =>
    store.subscribe((state, previous) => {
      if (!state.task || state.sequence === previous.sequence) return
      const { task, sequence } = state
      void execute(task).then(
        (receipt) => {
          dispatch({ type: 'result', sequence, receipt, error: null })
          return refresh([task.wallet.address], [task.wallet])
        },
        (error: unknown) => {
          console.warn('Sale transaction did not complete.', error)
          const message = error instanceof Error ? error.message : 'unavailable'
          dispatch({ type: 'result', sequence, receipt: null, error: { address: task.wallet.address, message } })
          // An uncertain execution may still have committed: show the chain's amount, never assume zero.
          return refresh([task.wallet.address], [task.wallet])
        }
      )
    })
  return { store, dispatch, refresh, start }
}
export type SaleRuntime = ReturnType<typeof create_sale_runtime>
