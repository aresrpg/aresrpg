// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ReactNode } from 'react'
import { ArrowRight, BookOpen, Check, ChevronDown, Compass, Sparkles } from 'lucide-react'

import { NewTabLink } from '../components/links.tsx'
import { market_item_href } from '../site/routes.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { docs_path } from '../docs/routes.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { pathname_for_page } from '../modules/navigation.ts'
import { dispatch_app } from '../store.ts'

import { next_quest, type JourneyQuest } from './model.ts'
import { useJourneySource } from './source.tsx'
import './journey.css'

const ItemArt = ({ item, className = '' }: Readonly<{ item: string; className?: string }>) => {
  const icon = item_detail_icon(item)
  return <img alt="" className={className} draggable={false} src={icon ?? undefined} />
}

const open_path = (pathname: string): void => {
  dispatch_app({ type: 'journey/journal', open: false })
  dispatch_app({ type: 'path/open', pathname })
}

/** The quest's jobs link opens the world with the character window on its Jobs tab. */
const open_jobs = (): void => {
  open_path(pathname_for_page('world'))
  dispatch_app({ type: 'dialog/open', dialog: 'character_jobs' })
}

const QuestActions = ({ quest, copy }: Readonly<{ quest: JourneyQuest; copy: AppCopy }>) => {
  const source = useJourneySource(copy)
  const { text } = source
  const { new_tab } = copy.site
  const docs_link = (label: string, href: string) => (
    <NewTabLink className="journey-button journey-button--secondary" href={href} new_tab={new_tab}>
      {label} <ArrowRight size={14} />
    </NewTabLink>
  )
  const details: Partial<Record<JourneyQuest['kind'], ReactNode>> = {
    harvest: docs_link(text('resource_details'), docs_path('items', quest.item)),
    hunt: docs_link(text('mob_details'), docs_path('bestiary', quest.mob)),
    map: (
      <button
        className="journey-button journey-button--secondary"
        onClick={() => {
          open_path(pathname_for_page('world'))
          dispatch_app({ type: 'dialog/open', dialog: 'world_map' })
        }}
        type="button"
      >
        {copy_text(copy.world_hud)('world_map')} <ArrowRight size={14} />
      </button>
    ),
  }
  const information = details[quest.kind]
  if (quest.kind === 'start')
    return (
      <button className="journey-button" onClick={() => dispatch_app({ type: 'journey/start' })} type="button">
        {text('start')} <ArrowRight size={15} />
      </button>
    )
  if (quest.id === 'suize') return null
  if (information) return information
  return (
    <div className="journey-actions">
      <NewTabLink className="journey-button" href={docs_path('items', quest.item)} new_tab={new_tab}>
        {text(quest.kind === 'dungeon' ? 'key_details' : 'recipe')} <ArrowRight size={14} />
      </NewTabLink>
      <button className="journey-button journey-button--secondary" onClick={open_jobs} type="button">
        {text('jobs')}
      </button>
      <NewTabLink
        className="journey-button journey-button--secondary"
        href={market_item_href(quest.item)}
        new_tab={new_tab}
      >
        {copy.site.market}
      </NewTabLink>
    </div>
  )
}

const JourneyProgress = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const {
    state: { completed },
    quests,
    text,
  } = useJourneySource(copy)
  const count = quests.filter(({ kind, id }) => kind !== 'start' && completed.includes(id)).length
  const total = quests.filter(({ kind }) => kind !== 'start').length
  return (
    <div className="journey-progress">
      <div
        aria-label={text('progress')}
        aria-valuemax={total}
        aria-valuemin={0}
        aria-valuenow={count}
        className="journey-meter"
        role="progressbar"
      >
        <span style={{ width: `${(100 * count) / total}%` }} />
      </div>
      <div className="journey-progress-caption">
        <span>{text('progress')}</span>
        <span>{text('count', { count, total })}</span>
      </div>
    </div>
  )
}

const Milestones = ({ copy, quest }: Readonly<{ copy: AppCopy; quest: JourneyQuest | null }>) => {
  const {
    state: { completed },
    quests,
    text,
  } = useJourneySource(copy)
  return (
    <div className="journey-milestones">
      {[...new Set(quests.map(({ chapter }) => chapter))]
        .filter((chapter) => chapter !== 'welcome')
        .map((chapter) => {
          const chapter_quests = quests.filter((row) => row.chapter === chapter)
          const done = chapter_quests.every(({ id }) => completed.includes(id))
          return (
            <div
              className={`journey-milestone ${done ? 'is-complete' : ''} ${quest?.chapter === chapter ? 'is-active' : ''}`}
              key={chapter}
            >
              <div className="journey-medal">
                <ItemArt item={chapter_quests[0]!.item} />
                {done && <Check aria-label={text('complete')} className="journey-medal-check" size={17} />}
              </div>
              <span>{text(`chapter_${chapter}`)}</span>
            </div>
          )
        })}
    </div>
  )
}

const useJourneyView = (copy: AppCopy) => {
  const { state: journey, quests } = useJourneySource(copy)
  const [celebrated] = journey.celebrations
  const quest = quests.find(({ id }) => id === celebrated) ?? next_quest(journey.completed, quests)
  const celebrating = Boolean(celebrated) && !journey.saving
  return { journey, celebrated, quest, celebrating }
}

const JourneyControls = ({ copy, compact }: Readonly<{ copy: AppCopy; compact: boolean }>) => {
  const { journey, celebrated, quest } = useJourneyView(copy)
  const source = useJourneySource(copy)
  const { text } = source
  if (journey.saving)
    return (
      <button className="journey-button" disabled type="button">
        {text('saving')}
      </button>
    )
  if (celebrated)
    return (
      <button className="journey-button" onClick={source.acknowledge} type="button">
        {text('continue')} <ArrowRight size={14} />
      </button>
    )
  if (compact)
    return (
      <button className="journey-button" onClick={() => source.journal(true)} type="button">
        <BookOpen size={14} />
        {text(quest?.kind === 'start' ? 'start' : 'journal')}
      </button>
    )
  return quest ? <QuestActions copy={copy} quest={quest} /> : null
}

const QuestCard = ({ copy, compact }: Readonly<{ copy: AppCopy; compact: boolean }>) => {
  const { celebrated, quest } = useJourneyView(copy)
  const source = useJourneySource(copy)
  const { text } = source
  if (!quest) return null
  const { id, item: item_type, chapter, kind } = quest
  const item = source.name(item_type)
  const objective = text(`${id}_objective`, { item })
  return (
    <div className="journey-quest" data-quest-kind={kind}>
      <div className="journey-art">
        <ItemArt item={item_type} />
      </div>
      <div className="journey-copy">
        <span className="journey-eyebrow">{text(`chapter_${chapter}`)}</span>
        <h3>{text(`${id}_title`)}</h3>
        <p>{text(`${id}_body`, { item })}</p>
        {kind === 'materials' && (
          <div className="journey-ingredients">
            {source.ingredients?.(item_type).map(({ item, have, need }) => (
              <NewTabLink key={item} href={docs_path('items', item)} new_tab={copy.site.new_tab}>
                <ItemArt item={item} />
                <span>{source.name(item)}</span>
                <strong>
                  {have} / {need}
                </strong>
              </NewTabLink>
            ))}
          </div>
        )}
        {objective && (
          <div className="journey-objective">
            <span className="journey-checkbox">{celebrated && <Check size={15} />}</span>
            <span>{objective}</span>
          </div>
        )}
        <div className="journey-actions">
          <JourneyControls compact={compact} copy={copy} />
        </div>
      </div>
    </div>
  )
}

const JourneyChecklist = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const {
    state: { completed },
    quests,
    text,
  } = useJourneySource(copy)
  return (
    <ol className="journey-checklist">
      {quests
        .filter(({ kind }) => kind !== 'start')
        .map((row) => (
          <li key={row.id}>
            <span className="journey-checkbox">
              {completed.includes(row.id) && <Check aria-label={text('complete')} size={13} />}
            </span>
            <span>{text(`${row.id}_title`)}</span>
          </li>
        ))}
    </ol>
  )
}

const JourneyNext = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const { journey, celebrated } = useJourneyView(copy)
  const { quests, text } = useJourneySource(copy)
  const following = next_quest(journey.completed, quests)
  if (!celebrated || !following) return null
  return (
    <div className="journey-next">
      <ItemArt item={following.item} />
      <span>
        {text('next')} <strong>{text(`${following.id}_title`)}</strong>
      </span>
    </div>
  )
}

export const JourneyPanel = ({ copy, compact }: Readonly<{ copy: AppCopy; compact: boolean }>) => {
  const { journey, celebrated, quest, celebrating } = useJourneyView(copy)
  const source = useJourneySource(copy)
  const { text } = source
  return (
    <section
      aria-label={text('title')}
      className={`journey-panel ${compact ? 'journey-panel--compact' : ''} ${celebrating ? 'is-celebrating' : ''}`}
    >
      <header className="journey-header">
        <div>
          <span className="journey-eyebrow">{text('eyebrow')}</span>
          <h2>{text('title')}</h2>
        </div>
        {compact ? (
          <button
            aria-label={text('collapse')}
            className="journey-icon-button"
            onClick={() => source.collapse(true)}
            type="button"
          >
            <ChevronDown size={17} />
          </button>
        ) : (
          <Compass aria-hidden="true" className="text-gold" size={26} />
        )}
      </header>
      {!compact && <Milestones copy={copy} quest={quest} />}
      <JourneyProgress copy={copy} />
      {celebrating && (
        <div className="journey-complete" key={celebrated} role="status">
          <Sparkles size={17} />
          <strong>{text('complete')}</strong>
          <Check size={17} />
        </div>
      )}
      <QuestCard compact={compact} copy={copy} />
      <JourneyNext copy={copy} />
      {journey.storage_failed && (
        <p className="journey-storage-warning" role="status">
          {text('storage_failed')}
        </p>
      )}
      {!compact && <JourneyChecklist copy={copy} />}
    </section>
  )
}

export const JourneyTracker = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const source = useJourneySource(copy)
  const { state: journey, available, text } = source
  if (!journey.ready || !journey.identity || !available || !next_quest(journey.completed, source.quests)) return null
  return (
    <aside className="journey-tracker">
      {source.collapsed ? (
        <button className="journey-launcher" onClick={() => source.collapse(false)} type="button">
          <BookOpen size={17} />
          <span>{text('title')}</span>
          {journey.celebrations.length > 0 && <Sparkles size={16} />}
        </button>
      ) : (
        <JourneyPanel compact copy={copy} />
      )}
    </aside>
  )
}
