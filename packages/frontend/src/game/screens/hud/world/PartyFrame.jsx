// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Party frame — the roster is an exact character-keyed Member[] (maximum six). Every display read resolves
// `member.character` directly through `/v1/characters?ids=`, so a wallet's sibling characters can never stand in
// for the character that actually joined.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { projected_hp, character_max_hp } from '../../../../chain/read_character.js'
import { v1_character_to_party_row } from '../../../../chain/read_staking.js'

import './game-world-hud.css'
import { context, use_game_state } from '../../../store.js'
import { project_party_view } from '@aresrpg/party/reduce'

import { use_party } from '../../../../world-shell/party_store.js'
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import { world_fight_session } from '../../../../world-shell/fight_session_scope.js'
import { get_characters } from '../../../../rpc/client'
import { game_log } from '../../../../core/log.js'
import { open_player_menu } from './player_menu_store.js'
import { get_group_follow_snapshot, subscribe_group_follow } from '../../../../world-shell/group_wiring.js'

const MAX_ROWS = 6

/** @type {Map<string, { name: string, level: number | null, health: number | null, max_health: number | null } | null>}
 * exact Character ID -> last-resolved roster row. */
const member_cache = new Map()

/** @param {number} health @param {number} max_health */
const hp_pct = (health, max_health) => {
  if (typeof health !== 'number' || typeof max_health !== 'number' || max_health <= 0) return 100
  return Math.max(0, Math.min(100, (health / max_health) * 100))
}

const transit_time = (remaining_ms) => {
  const seconds = Math.max(0, Math.ceil(Number(remaining_ms ?? 0) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

const transit_progress = (row) => {
  if (row?.status !== 'in_transit') return 0
  return Math.max(0, Math.min(100, Number(row.progress ?? 0) * 100))
}

// #613 — only the ARRIVING legs carry a timer copy. with_you (arrived) and blocked are distinct row states
// rendered inline below, never a "still arriving" label frozen at 00:00.
const transit_status = (t, status) =>
  status === 'joining' ? t('party.follow_joining') : t('party.follow_in_transit')

/** Resolve one exact party character; never query every character owned by its wallet. */
async function resolve_member(/** @type {string} */ character_id) {
  try {
    const [character] = await get_characters({ id: character_id })
    if (!character) return null
    const party_character = v1_character_to_party_row(character)
    return {
      name: String(character.name ?? ''),
      level: character.level,
      health: party_character.hp_known ? projected_hp(party_character, Date.now()) : null,
      max_health: party_character.hp_known ? character_max_hp(party_character) : null,
    }
  } catch (error) {
    game_log('party-frame', 'resolve_member failed', character_id, error)
    return null
  }
}

/** @returns {import('react').ReactElement | null} */
export function PartyFrame() {
  const { t } = useTranslation()
  // The ONE renderer-agnostic party view — the same projection the CLI bot consumes (project_party_view). Members and
  // the invite ride stable refs across identical frames, so a shallow compare keeps this from re-rendering on polls.
  const { members, leader_character, is_solo, incoming_dungeon_id, incoming_template_id, incoming_invite: pending_invite } =
    use_party(useShallow(project_party_view))
  const leave = use_party((state) => state.leave)
  const clear_incoming_dungeon = use_party((state) => state.clear_incoming_dungeon)
  const join_shared_dungeon = use_dungeon((state) => state.join_shared_dungeon)
  const dungeon_busy = use_dungeon((state) => state.busy)
  const my_dungeon_id = use_dungeon((state) =>
    state.in_session || world_fight_session(state) ? state.dungeon_id : null
  )
  const selected_character_id = use_game_state((state) => state.selected_character_id)
  const my_char_name = use_game_state(
    (state) => state.sui?.characters?.find((character) => character.id === state.selected_character_id)?.name
  )

  const [, force_tick] = useState(0)
  useEffect(() => {
    if (!members.length) return
    let cancelled = false
    for (const member of members) {
      const character_id = member.character
      if (member_cache.has(character_id)) continue
      member_cache.set(character_id, null)
      resolve_member(character_id).then((row) => {
        if (cancelled) return
        member_cache.set(character_id, row)
        force_tick((tick) => tick + 1)
      })
    }
    return () => {
      cancelled = true
    }
  }, [members.map((member) => member.character).join(',')])

  const incoming_invite = pending_invite?.invited_character_id === selected_character_id ? pending_invite : null
  const accept_invite = use_party((state) => state.accept_invite)
  const decline_invite = use_party((state) => state.decline_invite)
  const party_busy = use_party((state) => state.busy)
  const invite_owned = use_party((state) => state.invite_owned)
  const roster = use_game_state((state) => state.sui?.characters)
  const follow = useSyncExternalStore(
    subscribe_group_follow,
    get_group_follow_snapshot,
    get_group_follow_snapshot
  )

  // GROUP MEMBERSHIP IS AUTO-FOLLOW (#613 DESIGN COLLAPSE): inviting an owned character to the group IS the
  // enable act — no separate follow toggle. The group loop reconciles the follower set to membership on the
  // resulting party resync and auto-aligns / seats them; kicking from the group is the only disable.
  const invite = (character_id) => void invite_owned([character_id])

  // MULTICHAR picker: the wallet's OTHER characters, invitable one exact pick at a time —
  // the group loop then auto-aligns worlds, follows, and seats them. Capacity honors the six-slot chain cap.
  const member_ids = new Set(members.map((member) => member.character))
  const owned_alts = (roster ?? []).filter(
    (character) => character?.id && character.id !== selected_character_id && !member_ids.has(character.id)
  )
  const capacity_left = Math.max(0, MAX_ROWS - Math.max(members.length, 1))
  const picker_card =
    owned_alts.length > 0 && capacity_left > 0 && selected_character_id ? (
      <div className="gw-party gw-panel">
        <div className="gw-party__h">{t('party.owned_picker_title')}</div>
        {owned_alts.slice(0, capacity_left).map((character) => (
          <div key={character.id} className="gw-party__row">
            <div className="gw-party__top">
              <span className="gw-party__name">{character.name || t('party.adventurer')}</span>
              <button
                type="button"
                className="gw-party__lvl"
                style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
                onClick={() => invite(character.id)}
                disabled={party_busy}
              >
                {t('party.invite_owned_cta')}
              </button>
            </div>
          </div>
        ))}
      </div>
    ) : null
  const invite_card = incoming_invite ? (
    <div className="gw-party gw-panel">
      <div className="gw-party__h">
        {t('party.incoming_invite', { name: incoming_invite.from_name || t('party.adventurer') })}
      </div>
      <div className="gw-party__row" style={{ display: 'flex', gap: 12 }}>
        <button
          type="button"
          className="gw-party__name"
          style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
          onClick={accept_invite}
          disabled={party_busy}
        >
          {t('party.accept_cta')}
        </button>
        <button
          type="button"
          className="gw-party__lvl"
          style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
          onClick={decline_invite}
          disabled={party_busy}
        >
          {t('party.decline_cta')}
        </button>
      </div>
    </div>
  ) : null

  if (is_solo)
    return (
      <>
        {invite_card}
        {picker_card}
      </>
    )

  const visible_members = members.slice(0, MAX_ROWS)

  return (
    <>
      {invite_card}
      {picker_card}
      <div className="gw-party gw-panel">
        <div className="gw-party__h">{t('party.title')}</div>
        {visible_members.map((member) => {
          const character_id = member.character
          const row = member_cache.get(character_id)
          const is_leader = character_id === leader_character
          const transit = follow.followers[character_id] ?? null
          const arriving = transit?.status === 'joining' || transit?.status === 'in_transit'
          const self_name = character_id === selected_character_id ? my_char_name : null
          const name = self_name || row?.name || member.name || t('party.adventurer')
          const open_member_menu = (/** @type {any} */ e) => {
            if (character_id === selected_character_id) return // never target my own character (B10)
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            open_player_menu({
              id: character_id,
              address: member.owner ?? null,
              name,
              x: r.left,
              y: r.bottom + 4,
            })
          }
          return (
            <div
              key={character_id}
              className={`gw-party__row${is_leader ? ' leader' : ''}`}
              onContextMenu={open_member_menu}
            >
              {/* #613 — three-column grid (name · fixed LV · status) so levels align whether or not a row shows
                  a follow status. Group membership IS auto-follow now: the row shows STATUS ONLY, never a control. */}
              <div className="gw-party__top">
                <span className="gw-party__name">{name}</span>
                <span className="gw-party__lvl">
                  {row?.level != null ? t('party.level_chip', { level: row.level }) : ''}
                </span>
                <span className="gw-party__status">
                  {transit?.status === 'with_you' ? (
                    <span className="gw-party__with-you">{t('party.follow_with_you')}</span>
                  ) : null}
                </span>
              </div>
              {row?.health != null && row?.max_health != null && (
                <div className="gw-party__bar">
                  <span className="gw-party__bar-fill" style={{ width: `${hp_pct(row.health, row.max_health)}%` }} />
                </div>
              )}
              {/* the status idiom: ARRIVING timer → with_you (in the grid above) → blocked. A `resolving`
                  same-world read shows nothing (no "joining world" flash for a follower already beside you). */}
              {transit?.status === 'blocked' ? (
                <div className="gw-party__blocked">
                  <span>{t('party.follow_blocked_fight_result', { name })}</span>
                  <button
                    type="button"
                    className="gw-party__blocked-open"
                    onClick={() => context.dispatch('action/select_character', character_id)}
                  >
                    {t('party.follow_open_result_cta')}
                  </button>
                </div>
              ) : arriving ? (
                <div className="gw-party__transit">
                  <div className="gw-party__transit-copy">
                    <span>
                      {transit_status(t, transit.status)}
                      {follow.dungeon_background && transit.status === 'in_transit'
                        ? ` · ${t('party.follow_background')}`
                        : ''}
                    </span>
                    <span>{transit.status === 'joining' ? '--:--' : transit_time(transit.remaining_ms)}</span>
                  </div>
                  <div className="gw-party__transit-bar">
                    <span style={{ width: `${transit_progress(transit)}%` }} />
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
        {incoming_dungeon_id && !my_dungeon_id && (
          <div className="gw-party__row">
            <button
              type="button"
              className="gw-party__name"
              style={{ background: 'none', border: 0, cursor: 'pointer', textAlign: 'left', padding: 0 }}
              disabled={dungeon_busy || !selected_character_id}
              onClick={() => {
                join_shared_dungeon(incoming_dungeon_id, incoming_template_id, selected_character_id)
                clear_incoming_dungeon()
              }}
            >
              {t('party.join_dungeon_cta')}
            </button>
          </div>
        )}
        <div className="gw-party__row">
          <button
            type="button"
            className="gw-party__lvl"
            style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
            onClick={leave}
          >
            {t('party.leave_cta')}
          </button>
        </div>
      </div>
    </>
  )
}
