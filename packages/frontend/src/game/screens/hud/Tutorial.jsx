// First-time coachmark tour (#15) — a SHORT, linear "how to play" spotlight tour for a brand-new player
// (naive-user law: understand AND enjoy in ~10s, zero text walls). It dims the live world, spotlights ONE
// element at a time (the in-world minimap + vitals, then the companion SIDEBAR meta-tabs where the breadth
// lives), shows a one-line how-to, and advances on Next; Skip (or finishing the last step) ends it.
// FIRST-SESSION ONLY: a single localStorage flag (a UI PREFERENCE — the only thing allowed there, never
// gameplay) gates re-show, so a returning player never sees it again.
//
// TOKEN SCOPE FIX: the layer is portaled to <body> WRAPPED in `.gw-tab gw-tab--carrier`. The bridge defines
// the companion house tokens (--accent / --glass / --fg / ...) so they resolve here (a bare body portal
// would leave them empty -> unstyled card), while `gw-tab--carrier`'s display:contents paints no box and adds no
// transform — so the position:fixed layer measures against the viewport and lines up with the real HUD
// targets' getBoundingClientRect (the same token-bridge pattern GameWorldHud uses for the dock).

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { icon_x } from '../icons.js'
import { TOUR_STEPS } from './tutorial-data.js'
import './tutorial.css'

// The seen flag is a UI preference (house law: localStorage = preferences only, never gameplay state).
// Versioned: D165 re-targeted the whole tour from HUD elements to the sidebar nav tabs, so the `_v2` suffix
// lets players who already dismissed the old HUD tour see the new tab tour exactly once. Bump on re-target.
const SEEN_KEY = 'ares_tutorial_seen_v2'

/** @returns {boolean} */
function already_seen() {
  try {
    return localStorage.getItem(SEEN_KEY) != null
  } catch {
    return false
  }
}

function mark_seen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // ignore unavailable / full storage — the tour just won't persist its dismissal across reloads
  }
}

const PAD = 8 // breathing room of the spotlight cutout around the target
const GAP = 12 // distance between the spotlight and the card

/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi))

/**
 * The first-time coachmark tour. Renders nothing for a returning player (seen flag set). Mount it on the
 * Play view (a playable roster) so the in-world HUD + the sidebar meta-tab targets exist on screen.
 * @returns {import('react').ReactNode}
 */
export function Tutorial() {
  const { t } = useTranslation()
  // RETIRED auto-start: the onboarding QUEST LADDER (world/QuestObjectiveCard) replaced this
  // coachmark tour. The tour code stays one release for a clean janitor delete, but it NO LONGER AUTO-STARTS
  // — every mount begins dismissed (index -1). We still fold the seen-flag forward (mark it seen once) so the
  // retirement persists and a re-enable would treat existing players as already-onboarded.
  const [index, set_index] = useState(() => {
    if (!already_seen()) mark_seen()
    return -1
  })
  const step = index >= 0 ? TOUR_STEPS[index] : undefined

  if (!step) return null

  const close = () => {
    mark_seen()
    set_index(-1)
  }
  const next = () => {
    if (index >= TOUR_STEPS.length - 1) close()
    else set_index((i) => i + 1)
  }

  return createPortal(
    <div className="gw-tab gw-tab--carrier">
      <TourLayer t={t} step={step} index={index} total={TOUR_STEPS.length} on_next={next} on_skip={close} />
    </div>,
    document.body
  )
}

/**
 * One tour step: a full-screen click-blocking layer with a spotlight cutout over the step's target
 * element, plus the how-to card placed beside it (top / bottom, or right for the vertical sidebar tabs).
 * Re-measures on every step change and on resize so it tracks the live targets. A null target -> centered
 * card, no spotlight (the closing step).
 * @param {{
 *   t: (key: string, opts?: any) => string,
 *   step: import('./tutorial-data.js').TourStep,
 *   index: number,
 *   total: number,
 *   on_next: () => void,
 *   on_skip: () => void,
 * }} props
 * @returns {import('react').ReactElement}
 */
function TourLayer({ t, step, index, total, on_next, on_skip }) {
  const card_ref = useRef(/** @type {HTMLDivElement | null} */ (null))
  const [spot, set_spot] = useState(
    /** @type {{ left: number, top: number, width: number, height: number } | null} */ (null)
  )
  const [card, set_card] = useState(/** @type {{ left: number, top: number } | null} */ (null))

  useLayoutEffect(() => {
    const measure = () => {
      const el = card_ref.current
      if (!el) return
      const c = el.getBoundingClientRect()
      const target = step.placement !== 'center' && step.target ? document.querySelector(step.target) : null
      if (!target) {
        set_spot(null)
        set_card({
          left: window.innerWidth / 2 - c.width / 2,
          top: window.innerHeight / 2 - c.height / 2,
        })
        return
      }
      const t = target.getBoundingClientRect()
      const box = {
        left: t.left - PAD,
        top: t.top - PAD,
        width: t.width + PAD * 2,
        height: t.height + PAD * 2,
      }
      set_spot(box)
      if (step.placement === 'right') {
        // beside a vertical target (the left-sidebar meta-tabs): card to the right, centered on the tab
        set_card({
          left: clamp(box.left + box.width + GAP, GAP, window.innerWidth - c.width - GAP),
          top: clamp(t.top + t.height / 2 - c.height / 2, GAP, window.innerHeight - c.height - GAP),
        })
        return
      }
      const left = clamp(t.left + t.width / 2 - c.width / 2, GAP, window.innerWidth - c.width - GAP)
      const raw_top = step.placement === 'bottom' ? box.top + box.height + GAP : box.top - c.height - GAP
      set_card({
        left,
        top: clamp(raw_top, GAP, window.innerHeight - c.height - GAP),
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [step])

  const last = index >= total - 1

  return (
    <div className="tut">
      {/* transparent full-screen click-catcher (modal): the world/dock can't be clicked mid-tour. The dim
          itself comes from the spotlight's box-shadow; on a centered step the backdrop dims instead. */}
      <div className="tut__backdrop" data-dim={spot ? undefined : 'true'} />
      {spot && (
        <div
          className="tut__spot"
          style={{ left: spot.left, top: spot.top, width: spot.width, height: spot.height }}
          aria-hidden="true"
        />
      )}
      <div
        ref={card_ref}
        className="tut__card"
        role="dialog"
        aria-label={t('tutorial.tip_label', { title: t(step.title_key) })}
        style={card ? { left: card.left, top: card.top } : { opacity: 0 }}
      >
        <button
          type="button"
          className="tut__x"
          aria-label={t('tutorial.skip')}
          onClick={on_skip}
          dangerouslySetInnerHTML={{ __html: icon_x }}
        />
        <span className="tut__eyebrow">{t('tutorial.step_counter', { current: index + 1, total })}</span>
        <span className="tut__title">{t(step.title_key)}</span>
        <span className="tut__body">{t(step.body_key)}</span>
        <div className="tut__foot">
          <button type="button" className="tut__skip" onClick={on_skip}>
            {t('tutorial.skip')}
          </button>
          <button type="button" className="tut__next" onClick={on_next}>
            {t(last ? 'tutorial.start_playing' : 'tutorial.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
