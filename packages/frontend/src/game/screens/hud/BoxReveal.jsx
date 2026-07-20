// PET LOOT-BOX reveal overlay — the OPEN → CHARGE → BURST → REVEAL lifecycle for a bought box, with the
// collection AUTOMATIC (claiming a pet is automatic at opening). The container (`BoxReveal`)
// OWNS the phase machine + the two tx calls (open_box / claim_pet, lootbox_actions.js) and NOTHING ELSE renders
// the visuals — the pure `RevealStage` is the single visual home (the throwaway design harness drives IT
// directly with fixtures, no chain / no 3D).
//
// INVARIANTS honoured here:
//   • The roll animation NEVER starts until open_box CONFIRMS — `pending` shows an honest wait; the charge
//     celebrates the RECEIPT (client-independence: name/art resolve DURING the 1.7s animation, never before it).
//   • The reveal card only ever shows the resolved LootBoxOpened roll (the ACTUAL pet, never a client re-roll).
//   • AUTO-CLAIM fires the moment the roll is known, exactly once across surfaces (begin_claim, the module
//     guard). An executed/ambiguous claim failure LATCHES against auto refire (TX-RETRY law) — the card offers
//     the one-click MANUAL retry; a zero-gas refusal stays freely collectable. The claim is durable: dismissing
//     while collecting is always allowed — the flight resolves to its one toast in the background.
//   • NO silent failure: every error path → exactly ONE humanize_tx_error toast. open_box fail → toast + close.
//   • prefers-reduced-motion collapses charging/burst — the reveal still waits for the resolved pet.
//
// SFX (EXISTING corpus only — curated selection): burst → play_fight_sfx('crit'); reveal → play_discovery_sfx()
// (the reward-beat sparkle). Best-effort (try/catch); no new assets.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { ItemImage } from '../../../components/items'
import i18n from '../../../i18n' // singleton for toast handlers (outside the render's useTranslation closure)
import { use_template_t } from '../../../i18n/template_t'
import { use_toast } from '../../../toast'
import { load_roster } from '../../../roster/load_roster.js'
import { get_template_by_item_type_map } from '../../../chain/read_findables.js'
import { humanize_tx_error } from '../../core/abort_copy.js' // the ONE decoder
import { play_fight_sfx, play_discovery_sfx } from '../../core/audio/sfx.js'
import { game_log } from '../../../core/log.js'

import { open_box, claim_pet, resolve_rolled } from '../../../world-shell/lootbox_actions.js'
import {
  PENDING_ESCAPE_MS,
  PENDING_TIMEOUT_MS,
  can_dismiss_reveal,
  open_timeout_armed,
  reveal_after_celebration,
} from '../../../world-shell/lootbox_util.js'
import { begin_claim, end_claim, note_open_settled, should_block_tx_retry } from './lootbox-retry-guard.js'
import './box_reveal.css'

// Phase timings (the pure phase ORDER lives in the import-free lootbox_util.js leaf — testable under bun:test).
const CHARGING_MS = 1200
const BURST_MS = 500

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const best_effort = (fn) => {
  try {
    fn()
  } catch {
    /* audio is best-effort */
  }
}

/**
 * PURE presentational overlay — renders EVERY phase off `phase` (data-phase drives the CSS keyframes). No chain,
 * no timers, no effects: the harness + the container both render THIS, so the look has one home. The claim is
 * automatic — the card shows its honest state (`collect_status`) instead of a Collect ceremony; `on_collect` is
 * only the MANUAL retry after a failure. `on_dismiss` = Escape/backdrop close (the claim is durable and its
 * flight survives the close).
 * @param {{ phase:string, box:{item_type:string, icon_slug?:string|null}, pet?:{slug:string,name:string}|null,
 *   collect_status?:'collecting'|'collected'|'failed', collect_latched?:boolean, on_skip?:()=>void,
 *   on_collect?:()=>void, on_dismiss?:()=>void }} props
 */
export function RevealStage({
  phase,
  box,
  pet,
  collect_status = 'collecting',
  collect_latched = false,
  on_skip,
  on_collect,
  on_dismiss,
}) {
  const { t } = useTranslation()
  const animating = phase === 'charging' || phase === 'burst'
  return (
    <div
      className="boxreveal"
      data-phase={phase}
      role="dialog"
      aria-modal="true"
      onClick={() => (animating ? on_skip?.() : (phase === 'reveal' || phase === 'resolving') && on_dismiss?.())}
    >
      {/* BOX STAGE — the sealed box floating/charging/bursting (hidden once revealed or resolving). HD art: the
          base icon is a 64px thumb (blurry at 150px, a low-quality icon); `hd` requests the published
          _hd render and degrades to the pixelated base automatically (ItemImage's ladder). */}
      {phase !== 'reveal' && phase !== 'resolving' && (
        <div className="boxreveal__stage">
          <div className="boxreveal__aura" aria-hidden="true" />
          <div className="boxreveal__box">
            <ItemImage
              id={box.icon_slug ?? box.item_type}
              category="consumable"
              hd
              eager
              className="boxreveal__box-art"
            />
          </div>
          <div className="boxreveal__sparks" aria-hidden="true">
            {[...Array(10).keys()].map((i) => (
              <span
                key={i}
                className={`boxreveal__spark boxreveal__spark--${i % 2 ? 'cyan' : 'gold'}`}
                style={{ '--i': i }}
              />
            ))}
          </div>
          <div className="boxreveal__flash" aria-hidden="true" />
          {phase === 'pending' && (
            <div className="boxreveal__label boxreveal__label--pulse">{t('lootbox.unsealing')}</div>
          )}
          {animating && <div className="boxreveal__skip">{t('lootbox.skip_hint')}</div>}
        </div>
      )}

      {/* RESOLVING — the celebration ended before the pet read landed (a slow / cold resolve): an honest shimmer
          in the card slot, never the frozen forwards-filled burst tail that read as blank (UX-A). Dismissible via
          the backdrop — a hung read must never trap the player (no dead-end). */}
      {phase === 'resolving' && (
        <div className="boxreveal__card-wrap" onClick={(e) => e.stopPropagation()}>
          <div className="boxreveal__eyebrow">{t('lootbox.reveal_eyebrow')}</div>
          <div className="boxreveal__card boxreveal__card--resolving" aria-busy="true">
            <div className="boxreveal__shimmer" aria-hidden="true" />
            <div className="boxreveal__resolving-label">{t('lootbox.revealing')}</div>
          </div>
        </div>
      )}

      {/* REVEAL CARD — the rolled pet (truthful, off the event) + the honest automatic-collection state. */}
      {phase === 'reveal' && pet && (
        <div className="boxreveal__card-wrap" onClick={(e) => e.stopPropagation()}>
          <div className="boxreveal__eyebrow">{t('lootbox.reveal_eyebrow')}</div>
          <div className="boxreveal__card">
            <ItemImage id={pet.slug} category="pet" hd eager className="boxreveal__pet-art" />
            <div className="boxreveal__pet-name">{pet.name}</div>
          </div>
          {collect_status === 'collected' ? (
            <button type="button" className="btn-gold boxreveal__collect" onClick={() => on_dismiss?.()}>
              {t('lootbox.continue')}
            </button>
          ) : collect_status === 'failed' ? (
            <>
              {collect_latched && <div className="boxreveal__hint">{t('lootbox.collect_failed_hint')}</div>}
              <button type="button" className="btn-gold boxreveal__collect" onClick={() => on_collect?.()}>
                {collect_latched ? t('lootbox.retry_collect') : t('lootbox.collect')}
              </button>
            </>
          ) : (
            <button type="button" className="btn-gold boxreveal__collect" disabled>
              <Loader2 size={13} className="boxreveal__spin" />
              {t('lootbox.collecting')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Container — mounts `pending`, fires open_box ONCE; its confirm starts the charge IMMEDIATELY (the receipt is
 * the proof) while the pet name/art resolve and the AUTO-CLAIM run during the animation. Owns SFX, toasts, the
 * claim flight, and the reduced-motion collapse. Renders `RevealStage`.
 * @param {{ box:{id:string,item_type:string,template_id?:string|null,icon_slug?:string|null}, on_close:()=>void,
 *   on_retry_blocked?:(box_id:string)=>void, on_retry_allowed?:(box_id:string)=>void }} props
 */
export function BoxReveal({ box, on_close, on_retry_blocked, on_retry_allowed }) {
  const tt = use_template_t()
  const [phase, set_phase] = useState('pending')
  const [pet, set_pet] = useState(/** @type {{slug:string,name:string}|null} */ (null))
  const [collect_status, set_collect_status] = useState(
    /** @type {'collecting'|'collected'|'failed'} */ ('collecting')
  )
  const [collect_latched, set_collect_latched] = useState(false)
  const [pending_escape_ready, set_pending_escape_ready] = useState(false)
  const opened = useRef(false) // StrictMode double-mount guard — open_box must fire exactly ONCE (it burns gas)
  const timers = useRef(/** @type {any[]} */ ([]))
  const revealed = useRef(false) // the reveal SFX fires once (a skip must not double it)
  const alive = useRef(true)
  const anim_done = useRef(false) // reveal gate half 1: the celebration ran (or was skipped / reduced-motion)
  const pet_ref = useRef(/** @type {{slug:string,name:string,claim_id:string,rolled_template:string}|null} */ (null)) // half 2: the truth arrived

  const clear_timers = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  const to_reveal = () => {
    clear_timers()
    if (!revealed.current) {
      revealed.current = true
      best_effort(play_discovery_sfx)
    }
    if (alive.current) set_phase('reveal')
  }

  // The reveal fires only when BOTH the animation finished (or was skipped) AND the rolled pet resolved. When the
  // animation ends first, we show an honest RESOLVING shimmer (UX-A) instead of freezing on the burst tail — the
  // pure decision lives in the util leaf so it is testable.
  const maybe_reveal = () => {
    const next = reveal_after_celebration(anim_done.current, !!pet_ref.current)
    if (next === 'reveal') to_reveal()
    else if (next === 'resolving' && alive.current) set_phase('resolving')
  }
  const skip = () => {
    anim_done.current = true
    maybe_reveal()
  }

  /**
   * THE claim flight (auto at roll-time, manual on retry) — one home for begin/end guarding, the outcome
   * toast, and the card state. Runs to completion even after the overlay closes (the claim is durable;
   * UI writes are alive-guarded, the toast is global).
   * @param {{ claim_id:string, rolled_template:string, name:string }} target
   */
  const run_collect = async ({ claim_id, rolled_template, name }) => {
    if (!begin_claim(claim_id)) return // already flying (or already collected) on some surface
    if (alive.current) {
      set_collect_status('collecting')
      set_collect_latched(false)
    }
    try {
      await claim_pet({ claim_id, rolled_template })
      end_claim(claim_id, {})
      load_roster().catch(() => {}) // the minted pet flows back through the roster refetch
      use_toast.getState().add(i18n.t('lootbox.collected', { name }), 'info')
      if (alive.current) set_collect_status('collected')
    } catch (e) {
      // An executed/uncertain claim may have burned gas → latch against AUTO refire; the card keeps the
      // one-click MANUAL retry (human decision). A positively identified dry-run refusal stays free to retry.
      end_claim(claim_id, { error: e })
      use_toast.getState().add(humanize_tx_error(e), 'error')
      if (alive.current) {
        set_collect_status('failed')
        set_collect_latched(should_block_tx_retry(e))
      }
    }
  }

  // OPEN the box exactly once; only its confirm starts the roll (INVARIANT: no fake roll before the tx lands).
  useEffect(() => {
    alive.current = true
    const cleanup = () => {
      alive.current = false
      clear_timers()
    }
    // React StrictMode replays this effect: re-arm nothing here on replay, never the gas-burning open.
    if (opened.current) return cleanup
    opened.current = true
    // Latch at submission start, not only in catch: an ordinary drawer/navigation unmount must not expose a second
    // open while this promise may still execute. Release paths: the positively identified zero-gas refusal below,
    // or the guard's self-clear once a FRESH roster read proves the box survived a settled failure.
    on_retry_blocked?.(box.id)
    ;(async () => {
      const t0 = now()
      try {
        const { rolled_template, claim_id } = await open_box({
          box_id: box.id,
          item_type: box.item_type,
          template_id: box.template_id,
        })
        // Settled + fresh-read input FIRST (module truth, not UI): a late settle after the 45s close still
        // removes the consumed box and lets the self-clear predicate see ground truth.
        note_open_settled(box.id)
        load_roster().catch(() => {})
        if (!rolled_template || !claim_id) throw new Error('open_box returned no rolled pet') // honest, no silent no-op
        // RECEIPT PROVEN — leave 'pending' NOW (this disarms the 45s force-close guard, UX-B) and start the
        // celebration; the resolve + auto-claim run inside it (D2).
        if (alive.current) {
          const reduced_motion =
            typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          if (reduced_motion) {
            anim_done.current = true
            set_phase('resolving') // no animation — leave pending and wait honestly for the pet read
          } else {
            set_phase('charging')
            timers.current.push(
              setTimeout(() => {
                if (!alive.current) return
                set_phase('burst')
                best_effort(() => play_fight_sfx('crit'))
                timers.current.push(
                  setTimeout(() => {
                    anim_done.current = true
                    maybe_reveal()
                  }, BURST_MS)
                )
              }, CHARGING_MS)
            )
          }
        }
        const t1 = now()
        const { slug } = await resolve_rolled({ rolled_template })
        const tmpl = (await get_template_by_item_type_map()).get(slug)
        const t2 = now()
        game_log(
          'lootbox-perf',
          `open confirmed @${Math.round(t1 - t0)}ms · resolve+template ${Math.round(t2 - t1)}ms (masked by the charge)`
        )
        const resolved = {
          slug: slug || rolled_template,
          name: tmpl
            ? tt({ item_type: slug, name: tmpl.name, desc_key: slug }, 'name')
            : String(slug || rolled_template).replace(/_/g, ' '),
          claim_id,
          rolled_template,
        }
        pet_ref.current = resolved
        if (alive.current) set_pet({ slug: resolved.slug, name: resolved.name })
        run_collect(resolved) // AUTO-CLAIM at opening (D3) — its own outcome handling, never awaited by the show
        maybe_reveal()
      } catch (e) {
        // open_box failed (pre-flight or executed) → ONE humanized toast, close. NEVER auto-retry (TX-RETRY law).
        note_open_settled(box.id, { error: e })
        load_roster().catch(() => {}) // fresh-read input: a failed open leaves the box sealed — prove it, self-clear
        if (!alive.current) return
        alive.current = false
        clear_timers()
        use_toast.getState().add(humanize_tx_error(e), 'error')
        if (!should_block_tx_retry(e)) on_retry_allowed?.(box.id)
        on_close()
      }
    })()
    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // PENDING GUARD (UX-B) — an edge effect keyed to the phase (the same one-pipeline shape as the durable latch):
  // the 10s escape-arm + the 45s open-timeout force-close live ONLY while we await the receipt. The instant the
  // receipt lands the phase leaves 'pending' (→ charging / resolving) and this effect's cleanup clears both, so a
  // slow resolve/claim AFTER the win the player already watched can never raise a false "timed out" close. A
  // late-settling open promise still stamps the latch + refreshes the roster + auto-collects (its toasts narrate).
  useEffect(() => {
    if (!open_timeout_armed(phase)) return
    const escape_timer = setTimeout(() => {
      if (alive.current) set_pending_escape_ready(true)
    }, PENDING_ESCAPE_MS)
    const timeout_timer = setTimeout(() => {
      if (!alive.current) return
      alive.current = false
      clear_timers()
      use_toast.getState().add(humanize_tx_error(new Error(i18n.t('lootbox.open_timeout'))), 'error')
      on_retry_blocked?.(box.id)
      on_close()
    }, PENDING_TIMEOUT_MS)
    return () => {
      clearTimeout(escape_timer)
      clearTimeout(timeout_timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Escape/backdrop close (no dead-end law): the reveal always dismisses — the claim flight is durable and
  // resolves to its one toast in the background. Pending Escape arms after 10s. Neither path cancels or
  // retries a submitted transaction.
  const dismiss = useCallback(() => {
    if (!can_dismiss_reveal(phase, pending_escape_ready)) return
    if (phase === 'pending') {
      alive.current = false
      clear_timers()
      // The submitted promise may still execute after this overlay closes. Latch the box before exposing the bag
      // again so an Escape/reopen sequence cannot submit a second gas-burning open.
      on_retry_blocked?.(box.id)
    }
    on_close()
  }, [phase, pending_escape_ready, clear_timers, on_close, on_retry_blocked, box.id])
  useEffect(() => {
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [dismiss])

  /** MANUAL retry only (the auto path already ran) — begin_claim arbitrates double-clicks and cross-surface races. */
  const on_collect = () => {
    if (pet_ref.current && collect_status === 'failed') run_collect(pet_ref.current)
  }

  return (
    <RevealStage
      phase={phase}
      box={box}
      pet={pet}
      collect_status={collect_status}
      collect_latched={collect_latched}
      on_skip={skip}
      on_collect={on_collect}
      on_dismiss={dismiss}
    />
  )
}
