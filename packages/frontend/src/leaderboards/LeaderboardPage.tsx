// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { LEADERBOARD_LIMIT, LEADERBOARD_METRICS, type LeaderboardEntry } from '@aresrpg/protocol'

import podium_first from '../assets/leaderboards/podium-1.png'
import podium_second from '../assets/leaderboards/podium-2.png'
import podium_third from '../assets/leaderboards/podium-3.png'
import { copy_text } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import {
  BADGE_COLORS,
  display_address,
  display_suins_name,
  leaderboard_score,
  compact_leaderboard_score,
} from './presentation.ts'
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
    <div role="row" className={`leaderboard-row leaderboard-row-filled text-xs ${self ? 'leaderboard-row-self' : ''}`}>
      <span role="cell" className="text-[10px] text-muted">
        {entry.rank}
      </span>
      <div role="cell" className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span title={[entry.name, entry.address].filter(Boolean).join(' · ')} className="truncate text-text">
            {entry.name ? display_suins_name(entry.name) : display_address(entry.address)}
          </span>
          {self && <span className="shrink-0 text-[10px] text-cyan uppercase">{text('you')}</span>}
        </div>
        {['xp', 'jobs'].includes(observation.metric) && <EntryBadges entry={entry} />}
      </div>
      <span
        role="cell"
        className="pl-2 text-right font-semibold break-all text-gold"
        title={leaderboard_score(entry.score, observation.metric, locale)}
      >
        {compact_leaderboard_score(entry.score, observation.metric, locale)}
      </span>
    </div>
  )
}

const Podium = () => {
  const { snapshot, observation } = useAppStore(({ leaderboards }) => leaderboards)
  const locale = useAppStore(({ locale }) => locale)
  const copy = useAppStore(({ copy }) => copy)
  if (!copy) return null
  const text = copy_text(copy.leaderboard_page)
  return (
    <div className="leaderboard-standings">
      {[1, 0, 2].map((position) => {
        const entry = snapshot?.entries[position]
        return (
          <div key={position} className="leaderboard-podium" data-rank={position + 1}>
            <img
              className="leaderboard-medal"
              src={[podium_first, podium_second, podium_third][position]}
              alt=""
              width={128}
              height={128}
              draggable={false}
            />
            <span
              title={[entry?.name, entry?.address].filter(Boolean).join(' · ')}
              className="w-full truncate text-center text-xs text-text"
            >
              {entry
                ? entry.name
                  ? display_suins_name(entry.name)
                  : display_address(entry.address)
                : text('unclaimed')}
            </span>
            <div
              className="mt-2 max-w-full text-center text-lg font-semibold break-all"
              title={entry ? leaderboard_score(entry.score, observation.metric, locale) : undefined}
            >
              {entry ? compact_leaderboard_score(entry.score, observation.metric, locale) : '—'}
            </div>
            <span className="mt-1 text-center text-[10px] tracking-wide text-muted uppercase">
              {text(observation.metric)}
            </span>
            <div className="leaderboard-step">#{position + 1}</div>
          </div>
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
          onClick={() => dispatch_app({ type: 'leaderboards/select', metric })}
        >
          {text(metric)}
        </button>
      ))}
    </div>
  )
}

const ResetCountdown = () => {
  const copy = useAppStore(({ copy }) => copy)
  const snapshot = useAppStore(({ leaderboards }) => leaderboards.snapshot)
  const locale = useAppStore(({ locale }) => locale)
  if (!copy || !snapshot) return null
  const days = Math.max(0, Math.ceil((snapshot.reset_at_ms - snapshot.timestamp_ms) / 86_400_000))
  const time = new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(days, 'day')
  return (
    <p className="text-[10px] tracking-[0.12em] text-gold uppercase">
      {copy_text(copy.leaderboard_page)('reset_in', { time })}
    </p>
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
      <button
        type="button"
        className="leaderboard-action"
        onClick={() => dispatch_app({ type: 'leaderboards/refresh' })}
      >
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
  const self = snapshot?.self
  const outside = self && !snapshot.entries.some(({ address }) => address === self.address)
  return (
    <>
      {!snapshot && !error && (
        <p role="status" className="animate-pulse text-[10px] tracking-[0.2em] text-muted uppercase">
          {text('loading')}
        </p>
      )}
      <Podium />
      <div
        role="table"
        aria-label={text(observation.metric)}
        className="flex flex-col divide-y divide-border/50 border border-border bg-surface-low"
      >
        <div
          role="row"
          className="leaderboard-row sticky top-0 z-1 border-b border-border bg-surface text-[10px] tracking-[0.1em] text-muted uppercase"
        >
          <span role="columnheader">#</span>
          <span role="columnheader">{text('user')}</span>
          <span role="columnheader" className="text-right">
            {text('score')}
          </span>
        </div>
        {Array.from({ length: LEADERBOARD_LIMIT }, (_, index) => {
          const entry = snapshot?.entries[index]
          return entry ? (
            <EntryRow key={index} entry={entry} />
          ) : (
            <div key={index} role="row" className="leaderboard-row text-[11px] text-muted">
              <span role="cell" className="text-[10px]">
                {index + 1}
              </span>
              <span role="cell">—</span>
              <span role="cell" className="text-right">
                —
              </span>
            </div>
          )
        })}
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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-medium text-text">{copy.leaderboard}</h1>
        <ResetCountdown />
      </header>
      <CategoryTabs />
      <p className="text-[10px] leading-5 text-muted">{text(`${metric}_description`)}</p>
      <ErrorNotice />
      <Rankings />
      <p className="text-[9px] leading-5 text-muted">{text('suins_hint')}</p>
    </section>
  )
}
