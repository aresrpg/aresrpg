// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowRight, BookOpen, Check, ChevronDown, Compass, Pickaxe, Sparkles } from 'lucide-react'

import { item_detail_icon } from '../content/item_detail_assets.ts'
import { content_catalog } from '../content/catalog.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { JOURNEY_CHAPTERS, JOURNEY_QUESTS, next_quest, type JourneyQuest } from './model.ts'
import { journey_tracker_available } from './facts.ts'
import './journey.css'

const ItemArt = ({ item, className = '' }: Readonly<{ item: string; className?: string }>) => (
  <img alt="" className={className} draggable={false} src={item_detail_icon(item) ?? undefined} />
)

const open_journal = (): void => dispatch_app({ type: 'journey/journal', open: true })

const open_path = (pathname: string): void => {
  dispatch_app({ type: 'journey/journal', open: false })
  dispatch_app({ type: 'path/open', pathname })
}

const QuestActions = ({ quest, copy }: Readonly<{ quest: JourneyQuest; copy: AppCopy }>) => {
  const text = copy_text(copy.journey)
  if (quest.kind === 'start')
    return (
      <button className="journey-button" onClick={() => dispatch_app({ type: 'journey/start' })} type="button">
        {text('start')} <ArrowRight size={15} />
      </button>
    )
  if (quest.id === 'suize') return null
  if (quest.kind === 'harvest')
    return (
      <button
        className="journey-button journey-button--secondary"
        onClick={() => open_path(`/encyclopedia/items/${quest.item}`)}
        type="button"
      >
        {text('resource_details')} <ArrowRight size={14} />
      </button>
    )
  return (
    <div className="journey-actions">
      <button className="journey-button" onClick={() => open_path(`/encyclopedia/items/${quest.item}`)} type="button">
        {text(quest.kind === 'dungeon' ? 'key_details' : 'recipe')} <ArrowRight size={14} />
      </button>
      <button
        className="journey-button journey-button--secondary"
        onClick={() => open_path('/characters/jobs')}
        type="button"
      >
        {text('jobs')}
      </button>
      <button
        className="journey-button journey-button--secondary"
        onClick={() => open_path('/marketplace')}
        type="button"
      >
        {copy.marketplace}
      </button>
    </div>
  )
}

const JourneyProgress = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const completed = useAppStore((state) => state.journey.completed)
  const text = copy_text(copy.journey)
  const count = JOURNEY_QUESTS.filter(({ kind, id }) => kind !== 'start' && completed.includes(id)).length
  const total = JOURNEY_QUESTS.length - 1
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
  const completed = useAppStore((state) => state.journey.completed)
  const text = copy_text(copy.journey)
  return (
    <div className="journey-milestones">
      {JOURNEY_CHAPTERS.filter((chapter) => chapter !== 'welcome').map((chapter) => {
        const quests = JOURNEY_QUESTS.filter((row) => row.chapter === chapter)
        const done = quests.every(({ id }) => completed.includes(id))
        return (
          <div
            className={`journey-milestone ${done ? 'is-complete' : ''} ${quest?.chapter === chapter ? 'is-active' : ''}`}
            key={chapter}
          >
            <div className="journey-medal">
              <ItemArt item={quests[0]!.item} />
              {done && <Check aria-label={text('complete')} className="journey-medal-check" size={17} />}
            </div>
            <span>{text(`chapter_${chapter}`)}</span>
          </div>
        )
      })}
    </div>
  )
}

const useJourneyView = () => {
  const journey = useAppStore((state) => state.journey)
  const [celebrated] = journey.celebrations
  const quest = JOURNEY_QUESTS.find(({ id }) => id === celebrated) ?? next_quest(journey.completed)
  const display = quest ?? { id: 'finished', chapter: 'finished', item: 'wheat_suize', kind: 'start' }
  const celebrating = Boolean(celebrated) && !journey.saving
  return { journey, celebrated, quest, display, celebrating }
}

const JourneyControls = ({ copy, compact }: Readonly<{ copy: AppCopy; compact: boolean }>) => {
  const { journey, celebrated, quest } = useJourneyView()
  const text = copy_text(copy.journey)
  if (journey.saving)
    return (
      <button className="journey-button" disabled type="button">
        {text('saving')}
      </button>
    )
  if (celebrated)
    return (
      <button className="journey-button" onClick={() => dispatch_app({ type: 'journey/acknowledged' })} type="button">
        {text('continue')} <ArrowRight size={14} />
      </button>
    )
  if (compact)
    return (
      <button className="journey-button" onClick={open_journal} type="button">
        <BookOpen size={14} />
        {text(quest?.kind === 'start' ? 'start' : 'journal')}
      </button>
    )
  return quest ? (
    <QuestActions copy={copy} quest={quest} />
  ) : (
    <button
      className="journey-button"
      onClick={() => {
        dispatch_app({ type: 'automation/collapse', collapsed: false })
        dispatch_app({ type: 'journey/collapse', collapsed: true })
        open_path('/')
      }}
      type="button"
    >
      <Pickaxe size={15} /> {text('automation_reward_action')}
    </button>
  )
}

const QuestCard = ({ copy, compact }: Readonly<{ copy: AppCopy; compact: boolean }>) => {
  const { celebrated, display } = useJourneyView()
  const text = copy_text(copy.journey)
  const { id, item: item_type, chapter, kind } = display
  const item = content_catalog.item(item_type)!.item.name
  const objective = text(`${id}_objective`, { item })
  return (
    <div className="journey-quest" data-quest-kind={kind}>
      <div className="journey-art">
        {id === 'finished' ? (
          <Pickaxe aria-hidden="true" className="size-20 text-cyan" />
        ) : (
          <ItemArt item={item_type} />
        )}
      </div>
      <div className="journey-copy">
        <span className="journey-eyebrow">{text(`chapter_${chapter}`)}</span>
        <h3>{text(`${id}_title`)}</h3>
        <p>{text(`${id}_body`, { item })}</p>
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
  const completed = useAppStore((state) => state.journey.completed)
  const text = copy_text(copy.journey)
  return (
    <ol className="journey-checklist">
      {JOURNEY_QUESTS.filter(({ kind }) => kind !== 'start').map((row) => (
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
  const { journey, celebrated } = useJourneyView()
  const following = next_quest(journey.completed)
  const text = copy_text(copy.journey)
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
  const { journey, celebrated, quest, celebrating } = useJourneyView()
  const text = copy_text(copy.journey)
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
            onClick={() => dispatch_app({ type: 'journey/collapse', collapsed: true })}
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
  const journey = useAppStore((state) => state.journey)
  const available = useAppStore(journey_tracker_available)
  if (!journey.ready || !journey.identity || !available) return null
  const text = copy_text(copy.journey)
  return (
    <aside className="journey-tracker">
      {journey.collapsed ? (
        <button
          className="journey-launcher"
          onClick={() => dispatch_app({ type: 'journey/collapse', collapsed: false })}
          type="button"
        >
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
