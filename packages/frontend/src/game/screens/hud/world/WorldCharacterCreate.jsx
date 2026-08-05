// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Confirmed-empty WORLD-SLOT onboarding. The roster state is explicit: loading never flashes create,
// read failure offers retry, zero characters mounts the inline creator, and the first optimistic roster
// insert swaps the slot straight back to the resident world. Meta tabs return `inactive`, never redirect.

import { useEffect, useRef, useState } from 'react'

import i18n from '../../../../i18n'
import { probe_gl_context } from '../../../../core/gl_support.js'
import { useGameState } from '../../../store.js'
import {
  character_create,
  read_allowed_classes,
  is_paid_create,
  ADDITIONAL_CHARACTER_PRICE_SUI,
} from '../../character-create.js'

const color_to_number = (/** @type {string} */ hex) => parseInt(String(hex).replace(/^#/, ''), 16)

/**
 * @param {{ pathname: string, loaded: boolean, load_error: unknown, character_count: number,
 *   gl_supported?: boolean }} state  `gl_supported` is the DETECTED browser capability (core/gl_support.js),
 *   entering this reducer as an input like every other fact here. Defaults true — absence of the probe is
 *   never a reason to accuse a working browser.
 * @returns {'inactive' | 'loading' | 'error' | 'create' | 'world' | 'no_gpu'}
 */
export function world_slot_content({ pathname, loaded, load_error, character_count, gl_supported = true }) {
  if (pathname !== '/') return 'inactive'
  // #2235 — outranks every other face on this slot: with no WebGL context NOTHING here can be drawn, so
  // the creator's canvas, its class thumbnails and the world behind it are all equally dead. Showing the
  // creator anyway is what made this a "broken screen" instead of an answerable problem.
  if (!gl_supported) return 'no_gpu'
  if (character_count > 0) return 'world'
  if (load_error) return 'error'
  return loaded ? 'create' : 'loading'
}

/**
 * The imperative creator's bounded React mount point.
 * @param {{ price_sui?: number }} [props]  the LIVE on-chain creation price (state.sui.character_price_sui,
 *   load_roster's get_creation_state read — the SAME derived source create_character_paid re-reads before
 *   building, #443). Defaults to the display-fallback constant while the background hydrate is still in flight.
 */
export function InlineCharacterCreateHost({ price_sui = ADDITIONAL_CHARACTER_PRICE_SUI } = {}) {
  const host = useRef(/** @type {HTMLDivElement | null} */ (null))

  useEffect(() => {
    const mount = host.current
    if (!mount) return undefined
    /** @type {ReturnType<typeof character_create> | undefined} */ let handle
    let destroyed = false

    // #443 — the FREE sponsored mint is zkLogin-ONLY (money law #73 / auth's is_zklogin_session idiom: a
    // connected wallet self-pays every tx and never rides the sponsor door). A wallet session's first
    // character routes through the SAME self-pay paid mint an additional character already uses;
    // is_paid_create is the ONE predicate both this routing and the on-screen price badge/button read, so
    // they can never disagree (the promised-free-then-charged trap stays unrepresentable). auth is
    // DYNAMIC-imported (mirrors on_cancel below) — its module body eagerly registers the Enoki wallet, so
    // this host must never statically import it (keeps this file DOM/window-safe at module load).
    void Promise.all([import('../../../../auth'), read_allowed_classes()]).then(
      ([{ is_zklogin_session }, allowed_classes]) => {
        if (destroyed) return
        const zklogin_session = is_zklogin_session()
        const paid = is_paid_create({ character_count: 0, claimed_free: false, zklogin_session })
        handle = character_create({
          placement: 'inline',
          character_count: 0,
          claimed_free: false,
          zklogin_session,
          price_sui,
          allowed_classes,
          cancel_label: 'Log out',
          on_created: async ({ name, class_id, male, color_1, color_2, color_3 }) => {
            const { use_expedition } = await import('../../../../roster/store')
            const { create_character, create_character_paid } = use_expedition.getState()
            const draft = {
              name,
              classe: class_id,
              male: male ?? true,
              color_1: color_to_number(color_1),
              color_2: color_to_number(color_2),
              color_3: color_to_number(color_3),
            }
            await (paid ? create_character_paid(draft) : create_character(draft))
          },
          on_cancel: () => void import('../../../../auth').then(({ use_auth }) => use_auth.getState().logout()),
        })
        mount.appendChild(handle.root)
      }
    )

    return () => {
      destroyed = true
      handle?.destroy()
    }
    // price_sui is captured once at open (mirrors CreateHost/CharactersDrawer.jsx) — a later-arriving live
    // price must never remount mid-form (it would tear down the pedestal and drop in-progress input).
    // (the react-hooks/exhaustive-deps directive that sat here was dead — the plugin is not registered.)
  }, [])

  return <div ref={host} className="world-character-create" data-world-slot="character-create" />
}

/**
 * #2235 — THE RECOVERY DOOR for a browser with graphics acceleration turned off. Plain DOM by
 * construction (it has to work exactly when nothing can be rendered), and honest on all three counts a
 * stuck player needs: what happened, that it is a browser setting rather than their machine, and the two
 * clicks that fix it. `Retry` re-runs the probe — the player flips the setting, relaunches, comes back.
 *
 * It wears the roster-error face's EXACT classes on purpose: that is the world slot's one bounded-notice
 * treatment (gold-topped companion glass) and it already carries #871's proven hit-test contract — a
 * `pointer-events: none` frame whose card alone is clickable. A second copy of that surface language, or
 * a second selector for it, would be a second home for one fact.
 * @param {{ on_retry: () => void }} props
 */
export function GpuDisabledDoor({ on_retry }) {
  return (
    <div className="world-character-create world-character-create--error" data-world-slot="gpu-disabled">
      <div className="flex flex-col items-center gap-3 text-center max-w-[52ch]">
        <span className="text-gold text-[11px] tracking-[0.2em] uppercase">{i18n.t('world.gpu_disabled_title')}</span>
        <p className="text-muted text-[12px] leading-relaxed">{i18n.t('world.gpu_disabled_body')}</p>
        <p className="text-muted text-[12px] leading-relaxed">{i18n.t('world.gpu_disabled_chrome')}</p>
        <p className="text-muted text-[11px] leading-relaxed">{i18n.t('world.gpu_disabled_other')}</p>
        <button
          type="button"
          data-gpu-retry
          className="btn-outline px-4 py-1.5 text-[10px] tracking-[0.2em] uppercase"
          onClick={on_retry}
        >
          {i18n.t('world.retry')}
        </button>
      </div>
    </div>
  )
}

/**
 * Pure render seam for placement tests; production passes the roster-derived mode below.
 * @param {{ mode: ReturnType<typeof world_slot_content>, on_retry?: () => void, on_gl_retry?: () => void,
 *   price_sui?: number }} props
 */
export function WorldCharacterCreateSurface({ mode, on_retry = () => {}, on_gl_retry = () => {}, price_sui }) {
  if (mode === 'no_gpu') return <GpuDisabledDoor on_retry={on_gl_retry} />
  if (mode === 'create') return <InlineCharacterCreateHost price_sui={price_sui} />
  if (mode !== 'error') return null
  return (
    <div className="world-character-create world-character-create--error" data-world-slot="roster-error">
      <div className="flex flex-col items-center gap-3">
        <span className="text-muted text-[11px] tracking-[0.2em] uppercase">
          {i18n.t('world.roster_load_error')}
        </span>
        <button
          type="button"
          className="btn-outline px-4 py-1.5 text-[10px] tracking-[0.2em] uppercase"
          onClick={on_retry}
        >
          {i18n.t('world.retry')}
        </button>
      </div>
    </div>
  )
}

/** @param {{ pathname: string }} props */
export function WorldCharacterCreate({ pathname }) {
  const loaded = useGameState((state) => state.sui.loaded)
  const load_error = useGameState((state) => state.sui.load_error)
  const character_count = useGameState((state) => state.sui.characters.length)
  // #443 — the LIVE on-chain creation price (load_roster's get_creation_state read), the same derived
  // source CharactersDrawer's paid flow reads. Falls back to the display constant while still loading;
  // the mint itself always re-reads the authoritative price, never this display value.
  const price_sui = useGameState((state) => state.sui.character_price_sui) ?? ADDITIONAL_CHARACTER_PRICE_SUI
  // #2235 — probed ONCE per mount (lazy initializer), never memoized module-side: the door's retry re-asks
  // after the player enables acceleration and relaunches, and this state is what the slot renders from.
  const [gl_supported, set_gl_supported] = useState(probe_gl_context)
  const mode = world_slot_content({ pathname, loaded, load_error, character_count, gl_supported })
  const retry_roster = () =>
    void import('../../../../roster/load_roster').then(({ load_roster }) => load_roster())
  const retry_gl = () => set_gl_supported(probe_gl_context())

  return (
    <WorldCharacterCreateSurface
      mode={mode}
      on_retry={retry_roster}
      on_gl_retry={retry_gl}
      price_sui={price_sui}
    />
  )
}
