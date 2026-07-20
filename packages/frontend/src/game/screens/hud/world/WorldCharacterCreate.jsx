// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Confirmed-empty WORLD-SLOT onboarding. The roster state is explicit: loading never flashes create,
// read failure offers retry, zero characters mounts the inline creator, and the first optimistic roster
// insert swaps the slot straight back to the resident world. Meta tabs return `inactive`, never redirect.

import { useEffect, useRef } from 'react'

import i18n from '../../../../i18n'
import { use_game_state } from '../../../store.js'
import { character_create, read_allowed_classes } from '../../character-create.js'

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

/** The imperative creator's bounded React mount point. */
export function InlineCharacterCreateHost() {
  const host = useRef(/** @type {HTMLDivElement | null} */ (null))

  useEffect(() => {
    const mount = host.current
    if (!mount) return undefined
    /** @type {ReturnType<typeof character_create> | undefined} */ let handle
    let destroyed = false

    void read_allowed_classes().then((allowed_classes) => {
      if (destroyed) return
      handle = character_create({
        placement: 'inline',
        character_count: 0,
        claimed_free: false,
        allowed_classes,
        cancel_label: 'Log out',
        on_created: async ({ name, class_id, male, color_1, color_2, color_3 }) => {
          const { use_expedition } = await import('../../../../roster/store')
          await use_expedition.getState().create_character({
            name,
            classe: class_id,
            male: male ?? true,
            color_1: color_to_number(color_1),
            color_2: color_to_number(color_2),
            color_3: color_to_number(color_3),
          })
        },
        on_cancel: () => void import('../../../../auth').then(({ use_auth }) => use_auth.getState().logout()),
      })
      mount.appendChild(handle.root)
    })

    return () => {
      destroyed = true
      handle?.destroy()
    }
  }, [])

  return <div ref={host} className="world-character-create" data-world-slot="character-create" />
}

/**
 * Pure render seam for placement tests; production passes the roster-derived mode below.
 * @param {{ mode: ReturnType<typeof world_slot_content>, on_retry?: () => void }} props
 */
export function WorldCharacterCreateSurface({ mode, on_retry = () => {} }) {
  if (mode === 'create') return <InlineCharacterCreateHost />
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
  const mode = world_slot_content({ pathname, loaded, load_error, character_count })
  const retry_roster = () =>
    void import('../../../../roster/load_roster').then(({ load_roster }) => load_roster())

  return <WorldCharacterCreateSurface mode={mode} on_retry={retry_roster} />
}
