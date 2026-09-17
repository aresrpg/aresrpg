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
// explicitly from inventory after an unsuccessful automatic attempt. prefers-reduced-motion collapses the celebration.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ItemRow } from '@aresrpg/protocol'
import { Loader2 } from 'lucide-react'

import { NativeModal } from '../components/ModalFrame.tsx'
import { play_fight_audio } from '../game/audio/fight_audio_registry.ts'
import { rolled_item_types } from '../modules/claims.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, read_app_state, useAppStore } from '../store.ts'
import { encumbered_asset_ids, stack_merge_sources } from '../inventory_stacks.ts'
import { toast } from '../toast.ts'

import { BoxRevealCell, type BoxPhase, type BoxResult } from './BoxRevealCell.tsx'
import './box_reveal.css'

const CHARGING_MS = 1_200
const BURST_MS = 500
const PENDING_ESCAPE_MS = 10_000

export const BoxReveal = ({
  box,
  count = 1,
  copy,
  close,
}: Readonly<{ box: Readonly<ItemRow>; count?: number; copy: AppCopy; close: () => void }>) => {
  const t = copy_text(copy.characters_page)
  const wallet = useAppStore(({ session }) => session.wallet)
  const claims = useAppStore(({ session }) => session.claims)
  const [phase, set_phase] = useState<BoxPhase>('pending')
  const [rolled, set_rolled] = useState<readonly BoxResult[] | null>(null)
  const [anim_done, set_anim_done] = useState(false)
  const [escape_ready, set_escape_ready] = useState(false)
  /** the settle is durable and runs without this overlay — after a wait, stop pretending the
   *  player has to watch it (2026-08-22: a claim whose roll had not been projected yet left
   *  this button spinning on Collecting… with no way out but the Escape key) */
  const [collect_escape, set_collect_escape] = useState(false)
  // collected the moment the SILENT claimer settles the claim out of the session
  const collected = !!rolled && rolled.every((roll) => !claims.some(({ id }) => id === roll.claim_id))

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
        const state = read_app_state()
        if (state.session.wallet !== wallet) throw new Error('Wallet changed before opening boxes')
        const { rolls, inventory_changes } = await wallet.character.open_loot_boxes({
          count,
          merge_sources: stack_merge_sources(
            state.session.inventory,
            encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows),
            box
          ),
          box_item_id: box.id,
          box_item_type: box.item_type,
          custody: { kiosk: box.kiosk },
        })
        if (read_app_state().session.wallet !== wallet) return
        dispatch_app({ type: 'inventory/amounts_changed', changes: inventory_changes })
        // the fold lands the claim — the SILENT claimer settles it during the celebration
        dispatch_app({
          type: 'inventory/boxes_opened',
          claims: rolls.map(({ claim_id, rolled_template, amount }) => ({
            id: claim_id,
            kind: 'box',
            rolled_template,
            amount,
          })),
        })
        // the event names the template — resolve it PURELY off the authored catalog
        const results = rolls.map(({ claim_id, rolled_template, amount }) => {
          const item_type = rolled_item_types().get(rolled_template)
          if (!item_type) throw new Error('The rolled item is not in the authored catalog')
          return { claim_id, item_type, amount }
        })

        // receipt proven — celebrate NOW; the resolve + auto-claim run inside the animation
        if (runtime.alive) {
          set_rolled(results)
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

  return (
    <NativeModal
      close={dismiss}
      label={t('reveal_eyebrow')}
      className={`boxreveal${count > 1 ? ' boxreveal--batch' : ''}`}
      data-phase={phase}
      style={
        {
          '--columns': Math.ceil(Math.sqrt(count * 1.5)),
          '--rows': Math.ceil(count / Math.ceil(Math.sqrt(count * 1.5))),
          '--mobile-columns': Math.ceil(Math.sqrt(count / 1.5)),
          '--mobile-rows': Math.ceil(count / Math.ceil(Math.sqrt(count / 1.5))),
        } as CSSProperties
      }
      onClick={() => (animating ? skip() : dismiss())}
    >
      <div className="boxreveal__grid">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="boxreveal__cell">
            <BoxRevealCell item_type={box.item_type} phase={phase} roll={rolled?.[index]} text={t} />
          </div>
        ))}
      </div>
      {animating && <div className="boxreveal__skip">{t('skip_hint')}</div>}
      {phase === 'reveal' &&
        (collected || collect_escape ? (
          <button className="btn-gold boxreveal__collect" onClick={close} type="button">
            {t('continue_cta')}
          </button>
        ) : (
          <button className="btn-gold boxreveal__collect" disabled type="button">
            <Loader2 className="boxreveal__spin" size={13} />
            {t('collecting')}
          </button>
        ))}
    </NativeModal>
  )
}
