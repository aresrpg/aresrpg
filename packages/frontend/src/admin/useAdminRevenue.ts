// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { MarketplaceRoyalty } from '@aresrpg/sdk/marketplace-admin'
import type { create_admin_overview as CreateAdminOverview } from '@aresrpg/sdk/admin-overview'
import { useCallback, useEffect, useRef, useState } from 'react'

import { env } from '../env.ts'
import { useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { format_sui } from '../wallet_amount.ts'

// The read-only chain reader (no wallet, the one sanctioned direct-GraphQL path — owner
// 2026-08-21): built once per page lifetime, lazily, inside the admin chunk.
const overview_cell: { reader: Promise<ReturnType<typeof CreateAdminOverview>> | null } = { reader: null }
const admin_overview = () => {
  // eslint-disable-next-line functional/immutable-data -- the one lazy-singleton cell of this module
  overview_cell.reader ??= import('@aresrpg/sdk/admin-overview').then(({ create_admin_overview }) =>
    create_admin_overview({ graphql_url: env.graphql_url, network: env.network })
  )
  return overview_cell.reader
}

/* eslint-disable functional/immutable-data -- React refs are local request latches, never shared application state. */
const translated = (copy: Readonly<Record<string, string>>, key: string, fallback: string): string =>
  copy[key] || fallback

export type AdminRevenue = Readonly<{
  royalties: readonly MarketplaceRoyalty[]
  treasury_mist: bigint | null
  claimable: bigint
  reading: boolean
  claiming: boolean
  claim_armed: boolean
  connected: boolean
  error: string | null
  refresh: () => void
  arm_claim: () => void
  claim: () => void
}>

export const useAdminRevenue = (copy: Readonly<Record<string, string>>): AdminRevenue => {
  const wallet = useAppStore((state) => state.external_wallet)
  const { session } = wallet
  const [royalties, set_royalties] = useState<readonly MarketplaceRoyalty[]>([])
  const [treasury_mist, set_treasury] = useState<bigint | null>(null)
  const [reading, set_reading] = useState(false)
  const [claim_armed, set_claim_armed] = useState(false)
  const [error, set_error] = useState<string | null>(null)
  const [claiming, set_claiming] = useState(false)
  const request_generation = useRef(0)
  const reading_now = useRef(false)
  const claiming_now = useRef(false)
  const active_claim = useRef<ReturnType<typeof toast.loading> | null>(null)

  const refresh = useCallback((): void => {
    if (reading_now.current) return
    const generation = ++request_generation.current
    reading_now.current = true
    set_reading(true)
    set_error(null)
    // royalty rows: the connected wallet's read when present (cap = CONNECTED-wallet truth,
    // it gates the claim button honestly); the wallet-free chain read otherwise
    const chain_read = admin_overview().then((overview) => overview.read())
    const read_royalties = session
      ? session.read_marketplace_royalties()
      : chain_read.then(({ royalties: rows }) => rows)
    const read_treasury = chain_read.then(({ treasury_mist: balance }) => balance)
    void Promise.allSettled([read_royalties, read_treasury])
      .then(([royalties_result, treasury_result]) => {
        if (request_generation.current !== generation) return
        if (royalties_result.status === 'fulfilled') set_royalties(royalties_result.value)
        if (treasury_result.status === 'fulfilled') set_treasury(treasury_result.value)
        const failure = [royalties_result, treasury_result].find(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        )
        if (failure) {
          console.error('Admin overview could not be read.', failure.reason)
          set_error(failure.reason instanceof Error ? failure.reason.message : String(failure.reason))
        }
      })
      .finally(() => {
        if (request_generation.current !== generation) return
        reading_now.current = false
        set_reading(false)
      })
  }, [session])

  useEffect(() => {
    request_generation.current += 1
    reading_now.current = false
    claiming_now.current = false
    active_claim.current?.dismiss()
    active_claim.current = null
    set_reading(false)
    set_claiming(false)
    set_royalties([])
    set_claim_armed(false)
    set_error(null)
    refresh()
    // The session identity is the boundary; request state must not restart this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const claimable = royalties.reduce((sum, royalty) => sum + (royalty.cap ? royalty.balance_mist : 0n), 0n)
  const claim = (): void => {
    if (!session || claiming_now.current || claimable <= 0n) return
    const generation = request_generation.current
    claiming_now.current = true
    set_claiming(true)
    set_claim_armed(false)
    const pending = toast.loading(translated(copy, 'claiming', 'Claiming…'))
    active_claim.current = pending
    void session
      .claim_marketplace_royalties()
      .then(({ amount_mist }) => {
        if (request_generation.current !== generation) return
        pending.success(`${translated(copy, 'claim_success', 'Royalties claimed')} · ${format_sui(amount_mist, 4)} SUI`)
        refresh()
      })
      .catch((reason) => {
        if (request_generation.current !== generation) return
        console.error('Marketplace royalties could not be claimed.', reason)
        pending.error(reason)
      })
      .finally(() => {
        if (request_generation.current !== generation) return
        active_claim.current = null
        claiming_now.current = false
        set_claiming(false)
      })
  }

  return Object.freeze({
    royalties,
    treasury_mist,
    claimable,
    reading,
    claiming,
    claim_armed,
    connected: !!session,
    error: wallet.error ?? error,
    refresh,
    arm_claim: () => set_claim_armed(true),
    claim,
  })
}

/* eslint-enable functional/immutable-data */
