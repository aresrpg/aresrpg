// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LOOT-BOX reveal overlay — the canon OPEN → CHARGE → BURST → REVEAL lifecycle, ported from
// the proven BoxReveal (visuals verbatim in box_reveal.css, [data-phase]-driven keyframes).
// ONE player gesture: consume the box. The open transaction fires on mount; its RECEIPT
// starts the celebration and names the roll (the event carries the template — the item
// resolves PURELY off the authored catalog, zero chain reads). The CLAIM is the SILENT
// claimer's job (modules/claims.ts): the open fold lands the soulbound claim, the claimer
// settles it during the animation, and this card flips to collected when the claim leaves
// the session. Failures are ONE loud toast each; the claim survives on-chain and retries
// by itself. prefers-reduced-motion collapses the celebration.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ItemRow } from '@aresrpg/protocol'
import { Loader2 } from 'lucide-react'

import { item_icon } from '../content/assets.ts'
import { encyclopedia_catalog } from '../content/catalog.ts'
import { play_fight_audio } from '../game/audio/fight_audio_registry.ts'
import { rolled_item_types } from '../modules/claims.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'

import './box_reveal.css'

const CHARGING_MS = 1_200
const BURST_MS = 500
const PENDING_ESCAPE_MS = 10_000

type Phase = 'pending' | 'charging' | 'burst' | 'resolving' | 'reveal'
type Rolled = Readonly<{ claim_id: string; item_type: string; amount: number }>

export const BoxReveal = ({
  box,
  copy,
  close,
}: Readonly<{ box: Readonly<ItemRow>; copy: AppCopy; close: () => void }>) => {
  const t = copy_text(copy.characters_page)
  const wallet = useAppStore(({ session }) => session.wallet)
  const claims = useAppStore(({ session }) => session.claims)
  const [phase, set_phase] = useState<Phase>('pending')
  const [rolled, set_rolled] = useState<Rolled | null>(null)
  const [anim_done, set_anim_done] = useState(false)
  const [escape_ready, set_escape_ready] = useState(false)
  /** the settle is durable and runs without this overlay — after a wait, stop pretending the
   *  player has to watch it (2026-08-22: a claim whose roll had not been projected yet left
   *  this button spinning on Collecting… with no way out but the Escape key) */
  const [collect_escape, set_collect_escape] = useState(false)
  // collected the moment the SILENT claimer settles the claim out of the session
  const collected = !!rolled && !claims.some(({ id }) => id === rolled.claim_id)

  const seed = rolled ? encyclopedia_catalog.item(rolled.item_type)?.item : null

  // the reveal fires only when BOTH the celebration finished AND the roll resolved;
  // an animation that outruns a slow resolve shows the honest shimmer, never a frozen tail
  useEffect(() => {
    if (phase === 'reveal') return
    if (anim_done && rolled) set_phase('reveal')
    else if (anim_done && phase !== 'pending') set_phase('resolving')
  }, [anim_done, rolled, phase])

  // OPEN exactly once — the ref latches across StrictMode effect replays so the
  // gas-burning open can never fire twice for one overlay (the canon's runtime-cell law).
  /* eslint-disable functional/immutable-data, fp-law/no-mutating-methods -- the latch + timer list are this component's own mutable machinery (DOM lifecycle boundary) */
  const flight = useRef({ opened: false, alive: true, timers: [] as ReturnType<typeof setTimeout>[] })
  useEffect(() => {
    if (!wallet) return close()
    const runtime = flight.current
    runtime.alive = true
    const cleanup = (): void => {
      runtime.alive = false
      runtime.timers.forEach(clearTimeout)
    }
    if (runtime.opened) return cleanup
    runtime.opened = true
    void (async () => {
      try {
        const { claim_id, rolled_template, amount } = await wallet.character.open_loot_box({
          box_item_id: box.id,
          box_item_type: box.item_type,
          custody: { kiosk: box.kiosk },
        })
        // the fold lands the claim — the SILENT claimer settles it during the celebration
        dispatch_app({ type: 'inventory/box_opened', box_item_id: box.id, claim_id })
        // receipt proven — celebrate NOW; the resolve + auto-claim run inside the animation
        if (runtime.alive) {
          const reduced_motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          if (reduced_motion) set_anim_done(true)
          else {
            set_phase('charging')
            runtime.timers.push(
              setTimeout(() => {
                if (!runtime.alive) return
                set_phase('burst')
                try {
                  play_fight_audio('crit')
                } catch (error) {
                  console.error('best-effort burst sfx failed (the reveal continues)', error)
                }
                runtime.timers.push(setTimeout(() => runtime.alive && set_anim_done(true), BURST_MS))
              }, CHARGING_MS)
            )
          }
        }
        // the event names the template — resolve it PURELY off the authored catalog
        const item_type = rolled_item_types().get(rolled_template)
        if (!item_type) throw new Error('The rolled item is not in the authored catalog')
        if (runtime.alive) set_rolled({ claim_id, item_type, amount })
      } catch (error) {
        toast.add(error)
        if (runtime.alive) close()
      }
    })()
    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires the gas-burning open exactly once per mount; the box is fixed for this overlay's whole life
  }, [])
  /* eslint-enable functional/immutable-data, fp-law/no-mutating-methods */

  useEffect(() => {
    if (phase !== 'pending') return
    const timer = setTimeout(() => set_escape_ready(true), PENDING_ESCAPE_MS)
    return () => clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== 'reveal' || collected) return undefined
    const timer = setTimeout(() => set_collect_escape(true), PENDING_ESCAPE_MS)
    return () => clearTimeout(timer)
  }, [phase, collected])

  const animating = phase === 'charging' || phase === 'burst'
  // skipping also silences the pending celebration timers so a late burst can never
  // drag the phase backwards out of the reveal
  const skip = (): void => {
    flight.current.timers.forEach(clearTimeout)
    set_anim_done(true)
  }
  const dismiss = useCallback((): void => {
    // the claim flight is durable — dismissing never cancels it, its toast narrates
    if (phase === 'reveal' || phase === 'resolving' || (phase === 'pending' && escape_ready)) close()
  }, [phase, escape_ready, close])

  useEffect(() => {
    const on_key = (event: Readonly<KeyboardEvent>): void => {
      if (event.key === 'Escape') dismiss()
    }
    globalThis.addEventListener('keydown', on_key)
    return () => globalThis.removeEventListener('keydown', on_key)
  }, [dismiss])

  return (
    <div
      aria-modal="true"
      className="boxreveal"
      data-phase={phase}
      onClick={() => (animating ? skip() : dismiss())}
      role="dialog"
    >
      {phase !== 'reveal' && phase !== 'resolving' && (
        <div className="boxreveal__stage">
          <div aria-hidden="true" className="boxreveal__aura" />
          <div className="boxreveal__box">
            {item_icon(box.item_type) && (
              <img alt="" className="boxreveal__box-art" draggable={false} src={item_icon(box.item_type)!} />
            )}
          </div>
          <div aria-hidden="true" className="boxreveal__sparks">
            {[...Array(10).keys()].map((index) => (
              <span
                className={`boxreveal__spark boxreveal__spark--${index % 2 ? 'cyan' : 'gold'}`}
                key={index}
                style={{ '--i': index } as React.CSSProperties}
              />
            ))}
          </div>
          <div aria-hidden="true" className="boxreveal__flash" />
          {phase === 'pending' && <div className="boxreveal__label boxreveal__label--pulse">{t('unsealing')}</div>}
          {animating && <div className="boxreveal__skip">{t('skip_hint')}</div>}
        </div>
      )}

      {phase === 'resolving' && (
        <div className="boxreveal__card-wrap" onClick={(event) => event.stopPropagation()}>
          <div className="boxreveal__eyebrow">{t('reveal_eyebrow')}</div>
          <div aria-busy="true" className="boxreveal__card boxreveal__card--resolving">
            <div aria-hidden="true" className="boxreveal__shimmer" />
            <div className="boxreveal__resolving-label">{t('revealing')}</div>
          </div>
        </div>
      )}

      {phase === 'reveal' && rolled && (
        <div className="boxreveal__card-wrap" onClick={(event) => event.stopPropagation()}>
          <div className="boxreveal__eyebrow">{t('reveal_eyebrow')}</div>
          <div className="boxreveal__card">
            {item_icon(rolled.item_type) && (
              <img alt="" className="boxreveal__pet-art" draggable={false} src={item_icon(rolled.item_type)!} />
            )}
            <div className="boxreveal__pet-name">
              {seed?.name ?? rolled.item_type}
              {rolled.amount > 1 && <span> ×{rolled.amount}</span>}
            </div>
          </div>
          {collected || collect_escape ? (
            <button className="btn-gold boxreveal__collect" onClick={close} type="button">
              {t('continue_cta')}
            </button>
          ) : (
            <button className="btn-gold boxreveal__collect" disabled type="button">
              <Loader2 className="boxreveal__spin" size={13} />
              {t('collecting')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
