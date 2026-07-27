// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// End-of-fight VICTORY card — shown on a player WIN. Feeds the shared canon <FightReport> (dark dramatic
// modal, spec_fightend_cards.md): party + enemy rows (shared format, the local player ALWAYS present) + an
// inline SILENT receipt (SPOILS: +XP, loot tiles — no claim/mint buttons; fight-end auto-settles same-tx).
// Data: the local reward is the `fight_result` slice (player_experience.js — RESOLVED ONLY by the settlement
// receipt's ResultOpened dispatch, finish_result/dungeon_settlement.js; /v1 owes this card nothing); the
// roster rides the `fight_summary` recap, opened for BOTH outcomes since the v30 fix (dungeon_run_store.js
// open_fight_recap — a WIN now carries the real multiplayer roster too). The self row is still synthesized
// defensively when the roster raced/omitted it (WS-path fights, or any edge the recap missed) — FightReport
// re-resolves every OTHER party/enemy row's name off the ONE character-name home regardless (fight_report_names.js),
// so a raw address never survives even when this file's own `p.name` passthrough is stale. React only renders
// — truth is the chain. Wires the VICTORY sound cue (warm ascending swell) on card entrance.

import { note_card_shown } from '../../../fight-engine/fight_end_machine.js' // D153 C14
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { use_game_state, context } from '../../store.js'
import { use_auth } from '../../../auth'
import { get_class } from '../../data/classes.js'
import { play_fight_sfx } from '../../core/audio/sfx.js'
import { use_fight_cost, format_fight_cost } from '../../../world-shell/fight_gas_ledger.js'
import { FightReport } from './FightReport.jsx'

// closing the win modal clears BOTH the reward slice AND the shared recap (a win opens both).
const close = () => {
  context.dispatch('action/fight_result/close')
  context.dispatch('action/fight_summary/close', {})
}

/**
 * The end-of-fight WIN card. Gates off the discrete `fight_result` flag (not fight_mode), so it persists a
 * beat after the board despawns and never churns per-frame.
 * @returns {import('react').JSX.Element | null}
 */
export function FightResult() {
  const { t } = useTranslation()
  const reward = use_game_state(s => s.fight_result)
  const recap = use_game_state(s => s.fight_summary)
  const me_id = use_game_state(s => s.selected_character_id)
  const characters = use_game_state(s => s.sui.characters)
  const items = use_game_state(s => s.sui.items)
  const address = use_auth(s => s.address)
  const net_mist = use_fight_cost(s => s.net_mist)

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

  const me = characters.find(c => c.id === me_id) ?? null
  const my_class = get_class(me?.classe ?? me?.class_id ?? '')?.name ?? null
  // the local fighter is identified by the character id (WS path) OR the wallet address (dungeon fighters
  // are keyed by address) — either match is "me".
  const is_local = p => p.id === me_id || (address != null && p.id === address)

  const roster = recap?.summary?.participants ?? []
  const my_team = roster.find(is_local)?.team ?? 0

  // YOUR PARTY — every member, self ALWAYS present (synthesize the local row if the roster raced/omitted it).
  let party = roster.filter(p => p.team === my_team)
  if (!party.some(is_local))
    party = [
      { id: me_id ?? 'me', name: me?.name ?? t('fight_end.you'), team: my_team, level: reward.level, is_player: true, alive: true },
      ...party,
    ]
  const party_rows = party.map(p => {
    const mine = is_local(p)
    return {
      id: p.id,
      // prefer the character name for the local row; every OTHER row's name is re-resolved by FightReport
      // itself off the ONE character-name home (fight_report_names.js) — this passthrough is just its input.
      name: (mine ? me?.name : null) || p.name || t('fight_end.you'),
      level: mine ? reward.level : p.level,
      is_me: mine,
      is_player: p.is_player ?? true, // a party row is always a player; roster rows carry it explicitly
      alive: p.alive,
      hp_pct: p.alive ? 100 : 0,
      class_name: mine ? my_class : null,
    }
  })
  const enemy_rows = roster
    .filter(p => p.team !== my_team)
    // template_id: the mob's on-chain template (fight_recap.js) — the row's bestiary deep-link. Players: null.
    .map(p => ({ id: p.id, name: p.name, level: p.level, is_player: p.is_player, alive: p.alive, hp_pct: p.alive ? 100 : 0, template_id: p.template_id ?? null }))

  // SPOILS receipt (silent-auto — the card IS the receipt). tokens=0: no on-chain token reward exists yet.
  const spoils = { xp: reward.xp, tokens: 0, loot: reward.loot ?? [] }

  return (
    <FightReport
      verdict="Victory"
      party={party_rows}
      enemies={enemy_rows}
      spoils={spoils}
      items={items}
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
