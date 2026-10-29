// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useMemo } from 'react'
import { useStore } from 'zustand'
import { create_blast_reader } from '@aresrpg/sdk/blast'

import type { AuthSession } from '../auth.ts'
import { env } from '../env.ts'

import { create_sale_runtime } from './sale.ts'

/** Commitments are re-read whenever the sale object changes version or the page's wallets change. */
export const useSpotSale = (addresses: readonly string[], signers: readonly AuthSession[], version: string | null) => {
  const runtime = useMemo(() => {
    let reader: ReturnType<typeof create_blast_reader> | null = null
    return create_sale_runtime({
      commitment: async (address) =>
        (reader ??= create_blast_reader({ network: env.network, rpc_url: env.sui_rpc_url })).commitment(address),
    })
  }, [])
  const state = useStore(runtime.store)
  useEffect(() => runtime.start(), [runtime])
  const wallets = addresses.join()
  const signed = signers.map(({ address }) => address).join()
  useEffect(() => {
    if (version !== null) void runtime.refresh(wallets ? wallets.split(',') : [], signers)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The joined addresses identify the signer set; session objects are stable per connection.
  }, [runtime, wallets, signed, version])
  return { state, dispatch: runtime.dispatch, refresh: runtime.refresh }
}
