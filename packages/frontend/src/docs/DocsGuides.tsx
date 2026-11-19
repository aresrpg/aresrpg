// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The written guides. Prose comes from the locale documents; every number and object comes from guide_facts.ts.
import type { ReactNode } from 'react'

import { ExternalLink } from '../components/links.tsx'
import { format_text } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { useVocabulary } from '../i18n/useVocabulary.ts'
import type { EncyclopediaText } from '../encyclopedia/copy.ts'
import type { AppCopy } from '../i18n/copy.ts'

import { ItemChip, MobChip, type DocsCopy } from './docs_parts.tsx'
import { MechanicBody } from './DocsMechanics.tsx'
import { character_price_sui, docs_counts, first_hour, market_terms } from './guide_facts.ts'
import { is_mechanic, type DocsGuide, type DocsMechanic } from './routes.ts'

type Copy = Readonly<{ copy: DocsCopy }>
type Chooser = AppCopy['landing_page']['chooser']
export type GuideLinks = Readonly<{ source: string; playbook: string; agent_guide: string; license: string }>

const Facts = ({ rows }: Readonly<{ rows: readonly (readonly [string, ReactNode])[] }>) => (
  <dl className="docs-facts">
    {rows.map(([label, value]) => (
      <div key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    ))}
  </dl>
)
const Points = ({ points }: Readonly<{ points: readonly string[] }>) => (
  <ul className="docs-points">
    {points.map((point) => (
      <li key={point}>{point}</li>
    ))}
  </ul>
)

const Overview = ({ copy }: Copy) => {
  const { overview } = copy
  const { number } = useNumbers()
  const counts = Object.entries(docs_counts) as readonly (readonly [keyof typeof docs_counts, number])[]
  return (
    <>
      <p className="docs-lede">{overview.lede}</p>
      <Facts rows={counts.map(([key, value]) => [overview.counts[key], number(value)] as const)} />
      <h2>{overview.protocol_title}</h2>
      <Points points={overview.protocol} />
      <h2>{overview.loop_title}</h2>
      <Points points={overview.loop} />
    </>
  )
}

const WAYS = [
  ['world', 'manual'],
  ['dapp', 'automated'],
  ['agent', 'automated'],
  ['telegram', 'automated'],
  ['sdk', 'manual'],
] as const
const WAY_HUES = { world: 'green', dapp: 'gold', agent: 'clay', telegram: 'sky', sdk: 'lilac' } as const

/** The interfaces of the protocol. Their names and figures are the home page's own, never a second copy. */
const Ways = ({ copy, chooser }: Copy & Readonly<{ chooser: Chooser }>) => (
  <>
    <p className="docs-lede">{copy.ways.lede}</p>
    <div className="docs-ways">
      {WAYS.map(([id, play]) => {
        const way = chooser.items[id]
        return (
          <section className="docs-way" data-hue={WAY_HUES[id]} key={id}>
            <header>
              <h2>{way.name}</h2>
              <small>{chooser.play[play]}</small>
            </header>
            <p>{way.body}</p>
            <Facts
              rows={[
                [chooser.specs.runs_in, way.runs_in],
                [chooser.specs.role, way.role],
                [chooser.specs.good_for, way.good_for],
                [chooser.specs.status, way.status],
              ]}
            />
          </section>
        )
      })}
    </div>
    <p className="docs-note">{copy.ways.note}</p>
  </>
)

const Bots = ({ copy }: Copy) => {
  const { bots } = copy
  return (
    <>
      <p className="docs-lede">{bots.lede}</p>
      <h2>{bots.wallet_title}</h2>
      <Points points={bots.wallet} />
      <h2>{bots.does_title}</h2>
      <Points points={bots.does} />
      <h2>{bots.control_title}</h2>
      <Points points={bots.control} />
    </>
  )
}

const StepRow = ({
  step,
  values,
  children,
}: Readonly<{
  step: Readonly<{ title: string; body: string }>
  values?: Readonly<Record<string, string | number>>
  children?: ReactNode
}>) => (
  <li>
    <div>
      <b>{step.title}</b> {format_text(step.body, values)}
      {children && <div className="docs-chips">{children}</div>}
    </div>
  </li>
)

const FirstHour = ({ copy }: Copy) => {
  const guide = copy.first_hour
  const vocabulary = useVocabulary()
  const { starter, tool, key } = first_hour
  const [create, fight, collect, craft, dungeon] = guide.steps
  return (
    <>
      <p className="docs-lede">{guide.lede}</p>
      <ol className="docs-steps">
        <StepRow step={create} values={{ price: character_price_sui }} />
        <StepRow step={fight}>
          {starter?.mobs.slice(0, 6).map((mob) => (
            <MobChip key={mob.mob_type} mob={mob} />
          ))}
        </StepRow>
        <StepRow step={collect}>
          {tool?.parts.map((part) => (
            <span className="docs-source" key={part.item.item_type}>
              <ItemChip item={part.item} quantity={part.quantity} />
              {part.mob && (
                <>
                  <MobChip mob={part.mob} />
                  <small>{format_text(guide.drop_chance, { chance: part.chance_bp / 100 })}</small>
                </>
              )}
            </span>
          ))}
        </StepRow>
        <StepRow step={craft} values={{ job: tool ? vocabulary.job(tool.job) : '' }}>
          {tool && <ItemChip item={tool.item} />}
        </StepRow>
        <StepRow step={dungeon}>{key && <ItemChip item={key} />}</StepRow>
      </ol>
    </>
  )
}

const Market = ({ copy }: Copy) => {
  const { market } = copy
  return (
    <>
      <p className="docs-lede">{market.lede}</p>
      <Facts
        rows={[
          [market.royalty, `${market_terms.royalty_percent}%`],
          [market.royalty_floor, `${market_terms.royalty_floor_sui} SUI`],
          [market.lot_sizes, market_terms.lot_sizes.join(' / ')],
        ]}
      />
      <Points points={market.points} />
    </>
  )
}

/** The token is not launched: the page says so and states no figure. */
const Kares = ({ copy }: Copy) => (
  <>
    <p className="docs-lede">{copy.kares.lede}</p>
    <p className="docs-note">{copy.kares.note}</p>
  </>
)

const Agents = ({ copy, links }: Copy & Readonly<{ links: GuideLinks }>) => {
  const { agents } = copy
  return (
    <>
      <p className="docs-lede">{agents.lede}</p>
      <ol className="docs-steps">
        {agents.steps.map((step) => (
          <li key={step}>
            <div>{step}</div>
          </li>
        ))}
      </ol>
      <Points points={agents.points} />
      <p className="docs-links">
        <ExternalLink className="docs-text-link" href={links.agent_guide} new_tab={copy.new_tab}>
          {agents.guide}
        </ExternalLink>
        <ExternalLink className="docs-text-link" href={links.playbook} new_tab={copy.new_tab}>
          {agents.index}
        </ExternalLink>
      </p>
    </>
  )
}

const Build = ({ copy, links }: Copy & Readonly<{ links: GuideLinks }>) => {
  const { build } = copy
  return (
    <>
      <p className="docs-lede">{build.lede}</p>
      <div className="docs-cards">
        <ExternalLink className="docs-card" href={links.source} new_tab={copy.new_tab}>
          <b>{build.source_title}</b>
          {build.source_body}
        </ExternalLink>
        <ExternalLink className="docs-card" href={links.playbook} new_tab={copy.new_tab}>
          <b>{build.playbook_title}</b>
          {build.playbook_body}
        </ExternalLink>
      </div>
      <h2>{build.blocks_title}</h2>
      <Points points={build.blocks} />
      <h2>{build.license_title}</h2>
      <h3>{build.allowed_title}</h3>
      <Points points={build.allowed} />
      <h3>{build.forbidden_title}</h3>
      <Points points={build.forbidden} />
      <p className="docs-note">{build.license_note}</p>
      <p className="docs-links">
        <ExternalLink className="docs-text-link" href={links.license} new_tab={copy.new_tab}>
          {build.license_link}
        </ExternalLink>
      </p>
    </>
  )
}

type GuideProps = Readonly<{ links: GuideLinks; chooser: Chooser; text: EncyclopediaText }> & Copy
/** One renderer per written guide. A mechanics page is rendered by its own module. */
const GUIDES: Readonly<Record<Exclude<DocsGuide, DocsMechanic>, (props: GuideProps) => ReactNode>> = {
  overview: ({ copy }) => <Overview copy={copy} />,
  ways: ({ copy, chooser }) => <Ways chooser={chooser} copy={copy} />,
  'first-hour': ({ copy }) => <FirstHour copy={copy} />,
  bots: ({ copy }) => <Bots copy={copy} />,
  market: ({ copy }) => <Market copy={copy} />,
  kares: ({ copy }) => <Kares copy={copy} />,
  agents: ({ copy, links }) => <Agents copy={copy} links={links} />,
  build: ({ copy, links }) => <Build copy={copy} links={links} />,
}

export const GuideBody = ({ guide, ...props }: Readonly<{ guide: DocsGuide }> & GuideProps) =>
  is_mechanic(guide) ? <MechanicBody mechanic={guide} text={props.text} /> : GUIDES[guide](props)
