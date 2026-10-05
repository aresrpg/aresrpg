// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { BLAST_URL, create_blast_reader, type BlastSnapshot } from '@aresrpg/sdk/blast'
import { createStore } from 'zustand/vanilla'

export type BlastState = Readonly<{
  ready: boolean
  url: string
  snapshot: BlastSnapshot | null
  error: boolean
}>
export type BlastInput =
  | Readonly<{ type: 'snapshot'; snapshot: BlastSnapshot | null; url: string }>
  | Readonly<{ type: 'failed'; url: string }>

export const initial_blast_state = (): BlastState => ({
  ready: false,
  url: BLAST_URL,
  snapshot: null,
  error: false,
})
export const reduce_blast = (state: BlastState, input: BlastInput): BlastState => {
  switch (input.type) {
    case 'snapshot':
      if (
        state.snapshot &&
        input.snapshot &&
        (BigInt(input.snapshot.version) < BigInt(state.snapshot.version) ||
          input.snapshot.clock_ms < state.snapshot.clock_ms)
      )
        return state
      return { ...state, snapshot: input.snapshot, url: input.url, ready: true, error: false }
    case 'failed':
      return { ...state, url: input.url, ready: true, error: true }
  }
}
export const blast_phase = (state: BlastState) =>
  !state.ready ? 'loading' : state.error ? 'unavailable' : (state.snapshot?.phase ?? 'soon')

/** One mounted public card owns one disposable reader; callbacks only dispatch reducer inputs. */
export const create_blast_runtime = (
  options: Parameters<typeof create_blast_reader>[0],
  factory: typeof create_blast_reader = create_blast_reader
) => {
  const store = createStore<BlastState>(initial_blast_state)
  const dispatch = (input: BlastInput): void => store.setState((state) => reduce_blast(state, input), true)
  const start = (): (() => void) => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let reader: ReturnType<typeof create_blast_reader>
    try {
      reader = factory(options)
    } catch (error) {
      console.error('Blast presale configuration failed.', error)
      dispatch({ type: 'failed', url: BLAST_URL })
      return () => {
        stopped = true
      }
    }
    const send = (input: BlastInput): void => {
      if (!stopped) dispatch(input)
    }
    const refresh = async (): Promise<void> => {
      try {
        const snapshot = await reader.read()
        send({ type: 'snapshot', snapshot, url: reader.url })
      } catch (error) {
        console.error('Blast presale read failed.', error)
        send({ type: 'failed', url: reader.url })
      }
      const phase = store.getState().snapshot?.phase
      if (stopped || !reader.configured || ['complete', 'cancelled'].includes(phase ?? '')) return
      // eslint-disable-next-line one-pipeline/no-settimeout-in-stores -- This read-only polling edge dispatches reducer inputs and stops on disposal or a terminal sale.
      timer = setTimeout(() => {
        void refresh()
      }, 30_000)
    }
    void refresh()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }
  return { store, start }
}
