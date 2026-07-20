// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PRESENCE panel (S-67 rework) — the top-left world-HUD panel, formerly the party-invite roster. Now it is
// the FRIENDS-first presence surface that replaced the retired /friends page:
//   COLLAPSED → FRIENDS + the online friends' rows (dot / name / Lv)
//   EXPANDED  → adds the OFFLINE friends + an ADD FRIEND bar (paste a 0x address; the primary add UX is
//               clicking a player in the world or a name in chat → PlayerActionMenu)
//
// DATA (all honest, no fakes): the friend list = read_roster (chain-direct FriendList + /v1 enrichment,
// use_rpc_view short-poll + focus-heal per the UI-DATA LAW). ONLINE status = the P2P LOBBY:
// a friend is "online" iff their wallet is in my live peer set — get_peer_state_by_address), NOT the RPC's
// last-position freshness. Names = friend_display_name below: the peer's self-declared p2p name (D222), else
// the indexer character name, else character_name_resolve.js's ONE HOME fallback — never a raw address slice.
//
// The per-row "invite to party" that used to live here moved to PlayerActionMenu (clicking the player) so the
// panel stays friends-first without dropping the feature. Removing a friend is the hover-× on each row.

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'

import { use_game_state } from '../../../store.js'
import { get_peer_state_by_address } from '../../../../p2p/lobby-room.js'
import { use_auth } from '../../../../auth'
import { use_rpc_view } from '../../../../rpc/use_view'
import { friend_display_name } from '../../../../world-shell/friends_display.js'
import { read_roster } from '../../../../world-shell/friends_reads'
import { add_friend_flow, remove_friend_flow, on_friends_changed } from '../../../../world-shell/friends_actions'
import { ConfirmDialog } from './ConfirmDialog.jsx'
import { open_player_menu } from './player_menu_store.js'

/** Re-render when the peer roster identity changes so per-friend p2p dots stay live without deriving the
 *  aggregate online count owned by WorldChat. Self-heals further on the 8 s roster poll + focus. */
const roster_signal = (/** @type {import('../../../core/game.js').State} */ s) =>
  [...s.visible_characters.keys()].sort().join('|')

/** @returns {import('react').ReactElement | null} */
export function OnlinePlayers() {
  const { t } = useTranslation()
  use_game_state(roster_signal)
  const address = use_auth((s) => s.address)
  const [expanded, set_expanded] = useState(false)
  const [input, set_input] = useState('')
  // The friend a remove-× is asking to drop (address + its already-resolved display name, so the confirm copy
  // names them instead of repeating the raw-address-slice bug one dialog away) — drives the house ConfirmDialog
  // (NEVER a native window.confirm — house dialog law). null = closed; confirm runs the remove flow for it.
  const [pending_remove, set_pending_remove] = useState(/** @type {{ address: string, name: string } | null} */ (null))

  // Friend list (chain-direct) + per-friend /v1 enrichment — one atomic poll, lags OK, self-heals on focus.
  const view = use_rpc_view(
    /** @returns {Promise<{ list_id: string | null, rows: any[] }>} */ (signal) => read_roster(address, signal),
    { deps: [address], enabled: !!address, interval_ms: 8000 }
  )
  const list_id = view.data?.list_id ?? null
  const rows = view.data?.rows ?? []

  // Refetch the instant an add/remove lands from ANY surface (this bar, the world click, the chat click).
  useEffect(() => on_friends_changed(() => view.refetch()), [view])

  // ONLINE = present in my p2p lobby peer set. name = friend_display_name's ONE derivation, always
  // a truthy display string — never empty, never a raw address needing a per-row fallback below.
  const decorated = rows.map((r) => {
    const peer = get_peer_state_by_address(r.address)
    return { ...r, online: !!peer, name: friend_display_name(r, peer) }
  })
  const online = decorated.filter((r) => r.online)
  const offline = decorated.filter((r) => !r.online)

  const on_add = async () => {
    const v = input.trim()
    if (!v) return
    set_input('')
    await add_friend_flow(address, v)
  }
  const on_remove = (/** @type {string} */ addr, /** @type {string} */ name) => {
    if (!list_id) return
    set_pending_remove({ address: addr, name })
  }
  const confirm_remove = () => {
    if (list_id && pending_remove) remove_friend_flow(list_id, pending_remove.address)
    set_pending_remove(null)
  }

  return (
    <div className="gw-players gw-players--float gw-panel">
      <button
        type="button"
        className="gw-players__h gw-players__h--btn"
        onClick={() => set_expanded((e) => !e)}
        aria-expanded={expanded}
        title={expanded ? t('presence.collapse') : t('presence.expand')}
      >
        <span className="gw-players__stat">{t('presence.friends')}</span>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      <div className="gw-players__list">
        {online.map((r) => (
          <FriendRow key={r.address} row={r} t={t} on_remove={on_remove} />
        ))}
        {online.length === 0 && <div className="gw-players__empty">{t('presence.no_online_friends')}</div>}
        {expanded && offline.length > 0 && <div className="gw-players__group">{t('friends.offline')}</div>}
        {expanded && offline.map((r) => <FriendRow key={r.address} row={r} t={t} on_remove={on_remove} />)}
      </div>

      {expanded && (
        <div className="gw-players__add" title={t('presence.add_hint')}>
          <input
            className="gw-players__input"
            placeholder={t('friends.add_placeholder')}
            value={input}
            onChange={(e) => set_input(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && on_add()}
          />
          <button
            type="button"
            className="gw-players__addbtn"
            onClick={on_add}
            disabled={!input.trim()}
            title={t('friends.add_cta')}
          >
            <Plus size={12} />
          </button>
        </div>
      )}

      <ConfirmDialog
        open={!!pending_remove}
        title={t('friends.remove')}
        message={pending_remove ? t('friends.remove_confirm', { addr: pending_remove.name }) : ''}
        confirm_label={t('friends.remove')}
        cancel_label={t('common.cancel')}
        danger
        on_confirm={confirm_remove}
        on_cancel={() => set_pending_remove(null)}
      />
    </div>
  )
}

/** @param {{ row: any, t: (k: string, o?: any) => string, on_remove: (addr: string, name: string) => void }} props */
function FriendRow({ row, t, on_remove }) {
  // Right-click a friend row → PlayerActionMenu (add friend / invite / fast travel). Friend rows carry only an
  // address (no character id) — the fast-travel resolver reads that address's /v1 character to find world+position.
  const open_menu = (/** @type {any} */ e) => {
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    open_player_menu({ id: null, address: row.address, name: row.name, x: r.left, y: r.bottom + 4 })
  }
  return (
    <div className={`gw-prow gw-prow--friend${row.online ? '' : ' off'}`} onContextMenu={open_menu}>
      <span className={`gw-prow__dot${row.online ? '' : ' off'}`} />
      <span className="gw-prow__name">{row.name}</span>
      {row.level != null && <span className="gw-prow__lvl">Lv {row.level}</span>}
      <button
        type="button"
        className="gw-prow__rm"
        title={t('friends.remove')}
        onClick={() => on_remove(row.address, row.name)}
      >
        <X size={11} />
      </button>
    </div>
  )
}
