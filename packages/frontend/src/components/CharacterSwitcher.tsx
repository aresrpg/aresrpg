// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #29 PART 2 — sidebar character switcher, docked at the bottom of the left sidebar (the freed
// `#game-online-slot` region — Option B dropped OnlinePlayers there). World-tab only. Lets the player see
// their whole on-chain roster grouped IN DUNGEON / IN LOBBY, click to either RESUME a live dungeon fight
// (attach + mount the board) or SWITCH the active lobby character (selection + resident-session binding).
// The follow store is exited during a lobby switch so it cannot keep an old spectator target alive. A red dot
// flags a character whose dungeon fight is on ITS turn right now (needs input).
//
// Chain-direct only: reads state.sui.characters (populated by roster/load_roster.js), never a WS/
// backend call. Reuses the ALREADY-DISPATCHED roster — no new fetch.

import { useTranslation } from 'react-i18next'
import { Compass } from 'lucide-react'
import { experience_to_level } from '@aresrpg/sdk/experience'
import { handle_character_click } from '@aresrpg/world'

import { use_game_state, context, use_fight_view } from '../game/store.js'
import { use_follow } from '../follow'
import { use_dungeon } from '../world-shell/dungeon_store.js'
import { rebind_world_character } from '../world-shell/session_gate.js'
import { rebind_fight_session } from '../world-shell/character_fight_rebind.js'
import { resume_world_fight } from '../world-shell/world_fight.js'
import { get_class } from '../game/data/classes.js'
import { color_to_hue } from '../game/data/color.js'
import { set_last_character } from '../game/core/draft.js'
import { use_toast } from '../toast'
import { game_log } from '../core/log.js'
import { report_error } from '../core/report.js'

/** A character is escrowed in a dungeon (in_dungeon flag from load_roster.js) → "IN DUNGEON", else "IN LOBBY". */
function group_of(character: any): 'dungeon' | 'lobby' {
  return character.in_dungeon ? 'dungeon' : 'lobby'
}

// Dungeon.status (dungeon.move) → the i18n status key shown on an IN-DUNGEON row, so a stuck/terminal run reads
// its live state at a glance (fixes the "closed/ended dungeon still looks startable" + "stale FAILED card" traps).
const DUNGEON_STATUS_KEY = ['status_open', 'status_active', 'status_cleared', 'status_won', 'status_failed']

export function CharacterSwitcher() {
  const { t } = useTranslation()
  const characters = use_game_state((s) => s.sui.characters)
  const loaded = use_game_state((s) => s.sui.loaded)
  const selected_id = use_game_state((s) => s.selected_character_id)
  const active_dungeon_id = use_dungeon((s) => s.dungeon_id)
  const fight = use_fight_view() // synchronous core view (S2 mirror kill)

  if (!loaded) return <SkeletonRows />
  if (!characters?.length) return <div className="chsw-empty">{t('characters.switcher_none')}</div>

  const dungeon_group = characters.filter((c: any) => group_of(c) === 'dungeon')
  const lobby_group = characters.filter((c: any) => group_of(c) === 'lobby')

  const on_select = (character: any) => {
    const is_active = character.id === selected_id
    if (is_active) return // clicking the already-active char is a no-op
    const on_failure = (error: unknown) => {
      game_log('character-switch', 'active character rebind failed', error)
      report_error(error, { area: 'character-switch', action: 'select_character' })
      use_toast.getState().add(t('errors.character_switch_failed'), 'error')
    }
    if (character.in_dungeon && character.dungeon_id) {
      void use_dungeon.getState().resume_dungeon(character.dungeon_id, character.id).catch(on_failure)
      return
    }
    // Lobby: this is an ACTIVE-character switch, not a follow-mode target update. Selection alone only repaints
    // store consumers; GameWorldHost keys the live roam session from session_gate's character/world binding.
    // Re-publish that binding from rpc_to_card's indexed `world_id` so the host tears down A and mounts B.
    void handle_character_click(
      character,
      {
        select_character: (id) => context.dispatch('action/select_character', id),
        persist_character: set_last_character,
        stop_follow: () => {
          if (use_follow.getState().active) use_follow.getState().unfollow()
        },
        rebind_session: rebind_world_character,
        // FIGHT half: drop the OUTGOING character's local board (no chain tx — its Fight persists,
        // re-enterable on switch-back) and resume the INCOMING character's own live fight, so the board tracks
        // the ACTIVE character instead of whoever started it (the "forced to remain on the first char fight").
        rebind_fight: (id) =>
          rebind_fight_session(id, {
            dungeon: use_dungeon.getState(),
            reset_local: () => use_dungeon.getState().reset_local(),
            resume: resume_world_fight,
          }),
      },
      on_failure
    )
  }

  // board #47 (d) — THE TRAP ESCAPE: an address's active dungeon locks its escrowed character out of its kiosk,
  // which blocked ALL that address's characters from entering a new dungeon with no way out.
  // HP to 0 and unlocks it back to the kiosk), so the run can always be exited from ANY character. If this is the
  // The per-row ✗ abandon was removed (unrequested scope + single-exit law) — no abandon surface here.

  // Red dot: that character IS the active dungeon session's current-turn participant. Only meaningful for
  // the ONE dungeon this client is actively polling (use_dungeon.dungeon_id) — a char escrowed in a dungeon
  // this local session isn't attached to shows no dot (MVP, per spec).
  const is_their_turn = (character: any) =>
    character.in_dungeon &&
    character.dungeon_id === active_dungeon_id &&
    !!fight &&
    fight.winner === -1 &&
    fight.active_entity_id === character.id

  return (
    <div className="chsw">
      <div className="chsw-header">{t('characters.switcher_title')}</div>
      <div className="chsw-list">
        {dungeon_group.length > 0 && (
          <CharacterGroup
            label={t('characters.switcher_in_dungeon')}
            characters={dungeon_group}
            active_character_id={selected_id}
            is_their_turn={is_their_turn}
            on_select={on_select}
          />
        )}
        {lobby_group.length > 0 && (
          <CharacterGroup
            label={t('characters.switcher_in_lobby')}
            characters={lobby_group}
            active_character_id={selected_id}
            is_their_turn={is_their_turn}
            on_select={on_select}
          />
        )}
      </div>
    </div>
  )
}

function CharacterGroup({
  label,
  characters,
  active_character_id,
  is_their_turn,
  on_select,
}: {
  label: string
  characters: any[]
  active_character_id: string | null
  is_their_turn: (character: any) => boolean
  on_select: (character: any) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="chsw-group">
      <div className="chsw-group__label">{label}</div>
      {characters.map((character) => (
        <CharacterRow
          key={character.id}
          character={character}
          active={character.id === active_character_id}
          dot={is_their_turn(character)}
          exploring={!!character.exploring}
          status_label={
            character.in_dungeon ? t(`dungeons.${DUNGEON_STATUS_KEY[character.status] ?? 'status_open'}`) : null
          }
          on_click={() => on_select(character)}
        />
      ))}
    </div>
  )
}

function CharacterRow({
  character,
  active,
  dot,
  exploring,
  status_label,
  on_click,
}: {
  character: any
  active: boolean
  dot: boolean
  exploring: boolean
  status_label?: string | null
  on_click: () => void
}) {
  const { t } = useTranslation()
  const cls = get_class(character.classe ?? character.class_id)
  const level = experience_to_level(character.experience ?? 0)
  const hue = color_to_hue(character.color_1 ?? 0)
  const initial = (cls?.name ?? character.classe ?? '?').charAt(0).toUpperCase()

  const row = (
    <button
      type="button"
      className={`chsw-row${active ? ' is-active' : ''}${exploring ? ' is-exploring' : ''}`}
      onClick={on_click}
      title={character.name}
    >
      <span className="chsw-row__glyph" style={{ '--hue': hue } as React.CSSProperties}>
        {initial}
      </span>
      <span className="chsw-row__name">{character.name}</span>
      {/* EXPLORING badge (staked/idle-farming, load_roster's `exploring` flag) — distinct from a plain lobby
          row so the player never mistakes a staked char for one that's free to embody/enter a dungeon with. */}
      {exploring && (
        <Compass
          className="chsw-row__exploring"
          aria-label={t('characters.switcher_exploring')}
          title={t('characters.switcher_exploring')}
        />
      )}
      {/* live dungeon status (IN DUNGEON rows only) — surfaces a stuck/terminal run so it never looks startable. */}
      {status_label && <span className="chsw-row__status">{status_label}</span>}
      <span className="chsw-row__lvl">Lv {level}</span>
      {dot && <span className="chsw-row__dot" aria-hidden="true" />}
    </button>
  )

  // The per-row ✕ abandon is REMOVED — unrequested scope + a native title tooltip + a single-exit-law
  // violation (abandon lives ONLY in the bottom-right card). The row itself (resume click + status chip) is the
  // requested surface, nothing more.
  return row
}

function SkeletonRows() {
  return (
    <div className="chsw">
      <div className="chsw-header chsw-header--skeleton" />
      <div className="chsw-list">
        {[0, 1, 2].map((i) => (
          <div key={i} className="chsw-row chsw-row--skeleton" />
        ))}
      </div>
    </div>
  )
}
