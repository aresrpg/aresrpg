// S-67 — the floating "player actions" menu. Renders ONCE (mounted by GameWorldHud); shows only when a seam
// (chat name click / in-world nameplate click) has set a target in player_menu_store. Actions: Add Friend
// + Invite to Party (SPEC §13 "invite by clicking a player" — the party-invite that
// used to live per-row in the online panel, relocated here so the panel is friends-first and no feature dies).
// Every write funnels through the SAME tx flows every other surface uses (add_friend_flow · party_store) — no
// new tx path, no roster state held here.

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { use_auth } from '../../../../auth'
import { use_party } from '../../../../world-shell/party_store.js'
import { add_friend_flow } from '../../../../world-shell/friends_actions'
import { get_peer_state } from '../../../../p2p/lobby-room.js'
import { use_game_state } from '../../../store.js'
import { ft_dispatch } from '../../../../world-shell/fast_travel_store.js'

import { use_player_menu } from './player_menu_store.js'

const MENU_W = 190
const MENU_H = 142 // name header + 3 rows (Add Friend · Invite · Fast travel)

/** @returns {import('react').ReactElement | null} */
export function PlayerActionMenu() {
  const { t } = useTranslation()
  const target = use_player_menu((s) => s.target)
  const close = use_player_menu((s) => s.close)
  const my_address = use_auth((s) => s.address)
  const party_busy = use_party((s) => s.busy)
  const party = use_party((s) => s.party)
  const selected_character_id = use_game_state((s) => s.selected_character_id)

  // Esc closes (bound only while open).
  useEffect(() => {
    if (!target) return
    const on_key = (/** @type {KeyboardEvent} */ e) => e.key === 'Escape' && close()
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [target, close])

  if (!target) return null

  // Chat carries only the character id; the nameplate carries the address directly. Resolve the wallet live
  // from the peer's self-declared p2p state (the SAME D222 identity home every surface reads) when absent.
  const address = target.address || get_peer_state(target.id ?? '')?.address || null
  const can_act = !!address && !!my_address
  const can_invite =
    can_act && !!target.id && (!party || (!!selected_character_id && party.leader_character === selected_character_id))
  // Fast travel (the third menu option): needs MY selected character to ride, a resolvable target (character id
  // OR owner address), and never my OWN character on another seat (address === my_address hides it — B10).
  const is_self = !!address && !!my_address && address === my_address
  const can_fast_travel = !!selected_character_id && !is_self && (!!target.id || !!address)

  const on_add = () => {
    close()
    if (can_act) add_friend_flow(my_address, address)
  }
  const on_invite = async () => {
    close()
    if (!can_invite || party_busy) return
    // Cold start: no party yet → create one first, then invite, so a single click works (mirrors the old panel).
    if (!use_party.getState().party_id) await use_party.getState().create()
    await use_party.getState().invite(target.id, address)
  }
  const on_fast_travel = () => {
    close()
    if (!can_fast_travel) return
    // Fire the ONE fast-travel intent — the store's reducer + effect edges own the routing/join/flight.
    ft_dispatch({ type: 'begin', character_id: target.id ?? null, address, name: target.name })
  }

  // Clamp on-screen (the anchor can sit near the right/bottom edge — a nameplate at the viewport border).
  const left = Math.max(8, Math.min(target.x, window.innerWidth - MENU_W - 8))
  const top = Math.max(8, Math.min(target.y, window.innerHeight - MENU_H - 8))

  return createPortal(
    <>
      <div className="gw-pmenu__backdrop" onPointerDown={close} />
      <div className="gw-pmenu" style={{ left, top }} role="menu">
        <div className="gw-pmenu__name" title={address ?? undefined}>
          {target.name}
        </div>
        <button type="button" className="gw-pmenu__act" role="menuitem" disabled={!can_act} onClick={on_add}>
          {t('friends.add_cta')}
        </button>
        <button
          type="button"
          className="gw-pmenu__act"
          role="menuitem"
          disabled={!can_invite || party_busy}
          onClick={on_invite}
        >
          {t('party.invite_cta')}
        </button>
        <button
          type="button"
          className="gw-pmenu__act"
          role="menuitem"
          disabled={!can_fast_travel}
          onClick={on_fast_travel}
        >
          {t('fast_travel.option')}
        </button>
      </div>
    </>,
    document.body
  )
}
