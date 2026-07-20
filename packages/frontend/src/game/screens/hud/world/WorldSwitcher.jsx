// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD PANEL (S-67 → design redesign 2026-07-17: remove that picker and replace it with a simple "you are in
// <world>" and a button "travel to another world" → design ruling 2026-07-18: that was too big and polluting). The
// sidebar surface is ONE compact row in the house tiny-chrome idiom — globe icon + the current world's
// bare label (the full "you are in <world>" sentence rides the title/aria, keeping the i18n key) + a
// small inline text-button (the short `join` = "Travel" label; the long `travel_cta` sentence stays its
// title/aria). The destination picker lives in WorldTravelModal (world cards + level filter).
//
// Every rendered fact flows through the PURE derivations (world_travel_state.js):
//   • derive_world_panel — the selected character's location line, IDENTITY-GUARDED: use_rpc_view keeps
//     last-landed data across a selection switch, so the doc in hand can belong to a DIFFERENT character;
//     a doc whose id mismatches is discarded (the 07-17 "HERE in First Shore" lie died at this seam). A
//     selected character in NO world renders the honest empty state with the travel button as the CTA.
//   • derive_world_cards — the modal rows: seeded catalog (T62_WORLDS) ⋈ LIVE /v1 required_level (the
//     zones::join_world gate) ⋈ authored corpus knowledge (band/biome/mobs/resources — the encyclopedia's
//     own join). Locks mirror the chain gate exactly; an unknown never pre-locks.
//
// TRAVEL rides the EXISTING flow untouched: card → house ConfirmDialog → join_world_action (self-pay
// through the ONE run_tx choke, simulate-first, kiosk pair resolved inside; an executed failure is never
// auto-refired) wrapped in the standard toast lifecycle, then a refetch so the line follows the chain.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'

import { use_game_state } from '../../../store.js'
import { use_rpc_view } from '../../../../rpc/use_view'
import { get_characters, get_encyclopedia } from '../../../../rpc/client'
import { T62_WORLDS } from '../../../../chain/deployment'
import { world_corpus_of } from '../../../../pages/encyclopedia/world_corpus'
import { join_world_action } from '../../../../world-shell/world_join.js'
import { use_toast } from '../../../../toast'
import i18n from '../../../../i18n'
import { ConfirmDialog } from './ConfirmDialog.jsx'
import { WorldTravelModal } from './WorldTravelModal.jsx'
import { derive_world_panel, derive_world_cards, filter_world_cards } from './world_travel_state.js'

/** @returns {import('react').ReactElement} */
export function WorldSwitcher() {
  const { t } = useTranslation()
  const selected_character_id = use_game_state((s) => s.selected_character_id)
  const [travel_open, set_travel_open] = useState(false)
  const [accessible_only, set_accessible_only] = useState(false)
  // The world a card is asking to travel to — drives the house ConfirmDialog (NEVER a native
  // window.confirm — house dialog law). null = closed; confirm runs the toast-wrapped self-pay join.
  const [pending, set_pending] = useState(/** @type {{ id: string, label: string } | null} */ (null))

  // The selected character's doc (world binding + level). Cheap 15 s poll, self-heals on focus. The raw
  // hook value is NEVER rendered directly — derive_world_panel identity-guards it (see header).
  const view = use_rpc_view(
    /** @returns {Promise<{ id?: string, world?: string | null, level?: number | null } | null>} */ async (
      signal
    ) => (selected_character_id ? ((await get_characters({ id: selected_character_id }, signal))[0] ?? null) : null),
    { deps: [selected_character_id], enabled: !!selected_character_id, interval_ms: 15000 }
  )

  // The live worlds catalog carries the exact on-chain gate. IDs select the row only; no checked-in
  // chain-id map owns a second copy of required_level, so a republish cannot silently erase the gates.
  const worlds_view = use_rpc_view((signal) => get_encyclopedia('worlds', signal), { deps: [] })
  const required_level_by_world = new Map(
    (worlds_view.data?.worlds ?? []).map((world) => [world.world_id, Number(world.required_level ?? 1)])
  )

  const panel = derive_world_panel({ selected_character_id, doc: view.data })
  const current_label = panel.world_id
    ? (T62_WORLDS.find((w) => w.id === panel.world_id)?.label ?? panel.world_id)
    : null
  const cards = filter_world_cards(
    derive_world_cards({
      worlds: T62_WORLDS,
      required_level_by_world,
      corpus_of: world_corpus_of,
      my_level: panel.level,
      current_world_id: panel.world_id,
    }),
    { accessible_only }
  )

  // Compact-row copy: in-world shows the bare world label; the full localized sentence
  // ("You are in {{world}}") stays on the line as its title/aria — same key, tiny footprint.
  const status_line = {
    no_character: t('world_switcher.no_character'),
    unknown: t('world_switcher.locating'),
    not_in_world: t('world_switcher.no_world'),
    in_world: current_label ?? '',
  }[panel.status]
  const in_world_sentence =
    panel.status === 'in_world' ? t('world_switcher.in_world', { world: current_label }) : undefined

  // The real travel (unchanged flow): confirm → toast-wrapped self-pay join (kiosk derivation +
  // simulate-first live inside join_world_action) → refetch so the line follows the chain.
  const run_join = async (world) => {
    set_pending(null)
    set_travel_open(false)
    try {
      await use_toast
        .getState()
        .promise(join_world_action({ world_id: world.id, character_id: selected_character_id }), {
          pending: i18n.t('world_switcher.joining', { world: world.label }),
          success: i18n.t('world_switcher.joined', { world: world.label }),
        })
      view.refetch()
    } catch {
      /* surfaced by the toast lifecycle — an executed failure is never auto-refired (tx-retry law) */
    }
  }

  return (
    <div className="gw-worlds gw-panel">
      <Globe size={11} className="gw-worlds__icon" />
      <span
        className={`gw-worlds__now${panel.status === 'in_world' ? ' in-world' : ''}`}
        data-world={panel.world_id ?? undefined}
        title={in_world_sentence}
      >
        {status_line}
      </span>
      <button
        type="button"
        className={`gw-worlds__travel${panel.status === 'not_in_world' ? ' cta' : ''}`}
        disabled={!selected_character_id}
        title={t('world_switcher.travel_cta')}
        aria-label={t('world_switcher.travel_cta')}
        onClick={() => set_travel_open(true)}
      >
        {t('world_switcher.join')}
      </button>
      <WorldTravelModal
        open={travel_open}
        on_close={() => set_travel_open(false)}
        cards={cards}
        accessible_only={accessible_only}
        on_filter={set_accessible_only}
        can_travel={!!selected_character_id}
        on_travel={(card) => set_pending({ id: card.id, label: card.label })}
      />
      <ConfirmDialog
        open={!!pending}
        title={t('world_switcher.join')}
        message={pending ? t('world_switcher.join_confirm', { world: pending.label }) : ''}
        confirm_label={t('world_switcher.join')}
        cancel_label={t('common.cancel')}
        on_confirm={() => pending && run_join(pending)}
        on_cancel={() => set_pending(null)}
      />
    </div>
  )
}
