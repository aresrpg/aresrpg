// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-67 — the floating "player actions" menu. Renders ONCE (mounted by GameWorldHud); shows only when a seam
// (friend row / chat name / in-world nameplate click) has set a target in player_menu_store. Actions: Add Friend
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
import { presence_characters_by_address } from '../../../../world-shell/presence_adapter.js'
import { get_characters } from '../../../../rpc/client'
import { useRpcView } from '../../../../rpc/use_view'
import { useGameState } from '../../../store.js'
import { ft_dispatch } from '../../../../world-shell/fast_travel_store.js'
import { dispatch_fast_travel } from '../../../../world-shell/fast_travel_intent.js'
import { ft_dragon_glb_url, preload_mount_glb } from '../../../mount_rig.js'
import { start_invite_timing } from '../../../../core/invite_timing.js'

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
  const selected_character_id = useGameState((s) => s.selected_character_id)

  // Esc closes (bound only while open).
  useEffect(() => {
    if (!target) return
    const on_key = (/** @type {KeyboardEvent} */ e) => e.key === 'Escape' && close()
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [target, close])

  // AUTHORITY AT THE DOOR (realtime constitution D2). Every seam that opens this menu hands over a CHARACTER
  // ID — an identifier, not a claim about who owns it. The wallet each signed action is composed against is
  // read HERE from the authoritative /v1 character book (the same `get_characters` the roster and the travel
  // resolver use), so no observation can put an address in front of a transaction. The lone exception carries
  // no character id at all: a friend row's key IS a wallet, read from my own on-chain friend list.
  // Hoisted above the early return (below) so BOTH the render and the preload effect share one derivation.
  const { data: target_docs } = useRpcView(
    (signal) => (target?.id ? get_characters({ id: target.id }, signal) : Promise.resolve([])),
    { enabled: !!target?.id, deps: [target?.id], interval_ms: 15_000 }
  )
  // The document must be about THIS character: useRpcView keeps its last-good data across a query change
  // (its no-silent-stale contract), so switching targets briefly leaves the PREVIOUS player's document in
  // hand. An answer about someone else is not an answer — it reads as unresolved until this one lands.
  const target_doc = target_docs?.[0]
  const address = (target?.id ? (target_doc?.id === target.id ? target_doc.owner : null) : target?.owner_address) ?? null
  // Fast travel (the third menu option): needs MY selected character to ride, an authoritatively-owned target,
  // and never my OWN character on another seat (address === my_address hides it — B10).
  const is_self = !!address && !!my_address && address === my_address
  const can_fast_travel = !!target && !!selected_character_id && !!address && !is_self

  // PRELOAD AT WORLD-HUD BOOT + TRAVEL INTENT: this component is always mounted by GameWorldHud, so `!target`
  // starts the small (~1.15 MB) default dragon before any remote/local ride can spawn. Opening a valid travel
  // target retries (or joins) that same canonical cache key. The route effect independently waits for resolution
  // before it can enter `flying`, so this is early work, never a hidden confirm-time fetch.
  useEffect(() => {
    if (!target || can_fast_travel) void preload_mount_glb(ft_dragon_glb_url())
  }, [target, can_fast_travel])

  if (!target) return null

  const can_act = !!address && !!my_address
  const can_invite =
    can_act && !!target.id && (!party || (!!selected_character_id && party.leader_character === selected_character_id))

  const on_add = () => {
    close()
    // The friend-action door catches lookup/transaction failures and owns their humanized toast.
    if (can_act) void add_friend_flow(my_address, address)
  }
  const on_invite = async () => {
    close()
    if (!can_invite || party_busy) return
    // #2159 — the press is stage one of the invite trace; it closes when the inviter's UI says "invited". The
    // cold-start create below is deliberately INSIDE the span: a first invite really does pay two transactions.
    start_invite_timing(target.id)
    // Cold start: no party yet → create a BARE one first, then invite, so a single click works (mirrors the old
    // panel). #329: create() (not create_bare()) used to sit here and unconditionally swept every one of MY
    // OWN owned alt characters into the party as real, accepted on-chain members — inviting one specific other
    // player never means "also enroll my siblings"; that stays the explicit picker's job (invite_owned).
    if (!use_party.getState().party_id) await use_party.getState().create_bare()
    // The menu already carries the resolved display name (its own header renders target.name) — thread it
    // through so the invite toast shows the NAME, never a truncated address (#328).
    await use_party.getState().invite(target.id, address, target.name)
  }
  const on_fast_travel = () => {
    close()
    if (!can_fast_travel) return
    // Friend + in-world targets share this shaping seam and the ONE reducer door. Everything after the input —
    // route gates, cross-world join, dragon flight, and notices — remains owned by the existing travel pipeline.
    // The peer sample is ADVISORY: the shaping seam only lets it refine a landing coordinate for a character
    // the authoritative roster read already named, so the stream's own health decides nothing here.
    const observed_peers = target.kind === 'friend' ? presence_characters_by_address(address) : []
    // The store is keyed by traveler (tranche F): a manual fast-travel flies the character I'm driving.
    dispatch_fast_travel({ ...target, address }, (input) => ft_dispatch({ ...input, traveler_id: selected_character_id }), observed_peers)
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
