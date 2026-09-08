// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { LEADERBOARD_METRICS, type LeaderboardEntry } from '@aresrpg/protocol'

import { copy_text } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { BADGE_COLORS, display_address, leaderboard_score, compact_leaderboard_score } from './presentation.ts'
import './leaderboards.css'

const Badge = ({
  identity,
  label,
  level,
  title,
}: Readonly<{ identity: string; label: string; level: number; title: string }>) => {
  const [dark, light] = BADGE_COLORS[identity] ?? ['#7F8C8D', '#95A5A6']
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 text-[9px] tracking-wide uppercase"
      style={{
        background: `linear-gradient(135deg, ${dark}30, ${light}18)`,
        border: `1px solid ${light}40`,
        color: light,
      }}
      title={title}
    >
      <span className="opacity-70">{label}</span>
      <span className="mx-0.5 opacity-30">·</span>
      <b>{level}</b>
    </span>
  )
}

const EntryBadges = ({ entry }: Readonly<{ entry: LeaderboardEntry }>) => {
  const copy = useAppStore(({ copy }) => copy)
  const metric = useAppStore(({ leaderboards }) => leaderboards.observation.metric)
  if (!copy) return null
  const text = copy_text(copy.leaderboard_page)
  const characters = metric === 'xp'
  const badges = characters
    ? entry.characters.map(({ name, classe, level }) => ({
        key: name,
        identity: classe,
        label: classe,
        level,
        title: name,
      }))
    : entry.jobs.map(({ job, level }) => ({
        key: job,
        identity: job,
        label: text(`job_${job}`),
        level,
        title: text(`job_${job}`),
      }))
  const total = characters ? entry.character_count : entry.jobs.length
  return (
    <div className="flex flex-wrap items-center gap-1" title={text(characters ? 'current_characters' : 'current_jobs')}>
      {badges.slice(0, 6).map(({ key, ...badge }) => (
        <Badge key={key} {...badge} />
      ))}
      {total > 6 && <span className="text-[9px] text-muted">+{total - 6}</span>}
    </div>
  )
}

const EntryRow = ({ entry }: Readonly<{ entry: LeaderboardEntry }>) => {
  const copy = useAppStore(({ copy }) => copy)
  const { observation } = useAppStore(({ leaderboards }) => leaderboards)
  const address = useAppStore(({ session }) => session.wallet?.address)
  const locale = useAppStore(({ locale }) => locale)
  if (!copy) return null
  const text = copy_text(copy.leaderboard_page)
  const self = entry.address === address
  return (
    <div role="row" className={`leaderboard-row text-[11px] ${self ? 'leaderboard-row-self' : ''}`}>
      <span role="cell" className="text-[10px] text-muted">
        {entry.rank}
      </span>
      <div role="cell" className="flex min-w-0 flex-col gap-1">
        <span title={entry.address} className="truncate text-text">
          {entry.name ?? display_address(entry.address)}
        </span>
        {['xp', 'jobs'].includes(observation.metric) && <EntryBadges entry={entry} />}
      </div>
      <span
        role="cell"
        className="pl-2 text-right font-semibold break-all text-gold"
        title={leaderboard_score(entry.score, observation.metric, locale)}
      >
        {compact_leaderboard_score(entry.score, observation.metric, locale)}
      </span>
      <span role="cell" className="text-right text-[9px] text-muted">
        {self ? text('you') : '—'}
      </span>
    </div>
  )
}

const Podium = () => {
  const { snapshot, observation } = useAppStore(({ leaderboards }) => leaderboards)
  const locale = useAppStore(({ locale }) => locale)
  if (!snapshot?.entries.length) return null
  const positions = [1, 0, 2]
  const heights = [80, 100, 70]
  const colors = ['#9ca3af', '#c8963c', '#cd7f32']
  return (
    <div className="flex w-full items-end justify-center gap-2 px-2">
      {positions.map((position, index) => {
        const entry = snapshot.entries[position]
        return entry ? (
          <div
            key={entry.address}
            className="leaderboard-podium min-w-0 flex-1 max-w-[120px] lg:max-w-[140px]"
            style={{
              minHeight: heights[index],
              borderTopColor: colors[index],
              borderTopWidth: 3,
              animationDelay: `${index * 60}ms`,
            }}
          >
            <div className="text-[9px] tracking-[0.2em]" style={{ color: colors[index] }}>
              #{entry.rank}
            </div>
            <span
              title={entry.address}
              className="mt-1 max-w-full truncate text-center text-[11px] font-semibold text-text"
            >
              {entry.name ?? display_address(entry.address)}
            </span>
            <div
              className="mt-1 max-w-full text-center text-[12px] font-bold break-all"
              style={{ color: colors[index] }}
            >
              {compact_leaderboard_score(entry.score, observation.metric, locale)}
            </div>
          </div>
        ) : (
          <div key={position} className="min-w-0 max-w-[120px] flex-1 lg:max-w-[140px]" />
        )
      })}
    </div>
  )
}

const CategoryTabs = () => {
  const copy = useAppStore(({ copy }) => copy)
  const { observation } = useAppStore(({ leaderboards }) => leaderboards)
  if (!copy) return null
  const text = copy_text(copy.leaderboard_page)
  return (
    <div
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border pb-3"
      role="tablist"
      aria-label={text('category')}
    >
      {LEADERBOARD_METRICS.map((metric) => (
        <button
          key={metric}
          type="button"
          role="tab"
          aria-selected={metric === observation.metric}
          className={`leaderboard-category ${metric === observation.metric ? 'active' : ''}`}
          onClick={() => dispatch_app({ type: 'leaderboards/select', metric, season: observation.season })}
        >
          {text(metric)}
        </button>
      ))}
    </div>
  )
}

const SeasonControls = () => {
  const copy = useAppStore(({ copy }) => copy)
  const { observation, snapshot } = useAppStore(({ leaderboards }) => leaderboards)
  if (!copy || !snapshot) return null
  const text = copy_text(copy.leaderboard_page)
  const select = (season: number | null): void =>
    dispatch_app({ type: 'leaderboards/select', metric: observation.metric, season })
  const next = snapshot.season + 1 === snapshot.current_season ? null : snapshot.season + 1
  return (
    <div className="flex flex-wrap items-center gap-3 text-[9px] tracking-[0.12em] text-muted uppercase">
      <button
        type="button"
        className="leaderboard-time"
        disabled={snapshot.season === 0}
        onClick={() => select(snapshot.season - 1)}
      >
        {text('previous')}
      </button>
      <span className="text-gold">{text('season', { season: snapshot.season + 1 })}</span>
      <button
        type="button"
        className="leaderboard-time"
        disabled={snapshot.season === snapshot.current_season}
        onClick={() => select(next)}
      >
        {text('next')}
      </button>
      <button
        type="button"
        className={`leaderboard-time ${observation.season === null ? 'active' : ''}`}
        onClick={() => select(null)}
      >
        {text('current')}
      </button>
      <span>{text('epochs', { start: snapshot.start_epoch, end: snapshot.end_epoch - 1 })}</span>
      {snapshot.season === snapshot.current_season && (
        <span>{text('remaining', { epochs: snapshot.end_epoch - snapshot.epoch })}</span>
      )}
    </div>
  )
}

const ErrorNotice = () => {
  const copy = useAppStore(({ copy }) => copy)
  const error = useAppStore(({ leaderboards }) => leaderboards.error)
  if (!copy || !error) return null
  const text = copy_text(copy.leaderboard_page)
  return (
    <div role="alert" className="flex items-center gap-3 text-[10px] text-muted">
      {text('unavailable')}
      <button type="button" className="leaderboard-time" onClick={() => dispatch_app({ type: 'leaderboards/refresh' })}>
        {text('retry')}
      </button>
    </div>
  )
}

const Rankings = () => {
  const copy = useAppStore(({ copy }) => copy)
  const { snapshot, observation, error } = useAppStore(({ leaderboards }) => leaderboards)
  if (!copy) return null
  const text = copy_text(copy.leaderboard_page)
  if (!snapshot)
    return error ? null : (
      <p role="status" className="animate-pulse text-[10px] tracking-[0.2em] text-muted uppercase">
        {text('loading')}
      </p>
    )
  if (!snapshot.entries.length)
    return <div className="py-16 text-center text-[10px] tracking-[0.2em] text-muted uppercase">{text('empty')}</div>
  const { self } = snapshot
  const outside = self && !snapshot.entries.some(({ address }) => address === self.address)
  return (
    <>
      <Podium />
      <div
        role="table"
        aria-label={text(observation.metric)}
        className="leaderboard-glass flex flex-col divide-y divide-border/50"
      >
        <div
          role="row"
          className="leaderboard-row border-b border-border text-[9px] tracking-[0.1em] text-muted uppercase"
        >
          <span role="columnheader">#</span>
          <span role="columnheader">{text('user')}</span>
          <span role="columnheader" className="text-right">
            {text('score')}
          </span>
          <span />
        </div>
        {snapshot.entries.map((entry) => (
          <EntryRow key={entry.address} entry={entry} />
        ))}
      </div>
      {outside && (
        <div role="table" aria-label={text('you')}>
          <EntryRow entry={self} />
        </div>
      )}
    </>
  )
}

export default function LeaderboardPage() {
  const copy = useAppStore(({ copy }) => copy)
  const metric = useAppStore(({ leaderboards }) => leaderboards.observation.metric)
  if (!copy) return null
  const text = copy_text(copy.leaderboard_page)
  return (
    <section
      className="pointer-events-auto z-12 flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-3 lg:p-6"
      aria-label={copy.leaderboard}
    >
      <CategoryTabs />
      <SeasonControls />
      <p className="text-[10px] leading-5 text-muted">{text(`${metric}_description`)}</p>
      <ErrorNotice />
      <Rankings />
      <p className="text-[9px] leading-5 text-muted">{text('suins_hint')}</p>
    </section>
  )
}
