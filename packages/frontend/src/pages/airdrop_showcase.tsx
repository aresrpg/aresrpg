// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE AIRDROP SET — the showcase half of the airdrop page (#803): a visual grid over the PUBLISHED set,
// nothing else. No eligibility, no whitelist, no claim — those live in the claim section above it and on
// chain. The rows come from `data/airdrop.json` through airdrop_set.ts; this file is markup.
//
// HONEST STATES, FOUR OF THEM, ALL DISTINCT: loading (a cold fetch says LOADING, never "empty"), error (the
// set could not be read — a visible failure row with a retry, never a silent blank), served-and-empty (the
// host said there is nothing), and served-with-rows. A failed fetch is NEVER rendered as an empty airdrop.
//
// THE DEGRADATION CONTRACT: a tile shows its icon only when the manifest says that icon is served; every
// other row (today: every pet and the full-body outfit — the .glb corpus is unpublished host-wide) shows
// its kind glyph and says PREVIEW PENDING. Rows the content house has not ruled on render as explicit
// awaiting-ruling tiles rather than vanishing.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cat, Crown, Loader2, RefreshCw, Shirt, Sparkles, Star, TriangleAlert } from 'lucide-react'

import {
  humanize_id,
  load_airdrop_set,
  type AirdropSet,
  type AirdropSetItem,
  type AirdropSetPending,
} from './airdrop_set'

type ShowcaseState = { status: 'loading' | 'ready' | 'error'; set: AirdropSet }

const EMPTY: AirdropSet = { items: [], pending: [] }

/** kind → its terminal glyph. An unknown kind still gets a mark, never a blank tile. */
const KIND_GLYPH: Record<string, typeof Sparkles> = {
  pet_glb: Cat,
  cosmetic: Crown,
  title_relic: Star,
  outfit: Shirt,
}

const TILE = 'flex flex-col border border-border bg-black/40'
// 5:4, not a square: two thirds of the set has no served art today, and a full square turns those into
// cavernous empty boxes (driven capture, 2026-07-26). The icon fills most of the box so the art carries
// the tile instead of floating in it.
const ART = 'aspect-[5/4] flex flex-col items-center justify-center gap-1.5 border-b border-border/60'
const ART_BG = { background: 'radial-gradient(circle at 50% 35%, rgba(200,150,60,0.07), rgba(0,0,0,0) 70%)' }
const MICRO = 'text-[8px] tracking-[0.18em] uppercase text-muted/60'

function ItemTile({ item }: { item: AirdropSetItem }) {
  const { t } = useTranslation()
  const [broken, set_broken] = useState(false)
  const Glyph = KIND_GLYPH[item.kind] ?? Sparkles
  const show_icon = !!item.icon_url && !broken

  return (
    <div className={TILE}>
      <div className={ART} style={ART_BG}>
        {show_icon ? (
          <img
            src={item.icon_url ?? undefined}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-[78%] h-[78%] object-contain"
            style={{ imageRendering: 'pixelated' }}
            onError={() => set_broken(true)}
            onLoad={(e) => {
              // An HTTP-ok body the browser cannot decode fires onLoad, not onError — the native broken-image
              // box would leak through. Treat a zero-width decode as the failure it is.
              if (!e.currentTarget.naturalWidth) set_broken(true)
            }}
          />
        ) : (
          <>
            <Glyph size={34} className="text-gold" style={{ opacity: 0.25 }} aria-hidden="true" />
            <span className={MICRO}>{t('airdrop.set.no_preview')}</span>
          </>
        )}
      </div>
      <div className="flex flex-col gap-1 p-2.5 min-w-0">
        <span className="text-text text-[11px] tracking-[0.12em] uppercase font-semibold truncate">{item.name}</span>
        <span className={MICRO}>{t(`airdrop.set.kind.${item.kind}`, { defaultValue: humanize_id(item.kind) })}</span>
        {item.aura && (
          <span className="inline-flex items-center gap-1.5 text-[8px] tracking-[0.16em] uppercase text-cyan-300/80">
            <i className="w-1 h-1 bg-cyan-300" style={{ boxShadow: '0 0 5px rgba(103,232,249,0.7)' }} />
            {t('airdrop.set.aura')} · {item.aura.color}
          </span>
        )}
        {item.aura_pending && !item.aura && <span className={MICRO}>{t('airdrop.set.aura_pending')}</span>}
      </div>
    </div>
  )
}

function PendingTile({ row }: { row: AirdropSetPending }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col border border-dashed border-border bg-black/20 opacity-70">
      <div className={ART}>
        <Sparkles size={22} className="text-muted" style={{ opacity: 0.2 }} aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1 p-2.5 min-w-0">
        <span className="text-muted text-[11px] tracking-[0.12em] uppercase truncate">{row.name}</span>
        <span className={MICRO}>{t('airdrop.set.awaiting_ruling')}</span>
      </div>
    </div>
  )
}

/**
 * The showcase section, PURE in its state: every branch is a render of what the door returned. Exported so
 * the suite can drive all four states without a network.
 */
export function AirdropShowcaseSection({ state, on_retry }: { state: ShowcaseState; on_retry?: () => void }) {
  const { t } = useTranslation()
  const { items, pending } = state.set
  const nothing = items.length === 0 && pending.length === 0

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3 border-b border-border/60 pb-2">
        <span className="text-[10px] tracking-[0.28em] uppercase font-semibold text-gold inline-flex items-center gap-2">
          <Sparkles size={12} className="opacity-70" aria-hidden="true" />
          {t('airdrop.set.title')}
        </span>
        <span className="text-[9px] tracking-[0.14em] uppercase text-muted/70 truncate">
          {t('airdrop.set.subtitle')}
        </span>
      </div>

      {state.status === 'loading' ? (
        <div className="flex items-center justify-center gap-2 py-16">
          <Loader2 size={14} className="animate-spin text-gold opacity-40" />
          <span className="text-muted text-[10px] tracking-[0.2em] uppercase animate-pulse">{t('common.loading')}</span>
        </div>
      ) : state.status === 'error' ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <TriangleAlert size={22} className="text-gold" style={{ opacity: 0.35 }} aria-hidden="true" />
          <span className="text-muted text-[10px] tracking-[0.18em] uppercase">{t('airdrop.set.error')}</span>
          {on_retry && (
            <button
              type="button"
              onClick={on_retry}
              className="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 text-[9px] tracking-[0.2em] uppercase text-muted hover:text-gold cursor-pointer"
            >
              <RefreshCw size={10} />
              {t('airdrop.set.retry')}
            </button>
          )}
        </div>
      ) : nothing ? (
        <div className="flex items-center justify-center py-16">
          <span className="text-muted text-[10px] tracking-[0.18em] uppercase">{t('airdrop.set.empty')}</span>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          {items.map((item) => (
            <ItemTile key={item.id} item={item} />
          ))}
          {pending.map((row) => (
            <PendingTile key={row.id} row={row} />
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * The mounted section: one fetch per mount, no cache — a set that failed to load must be re-asked, and an
 * absent answer is never remembered as an empty one.
 */
export function AirdropShowcase() {
  const [state, set_state] = useState<ShowcaseState>({ status: 'loading', set: EMPTY })
  const [attempt, set_attempt] = useState(0)
  const retry = useCallback(() => set_attempt((n) => n + 1), [])

  useEffect(() => {
    let alive = true
    set_state({ status: 'loading', set: EMPTY })
    void load_airdrop_set().then((result) => {
      if (alive) set_state(result)
    })
    return () => {
      alive = false
    }
  }, [attempt])

  return <AirdropShowcaseSection state={state} on_retry={retry} />
}
