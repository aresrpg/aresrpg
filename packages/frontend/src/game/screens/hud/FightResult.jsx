// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// End-of-fight VICTORY card — shown on a player WIN. Feeds the shared canon <FightReport> (dark dramatic
// modal, spec_fightend_cards.md): party + enemy rows (shared format, the local player ALWAYS present) + an
// inline SILENT receipt (SPOILS: +XP, loot tiles — no claim/mint buttons; fight-end auto-settles same-tx).
// Data: the local reward is the `fight_result` slice (player_experience.js — RESOLVED ONLY by the settlement
// receipt's ResultOpened dispatch, finish_result/dungeon_settlement.js; /v1 owes this card nothing); the
// roster rides the `fight_summary` recap, opened for BOTH outcomes since the v30 fix (dungeon_run_store.js
// open_fight_recap — a WIN now carries the real multiplayer roster too). The party block projects through the
// ONE shared home (fight_report_roster.js) off the recap's CAPTURED seat identity, never the live character
// selection (#1661); the self row is still synthesized when a known seat's roster row raced — FightReport
// re-resolves every OTHER party/enemy row's name off the ONE character-name home regardless (fight_report_names.js),
// so a raw address never survives even when this file's own `p.name` passthrough is stale. React only renders
// — truth is the chain. Wires the VICTORY sound cue (warm ascending swell) on card entrance.

import { note_card_shown } from '../../../fight-engine/fight_end_machine.js' // D153 C14
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useGameState, context } from '../../store.js'
import { class_display } from '../../data/classes.js'
import { play_fight_sfx } from '../../core/audio/sfx.js'
import { use_fight_cost, format_fight_cost } from '../../../world-shell/fight_gas_ledger.js'
import { FightReport } from './FightReport.jsx'
import { fight_report_enemy_rows, fight_report_party_rows } from './fight_report_roster.js'

// closing the win modal clears BOTH the reward slice AND the shared recap (a win opens both).
const close = () => {
  context.dispatch('action/fight_result/close')
  context.dispatch('action/fight_summary/close', {})
}

/**
 * The end-of-fight WIN card. Gates off the discrete `fight_result` flag (not fight_mode), so it persists a
 * beat after the board despawns and never churns per-frame.
 * @param {{ slug_by_name?: Readonly<Record<string, string>> }} props
 * @returns {import('react').JSX.Element | null}
 */
export function FightResult({ slug_by_name = {} }) {
  const { t } = useTranslation()
  const reward = useGameState((s) => s.fight_result)
  const recap = useGameState((s) => s.fight_summary)
  const characters = useGameState((s) => s.sui.characters)
  const net_mist = use_fight_cost((s) => s.net_mist)

  // VICTORY sound cue (design mood: warm ascending swell) — fire once as the card appears, reset on close.
  const played = useRef(false)
  useEffect(() => {
    // D153 C14: the terminal WIN card mounting advances the machine VICTORY_RESOLVED→CARD_SHOWN.
    if (reward) note_card_shown()
    if (reward && !played.current) {
      played.current = true
      play_fight_sfx('win')
    }
    if (!reward) played.current = false
  }, [reward])

  if (!reward) return null

  // PARTICIPATION, NEVER SELECTION (#1661): the local row is the character that HELD THE SEAT, captured in the
  // recap while the fight was live — never `selected_character_id`, which the switcher can move under this slice.
  // A win always has a seat, so this is the defeat card's fix riding the ONE shared projection, not a second rule.
  const seat_id = recap?.summary?.me_id ?? null
  const me = characters.find((c) => c.id === seat_id) ?? null
  const my_class = class_display(t, me?.classe ?? me?.class_id)

  const roster = recap?.summary?.participants ?? []
  // YOUR PARTY — every member, the seat that won ALWAYS present (synthesized if the roster raced/omitted it).
  const { my_team, party_rows } = fight_report_party_rows({
    roster,
    me_id: seat_id,
    me_name: me?.name ?? null,
    my_level: reward.level,
    my_class,
    self_alive: true,
    fallback_name: t('fight_end.you'),
  })
  // ONE adapter shared with the defeat card preserves the mob template id that powers the bestiary deep-link.
  const enemy_rows = fight_report_enemy_rows(roster, my_team)

  // SPOILS receipt (silent-auto — the card IS the receipt). tokens=0: no on-chain token reward exists yet.
  const spoils = { xp: reward.xp, tokens: 0, loot: reward.loot ?? [] }

  return (
    <FightReport
      verdict="Victory"
      party={party_rows}
      enemies={enemy_rows}
      spoils={spoils}
      slug_by_name={slug_by_name}
      cost={format_fight_cost(net_mist)}
      pending={reward.status === 'pending'} /* xp/level still resolving on-chain → skeleton, never a literal +0 */
      loot_units={reward.loot_units} /* ResultOpened rolled count → loot skeletons until the items delta lands */
      duration_ms={recap?.summary?.duration_ms ?? 0} /* 0 until fight_recap_payload gets a real start timestamp */
      duration_partial={recap?.summary?.duration_partial ?? false} /* resume/poll-adopt floor → the card's "~" prefix */
      t={t}
      on_close={close}
    />
  )
}
