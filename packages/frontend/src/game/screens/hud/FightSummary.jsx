// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// End-of-fight DEFEAT card — shown on a LOSS / abandon / death. Reads the PERSISTENT `fight_summary` slice
// (owned by fight.js), so it SURVIVES the teardown that clears the live `fight` slice. On a WIN the
// experience-driven FightResult owns the celebration, so this renders ONLY on a defeat. Feeds the shared
// canon <FightReport> (spec_fightend_cards.md): party + enemy rows, spoils=null → the dashed "NO SPOILS"
// plate. The party block projects through the ONE shared home (fight_report_roster.js) off the SEAT identity the
// recap captured while the fight was live — never the live character selection, which used to render an
// uninvolved alt as a fallen party member of a fight it never joined (#1661). A defeat's party list still never
// renders empty, and a known seat the roster lost is still synthesized as a DEAD row (a dungeon claim can
// escrow-remove the dead player before the recap snapshots). Wires the DEFEAT sound cue on entrance.

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { experience_to_level } from '@aresrpg/sdk/experience'

import { use_game_state, context } from '../../store.js'
import { get_class } from '../../data/classes.js'
import { play_fight_sfx } from '../../core/audio/sfx.js'
import { use_fight_cost, format_fight_cost } from '../../../world-shell/fight_gas_ledger.js'
import { FightReport } from './FightReport.jsx'
import { fight_report_enemy_rows, fight_report_party_rows } from './fight_report_roster.js'

const close = () => context.dispatch('action/fight_summary/close', {})

/** @param {{ slug_by_name?: Readonly<Record<string, string>> }} props
 * @returns {import('react').JSX.Element | null} */
export function FightSummary({ slug_by_name = {} }) {
  const { t } = useTranslation()
  const recap = use_game_state((s) => s.fight_summary)
  const fight_result = use_game_state((s) => s.fight_result)
  const characters = use_game_state((s) => s.sui.characters)
  const items = use_game_state((s) => s.sui.items)
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
  // PARTICIPATION, NEVER SELECTION (#1661): the local row is the character that HELD THE SEAT (captured in the
  // recap while the fight was live) — never `selected_character_id`, which the switcher can move under this
  // persistent slice and which used to render an uninvolved alt as a fallen party member.
  const seat_id = summary.me_id ?? null
  const me = characters.find((c) => c.id === seat_id) ?? null
  const my_class = get_class(me?.classe ?? me?.class_id ?? '')?.name ?? null
  const my_level = experience_to_level(me?.experience ?? 0)

  const roster = summary.participants ?? []
  // YOUR PARTY — every member; a seat we KNOW fought is ALWAYS present (synthesized DEAD if the roster raced).
  const { my_team, party_rows } = fight_report_party_rows({
    roster,
    me_id: seat_id,
    me_name: me?.name ?? null,
    my_level,
    my_class,
    self_alive: false,
    fallback_name: t('fight_end.you'),
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
