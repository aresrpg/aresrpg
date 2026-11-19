// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The game's rules as docs pages. The text is the encyclopedia copy's `gameplay` block; the numbers
// come from the same constants the contracts and the fight simulator use.
import type { ReactNode } from 'react'
import { StatGlyph } from '@aresrpg/ui'
import { max_level, xp_for_level } from '@aresrpg/immutable'
import { RETRO_GROUP_XP_TENTHS } from '@aresrpg/fight'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'

import type { EncyclopediaText } from '../encyclopedia/copy.ts'
import { Text as LocalizedText } from '../i18n/Text.tsx'
import { useNumbers } from '../i18n/useNumbers.ts'
import { useText } from '../i18n/useText.ts'
import { element_colors, stat_colors } from '../visual_identity.ts'

import { sentence_case } from './docs_parts.tsx'
import type { DocsMechanic } from './routes.ts'

type Props = Readonly<{ text: EncyclopediaText }>
const STATS = ['vitality', 'wisdom', 'strength', 'intelligence', 'chance', 'agility'] as const
const ELEMENT_STATS = [
  ['earth', 'strength'],
  ['fire', 'intelligence'],
  ['water', 'chance'],
  ['air', 'agility'],
] as const

const Formula = ({ children }: Readonly<{ children: ReactNode }>) => <p className="docs-formula">{children}</p>
const Topic = ({ text, id, formula }: Props & Readonly<{ id: string; formula?: ReactNode }>) => (
  <>
    <h2>{sentence_case(text(`gameplay.${id}`))}</h2>
    <p>{text(`gameplay.${id}_desc`)}</p>
    {formula && <Formula>{formula}</Formula>}
  </>
)
const Figures = ({ rows }: Readonly<{ rows: readonly (readonly [string, ReactNode])[] }>) => (
  <dl className="docs-facts">
    {rows.map(([label, value]) => (
      <div key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    ))}
  </dl>
)

/** Each element is driven by one stat; the row carries that stat's own icon and the element's colour. */
const Elements = ({ text }: Props) => (
  <ul className="docs-stats">
    {ELEMENT_STATS.map(([element, stat]) => (
      <li key={element} style={{ color: element_colors[element] }}>
        <StatGlyph stat={stat} />
        <b>{text(`gameplay.element_${element}`)}</b>
        <span>{text(`gameplay.stat_${stat}`)}</span>
      </li>
    ))}
  </ul>
)

const Combat = ({ text }: Props) => (
  <>
    <p className="docs-lede">{text('gameplay.combat_desc')}</p>
    <Formula>D = B × (100 + E + P) / 100 + R</Formula>
    <h2>{sentence_case(text('gameplay.elements'))}</h2>
    <Elements text={text} />
    <h2>{sentence_case(text('gameplay.critical_hits'))}</h2>
    <p>{text('gameplay.crit_desc')}</p>
    <Formula>C = 1 / max(2, C₀ − Cᵢ)</Formula>
    <p>{text('gameplay.crit_bonus_desc')}</p>
    <Topic id="blocking" text={text} />
    <Topic formula="D₂ = floor(D × (100 − min(RES, 50)) / 100)" id="resistance" text={text} />
    <Topic id="mob_level_bands" text={text} />
    <Topic formula="H = floor(ΔHP / 2)" id="life_steal" text={text} />
    <p>{text('gameplay.life_steal_note')}</p>
    <Topic formula={<LocalizedText path="ui.formula_chastisement" />} id="chatiment" text={text} />
    <Topic formula="H = B × (100 + INT) / 100 + H₊" id="healing" text={text} />
  </>
)

const Stats = ({ text }: Props) => (
  <>
    <ul className="docs-stats docs-stats--wide">
      {STATS.map((stat) => (
        <li key={stat} style={{ color: stat_colors[stat] }}>
          <StatGlyph stat={stat} />
          <b>{text(`gameplay.stat_${stat}`)}</b>
          <span>{text(`gameplay.stat_${stat}_desc`)}</span>
        </li>
      ))}
    </ul>
    <h2>{sentence_case(text('gameplay.derived_formulas'))}</h2>
    <Figures
      rows={[
        [text('gameplay.max_health'), '50 + 5 × LVL + VIT'],
        [text('gameplay.action_points'), String(CONTRACT_CONSTANTS.base_ap)],
        [text('gameplay.movement_points'), String(CONTRACT_CONSTANTS.base_mp)],
        [text('level'), String(max_level)],
      ]}
    />
  </>
)

const Leveling = ({ text }: Props) => {
  const numbers = useNumbers()
  const ui = useText()
  return (
    <>
      <p className="docs-lede">{text('gameplay.leveling_desc')}</p>
      <Figures
        rows={[
          [text('gameplay.stat_points'), text('gameplay.stat_points_value', { n: 5 })],
          [text('gameplay.spell_points'), text('gameplay.spell_points_value', { n: 1 })],
        ]}
      />
      <p>{text('gameplay.stat_costs_desc')}</p>
      <h2>{sentence_case(text('gameplay.xp_milestones'))}</h2>
      <Figures
        rows={[10, 50, 100].map(
          (level) =>
            [text(`gameplay.level_${level}`), `${numbers.number(xp_for_level(level)!)} ${ui('ui.xp')}`] as const
        )}
      />
      <Topic formula="XP₂ = XP × (100 + WIS) / 100" id="wisdom_xp" text={text} />
    </>
  )
}

const Loot = ({ text }: Props) => (
  <>
    <p className="docs-lede">{text('gameplay.loot_desc')}</p>
    <Topic id="stat_rolling" text={text} />
    <Topic id="archimobs" text={text} />
    <Topic formula={<LocalizedText path="ui.formula_drop" />} id="chance_loot" text={text} />
    <Topic id="mob_loot_band" text={text} />
  </>
)

const Groups = ({ text }: Props) => (
  <>
    <p className="docs-lede">{text('gameplay.groups_desc', { max: 6 })}</p>
    <Topic formula={<LocalizedText path="ui.formula_xp" />} id="groups_xp" text={text} />
    <Figures
      rows={RETRO_GROUP_XP_TENTHS.map(
        (coefficient, index) => [String(index + 1), `×${Number(coefficient) / 10}`] as const
      )}
    />
    <Topic id="groups_loot" text={text} />
  </>
)

const Dungeons = ({ text }: Props) => (
  <>
    <p className="docs-lede">{text('gameplay.dungeons_desc')}</p>
    <Figures
      rows={(['entry', 'instance', 'completion', 'reward'] as const).map(
        (key) => [text(`gameplay.dungeon_${key}`), text(`gameplay.dungeon_${key}_value`)] as const
      )}
    />
  </>
)

const FORGE_TOPICS = [
  'crushing',
  'rune_tiers',
  'rune_application',
  'success_rate',
  'puits',
  'over_maging',
  'forgemagie_tips',
] as const
const Forgemagie = ({ text }: Props) => (
  <>
    <p className="docs-lede">{text('gameplay.forgemagie_desc')}</p>
    {FORGE_TOPICS.map((id) => (
      <Topic id={id} key={id} text={text} />
    ))}
  </>
)

const PAGES: Readonly<Record<DocsMechanic, (props: Props) => ReactNode>> = {
  combat: Combat,
  stats: Stats,
  leveling: Leveling,
  loot: Loot,
  groups: Groups,
  dungeons: Dungeons,
  forgemagie: Forgemagie,
}

export const MechanicBody = ({ mechanic, text }: Props & Readonly<{ mechanic: DocsMechanic }>) => {
  const Page = PAGES[mechanic]
  return <Page text={text} />
}
