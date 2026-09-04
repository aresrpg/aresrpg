// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Cat, Check, Gift, Loader2, Lock, Shirt, Sparkles, Star, WalletCards, type LucideIcon } from 'lucide-react'
import type { AirdropState } from '@aresrpg/protocol'
import { useState } from 'react'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { content_catalog } from '../content/catalog.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { env } from '../env.ts'
import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import { rolled_item_types } from '../modules/claims.ts'
import type { SessionState } from '../modules/session.ts'
import { dispatch_app, useAppStore } from '../store.ts'

const glyphs: Readonly<Record<string, LucideIcon>> = Object.freeze({
  pet_glb: Cat,
  title_relic: Star,
  outfit: Shirt,
})

type ShowcaseRow = (typeof content_catalog.airdrop.showcase)[number]
type DropRow = (typeof content_catalog.airdrop.drops)[number]

const DropStatus = ({ eligible, t }: Readonly<{ eligible: boolean; t: CopyText }>) => (
  <span
    className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[9px] tracking-[0.15em] uppercase ${eligible ? 'border-emerald-400/30 text-emerald-400' : 'border-border text-muted'}`}
  >
    {eligible ? <Check size={10} /> : <Lock size={10} />}
    {t(eligible ? 'eligible' : 'not_eligible')}
  </span>
)

const DropClaimButton = ({
  drop_id,
  eligible,
  busy,
  has_game_wallet,
  t,
}: Readonly<{
  drop_id: string
  eligible: boolean
  busy: string | null
  has_game_wallet: boolean
  t: CopyText
}>) => (
  <button
    className="btn-gold inline-flex w-full cursor-pointer items-center justify-center gap-2 py-2.5 text-[10px] tracking-[0.2em] disabled:cursor-not-allowed"
    disabled={!eligible || busy !== null || !has_game_wallet}
    onClick={() => dispatch_app({ type: 'distribution/claim', drop_id })}
    type="button"
  >
    {busy === `claim:${drop_id}` ? <Loader2 className="animate-spin" size={11} /> : <Gift size={12} />} {t('claim')}
  </button>
)

const DropIdentity = ({ drop }: Readonly<{ drop: DropRow }>) => {
  const icon = drop.item ? item_detail_icon(drop.item.item_type) : null
  return (
    <div className="flex items-center gap-3">
      {icon && <img alt="" className="size-14 object-contain" src={icon} />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-semibold tracking-[0.12em] text-text uppercase">
          {drop.id.replaceAll('_', ' ')}
        </div>
        <div className="mt-1 truncate text-[9px] tracking-[0.1em] text-muted uppercase">
          {drop.item?.name ?? drop.item_type}
        </div>
      </div>
    </div>
  )
}

export const AirdropDropCard = ({
  drop,
  state,
  busy,
  has_game_wallet,
  t,
}: Readonly<{
  drop: DropRow
  state: AirdropState | undefined
  busy: string | null
  has_game_wallet: boolean
  t: CopyText
}>) => {
  const eligible = state?.eligible === true
  return (
    <article className="flex flex-col gap-3 border border-border bg-surface/80 p-4">
      <DropIdentity drop={drop} />
      <div className="text-[8px] tracking-[0.14em] text-muted/60 uppercase">
        {t('eligible_count', { count: state?.eligible_count ?? 0 })}
      </div>
      <div>
        <DropStatus eligible={eligible} t={t} />
      </div>
      <DropClaimButton busy={busy} drop_id={drop.id} eligible={eligible} has_game_wallet={has_game_wallet} t={t} />
    </article>
  )
}

const giftcard_item = (giftcard: SessionState['giftcards'][number]) => {
  const item_type = rolled_item_types().get(giftcard.template)
  return item_type ? content_catalog.item(item_type)?.item : null
}

const GiftcardCard = ({
  busy,
  giftcard,
  t,
}: Readonly<{ busy: string | null; giftcard: SessionState['giftcards'][number]; t: CopyText }>) => {
  const item = giftcard_item(giftcard)
  const icon = item ? item_detail_icon(item.item_type) : null
  return (
    <article className="flex items-center gap-3 border border-border bg-surface/80 p-3">
      {icon && <img alt="" className="size-12 object-contain" src={icon} />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[10px] tracking-[0.12em] text-text uppercase">
          {item?.name ?? giftcard.template}
        </div>
        <div className="mt-1 text-[8px] text-muted">×{giftcard.amount}</div>
      </div>
      <button
        className="btn-gold px-3 py-2 text-[8px] tracking-[0.14em] uppercase disabled:opacity-40"
        disabled={busy !== null || !item}
        onClick={() => dispatch_app({ type: 'distribution/redeem', giftcard })}
        type="button"
      >
        {busy === `redeem:${giftcard.id}` ? <Loader2 className="animate-spin" size={11} /> : t('redeem')}
      </button>
    </article>
  )
}

const GiftLinkClaim = ({ ready, busy, t }: Readonly<{ ready: boolean; busy: string | null; t: CopyText }>) => {
  if (!ready) return null
  return (
    <div className="flex flex-wrap items-center gap-3 border border-gold/30 bg-gold/5 p-3">
      <Gift className="text-gold" size={15} />
      <div className="mr-auto text-[9px] tracking-[0.14em] text-gold uppercase">
        {t(busy === 'gift-link' ? 'gift_claiming' : 'gift_ready')}
      </div>
      <button
        className="btn-gold px-3 py-2 text-[8px] tracking-[0.14em] uppercase disabled:opacity-40"
        disabled={busy !== null}
        onClick={() => dispatch_app({ type: 'distribution/claim_gift_link' })}
        type="button"
      >
        {busy === 'gift-link' ? <Loader2 className="animate-spin" size={11} /> : t('gift_retry')}
      </button>
    </div>
  )
}

export const HolderWalletModal = ({
  wallets,
  busy,
  close,
  connect,
  t,
}: Readonly<{
  wallets: readonly string[]
  busy: string | null
  close: () => void
  connect: (wallet: string) => void
  t: CopyText
}>) => (
  <ModalFrame close={close} close_label={t('holder_close')} label={t('holder_title')} max_width="max-w-sm" soft>
    <div className="flex flex-col gap-5 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="grid size-11 place-items-center border border-cyan/30 bg-cyan/6 text-cyan shadow-[0_0_24px_rgba(72,207,207,0.08)]">
          <WalletCards size={19} />
        </div>
        <h2 className="text-[11px] font-semibold tracking-[0.22em] text-cyan uppercase">{t('holder_title')}</h2>
        <p className="max-w-xs text-[9px] leading-5 tracking-[0.06em] text-muted">{t('holder_connect_hint')}</p>
      </div>
      {wallets.length === 0 ? (
        <div className="border border-border bg-black/25 px-4 py-3 text-center text-[9px] tracking-[0.12em] text-muted uppercase">
          {t('holder_wallet_missing')}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {wallets.map((wallet) => (
            <button
              className="flex w-full cursor-pointer items-center gap-3 border border-white/10 bg-black/25 px-4 py-3 text-left transition-colors hover:border-cyan/45 hover:bg-cyan/6 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={busy !== null}
              key={wallet}
              onClick={() => connect(wallet)}
              type="button"
            >
              <WalletCards className="shrink-0 text-cyan" size={14} />
              <span className="min-w-0 flex-1 truncate text-[10px] font-semibold tracking-[0.08em] text-text">
                {wallet}
              </span>
              <span className="text-[8px] tracking-[0.16em] text-cyan/75 uppercase">{t('holder_select')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  </ModalFrame>
)

export const HolderWalletConnect = ({
  address,
  wallets,
  busy,
  t,
}: Readonly<{ address: string | null; wallets: readonly string[]; busy: string | null; t: CopyText }>) => {
  const [open, set_open] = useState(false)
  const connect = (wallet: string): void => {
    set_open(false)
    dispatch_app({ type: 'distribution/connect_holder', wallet })
  }
  return (
    <section className="flex flex-col items-center gap-3 border border-cyan/20 bg-[radial-gradient(circle_at_50%_0%,rgba(72,207,207,0.08),transparent_70%)] px-5 py-5 text-center">
      <WalletCards className="text-cyan" size={18} />
      <div>
        <div className="text-[9px] tracking-[0.2em] text-cyan uppercase">{t('holder_title')}</div>
        <div className="mt-1 max-w-md font-mono text-[8px] leading-4 text-muted">
          {address ?? t('holder_connect_hint')}
        </div>
      </div>
      {address ? (
        <span className="inline-flex items-center gap-1.5 border border-emerald-400/30 px-3 py-1.5 text-[8px] tracking-[0.15em] text-emerald-400 uppercase">
          <Check size={10} /> {t('holder_connected')}
        </span>
      ) : (
        <button
          className="inline-flex min-w-48 cursor-pointer items-center justify-center gap-2 border border-cyan/45 bg-cyan/7 px-5 py-2.5 text-[9px] font-semibold tracking-[0.18em] text-cyan uppercase shadow-[0_0_22px_rgba(72,207,207,0.07)] transition-colors hover:border-cyan/75 hover:bg-cyan/12 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={busy !== null}
          onClick={() => set_open(true)}
          type="button"
        >
          {busy === 'connect' ? <Loader2 className="animate-spin" size={12} /> : <WalletCards size={12} />}
          {t(busy === 'connect' ? 'holder_connecting' : 'holder_connect')}
        </button>
      )}
      {open && (
        <HolderWalletModal busy={busy} close={() => set_open(false)} connect={connect} t={t} wallets={wallets} />
      )}
    </section>
  )
}

const ShowcaseTile = ({ row, t }: Readonly<{ row: ShowcaseRow; t: CopyText }>) => {
  const Glyph = glyphs[row.kind] ?? Sparkles
  const icon = item_detail_icon(row.id)
  return (
    <article className="flex flex-col border border-border bg-black/40">
      <div className="flex aspect-[5/4] flex-col items-center justify-center gap-2 border-b border-border/60 bg-[radial-gradient(circle_at_50%_35%,rgba(200,150,60,0.07),transparent_70%)]">
        {icon ? (
          <img alt="" className="size-[78%] object-contain" src={icon} />
        ) : (
          <>
            <Glyph className="text-gold/25" size={34} />
            <span className="text-[8px] tracking-[0.18em] text-muted/60 uppercase">{t('set.no_preview')}</span>
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1 p-2.5">
        <span className="truncate text-[11px] font-semibold tracking-[0.12em] text-text uppercase">{row.name}</span>
        <span className="text-[8px] tracking-[0.18em] text-muted/60 uppercase">{t(`set.kind.${row.kind}`)}</span>
        {'aura' in row && row.aura && (
          <span className="inline-flex items-center gap-1.5 text-[8px] tracking-[0.16em] text-cyan-300/80 uppercase">
            <i className="size-1 bg-cyan-300 shadow-[0_0_5px_rgba(103,232,249,0.7)]" />
            {t('set.aura')} · {row.aura.color}
          </span>
        )}
        {'aura_pending' in row && row.aura_pending && (
          <span className="text-[8px] tracking-[0.18em] text-muted/60 uppercase">{t('set.aura_pending')}</span>
        )}
      </div>
    </article>
  )
}

export default function AirdropPage({ copy, session }: Readonly<{ copy: AppCopy; session: SessionState }>) {
  const t = copy_text(copy.airdrop_page)
  const distribution = useAppStore((state) => state.distribution)
  const busy = distribution.pending

  return (
    <section className="pointer-events-auto flex min-h-full flex-1 flex-col overflow-hidden border border-border bg-bg/97">
      <header className="flex shrink-0 items-end justify-between gap-4 border-b border-border px-6 pt-4 pb-3">
        <div className="flex min-w-0 items-baseline gap-3.5">
          <h1 className="inline-flex items-center gap-2 bg-[linear-gradient(135deg,#f5d0a9,#c8963c,#f0c474)] bg-clip-text text-[12px] font-semibold tracking-[0.3em] text-transparent uppercase">
            <Sparkles className="text-gold opacity-70" size={14} /> {t('title')}
          </h1>
          <span className="truncate text-[9px] tracking-[0.14em] text-muted/85 uppercase">{t('subtitle')}</span>
        </div>
        <span className="flex shrink-0 items-center gap-2 text-[8px] tracking-[0.18em] text-muted uppercase">
          <i className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.55)]" />
          Sui · {env.network}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
        <GiftLinkClaim busy={busy} ready={distribution.gift_link_ready} t={t} />
        <HolderWalletConnect
          address={distribution.holder?.address ?? null}
          busy={busy}
          t={t}
          wallets={distribution.wallets}
        />

        {content_catalog.airdrop.drops.length === 0 ? (
          <div className="flex items-center gap-2.5 border border-border/60 px-3 py-2.5 text-muted">
            <Gift className="opacity-40" size={13} />
            <span className="text-[9px] tracking-[0.18em] uppercase">{t('empty')}</span>
            <span className="truncate text-[9px] tracking-[0.08em] text-muted/60">{t('empty_hint')}</span>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {content_catalog.airdrop.drops.map((drop) => {
              const state = distribution.holder_airdrops?.find(({ drop_id }) => drop_id === drop.id)
              return (
                <AirdropDropCard
                  busy={busy}
                  drop={drop}
                  has_game_wallet={session.wallet?.identity === 'zklogin'}
                  key={drop.id}
                  state={state}
                  t={t}
                />
              )
            })}
          </div>
        )}

        {session.giftcards.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="border-b border-border/60 pb-2 text-[10px] font-semibold tracking-[0.24em] text-cyan uppercase">
              {t('giftcards_title')}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
              {session.giftcards.map((giftcard) => (
                <GiftcardCard busy={busy} giftcard={giftcard} key={giftcard.id} t={t} />
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3 border-b border-border/60 pb-2">
            <span className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.28em] text-gold uppercase">
              <Sparkles className="opacity-70" size={12} /> {t('set.title')}
            </span>
            <span className="truncate text-[9px] tracking-[0.14em] text-muted/70 uppercase">{t('set.subtitle')}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
            {content_catalog.airdrop.showcase.map((row) => (
              <ShowcaseTile key={row.id} row={row} t={t} />
            ))}
            {content_catalog.airdrop.pending.map((row) => (
              <article className="flex flex-col border border-dashed border-border bg-black/20 opacity-70" key={row.id}>
                <div className="grid aspect-[5/4] place-items-center border-b border-border/60">
                  <Sparkles className="text-muted/20" size={22} />
                </div>
                <div className="p-2.5">
                  <div className="truncate text-[11px] tracking-[0.12em] text-muted uppercase">{row.name}</div>
                  <div className="mt-1 text-[8px] tracking-[0.18em] text-muted/60 uppercase">
                    {t('set.awaiting_ruling')}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}
