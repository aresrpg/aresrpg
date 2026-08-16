// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { MarketplaceRoyalty } from '@aresrpg/sdk/marketplace-admin'
import { useCallback, useEffect, useRef, useState } from 'react'

import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { format_sui } from '../wallet_amount.ts'

/* eslint-disable functional/immutable-data -- React refs are local request latches, never shared application state. */
const button_class =
  'h-8 cursor-pointer border border-[#4a9eff]/35 px-3 text-[8px] tracking-[0.14em] text-[#67adff] uppercase hover:border-[#4a9eff]/65 disabled:cursor-not-allowed disabled:opacity-35'
const short_address = (address: string): string => `${address.slice(0, 8)}…${address.slice(-6)}`
const translated = (copy: Readonly<Record<string, string>>, key: string, fallback: string): string =>
  copy[key] || fallback

export const AdminWalletPanel = ({ copy }: Readonly<{ copy: Readonly<Record<string, string>> }>) => {
  const wallet = useAppStore((state) => state.admin.wallet)
  const { session } = wallet
  const [royalties, set_royalties] = useState<readonly MarketplaceRoyalty[]>([])
  const [reading, set_reading] = useState(false)
  const [claim_armed, set_claim_armed] = useState(false)
  const [error, set_error] = useState<string | null>(null)
  const [claiming, set_claiming] = useState(false)
  const request_generation = useRef(0)
  const reading_now = useRef(false)
  const claiming_now = useRef(false)
  const active_claim = useRef<ReturnType<typeof toast.loading> | null>(null)

  const refresh = useCallback((): void => {
    if (!session || reading_now.current) return
    const generation = ++request_generation.current
    reading_now.current = true
    set_reading(true)
    set_error(null)
    void session
      .read_marketplace_royalties()
      .then((next_royalties) => {
        if (request_generation.current === generation) set_royalties(next_royalties)
      })
      .catch((reason) => {
        if (request_generation.current !== generation) return
        console.error('Marketplace royalties could not be read.', reason)
        set_error(reason instanceof Error ? reason.message : String(reason))
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
    if (session) refresh()
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

  return (
    <section className="border border-white/8 bg-black/12 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[8px] tracking-[0.18em] text-[#c8963c] uppercase">
            {translated(copy, 'admin_wallet', 'Admin wallet')}
          </p>
          <p className="mt-2 text-[8px] text-[#686c76]">
            {translated(copy, 'admin_wallet_body', 'Publishing and withdrawals require an installed wallet.')}
          </p>
        </div>
        {session && (
          <div className="text-right">
            <p className="font-mono text-[9px] text-[#d8d3ca]">{short_address(session.address)}</p>
            <p className="mt-1 text-[7px] tracking-[0.12em] text-[#686c76] uppercase">{session.wallet_name}</p>
          </div>
        )}
      </div>

      {!session && (
        <div className="mt-4 flex flex-wrap gap-2">
          {wallet.wallets.map((wallet_name) => (
            <button
              className={button_class}
              disabled={wallet.status === 'connecting'}
              key={wallet_name}
              onClick={() => dispatch_app({ type: 'admin/wallet_connect', wallet_name })}
              type="button"
            >
              {wallet.status === 'connecting' && wallet.requested_wallet === wallet_name
                ? translated(copy, 'connecting', 'Connecting…')
                : `${translated(copy, 'connect_admin_wallet', 'Connect')} ${wallet_name}`}
            </button>
          ))}
          {wallet.status === 'loading' && (
            <span className="py-2 text-[8px] text-[#686c76]">
              {translated(copy, 'loading_wallets', 'Loading wallets…')}
            </span>
          )}
          {wallet.status === 'ready' && wallet.wallets.length === 0 && (
            <span className="py-2 text-[8px] text-[#686c76]">
              {translated(copy, 'no_admin_wallet', 'No compatible browser wallet installed.')}
            </span>
          )}
        </div>
      )}

      {session && (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {royalties.map((royalty) => (
              <div className="border border-white/7 bg-white/[0.018] p-3" key={royalty.kind}>
                <div className="flex items-center justify-between gap-3 text-[8px] uppercase">
                  <span className="tracking-[0.12em] text-[#858993]">
                    {royalty.kind} {translated(copy, 'royalties', 'royalties')}
                  </span>
                  <span className={royalty.cap ? 'text-[#5ecf8d]' : 'text-[#ff8caa]'}>
                    {royalty.cap
                      ? translated(copy, 'cap_owned', 'cap owned')
                      : translated(copy, 'cap_missing', 'cap missing')}
                  </span>
                </div>
                <p className="mt-3 text-lg text-[#efbd45]">{format_sui(royalty.balance_mist, 4)} SUI</p>
                <p className="mt-2 truncate font-mono text-[7px] text-[#555963]" title={royalty.policy_id}>
                  {royalty.policy_id}
                </p>
              </div>
            ))}
            {reading && royalties.length === 0 && (
              <p className="py-5 text-[8px] text-[#686c76]">
                {translated(copy, 'reading_royalties', 'Reading policies…')}
              </p>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button className={button_class} disabled={reading} onClick={refresh} type="button">
              {reading
                ? translated(copy, 'reading', 'Reading…')
                : translated(copy, 'refresh_revenue', 'Refresh revenue')}
            </button>
            {claimable > 0n && !claim_armed && (
              <button className={button_class} onClick={() => set_claim_armed(true)} type="button">
                {translated(copy, 'arm_claim', 'Arm claim')} · {format_sui(claimable, 4)} SUI
              </button>
            )}
            {claimable > 0n && claim_armed && (
              <button
                className="h-8 cursor-pointer border border-[#ff5a8b]/65 bg-[#ff5a8b]/10 px-3 text-[8px] tracking-[0.14em] text-[#ffc0d0] uppercase"
                disabled={claiming}
                onClick={claim}
                type="button"
              >
                {claiming
                  ? translated(copy, 'claiming', 'Claiming…')
                  : translated(copy, 'confirm_claim', 'Confirm claim')}
              </button>
            )}
            <button
              className="ml-auto h-8 cursor-pointer border border-white/10 px-3 text-[8px] tracking-[0.12em] text-[#777b86] uppercase disabled:opacity-35"
              disabled={reading}
              onClick={() => dispatch_app({ type: 'admin/wallet_disconnect' })}
              type="button"
            >
              {translated(copy, 'disconnect_admin_wallet', 'Disconnect')}
            </button>
          </div>
        </>
      )}

      {wallet.error && <p className="mt-3 text-[8px] leading-4 text-[#ff8caa]">{wallet.error}</p>}
      {error && <p className="mt-3 text-[8px] leading-4 text-[#ff8caa]">{error}</p>}
    </section>
  )
}
/* eslint-enable functional/immutable-data */
