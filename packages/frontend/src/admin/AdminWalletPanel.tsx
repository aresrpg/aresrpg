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
  const wallet = useAppStore((state) => state.admin.wallet)
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

const RevenueRow = ({
  label,
  value,
  tone = 'default',
  title,
}: Readonly<{ label: string; value: string; tone?: 'default' | 'gold'; title?: string }>) => (
  <div className="flex min-h-11 items-center justify-between gap-4 border-b border-white/[0.055] py-2" title={title}>
    <span className="text-[8px] tracking-[0.08em] text-[#858993] uppercase">{label}</span>
    <span className={`text-[10px] ${tone === 'gold' ? 'text-[#efbd45]' : 'text-[#d8d3ca]'}`}>{value}</span>
  </div>
)

export const AdminWalletPanel = ({
  copy,
  revenue,
}: Readonly<{ copy: Readonly<Record<string, string>>; revenue: AdminRevenue }>) => {
  const policy = (kind: MarketplaceRoyalty['kind']) => revenue.royalties.find((entry) => entry.kind === kind)
  const item = policy('item')
  const character = policy('character')
  const display_policy = (royalty: MarketplaceRoyalty | undefined): string =>
    royalty ? `${format_sui(royalty.balance_mist, 4)} SUI` : '—'

  return (
    <section className="flex min-h-[308px] flex-col rounded-xl border border-white/[0.08] bg-[linear-gradient(145deg,rgba(200,150,60,0.07),rgba(255,255,255,0.018)_42%,rgba(255,255,255,0.01))] p-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[9px] tracking-[0.18em] text-[#d8d3ca] uppercase">Revenue</p>
        <button
          className="cursor-pointer text-[8px] tracking-[0.12em] text-[#67adff] uppercase disabled:cursor-not-allowed disabled:opacity-35"
          disabled={revenue.reading}
          onClick={revenue.refresh}
          type="button"
        >
          {revenue.reading ? translated(copy, 'reading', 'Reading…') : translated(copy, 'refresh', 'Refresh')}
        </button>
      </div>

      <div className="mt-4">
        <RevenueRow
          label="Treasury balance"
          title="SUI held by the admin address"
          tone="gold"
          value={revenue.treasury_mist === null ? '—' : `${format_sui(revenue.treasury_mist, 4)} SUI`}
        />
        <RevenueRow
          label="Item royalties"
          title={item && !item.cap ? 'The connected wallet does not own this policy cap' : item?.policy_id}
          tone="gold"
          value={display_policy(item)}
        />
        <RevenueRow
          label="Character royalties"
          title={
            character && !character.cap ? 'The connected wallet does not own this policy cap' : character?.policy_id
          }
          tone="gold"
          value={display_policy(character)}
        />
        <RevenueRow label="Lifetime revenue" title="Lifetime revenue is not projected yet" value="—" />
        <RevenueRow label="Marketplace fee" title="Marketplace fee is not projected yet" value="—" />
      </div>

      <div className="mt-auto pt-5">
        <button
          className={`h-9 w-full border text-[8px] tracking-[0.16em] uppercase transition disabled:cursor-not-allowed disabled:border-white/8 disabled:text-[#555a64] ${
            revenue.claim_armed
              ? 'border-[#efbd45]/65 bg-[#efbd45]/10 text-[#f3c761]'
              : 'border-[#c8963c]/35 text-[#dfad4e] hover:border-[#c8963c]/65'
          }`}
          disabled={!revenue.connected || revenue.claimable <= 0n || revenue.claiming}
          onClick={revenue.claim_armed ? revenue.claim : revenue.arm_claim}
          title={!revenue.connected ? 'Connect the admin wallet in the header' : undefined}
          type="button"
        >
          {revenue.claiming
            ? translated(copy, 'claiming', 'Claiming…')
            : revenue.claim_armed
              ? translated(copy, 'confirm_claim', 'Confirm claim')
              : `${translated(copy, 'claim', 'Claim')} · ${revenue.claimable > 0n ? `${format_sui(revenue.claimable, 4)} SUI` : '—'}`}
        </button>
        {revenue.error && (
          <p className="mt-2 truncate text-[7px] text-[#ff8caa]" title={revenue.error}>
            Revenue source unavailable
          </p>
        )}
      </div>
    </section>
  )
}
/* eslint-enable functional/immutable-data */
