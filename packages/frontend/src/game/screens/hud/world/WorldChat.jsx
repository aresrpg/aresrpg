// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// In-world chat (bottom-left, lowered per owner 819). Lean companion restyle of the vendored chat.
// Owner v2 (0702): channels are READ FILTERS as CHECKBOXES in the HEADER (pick-many-to-view, alongside the
// "Chat · N online" title) — every checked channel's lines interleave into ONE merged, chronological log
// (message_history is already a single append-ordered list across channels, so filtering it preserves order
// for free). Each line is tagged with its channel so the source stays legible in the merged view.
// Reuses the engine SSOT — message_history (folded by core/modules/chat.js) + send_chat_message + the CHANNEL
// enum. Combat is a client-only read-only system log (fight.js emits it locally); it's just another read-only
// checkbox, tagged + rendered green/headerless.
//
// SPEAK selector: the START of the input row carries a compact GENERAL | PARTY toggle — the ONLY
// two postable channels. COMMERCE and COMBAT stay VIEW-ONLY read filters (their lines arrive from other
// players/screens). GENERAL and PARTY both use the world's presence SSE; PARTY carries its exact party id and
// is receiver-filtered — chat.js branches broadcast_chat vs broadcast_party_chat on the selected speak channel.
// Dropped from the full vendored Chat for the roam HUD: private DMs, the social menu, slash-commands (all live
// in the full game HUD, not P2).
//
// Option B "Minimal Float": the standalone OnlinePlayers sidebar mount is gone (minimal chrome),
// so its count folds into the chat header ("CHAT · N ONLINE"). N = the courier presence roster
// (core/modules/presence.js) + 1 for self. This is the sole aggregate presence-count read.
// visible_characters is a Map mutated in place (its ref never changes) — subscribe to a stable digest
// primitive so React observes spawn/despawn notifications from the presence module.
//
// Courier chat: zkLogin-authenticated POST, then one presence-stream receive fold for local and remote lines.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { COURIER_CHAT_MAX_LENGTH } from '@aresrpg/sdk/courier'

import { use_fight, use_game_state } from '../../../store.js'
import { select_online_count } from '../../../core/presence_count.js'
import { send_chat_message } from '../../../core/chat_send.js'
import { CHANNEL } from '../../../core/modules/chat.js'
import { use_presence } from '../../../../world-shell/presence_adapter.js'
import { use_address_names } from '../../../../rpc/use_address_names'
import { AddressName } from '../../../../components/address_name'
import { open_player_menu } from './player_menu_store.js'
import { resolve_segment_text } from './combat_log_names.js'
import { chat_line_in_scope } from './world_chat_scope.js'
import { world_fight_view } from '../../../../world-shell/fight_session_scope.js'
// Self-contained styling (D207): the chat mounts OUTSIDE GameWorldHud now (the spectate overlay) — it
// carries its own css instead of riding the hud's imports. Vite dedupes; the hud path is unchanged.
import './game-world-hud.css'
import '../hud.css'

/** @typedef {{ key: string, label_key: string, channel: string }} ChannelDef */
// READ filters (header checkboxes). `tab_group`'s VALUE reads "Party" (GROUP→PARTY label rename —
// CTO owns the locale value; the internal CHANNEL.group key stays to avoid wire/store churn).
/** @type {ChannelDef[]} */
const CHANNELS = [
  { key: 'general', label_key: 'world_chat.tab_general', channel: CHANNEL.general },
  { key: 'commerce', label_key: 'world_chat.tab_commerce', channel: CHANNEL.commerce },
  { key: 'group', label_key: 'world_chat.tab_group', channel: CHANNEL.group },
  { key: 'combat', label_key: 'world_chat.tab_combat', channel: CHANNEL.combat },
]
// SPEAK selector (input-left toggle) — the ONLY two postable channels.
/** @type {ChannelDef[]} */
const SPEAK_CHANNELS = [
  { key: 'general', label_key: 'world_chat.tab_general', channel: CHANNEL.general },
  { key: 'group', label_key: 'world_chat.tab_group', channel: CHANNEL.group },
]

/** D151 — the MOUNT-TREE root of three failed fixes: the world HUD renders THIS component (not Chat.jsx),
 *  and it flattened tokenised segments to plain text. Render them as their .clog-* spans (classes live in
 *  hud.css, already imported by GameWorldHud; palette SSOT = hud.css `.hud-chat-line.is-combat` --clog-* — NOT
 *  tokens.css `:root`, which is never loaded in the app) so names/verbs/spells/numbers get
 *  the retro log hierarchy the emitters have carried all along.
 *  @param {{ segments?: { text: string, cls?: string, ref?: string }[], message?: string }} line
 *  @param {Map<string, { name?: string }> | undefined} fighters the LIVE fight slice's fighters, for `ref` resolution */
const line_body = (line, fighters) =>
  line.segments
    ? line.segments.map((s, i) => (
        <span key={i} className={s.cls}>
          {resolve_segment_text(s, fighters)}
        </span>
      ))
    : (line.message ?? '')

/** Open PlayerActionMenu anchored under a clicked/right-clicked chat name (the S-67 seam — one home). */
const open_chat_menu = (/** @type {any} */ e, /** @type {any} */ line, /** @type {any} */ t) => {
  const r = e.currentTarget.getBoundingClientRect()
  open_player_menu({
    id: line.id,
    address: line.address ?? null,
    name: line.name || t('party.adventurer'),
    x: r.left,
    y: r.bottom + 4,
  })
}

/** D207: `readonly` = the logged-out SPECTATE overlay variant — the merged log + filters render, the
 *  speak selector + input do NOT (a spectator has no character to post as).
 *  @param {{ readonly?: boolean }} [props] @returns {import('react').ReactElement} */
export function WorldChat({ readonly = false } = {}) {
  const { t } = useTranslation()
  const history = use_game_state((s) => s.message_history)
  // LIVE fighters map for combat-log name healing (resolve_segment_text) — the core view (S2 mirror kill):
  // a NEW Map only per core fold (memoized view identity), so this stays a stable read between fight ticks.
  const fighters = use_fight(world_fight_view)?.fighters
  const online_count = use_game_state(select_online_count)
  const link_status = use_presence((state) => state.link_status)
  const link_error = use_presence((state) => state.link_error)

  // Checked = visible in the merged log. All channels checked by default.
  const [enabled, set_enabled] = useState(() => new Set(CHANNELS.map((c) => c.channel)))
  // Which channel we POST on — GENERAL | PARTY only. Defaults to GENERAL.
  const [speak, set_speak] = useState(CHANNEL.general)
  const [draft, set_draft] = useState('')
  const log_ref = useRef(/** @type {HTMLDivElement | null} */ (null))
  const input_ref = useRef(/** @type {HTMLInputElement | null} */ (null))
  const root_ref = useRef(/** @type {HTMLDivElement | null} */ (null))

  // Chat rides the shared zone channel — zero fight/dungeon awareness (#306): a fighter stays a member of the
  // exact same log a roamer reads. chat_line_in_scope is always true (world_chat_scope.js); kept as an explicit
  // seam rather than inlined so the invariant stays headless-testable and greppable before anyone re-adds scoping.
  const lines = history.filter((line) => enabled.has(line.channel ?? CHANNEL.general) && chat_line_in_scope(line))
  // D52 — one batched /v1/names round trip for the visible log; only feeds authors with no known
  // character name (line.name), so an active chatter's chosen name never changes.
  const author_names = use_address_names(lines.map((l) => l.address))

  // autoscroll to the newest line (also when the checkbox filter changes the visible set)
  useEffect(() => {
    const el = log_ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length, enabled])

  // FOCUS LIFECYCLE (S-84 P0): the chat must never trap the keyboard. Enter (while NOT already in a text field)
  // OPENS the chat focused — the MMO convention; embed_voxel_player's D154 gate then correctly makes keys TYPE,
  // not walk. Control returns to the world via submit()'s blur (Enter), Escape (input onKeyDown), or a click
  // outside the panel (below). readonly = the logged-out spectate overlay has no input to focus.
  useEffect(() => {
    if (readonly) return undefined
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      if (e.key !== 'Enter') return
      const el = document.activeElement
      if (
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || /** @type {HTMLElement} */ (el).isContentEditable)
      )
        return // already typing (chat itself, or a modal input) — never hijack Enter
      const input = input_ref.current
      if (!input) return
      e.preventDefault()
      input.focus()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [readonly])

  // Clicking the world (or anywhere outside the chat panel) blurs the input → keyboard control returns to the
  // game. A bare <canvas> is not focusable, so a click on it does NOT blur the input natively — this is the fix.
  useEffect(() => {
    if (readonly) return undefined
    const on_pointer_down = (/** @type {PointerEvent} */ e) => {
      const input = input_ref.current
      if (!input || document.activeElement !== input) return
      if (root_ref.current?.contains(/** @type {Node} */ (e.target))) return // clicks inside chat keep focus
      input.blur()
    }
    window.addEventListener('pointerdown', on_pointer_down)
    return () => window.removeEventListener('pointerdown', on_pointer_down)
  }, [readonly])

  const toggle_channel = (/** @type {string} */ channel) =>
    set_enabled((prev) => {
      const next = new Set(prev)
      if (next.has(channel)) next.delete(channel)
      else next.add(channel)
      return next
    })

  const submit = (/** @type {import('react').FormEvent} */ event) => {
    event.preventDefault()
    const message = draft.trim()
    if (message) {
      set_draft('')
      send_chat_message(message, speak)
    }
    // P0 focus-trap fix (S-84): Enter ALWAYS hands keyboard control back to the world — after a send OR on an
    // empty Enter. Without this the input kept focus and embed_voxel_player's D154 gate ate every WASD key
    // (the naive player's movement "died" until reload). Blur === movement works again immediately.
    input_ref.current?.blur()
  }

  return (
    <div className="gw-chat gw-panel" ref={root_ref}>
      <div className="gw-chat__hdr">
        <span className="gw-chat__title">
          {t('world_chat.header')} · <b>{online_count}</b> {t('world_chat.online')} ·{' '}
          <span
            className={`gw-chat__link gw-chat__link--${link_status}`}
            role="status"
            title={link_error ?? undefined}
          >
            {/* A dead presence link says WHY on the chip itself — an outage the player can read beats a
                three-word status with the reason buried in a tooltip (docs/REALTIME.md, #1641). */}
            {link_status === 'failed' && link_error
              ? t('world_chat.link_failed_reason', { reason: link_error })
              : t(`world_chat.link_${link_status}`)}
          </span>
        </span>
        <div className="gw-chat__channels">
          {CHANNELS.map((c) => (
            <label key={c.key} className="gw-chat__check" title={t(c.label_key)}>
              <input
                type="checkbox"
                checked={enabled.has(c.channel)}
                onChange={() => toggle_channel(c.channel)}
                aria-label={t(c.label_key)}
              />
              <span className="gw-chat__box" />
              <span className="gw-chat__check-label">{t(c.label_key)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="gw-chat__log" ref={log_ref}>
        {lines.map((line, i) => {
          const chan = CHANNELS.find((c) => c.channel === (line.channel ?? CHANNEL.general)) ?? CHANNELS[0]
          const combat = chan.channel === CHANNEL.combat
          const system = combat || (!line.name && !line.from_me)
          if (system)
            return (
              // D151: combat lines reuse the D127 dressing (green gradient wash + accent bar + token spans)
              // that hud.css already ships — it was only ever mounted in the retired Chat.jsx tree.
              <div key={`${line.id}-${i}`} className={`gw-chat__sys${combat ? ' hud-chat-line is-combat' : ''}`}>
                <span className="gw-chat__tag">{t(chan.label_key)}</span>
                {line_body(line, fighters)}
              </div>
            )
          return (
            <div key={`${line.id}-${i}`} className="gw-chat__line">
              <span className="gw-chat__tag">{t(chan.label_key)}</span>
              {line.from_me ? (
                <span className="gw-chat__name me">{t('world_chat.you')}</span>
              ) : (
                // S-67: another player's name is a click target — opens PlayerActionMenu (add friend / invite).
                // The courier row already carries the wallet verified by its signed ingress.
                <button
                  type="button"
                  className="gw-chat__name gw-chat__name--btn"
                  onClick={(e) => open_chat_menu(e, line, t)}
                  onContextMenu={(e) => {
                    e.preventDefault() // right-click opens the menu deliberately, not the browser's
                    open_chat_menu(e, line, t)
                  }}
                >
                  {line.name || (
                    <AddressName
                      address={line.address}
                      name={author_names[line.address]}
                      fallback={t('party.adventurer')}
                    />
                  )}
                </button>
              )}
              {': '}
              {line_body(line, fighters)}
            </div>
          )
        })}
      </div>

      {readonly ? null : (
        <form className="gw-chat__form" onSubmit={submit}>
          <div className="gw-chat__speak" role="group">
            {SPEAK_CHANNELS.map((c) => (
              <button
                type="button"
                key={c.key}
                className={`gw-chat__speak-opt${speak === c.channel ? ' active' : ''}`}
                onClick={() => set_speak(c.channel)}
                aria-pressed={speak === c.channel}
                title={t(c.label_key)}
              >
                {t(c.label_key)}
              </button>
            ))}
          </div>
          <input
            ref={input_ref}
            className="gw-chat__input"
            value={draft}
            onChange={(e) => set_draft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') input_ref.current?.blur() // Escape → back to the world (submit handles Enter)
            }}
            maxLength={COURIER_CHAT_MAX_LENGTH}
            placeholder={t('world_chat.type_message')}
          />
        </form>
      )}
    </div>
  )
}
