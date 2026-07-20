// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Build simulator drawer body — a tactical build planner adapted from the aresrpg companion
// simulator (../../aresrpg/packages/frontend/src/pages/simulator.tsx). The companion simulator was
// built for the legacy reference game's REAL-TIME combat math (cooldowns, stamina, dps, crit denominators). This game is
// turn-based / tactical, so this adaptation drops that math and instead drives the EXACT combat
// model from @aresrpg/sdk: pick a class + level, allocate the 6 primary stats within the level's
// point budget (5 points per level, matching the level-up grant), pick castable spells from the
// class roster gated by unlock level, and read the resulting combat profile (max health, AP / MP,
// and the derived secondaries: critical, raw damage, the 4 elemental resistances)
// straight from the SDK so the planner and the live Stats panel agree by construction.
//
// SSOT: classes + per-level spell unlocks come from @aresrpg/sdk/classes (classes.json); the point
// budget from @aresrpg/sdk/experience; every derived number from @aresrpg/sdk/stats
// (get_max_health / get_total_stat / get_secondary_stats). This component computes NO balance.
//
// CONVENIENCE: "Load current" seeds the form from the active on-chain character (class, level
// inferred from xp, allocated base stats) so the player can plan from their real build. Equipment
// stat contributions are intentionally NOT modelled here yet — the planner shows the BASE build
// profile (stats allocation + class), and equipment is layered on by the live character in the
// Stats panel. FLAG: a future pass can let the planner equip template items (the companion did this
// via its item read-model) once the item templates are exposed to the client over the protocol.

import { useMemo, useState } from 'react'

import classes_json from '@aresrpg/sdk/classes'
import {
  get_max_health,
  get_secondary_stats,
  get_total_stat,
  STATISTICS,
  STATISTICS_PRIMARY,
} from '@aresrpg/sdk/stats'
import { experience_to_level, level_to_experience } from '@aresrpg/sdk/experience'

import i18n from '../../../i18n'
import { use_game_state } from '../../store.js'
import { class_spells } from './fight-spells.js'
import { roster_from_rows } from './spell-unlock-select.js'
import { SimulatorEquip } from './SimulatorEquip.jsx'
import { empty_equipment } from './simulator-equip.js'
import { element_color } from './encyclopedia-data.js'
import './hud-panels.css'
import './simulator.css'

// classes.json = class IDENTITY only (id / name / title) for the picker; fight-spells.json carries no class
// metadata. The spell roster below comes from the on-chain fight-spell SSOT (class_spells), not this map.
const CLASSES =
  /** @type {Record<string, { id: string, name: string, title: string }>} */ (
    classes_json
  )
const CLASS_LIST = Object.values(CLASSES)

// 5 characteristic points per level (the level-up grant — see the Stats deliverable). Level 1 is
// the floor with no points spent yet; each level above grants 5.
const POINTS_PER_LEVEL = 5
const MAX_LEVEL = 100

// Per-stat tint, reused from the Stats panel so the two surfaces read as one design.
const PRIMARY = /** @type {const} */ ([
  { key: STATISTICS.VITALITY, label: 'Vitality', tint: '#e98a8a' },
  { key: STATISTICS.WISDOM, label: 'Wisdom', tint: '#9b8ce6' },
  { key: STATISTICS.STRENGTH, label: 'Strength', tint: '#e0a36a' },
  { key: STATISTICS.INTELLIGENCE, label: 'Intelligence', tint: '#5db4ff' },
  { key: STATISTICS.CHANCE, label: 'Chance', tint: '#6fd6a0' },
  { key: STATISTICS.AGILITY, label: 'Agility', tint: '#c9b46a' },
])

const ZERO_STATS = STATISTICS_PRIMARY.reduce(
  (acc, key) => ({ ...acc, [key]: 0 }),
  /** @type {Record<string, number>} */ ({}),
)

/**
 * Build a minimal synthetic character the SDK stat helpers accept. `equipment` is the {slot: item}
 * map (flattened template items, simulator-equip.js); the SDK stat math (get_total_stat) reads each
 * slot off the character to sum equipment bonuses. `_type` gates get_max_health.
 * @param {{ classe: string, experience: number, stats: Record<string, number>,
 *   equipment: Record<string, any> }} input
 * @returns {import('@aresrpg/sdk/types').SuiCharacter}
 */
function synth_character({ classe, experience, stats, equipment }) {
  return /** @type {any} */ ({
    id: 'sim',
    name: 'Build',
    classe,
    sex: 'male',
    realm: '',
    position: { x: 0, y: 0, z: 0 },
    experience,
    health: 0,
    available_points: 0,
    color_1: 0,
    color_2: 0,
    color_3: 0,
    ...ZERO_STATS,
    ...stats,
    ...equipment,
    kiosk_id: '',
    personal_kiosk_cap_id: '',
    _type: 'sim',
  })
}

/**
 * The class's spell roster { unlock, id (name_key), name } from the on-chain fight-spell SSOT (class_spells —
 * every seeded class spell, unlock-ascending). Three starters at unlock_level 1 yield three entries the planner
 * shows unlocked at L1 (the legacy classes.json `{ level -> ONE id }` map could hold only one spell per level).
 */
function class_spell_roster(/** @type {string} */ class_id) {
  return roster_from_rows(class_spells(class_id))
}

/** Localize a fight-spell's display name via its name_key (spells.spell_<key>), the on-chain name as fallback. */
const spell_label = (/** @type {string} */ name_key, /** @type {string} */ name) =>
  i18n.t(`spells.spell_${name_key}`, { defaultValue: name })

/**
 * Build simulator drawer body. Two columns: LEFT config (class / level / stats / spells), RIGHT the
 * derived combat profile read from the SDK.
 * @returns {import('react').JSX.Element}
 */
export function SimulatorDrawer() {
  const characters = use_game_state(s => s.sui.characters)
  const selected_character_id = use_game_state(s => s.selected_character_id)

  const active_character = useMemo(
    () => characters?.find(c => c.id === selected_character_id) ?? null,
    [characters, selected_character_id],
  )

  const [class_id, set_class_id] = useState(CLASS_LIST[0].id)
  const [level, set_level] = useState(1)
  const [stats, set_stats] = useState(ZERO_STATS)
  const [spells, set_spells] = useState(/** @type {Set<string>} */ (new Set()))
  const [equipment, set_equipment] = useState(empty_equipment())

  const budget = (level - 1) * POINTS_PER_LEVEL
  const used = STATISTICS_PRIMARY.reduce((sum, k) => sum + (stats[k] ?? 0), 0)
  const remaining = budget - used

  const experience = level_to_experience(level)
  const character = useMemo(
    () => synth_character({ classe: class_id, experience, stats, equipment }),
    [class_id, experience, stats, equipment],
  )

  // the equipped weapon's damage rolls drive the combat-output "Weapon" block.
  const weapon_damages =
    /** @type {{ element: string, min: number, max: number }[]} */ (
      equipment.weapon?.damages ?? []
    )

  const on_equip = (/** @type {string} */ slot, /** @type {any} */ item) =>
    set_equipment(prev => ({ ...prev, [slot]: item }))

  const max_health = get_max_health(character)
  const secondary = useMemo(() => get_secondary_stats(character), [character])
  const action = get_total_stat(character, STATISTICS.ACTION)
  const movement = get_total_stat(character, STATISTICS.MOVEMENT)

  const roster = useMemo(() => class_spell_roster(class_id), [class_id])

  const set_level_clamped = (/** @type {number} */ next) => {
    const lv = Math.max(1, Math.min(MAX_LEVEL, Math.round(next || 1)))
    set_level(lv)
    // drop over-budget allocation when the level (and budget) shrinks
    const new_budget = (lv - 1) * POINTS_PER_LEVEL
    set_stats(prev => {
      let spent = STATISTICS_PRIMARY.reduce((s, k) => s + (prev[k] ?? 0), 0)
      if (spent <= new_budget) return prev
      const next_stats = { ...prev }
      // trim from the back until within budget (deterministic)
      for (let i = PRIMARY.length - 1; i >= 0 && spent > new_budget; i--) {
        const key = PRIMARY[i].key
        const take = Math.min(next_stats[key] ?? 0, spent - new_budget)
        next_stats[key] = (next_stats[key] ?? 0) - take
        spent -= take
      }
      return next_stats
    })
    // drop spells that are no longer unlocked at the new level
    set_spells(prev => {
      const next = new Set(prev)
      for (const { unlock, id } of roster) if (lv < unlock) next.delete(id)
      return next
    })
  }

  const add_stat = (/** @type {string} */ key) => {
    if (remaining <= 0) return
    set_stats(prev => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }))
  }
  const remove_stat = (/** @type {string} */ key) =>
    set_stats(prev =>
      (prev[key] ?? 0) > 0 ? { ...prev, [key]: prev[key] - 1 } : prev,
    )

  const toggle_spell = (/** @type {string} */ id) =>
    set_spells(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const reset = () => {
    set_class_id(CLASS_LIST[0].id)
    set_level(1)
    set_stats(ZERO_STATS)
    set_spells(new Set())
    set_equipment(empty_equipment())
  }

  const load_current = () => {
    if (!active_character) return
    const lv = experience_to_level(active_character.experience ?? 0)
    set_class_id(active_character.classe ?? CLASS_LIST[0].id)
    set_level(lv)
    set_stats(
      STATISTICS_PRIMARY.reduce(
        (acc, k) => ({ ...acc, [k]: active_character[k] ?? 0 }),
        /** @type {Record<string, number>} */ ({}),
      ),
    )
    set_spells(new Set())
  }

  return (
    <div className="sim">
      {/* ── LEFT: config ─────────────────────────────────────────────────── */}
      <div className="sim__col">
        {/* class */}
        <div>
          <div className="sim__section">Class</div>
          <div className="sim__classes">
            {CLASS_LIST.map(c => (
              <button
                key={c.id}
                type="button"
                className={`sim__class${class_id === c.id ? ' is-active' : ''}`}
                onClick={() => {
                  set_class_id(c.id)
                  set_spells(new Set())
                }}
              >
                <span className="sim__class-name">{c.name}</span>
                <span className="sim__class-title">{c.title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* level */}
        <div>
          <div className="sim__section">Level</div>
          <div className="sim__level">
            <input
              className="sim__level-input hud-num"
              type="number"
              min={1}
              max={MAX_LEVEL}
              value={level}
              onChange={e => set_level_clamped(Number(e.target.value))}
            />
            <input
              className="sim__level-range"
              type="range"
              min={1}
              max={MAX_LEVEL}
              value={level}
              onChange={e => set_level_clamped(Number(e.target.value))}
            />
          </div>
        </div>

        {/* stats */}
        <div>
          <div className="sim__section-row">
            <span className="sim__section">Characteristics</span>
            <span
              className={`sim__budget${remaining === 0 ? ' is-empty' : ''}`}
            >
              {used} / {budget} pts
            </span>
          </div>
          <div className="sim__stats">
            {PRIMARY.map(({ key, label, tint }) => (
              <div className="sim__stat" key={key}>
                <span
                  className="sim__stat-dot"
                  style={
                    /** @type {import('react').CSSProperties} */ ({
                      '--tint': tint,
                    })
                  }
                />
                <span className="sim__stat-label">{label}</span>
                <span className="sim__stat-value hud-num">
                  {stats[key] ?? 0}
                </span>
                <button
                  type="button"
                  className="sim__step"
                  disabled={(stats[key] ?? 0) <= 0}
                  onClick={() => remove_stat(key)}
                  aria-label={`remove point from ${label}`}
                >
                  &minus;
                </button>
                <button
                  type="button"
                  className="sim__step sim__step--add"
                  disabled={remaining <= 0}
                  onClick={() => add_stat(key)}
                  aria-label={`add point to ${label}`}
                >
                  +
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* spells (gated by unlock level) */}
        <div>
          <div className="sim__section">Spells</div>
          {roster.length === 0 ? (
            <span className="sim__empty">
              Spell roster for this class arrives with the content seed.
            </span>
          ) : (
            <div className="sim__spells">
              {roster.map(({ unlock, id, name }) => {
                const locked = level < unlock
                const on = spells.has(id)
                return (
                  <button
                    key={id}
                    type="button"
                    className={`sim__spell${on ? ' is-on' : ''}`}
                    disabled={locked}
                    onClick={() => toggle_spell(id)}
                  >
                    <span className="sim__spell-id">
                      <span className="sim__spell-name">
                        {spell_label(id, name)}
                      </span>
                      <span className="sim__spell-req">
                        {locked ? `Unlocks Lv ${unlock}` : `Lv ${unlock}`}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* equipment — pick template gear per slot; bonuses flow into the profile on the right */}
        <SimulatorEquip equipment={equipment} on_equip={on_equip} />

        {/* actions */}
        <div className="sim__actions">
          <button type="button" className="hud-btn" onClick={reset}>
            Reset
          </button>
          {active_character && (
            <button
              type="button"
              className="hud-btn hud-btn--accent"
              onClick={load_current}
            >
              Load current
            </button>
          )}
        </div>
      </div>

      {/* ── RIGHT: result profile ────────────────────────────────────────── */}
      <div className="sim__profile">
        <div>
          <div className="sim__section">Vitals</div>
          <div className="sim__vitals">
            <div className="sim__vital">
              <span className="sim__vital-label">Health</span>
              <span className="sim__vital-value">
                {max_health.toLocaleString()}
              </span>
            </div>
            <div className="sim__vital">
              <span className="sim__vital-label">Level</span>
              <span className="sim__vital-value">{level}</span>
            </div>
            <div className="sim__vital">
              <span className="sim__vital-label">Action</span>
              <span className="sim__vital-value">{action}</span>
            </div>
            <div className="sim__vital">
              <span className="sim__vital-label">Move</span>
              <span className="sim__vital-value">{movement}</span>
            </div>
          </div>
        </div>

        <div>
          <div className="sim__section">Secondary</div>
          <div className="sim__secondary">
            {secondary.map(({ key, label, value, unit }) => (
              <div className="sim__srow" key={key}>
                <span className="sim__srow-label">{label}</span>
                <span className="sim__srow-value">
                  {value.toLocaleString()}
                  {unit === 'percent' && '%'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {weapon_damages.length > 0 && (
          <div>
            <div className="sim__section">Weapon damage</div>
            <div className="sim__secondary">
              {weapon_damages.map((d, i) => (
                <div className="sim__srow" key={`${d.element}-${i}`}>
                  <span className="sim__srow-label">
                    <span
                      className="sim__dmg-dot"
                      style={{ background: element_color(d.element) }}
                    />
                    {d.element.replace(/^\w/, m => m.toUpperCase())}
                  </span>
                  <span
                    className="sim__srow-value"
                    style={{ color: element_color(d.element) }}
                  >
                    {d.min} - {d.max}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="sim__section">Spells equipped</div>
          <div className="sim__secondary">
            <div className="sim__srow">
              <span className="sim__srow-label">Selected</span>
              <span className="sim__srow-value">{spells.size}</span>
            </div>
            <div className="sim__srow">
              <span className="sim__srow-label">Class</span>
              <span className="sim__srow-value">{CLASSES[class_id]?.name}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
