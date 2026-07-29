// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// End-of-fight DEFEAT card — shown on a LOSS / abandon / death. Reads the PERSISTENT `fight_summary` slice
// (owned by fight.js), so it SURVIVES the teardown that clears the live `fight` slice. On a WIN the
// experience-driven FightResult owns the celebration, so this renders ONLY on a defeat. Feeds the shared
// canon <FightReport> (spec_fightend_cards.md): party + enemy rows, spoils=null → the dashed "NO SPOILS"
// plate. THE KEY FIX (a defeat's party list must never render empty): the fallen local player is ALWAYS rendered
// as a DEAD row — synthesized from the selected character when the roster raced/omitted it (a dungeon claim
// can escrow-remove the dead player before the recap snapshots). Wires the DEFEAT sound cue on entrance.

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { experience_to_level } from '@aresrpg/sdk/experience'

import { use_game_state, context } from '../../store.js'
import { use_auth } from '../../../auth'
import { get_class } from '../../data/classes.js'
import { play_fight_sfx } from '../../core/audio/sfx.js'
import { use_fight_cost, format_fight_cost } from '../../../world-shell/fight_gas_ledger.js'
import { FightReport } from './FightReport.jsx'
import { fight_report_enemy_rows } from './fight_report_roster.js'

const close = () => context.dispatch('action/fight_summary/close', {})

/** @param {{ slug_by_name?: Readonly<Record<string, string>> }} props
 * @returns {import('react').JSX.Element | null} */
export function FightSummary({ slug_by_name = {} }) {
  const { t } = useTranslation()
  const recap = use_game_state((s) => s.fight_summary)
  const fight_result = use_game_state((s) => s.fight_result)
  const me_id = use_game_state((s) => s.selected_character_id)
  const characters = use_game_state((s) => s.sui.characters)
  const items = use_game_state((s) => s.sui.items)
  const address = use_auth((s) => s.address)
  const net_mist = use_fight_cost((s) => s.net_mist)

  // the card shows only on a real defeat (the win celebration is FightResult's). Gate the sound + render on it.
  const is_defeat = !!recap && !recap.won && !fight_result

  // DEFEAT sound cue (design mood: somber descending toll) — fire once as the card appears, reset when gone.
  const played = useRef(false)
  useEffect(() => {
    if (is_defeat && !played.current) {
      played.current = true
      play_fight_sfx('lose')
    }
    if (!is_defeat) played.current = false
  }, [is_defeat])

  if (!is_defeat) return null

  const { summary } = recap
  const me = characters.find((c) => c.id === me_id) ?? null
  const my_class = get_class(me?.classe ?? me?.class_id ?? '')?.name ?? null
  const my_level = experience_to_level(me?.experience ?? 0)
  // the local fighter is the character id (WS) OR the wallet address (dungeon fighters are keyed by address).
  const is_local = (p) => p.id === me_id || (address != null && p.id === address)

  const roster = summary.participants ?? []
  const my_team = roster.find(is_local)?.team ?? 0

  // YOUR PARTY — every member; the fallen local player is ALWAYS present (synthesize a DEAD row if omitted).
  let party = roster.filter((p) => p.team === my_team)
  if (!party.some(is_local))
    party = [
      {
        id: me_id ?? 'me',
        name: me?.name ?? t('fight_end.you'),
        team: my_team,
        level: my_level,
        is_player: true,
        alive: false,
      },
      ...party,
    ]
  const party_rows = party.map((p) => {
    const mine = is_local(p)
    return {
      id: p.id,
      // prefer the character name for the local row; every OTHER row's name is re-resolved by FightReport
      // itself off the ONE character-name home (fight_report_names.js) — this passthrough is just its input.
      name: (mine ? me?.name : null) || p.name || t('fight_end.you'),
      level: mine ? my_level : p.level,
      is_me: mine,
      is_player: p.is_player ?? true, // a party row is always a player; roster rows carry it explicitly
      alive: p.alive,
      hp_pct: p.alive ? 100 : 0,
      class_name: mine ? my_class : null,
    }
  })
  // ONE adapter shared with the victory card preserves the mob template id that powers the bestiary deep-link.
  const enemy_rows = fight_report_enemy_rows(roster, my_team)

  // [defeat-cause] compose the localized "slain by X for N" line from the summary's killer stash (fight_bridge
  // captured it as the killing wave replayed). i18n lives HERE (the view), never in the shared FightReport shell.
  const cause = summary.cause?.killer
    ? t('fight_end.slain_by', { killer: summary.cause.killer, damage: summary.cause.damage })
    : null

  return (
    <FightReport
      verdict="Defeat"
      party={party_rows}
      enemies={enemy_rows}
      spoils={null}
      items={items}
      slug_by_name={slug_by_name}
      cost={format_fight_cost(net_mist)}
      cause={cause}
      duration_ms={summary.duration_ms ?? 0} /* 0 until fight_recap_payload gets a real start timestamp */
      duration_partial={summary.duration_partial ?? false} /* resume/poll-adopt floor → the card's "~" prefix */
      t={t}
      on_close={close}
    />
  )
}
