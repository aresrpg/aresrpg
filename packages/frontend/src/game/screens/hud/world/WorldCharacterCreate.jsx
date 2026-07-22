// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Confirmed-empty WORLD-SLOT onboarding. The roster state is explicit: loading never flashes create,
// read failure offers retry, zero characters mounts the inline creator, and the first optimistic roster
// insert swaps the slot straight back to the resident world. Meta tabs return `inactive`, never redirect.

import { useEffect, useRef } from 'react'

import i18n from '../../../../i18n'
import { use_game_state } from '../../../store.js'
import {
  character_create,
  read_allowed_classes,
  is_paid_create,
  ADDITIONAL_CHARACTER_PRICE_SUI,
} from '../../character-create.js'

const color_to_number = (/** @type {string} */ hex) => parseInt(String(hex).replace(/^#/, ''), 16)

/**
 * @param {{ pathname: string, loaded: boolean, load_error: unknown, character_count: number }} state
 * @returns {'inactive' | 'loading' | 'error' | 'create' | 'world'}
 */
export function world_slot_content({ pathname, loaded, load_error, character_count }) {
  if (pathname !== '/') return 'inactive'
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={host} className="world-character-create" data-world-slot="character-create" />
}

/**
 * Pure render seam for placement tests; production passes the roster-derived mode below.
 * @param {{ mode: ReturnType<typeof world_slot_content>, on_retry?: () => void, price_sui?: number }} props
 */
export function WorldCharacterCreateSurface({ mode, on_retry = () => {}, price_sui }) {
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
  const loaded = use_game_state((state) => state.sui.loaded)
  const load_error = use_game_state((state) => state.sui.load_error)
  const character_count = use_game_state((state) => state.sui.characters.length)
  // #443 — the LIVE on-chain creation price (load_roster's get_creation_state read), the same derived
  // source CharactersDrawer's paid flow reads. Falls back to the display constant while still loading;
  // the mint itself always re-reads the authoritative price, never this display value.
  const price_sui = use_game_state((state) => state.sui.character_price_sui) ?? ADDITIONAL_CHARACTER_PRICE_SUI
  const mode = world_slot_content({ pathname, loaded, load_error, character_count })
  const retry_roster = () =>
    void import('../../../../roster/load_roster').then(({ load_roster }) => load_roster())

  return <WorldCharacterCreateSurface mode={mode} on_retry={retry_roster} price_sui={price_sui} />
}
