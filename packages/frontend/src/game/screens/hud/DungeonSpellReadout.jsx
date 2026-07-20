// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DUNGEON in-fight SPELL READOUT (D113 / D299a lineage) — THE ONE spell tooltip (there should
// only be the big tooltip): the big aiming card shown for the HOVERED spell (preview) OR the ARMED spell
// (own turn), on every platform. Hover previews outrank the armed aim; a socket hover feeds it via the
// `hovered_spell_id` store write (DeckCluster). This SUPERSEDES the 07-17 desktop-hover split that lived on a
// compact SpellHoverTip anchored above the socket — that small card is DELETED. It renders the SAME
// `.sd` SpellDetail PRESENTATION as the tuned
// FightArmedReadout (art tile / name / school·kind / AP pill, a facts grid, an effects list) — the
// canonical armed-spell look — but fed from the ON-CHAIN fight-spell SSOT (fight-spells.js — the seeded
// SpellTemplates the hand arms with) instead of the legacy SPELL_TEMPLATES map that SpellDetail reads (a
// dungeon name_key like 'ember_strike' is ABSENT from that map, so SpellDetail itself returns null — the whole
// D113 symptom class). We reproduce its markup here — reusing the exported `SpellArt` tile + the scoped `.sd*`
// styles unchanged — and pour in the chain row's ap / range / crit / effects so every seeded spell renders in
// the tuned shell.
//
// The chain row carries AP / Range / Critical plus each effect's authored bounds and zone. Effect wording comes
// from seed-effect-line.js (the same source the out-of-fight grimoire uses), so the in-fight readout never drifts
// from the grimoire.

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { use_fight_view } from '../../store.js'
import { spell_element, spell_card } from '../../core/modules/fight.js'
import { use_mobile_input_mode } from '../../touch/mobile_input_mode.js'

import { SpellArt } from './SpellDetail.jsx'
import { fight_spell } from './fight-spells.js'
import { spell_effects } from './spellbook-data.js'
import { seed_effect_line, seed_el_label } from './seed-effect-line.js'
import { element_color } from './element-colors.js'
import { tooltip_anchor } from './tooltip_anchor.js'
import './spell-detail.css'
import './fight-targeting.css'

/**
 * The dungeon spell readout — THE ONE spell tooltip. EVERY platform renders the tuned `.sd`
 * detail for the HOVERED spell (preview, outranks the aim) or, absent a hover, the ARMED spell on my own turn
 * (the aiming card). `mobile` only picks the compact anchored `--mobile` CSS presentation (touch has no hover
 * surface, so the tap flash feeds the same hover write) — the spell SELECTION is now platform-identical,
 * restoring the D299a/msg 3254 hover-outranks-armed the 07-17 socket-anchored split had detoured.
 * @param {{ mobile?: boolean }} [props]
 * @returns {import('react').ReactElement | null}
 */
export function DungeonSpellReadout({ mobile: mobile_override } = {}) {
  const { t } = useTranslation()
  const live_mobile = use_mobile_input_mode()
  const mobile = mobile_override ?? live_mobile
  const fight = use_fight_view() // synchronous core view (S2 mirror kill)
  const armed = fight?.armed_spell_id ?? null
  const hovered = fight?.hovered_spell_id ?? null
  const my_turn = !!fight && fight.active_entity_id === fight.my_entity_id && fight.winner === -1 && !fight.placement
  // ONE TOOLTIP (there should only be the big tooltip): hover AND keypress drive THIS big card on
  // EVERY platform — a hovered spell previews (outranks the armed aim), else the ARMED spell shows. The compact
  // SpellHoverTip is deleted (supersedes the 07-17 socket-anchored hover split). Armed still gates on my_turn
  // (you can only aim on your turn); a hover previews any spell, on or off turn (reading your kit).
  const armed_id = armed && my_turn ? armed : null
  const spell_id = hovered ?? armed_id

  const chain = spell_id ? fight_spell(spell_id) : null
  const view = useMemo(() => {
    if (!chain) return null
    const l1 = chain.levels[0]
    const el = spell_element(chain.name_key) // UPPERCASE element of the first DAMAGE effect (or null)
    const el_key = el ? String(el).toLowerCase() : null
    return {
      name: spell_card(chain.name_key).name, // i18n-first, on-chain name fallback (spell_card's one rule)
      icon: chain.name_key, // CDN spell-icon key; SpellArt falls back to an element-tinted initial (D53)
      color: element_color(el), // element tint, or the neutral fallback for a heal/utility spell
      el_key, // lowercase element key for the head subline, or null (a heal/utility spell)
      ap: l1.ap ?? 0,
      range: l1.range ?? [0, 0],
      crit_rate: l1.crit_rate ?? 0, // 1-in-N crit odds (0 = non-critable) — SpellDetail's "1 / N" format
      cooldown: l1.cooldown ?? 0, // turns to recast (0 = none — not encoded on the seeded templates)
      effects: spell_effects(l1), // chain effects, each colour-tagged (element hue or house gold)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, t])

  // DESKTOP HOVER ANCHOR (the hover card was still on the right instead of being a tooltip of the
  // spell itself"): when this is a HOVER preview on desktop, position the readout ABOVE the hovered spell socket
  // (located by its data-spell-id) via the ONE tooltip_anchor home, portalled to <body> so it lives in viewport
  // space and is never clipped. Mobile keeps its bottom-anchored --mobile card (touch has no hover); the armed-AIM
  // readout keeps its fixed dock corner (you are aiming at the board, not reading a socket).
  const anchored = !!hovered && !mobile
  const card_ref = useRef(/** @type {HTMLDivElement | null} */ (null))
  const [anchor, set_anchor] = useState(/** @type {{ left: number, top: number } | null} */ (null))
  useLayoutEffect(() => {
    if (!anchored || !spell_id) return void set_anchor(null)
    const slot = document.querySelector(`[data-spell-id="${CSS.escape(String(spell_id))}"]`)
    const card = card_ref.current
    if (!slot || !card) return
    set_anchor(
      tooltip_anchor({
        trigger: slot.getBoundingClientRect(),
        card: card.getBoundingClientRect(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        placement: 'top',
      })
    )
  }, [anchored, spell_id])

  // Render for a genuine on-chain dungeon spell — the `spell_id` gate above already encodes "armed on my
  // turn (any platform) OR hovered on mobile". A non-chain id (a world/legacy fight) yields no view and is
  // handled by FightArmedReadout, never here — so the two readouts never double-mount.
  if (!fight || !view) return null

  const none = t('fight.none')
  // The head subline: element · Damage for an elemental spell, else the Heal family label — mirrors the
  // SpellDetail `school · kind` line (CSS uppercases it). Element labels reuse the seed `spells.el_*` keys.
  const subline = view.el_key
    ? `${seed_el_label(t, view.el_key)} · ${t('spells.damage')}`
    : t(chain.kind === 'heal' ? 'spells.heal' : 'spells.buff')
  // The facts grid — only the four the on-chain seed genuinely carries (no invented Area/LOS/Casts rows).
  const facts = /** @type {[string, string][]} */ ([
    [t('spells.ap_cost'), `${view.ap}`],
    [t('spells.range'), `${view.range[0]}-${view.range[1]}`],
    [t('spells.crit_chance'), view.crit_rate > 0 ? `1 / ${view.crit_rate}` : none],
    [t('spells.cooldown'), view.cooldown > 0 ? `${view.cooldown} ${t('spells.turns')}` : none],
  ])

  const readout = (
    <div
      ref={card_ref}
      className={`fight-readout${mobile ? ' fight-readout--mobile' : ''}${anchored ? ' fight-readout--anchored' : ''}`}
      // desktop-hover: fixed ABOVE the slot via the inline anchor (right/bottom dock overridden). useLayoutEffect
      // sets the anchor synchronously BEFORE paint (like Tooltip.jsx), so the pre-measure frame never reaches the
      // screen — no right-dock flash, and no visibility gymnastics. Mobile / armed-aim: positioned purely by CSS.
      style={anchored && anchor ? { left: anchor.left, top: anchor.top, right: 'auto', bottom: 'auto' } : undefined}
      aria-hidden="true"
    >
      <div className="sd" style={/** @type {import('react').CSSProperties} */ ({ '--el': view.color })}>
        <div className="sd__head">
          <span className="sd__head-art">
            <SpellArt icon={view.icon} color={view.color} name={view.name} />
          </span>
          <div className="sd__head-id">
            <span className="sd__head-name">{view.name}</span>
            <span className="sd__head-sub">{subline}</span>
          </div>
          <span className="sd__cost">
            <span className="sd__cost-n hud-num">{view.ap}</span>
            <span className="sd__cost-unit">{t('fight.ap')}</span>
          </span>
        </div>

        <div className="sd__facts">
          {facts.map(([label, value]) => (
            <div className="sd__fact" key={label}>
              <span className="sd__fact-label">{label}</span>
              <span className="sd__fact-val hud-num">{value}</span>
            </div>
          ))}
        </div>

        {view.effects.length > 0 && (
          <div className="sd__effects">
            <div className="sd__section-head">{t('spells.effects')}</div>
            {view.effects.map((fx, i) => (
              <div className="sd__effect" key={i}>
                <span className="sd__effect-dot" style={{ background: fx.color }} aria-hidden="true" />
                <div className="sd__effect-body">
                  <span className="sd__effect-text">{seed_effect_line(t, fx)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* the aiming hint belongs to the ARMED spell on my turn only — a passively hovered card is pure info,
          "pick a cell in range" under it would lie (msg 3254 hover-details pass). */}
      {armed && my_turn && spell_id === armed && (
        <div className="fight-readout__hint">{t('dungeons.spell_aim_hint', { name: view.name })}</div>
      )}
    </div>
  )
  // desktop hover → portal the anchored card to <body> (viewport space, escapes the scaled fight layer); else
  // render it in place at its CSS dock corner (armed aim) or bottom band (mobile). SSR-guarded: the no-jsdom
  // snapshot harness has no document, and useLayoutEffect never runs there, so render in place server-side.
  return anchored && typeof document !== 'undefined' && document.body ? createPortal(readout, document.body) : readout
}
