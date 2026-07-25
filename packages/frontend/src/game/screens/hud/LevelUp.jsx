// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Level-up congrats card (T-U9 "Level Burst", owner-locked) — a transient center celebration that fires
// ON the active character crossing a level. Mock-to-match the locked design (/tmp/ares-mock/levelup-LOCKED
// .html): the big glowing level number in a ring + sparks, the class line, the two points-gained tiles, an
// optional NEW SPELL UNLOCKED row, and the Allocate/Later CTA. Opaque .result--fe ground (issue #369) — no
// live-world/nameplate bleed-through, not translucent glass. Gated off the discrete `level_up` store slice
// owned by core/modules/player_experience.js.
//
// Data is pulled, never hardcoded: the new level + points gained come from the level-up EVENT (the slice);
// the class line is resolved from @aresrpg/sdk/classes identity, while the unlocked spell comes from the
// runtime-published fight spell catalog (name + AP cost + CDN icon). The +5 characteristic / +1 spell grant
// is already credited on-chain (AresCharacter.java); this only celebrates it. If no spell unlocks at the
// crossed level, the unlock row is omitted entirely (no empty card).

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { spell_icon_url } from '@aresrpg/sdk/jobs'
import classes_json from '@aresrpg/sdk/classes' with { type: 'json' }

import { use_game_state, context } from '../../store.js'
import { play_fight_sfx } from '../../core/audio/sfx.js'
import { resolve_class_spells } from './fight-spells.js'
import { newly_unlocked } from './spell-unlock-select.js'
import { worlds_unlocked_between } from './level_unlocks.js'
import { load_world_gates } from './world_levels.js'
import './result.css'
import './levelup-radiant.css'

/** @typedef {{ id: string, name: string, title: string }} ClassDef */

// classes.json here is CLASS IDENTITY only (display name + title) — fight-spells.json carries no class metadata.
// The unlocked SPELL is resolved from the on-chain fight-spell SSOT below, never this map's legacy `spells` field.
const CLASSES = /** @type {Record<string, ClassDef>} */ (
  /** @type {unknown} */ (classes_json)
)

/**
 * Resolve the spell unlocked while crossing into the new level from the on-chain fight-spell SSOT (fight-spells.js
 * — the SAME rows the deck / grimoire read, so we celebrate only spells actually DEPLOYED on-chain): the class
 * spells whose `unlock_level` lands in (level - levels_gained, level], freshest slot wins. Display facts come off
 * the row (name via name_key i18n with the on-chain name as fallback, AP cost + icon off level-1). Returns null
 * when nothing unlocks. `class_name` is the class's display name (classes.json identity, not spell data).
 * @param {string} class_id
 * @param {number} level         the level after the gain
 * @param {number} levels_gained levels crossed in this gain (>= 1)
 * @returns {{ name_key: string, name: string, cost: number | null, icon: string | null, class_name: string } | null}
 */
function resolve_unlock(class_id, level, levels_gained) {
  const class_def = CLASSES[class_id]
  if (!class_def) return null
  const fresh = newly_unlocked(
    resolve_class_spells(class_id, level),
    level - levels_gained,
  )
  if (!fresh) return null
  const l1 = fresh.levels?.[0] ?? {}
  return {
    name_key: fresh.name_key,
    name: fresh.name,
    cost: typeof l1.ap === 'number' ? l1.ap : null,
    icon: spell_icon_url(fresh.icon_key),
    class_name: class_def.name,
  }
}

/**
 * The level-up congrats card. Renders null when no level-up is pending.
 * @param {{ on_allocate?: () => void }} props on_allocate -> deep-link to the Character (Stats) panel
 * @returns {import('react').JSX.Element | null}
 */
export function LevelUp({ on_allocate }) {
  const { t } = useTranslation()
  const level_up = use_game_state(s => s.level_up)
  const result_open = use_game_state(s => !!s.fight_result)
  const characters = use_game_state(s => s.sui.characters)
  const selected_id = use_game_state(s => s.selected_character_id)
  // Every seeded world + its on-chain join gate (world.move `required_level`), read chain-direct + cached
  // (the /v1 worlds view omits the gate). Loaded lazily on the card's first paint; until it resolves the
  // world row is simply absent (honest — never a fabricated unlock). [] on a read failure.
  const [world_gates, set_world_gates] = useState(/** @type {import('./world_levels.js').WorldGate[]} */ ([]))
  // ONE cohesive flow, never card-over-card (canon/12+13): the end-fight RESULT panel
  // shows first; this level-up card WAITS its turn and fires only after the player hits Continue (which
  // clears `fight_result`). A level-up from outside a fight (quests/admin grants) has no result panel
  // open, so it still pops immediately. The result row already FLAGS the level via the inline badge.
  const visible = !!level_up && !result_open

  // First paint of the card: play the win-family SFX (the celebration cue). Gated on `visible` so it never
  // refires while the card is queued behind the result panel. Issue #369: the card used to auto-dismiss on
  // a timer — deleted. It now persists until the player explicitly presses Allocate or Later (`dismiss`/
  // `allocate` below); nothing else may unmount it.
  useEffect(() => {
    if (!visible) return
    play_fight_sfx('win')
  }, [visible])

  // Load the world join-gates on first paint so the "you now have access to X and Y worlds" row can compute
  // (world_gates → worlds_unlocked_between below). Async + cached; the card re-renders when it resolves.
  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    load_world_gates().then(gates => {
      if (alive) set_world_gates(gates)
    })
    return () => {
      alive = false
    }
  }, [visible])

  if (!visible) return null

  const { level, levels_gained, stat_points, spell_points } = level_up
  const character = characters?.find(c => c.id === selected_id) ?? null
  const class_id = character?.classe ?? character?.class_id ?? ''
  const cls = CLASSES[class_id] ?? null
  const unlock = resolve_unlock(class_id, level, levels_gained)
  // "You now have access to X and Y worlds" — the worlds whose join gate (required_level) the character
  // just crossed. Computed from the cached gates; [] (row omitted) until they load or when nothing opened.
  const new_worlds = worlds_unlocked_between(world_gates, level - levels_gained, level)

  // dismiss; the points are already credited on-chain, so "Allocate" just opens the Character panel (the
  // available points show pending/unspent there). Always route to Stats even at 0 unspent (guarded edge).
  const dismiss = () => context.dispatch('action/level_up/close')
  const allocate = () => {
    dismiss()
    on_allocate?.()
  }

  return (
    <div className="hud-middle lvlup-stage">
      <div
        className="result result--tall result--fe radiant"
        role="dialog"
        aria-modal="true"
        aria-label={t('level_up.aria_label', { level })}
      >
        {/* RADIANT ceremony (owner pick, round3-radiant): fine gold corner filigree — one <symbol>,
            reused 4× via <use> + CSS mirroring (scaleX/scaleY/scale(-1,-1) per corner). */}
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <defs>
            <symbol id="lvlup-filigree" viewBox="0 0 64 64">
              <path
                d="M6 48 L6 16 Q6 6 16 6 L48 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.15"
                strokeLinecap="round"
              />
              <path d="M6 30 Q19 30 19 17 Q19 6 6 6" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.7" />
              <path d="M6 1 L11 6 L6 11 L1 6 Z" fill="currentColor" stroke="none" />
              <circle cx="48" cy="6" r="1.7" fill="currentColor" stroke="none" />
              <circle cx="6" cy="48" r="1.7" fill="currentColor" stroke="none" />
            </symbol>
          </defs>
        </svg>
        <svg className="rad-crn rad-crn--tl" viewBox="0 0 64 64" aria-hidden="true">
          <use href="#lvlup-filigree" />
        </svg>
        <svg className="rad-crn rad-crn--tr" viewBox="0 0 64 64" aria-hidden="true">
          <use href="#lvlup-filigree" />
        </svg>
        <svg className="rad-crn rad-crn--bl" viewBox="0 0 64 64" aria-hidden="true">
          <use href="#lvlup-filigree" />
        </svg>
        <svg className="rad-crn rad-crn--br" viewBox="0 0 64 64" aria-hidden="true">
          <use href="#lvlup-filigree" />
        </svg>

        <div className="lvllabel">{t('level_up.title')}</div>

        <div className="lvlhero">
          <div className="rad-rays" aria-hidden="true" />
          <div className="rad-glow" aria-hidden="true" />
          <span className="rad-spark" style={{ '--x': '-168px', '--y': '-108px', '--d': '420ms' }} aria-hidden="true" />
          <span
            className="rad-spark rad-spark--em"
            style={{ '--x': '172px', '--y': '-96px', '--d': '460ms' }}
            aria-hidden="true"
          />
          <span className="rad-spark" style={{ '--x': '198px', '--y': '-4px', '--d': '500ms' }} aria-hidden="true" />
          <span
            className="rad-spark rad-spark--em"
            style={{ '--x': '-196px', '--y': '20px', '--d': '540ms' }}
            aria-hidden="true"
          />
          <span className="rad-spark" style={{ '--x': '-120px', '--y': '138px', '--d': '460ms' }} aria-hidden="true" />
          <span
            className="rad-spark rad-spark--em"
            style={{ '--x': '130px', '--y': '148px', '--d': '500ms' }}
            aria-hidden="true"
          />
          <span className="rad-spark" style={{ '--x': '4px', '--y': '-172px', '--d': '580ms' }} aria-hidden="true" />
          <div className="rad-numwrap">
            <span className="rad-pre">{t('level_up.reached')}</span>
            {/* data-level feeds the ::after foil-sheen pseudo-element (content: attr(data-level)) so the
                one-shot sheen sweep never drifts from the real number. */}
            <div className="rad-num" data-level={level}>
              {level}
            </div>
          </div>
        </div>

        {cls && (
          <div className="lvlcap">
            {cls.name} &middot; {cls.title}
          </div>
        )}

        <hr className="hr" />

        {/* Two grant tiles (the locked design's "two points-gained tiles"). The train-#4 package credits +5
            characteristic + 1 spell point per level ON-CHAIN (AresCharacter.java), so BOTH are honest now — the
            characteristic tile was hidden only while the old package granted 0 stat points (honest-UI law).
            Values come from the level-up EVENT (stat_points = 5×levels_gained, spell_points = 1×levels_gained). */}
        <div className="rewards">
          <div className="reward">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2l2.6 6.9L21 10l-5.2 4.2L17.6 21 12 17.1 6.4 21l1.8-6.8L3 10l6.4-1.1z" />
            </svg>
            <span>
              <b className="hud-num">+{stat_points}</b>
              <br />
              {t('level_up.stat_points')}
            </span>
          </div>
          <div className="reward">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6z" />
            </svg>
            <span>
              <b className="hud-num">+{spell_points}</b>
              <br />
              {t('level_up.spell_points')}
            </span>
          </div>
        </div>

        {unlock && (
          <div style={{ marginTop: '12px' }}>
            <div className="unlock">
              <div className="unlock__well">
                {unlock.icon ? (
                  <img src={unlock.icon} alt="" />
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <path d="M13 2L4 14h6l-1 8 9-12h-6z" />
                  </svg>
                )}
              </div>
              <div>
                <div className="unlock__l">{t('level_up.new_spell')}</div>
                <div className="unlock__n">
                  {t(`spells.spell_${unlock.name_key}`, { defaultValue: unlock.name })}
                </div>
                <div className="unlock__m">{unlock.class_name}</div>
              </div>
              {unlock.cost != null && (
                <div className="unlock__cost hud-num">{t('level_up.ap', { cost: unlock.cost })}</div>
              )}
            </div>
          </div>
        )}

        {/* "You now have access to X and Y worlds" — the worlds this level gain just opened. Same
            unlock-row language as the new-spell row; omitted entirely when no world gate was crossed. */}
        {new_worlds.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            <div className="unlock">
              <div className="unlock__well">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <div className="unlock__l">{t('level_up.worlds_unlocked')}</div>
                <div className="unlock__n">{new_worlds.map(w => w.label).join(' · ')}</div>
                <div className="unlock__m">{t('level_up.worlds_note')}</div>
              </div>
            </div>
          </div>
        )}

        <div className="cta">
          <button type="button" className="btn btn--primary" onClick={allocate}>
            {t('level_up.allocate')}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={dismiss}
          >
            {t('level_up.later')}
          </button>
        </div>
      </div>
    </div>
  )
}
