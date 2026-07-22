// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Rich tooltip CONTENT renderers fed into the <Tooltip content={...}> primitive. Pure presentational
// components, no state, no I/O. Two kinds left the HUD needs:
//   - <StatTip>  a stat explains itself (label + plain-language effect),
//   - <SpellTip> a spell's element / AP / range / area / line-of-sight / effects.
// (Item tooltips converged onto the SHARED ItemDetailView/useOnchainItemTooltip — see items.tsx /
// entity_display.tsx — so there is one item-tooltip renderer for the whole app, not a HUD-local fork.)
// NO em-dashes in copy (house law).

import { seed_effect_value } from './seed-effect-line.js'

// stat key -> { label, blurb }. Keep these legacy rich tips aligned with the live sim/chain formulas used by
// the localized character-sheet descriptions: four elemental characteristics, XP-only Wisdom, Chance loot,
// Agility tackle/dodge, and equipment-only Critical.
const STAT_INFO = /** @type {Record<string, { label: string, blurb: string }>} */ ({
  vitality: {
    label: 'Vitality',
    blurb: 'Each point adds 1 to your maximum health.',
  },
  wisdom: {
    label: 'Wisdom',
    blurb: 'Raises experience gained.',
  },
  strength: {
    label: 'Strength',
    blurb: 'Boosts earth-element power.',
  },
  intelligence: {
    label: 'Intelligence',
    blurb: 'Boosts fire-element power and the strength of your heals.',
  },
  chance: {
    label: 'Chance',
    blurb: 'Boosts water-element power and loot drop rates.',
  },
  agility: {
    label: 'Agility',
    blurb: 'Boosts air-element power, tackle, and dodge against AP and MP loss.',
  },
  ap: {
    label: 'Action points',
    blurb: 'Spent to cast spells each turn. Refills at the start of your turn.',
  },
  mp: {
    label: 'Movement points',
    blurb: 'One is spent per cell you move each turn.',
  },
  reserve: {
    label: 'AP reserve',
    blurb: 'Banked action points. On your turn, click to add one to this turn.',
  },
  health: {
    label: 'Health',
    blurb: 'Your life in combat. At zero you are out of the fight.',
  },
  xp: {
    label: 'Experience',
    blurb: 'Progress toward your next level. Win fights to earn it.',
  },
  critical: {
    label: 'Critical hit',
    blurb: "Improves the odds of triggering a spell's critical effects.",
  },
  raw_damage: {
    label: 'Raw damage',
    blurb: 'A flat increase to damage and life-steal effects, before resistances.',
  },
  earth_resistance: {
    label: 'Earth resist',
    blurb: 'Reduces incoming earth-element damage.',
  },
  fire_resistance: {
    label: 'Fire resist',
    blurb: 'Reduces incoming fire-element damage.',
  },
  water_resistance: {
    label: 'Water resist',
    blurb: 'Reduces incoming water-element damage.',
  },
  air_resistance: {
    label: 'Air resist',
    blurb: 'Reduces incoming air-element damage.',
  },
})

/** Is there a rich blurb for this stat key? (lets call sites fall back to a plain label) */
export const has_stat_info = (/** @type {string} */ key) => key in STAT_INFO

/**
 * A stat explaining itself: bold label + an optional live value line + plain-language effect.
 * @param {{ stat: string, label?: string, value?: string }} props
 * @returns {import('react').JSX.Element}
 */
export function StatTip({ stat, label, value }) {
  const info = STAT_INFO[stat]
  return (
    <div className="tt-stat">
      <div className="tt-name">{info?.label ?? label ?? stat}</div>
      {value != null && <div className="tt-num tt-stat-value">{value}</div>}
      {info?.blurb && <div className="tt-blurb">{info.blurb}</div>}
    </div>
  )
}

/**
 * Spell summary: element, AP cost, range, area, line-of-sight, and per-effect lines. Reads the first
 * rank (`spell.levels[0]`). `element_color` is optional (the call site passes its element palette so
 * we add no fourth ELEMENT_COLOR copy).
 * @param {{ spell: any, element_color?: (e: string) => string }} props
 * @returns {import('react').JSX.Element}
 */
/**
 * Compact SEED-spell tooltip for a spell-bar icon (S-25) — the hover detail that opens ABOVE the icon: the
 * name (element-tinted), then a facts grid of AP / MP / range / the life swing (damage or heal). Fed the
 * already-resolved `spell_card` fields (seed-derived) rather than a legacy template, so it renders for the
 * dungeon seed spells the legacy `SpellTip` returns blank for. Slot 0's weapon passes `weapon` — either `true`
 * (name only, before the escrow line loads) or the §17.27 FACTS object { ap_cost, damage, crit_damage, reach,
 * element_name } → a facts grid so daggers-3AP vs battleaxe-5AP (and bare-hands flat 3) is visible, which also
 * self-explains the greyed "can't afford" socket. Labels reuse existing i18n keys where they exist.
 * `next_hit` (spells) / `weapon.next_hit` = the §7 turn-seed SLOT-EXACT preview { value, crit }: the exact
 * number the NEXT queued action lands for (the authored base, crit-swapped while the socket glows — damage is
 * identity). One line, gold when it is the crit base.
 * `status` (FIX 4, 07-14): one optional honest line explaining why the socket is greyed beyond AP/turn —
 * "on cooldown — N turns" or "casts per turn used up" (already-localized string, or null for nothing to say).
 * @param {{ t: (k: string) => string, name: string, color?: string, ap?: number, mp?: number,
 *   range?: [number, number], life?: { value: number, damageMin?: number, damageMax?: number,
 *     kind: 'damage' | 'heal' } | null,
 *   next_hit?: { value: number, crit: boolean } | null,
 *   weapon?: boolean | { ap_cost: number, damage: number, crit_damage: number, reach: number, element_name?: string,
 *     next_hit?: { value: number, crit: boolean } | null },
 *   status?: string | null }} props
 * @returns {import('react').JSX.Element}
 */
export function SpellSeedTip({ t, name, color = 'var(--accent)', ap, mp, range, life, next_hit, weapon, status }) {
  const range_txt =
    Array.isArray(range) && range.length === 2
      ? range[0] === range[1]
        ? `${range[0]}`
        : `${range[0]} - ${range[1]}`
      : null
  const heal = life?.kind === 'heal'
  const life_value = life
    ? seed_effect_value(t, {
        damageMin: life.damageMin ?? life.value,
        damageMax: life.damageMax ?? life.value,
      })
    : null
  const w = weapon && typeof weapon === 'object' ? weapon : null // the §17.27 equipped-weapon facts (else name-only)
  /** the one-line §7 slot-exact preview — shared by the weapon and spell grids @param {{ value: number, crit: boolean } | null | undefined} nh */
  const next_hit_line = (nh) =>
    nh ? (
      <>
        <dt>{t('fight.next_hit')}</dt>
        <dd className="tt-next-hit" style={nh.crit ? { color: 'var(--accent)' } : undefined}>
          {heal ? '+' : ''}
          {nh.value}
        </dd>
      </>
    ) : null
  return (
    <div className="tt-spell">
      <div className="tt-head">
        <span className="tt-name" style={{ color }}>
          {name}
        </span>
      </div>
      {w && (
        <dl className="tt-spell-grid">
          <dt>{t('fight.ap')}</dt>
          <dd>{w.ap_cost}</dd>
          <dt>{t('spells.damage')}</dt>
          <dd style={{ color }}>
            {w.damage}
            {w.crit_damage > w.damage ? ` (${t('spells.crit_val', { value: w.crit_damage })})` : ''}
          </dd>
          <dt>{t('fight.weapon_reach')}</dt>
          <dd>{w.reach}</dd>
          {w.element_name && (
            <>
              <dt>{t('spells.element')}</dt>
              <dd style={{ color }}>{w.element_name}</dd>
            </>
          )}
          {next_hit_line(w.next_hit)}
        </dl>
      )}
      {!weapon && (
        <dl className="tt-spell-grid">
          {ap != null && ap > 0 && (
            <>
              <dt>{t('fight.ap')}</dt>
              <dd>{ap}</dd>
            </>
          )}
          {mp != null && mp > 0 && (
            <>
              <dt>{t('fight.mp')}</dt>
              <dd>{mp}</dd>
            </>
          )}
          {range_txt && (
            <>
              <dt>{t('spells.range')}</dt>
              <dd>{range_txt}</dd>
            </>
          )}
          {life && life.value ? (
            <>
              <dt>{heal ? t('spells.heal') : t('spells.damage')}</dt>
              <dd style={{ color: heal ? '#34d399' : color }}>
                {heal ? '+' : ''}
                {life_value}
              </dd>
            </>
          ) : null}
          {life && life.value ? next_hit_line(next_hit) : null}
        </dl>
      )}
      {status && <div className="tt-status">{status}</div>}
    </div>
  )
}

export function SpellTip({ spell, element_color }) {
  const rank = spell.levels?.[0] ?? null
  const effects = Array.isArray(rank?.base_effects) ? rank.base_effects : []
  const element = effects.find((fx) => fx.element)?.element ?? null
  const tint = element && element_color ? element_color(element) : 'var(--accent)'
  const range = rank?.range
    ? rank.range[0] === rank.range[1]
      ? `${rank.range[0]}`
      : `${rank.range[0]} to ${rank.range[1]}`
    : null

  return (
    <div className="tt-spell">
      <div className="tt-head">
        <span className="tt-name" style={{ color: tint }}>
          {spell.name}
        </span>
        {spell.level != null && <span className="tt-lvl tt-num">Lv {spell.level}</span>}
      </div>
      {element && (
        <div className="tt-sub" style={{ color: tint }}>
          {element}
        </div>
      )}
      <dl className="tt-spell-grid">
        {rank?.cost != null && (
          <>
            <dt>AP</dt>
            <dd>{rank.cost}</dd>
          </>
        )}
        {range && (
          <>
            <dt>Range</dt>
            <dd>{range}</dd>
          </>
        )}
        {rank?.area > 0 && (
          <>
            <dt>Area</dt>
            <dd>
              {rank.area_type ? `${rank.area_type} ` : ''}
              {rank.area}
            </dd>
          </>
        )}
        {rank && (
          <>
            <dt>Sight</dt>
            <dd>{rank.line_of_sight ? 'Required' : 'Ignores walls'}</dd>
          </>
        )}
      </dl>
      {effects.length > 0 && (
        <>
          <div className="tt-eff">Effects</div>
          {effects.map((fx, i) => (
            <div className="tt-line" key={`${fx.type}-${i}`}>
              <span
                className="tt-num"
                style={fx.element && element_color ? { color: element_color(fx.element) } : undefined}
              >
                {fx.min != null && fx.max != null ? `${fx.min} to ${fx.max}` : (fx.turns ?? '')}
              </span>
              <span className="tt-line-name">
                {(fx.type ?? '').replace(/_/g, ' ')}
                {fx.turns ? ` (${fx.turns}t)` : ''}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
