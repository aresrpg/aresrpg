// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One populated spell socket — split out of DeckCluster.jsx (senshi spell-bar icons
// stuck on the fallback blob after a class switch, only clearing on a full page refresh) so its icon-load
// lifecycle is unit-testable without dragging in DeckCluster's heavy game-store import graph (game/store.js
// → core/game.js → … → auth/index.ts's module-scope registerEnokiWallets, which throws under a window-less
// bun:test) — the same reason deck-key-arm.js / deck-crit-glow.js were split out of this file earlier.
// DeckCluster.jsx is this component's ONLY consumer; behavior is otherwise unchanged by the move.

import { spell_icon_url } from '@aresrpg/sdk/jobs'

import { hover_spell } from '../../core/modules/fight.js'
import { use_image_retry } from './image_retry.js'
import { Tooltip } from './Tooltip.jsx'

/**
 * One populated spell socket — a carved tile holding an element-tinted icon-gem (the spell's initial). Picks
 * (arms) its spell on click; the picked socket holds a gold ring while you aim at a target cell. HOVERING the
 * socket drives the single hover card via the `hover_spell` store write.
 * `enabled:false` only dims + gates the click (see DeckCluster's file header) — the hover preview stays live
 * on a greyed socket.
 * `glow` = the §7 turn-seed crit preview (casting this NEXT crits): gold socket glow — the socket itself
 * carries no badge/number, the detail card carries the crit odds.
 * `cd_left` (FIX 4, 07-14) = turns still on cooldown (0 = not on cooldown) — same disabled treatment as an
 * AP-unaffordable slot, plus a small turns-remaining number in the socket's free top-right corner (the
 * keyCap owns top-left, the AP cost owns bottom-right). `exhausted` = the casts-per-turn cap is already spent
 * this turn (no cross-turn cooldown, so no number — same disabled treatment).
 * @param {{ keyCap: string | null, card: any, color: string, spell_id: string, armed: boolean,
 *   enabled: boolean, glow: boolean, cd_left: number, exhausted: boolean, onPick: () => void,
 *   tip?: import('react').ReactNode, hovered?: boolean }} props
 */
export function SpellSocket({
  keyCap,
  card,
  color,
  spell_id,
  armed,
  enabled,
  glow,
  cd_left,
  exhausted,
  onPick,
  tip = null,
  hovered = false,
}) {
  // REAL spell art (wire the real spell icons — no stub bubbles): the canonical asset is
  // spell_icon_url(icon) → the Walrus `spell` quilt /spells/<icon>.png (curl-verified 200; the SAME
  // resolver SpellDetail ships). Load lifecycle rides the shared retry ladder (image_retry.js, design ruling
  // 2026-07-17: pictures must not go missing until refresh): a cold-edge quilt-patch miss self-heals with a bounded backoff
  // instead of PINNING the element-tinted-initial fallback for this socket's whole mount life. A class
  // switch mounts a BURST of fresh sockets at once (new spell name_keys → new React keys — see
  // DeckCluster's key={spell_id}), which is exactly the "concurrent burst" trigger image_retry.js's own
  // header names; this used to be a private useState(false) latch — the same pin-forever bug already fixed
  // for SpellArt/ItemIcon but never ported here, so a senshi switch racing a cold edge stuck on the
  // fallback until a full page refresh (fresh mount, warm edge).
  const resolved = spell_icon_url(card.icon ?? spell_id)
  const { url: art_url, attempt, on_failed_attempt } = use_image_retry(resolved ? [resolved] : [])
  return (
    <Tooltip placement="top" content={tip} className="tt-card--spell" visible={hovered}>
      {/* HOVER is projected through the fight core's one input door for the socket-anchored card. */}
      <button
        type="button"
        data-spell-id={spell_id}
        className={`hud-socket${armed ? ' armed' : ''}${enabled ? '' : ' disabled'}${glow ? ' crit-glow' : ''}`}
        style={/** @type {import('react').CSSProperties} */ ({ '--el': color })}
        aria-disabled={!enabled}
        aria-label={card.name}
        onClick={onPick}
        // pointer (not mouse) enter/leave: fires for mouse AND pen/touch, and — with the socket never natively
        // `disabled` (file header) — stays live on greyed sockets, so off-turn spells are still readable (D299a).
        onPointerEnter={() => hover_spell(spell_id)}
        onPointerLeave={() => hover_spell(null)}
        // never hold DOM focus — see WeaponSocket in DeckCluster.jsx (the numkey blue-ring fix).
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
      >
        {keyCap && (
          <span className="hud-socket__key hud-num" aria-hidden="true">
            {keyCap}
          </span>
        )}
        <span className="hud-socket__gem" aria-hidden="true">
          <span className="hud-socket__gem-shine" />
          {art_url ? (
            <img
              key={`${art_url}#${attempt}`}
              className="hud-socket__gem-art"
              src={art_url}
              alt=""
              draggable={false}
              onError={on_failed_attempt}
              // An HTTP-ok response with an undecodable body fires onLoad with naturalWidth 0, never onError —
              // treat a zero-dimension load as a failure too (same guard as SpellArt / ItemIcon / mob_image).
              onLoad={(e) => {
                if (!e.currentTarget.naturalWidth) on_failed_attempt()
              }}
            />
          ) : (
            (card.name || spell_id || '?').slice(0, 1).toUpperCase()
          )}
        </span>
        {cd_left > 0 && (
          <span className="hud-socket__cd hud-num" aria-hidden="true">
            {cd_left}
          </span>
        )}
        {card.cost > 0 && (
          <span className="hud-socket__cost hud-num" aria-hidden="true">
            {card.cost}
          </span>
        )}
      </button>
    </Tooltip>
  )
}
