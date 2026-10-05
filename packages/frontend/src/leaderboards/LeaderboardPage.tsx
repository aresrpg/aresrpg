// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { LEADERBOARD_LIMIT, type LeaderboardEntry } from '@aresrpg/protocol'

import podium_first from '../assets/leaderboards/podium-1.png'
import podium_second from '../assets/leaderboards/podium-2.png'
import podium_third from '../assets/leaderboards/podium-3.png'
import { copy_text } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { player_name, leaderboard_score, compact_leaderboard_score } from './presentation.ts'
import { PlayerProfileModal } from './PlayerProfileModal.tsx'
import { BadgeRow } from './BadgeRow.tsx'
import { LeaderboardCategories } from './LeaderboardCategories.tsx'
import { useLeaderboardState, useLeaderboardDispatch } from './LeaderboardSource.tsx'
import './leaderboards.css'

const EntryBadges = ({ entry }: Readonly<{ entry: LeaderboardEntry }>) => {
  const copy = useAppStore(({ copy }) => copy)
  const { metric } = useLeaderboardState().observation
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
  return <BadgeRow badges={badges} total={total} title={text(characters ? 'current_characters' : 'current_jobs')} />
}

const EntryRow = ({ entry }: Readonly<{ entry: LeaderboardEntry }>) => {
  const copy = useAppStore(({ copy }) => copy)
  const { observation } = useLeaderboardState()
  const dispatch = useLeaderboardDispatch()
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
      <div role="cell" className="leaderboard-user">
        <div className="leaderboard-user-name">
          <button
            type="button"
            onClick={() => dispatch({ type: 'leaderboards/inspect', address: entry.address, name: entry.name })}
            title={[entry.name, entry.address].filter(Boolean).join(' · ')}
            className="leaderboard-player-name truncate text-left text-text hover:text-gold"
          >
            {player_name(entry)}
          </button>
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
  const { snapshot, observation } = useLeaderboardState()
  const dispatch = useLeaderboardDispatch()
  const locale = useAppStore(({ locale }) => locale)
  const copy = useAppStore(({ copy }) => copy)
  if (!copy) return null
  const text = copy_text(copy.leaderboard_page)
  return (
    <div className="leaderboard-standings" aria-label={text(observation.metric)}>
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
            <button
              type="button"
              disabled={!entry}
              onClick={() =>
                entry && dispatch({ type: 'leaderboards/inspect', address: entry.address, name: entry.name })
              }
              title={[entry?.name, entry?.address].filter(Boolean).join(' · ')}
              className="leaderboard-player-name w-full truncate text-center text-xs text-text"
            >
              {entry ? player_name(entry) : text('unclaimed')}
            </button>
            <div
              className="mt-2 max-w-full text-center text-lg font-semibold break-all"
              title={entry ? leaderboard_score(entry.score, observation.metric, locale) : undefined}
            >
              {entry ? compact_leaderboard_score(entry.score, observation.metric, locale) : '—'}
            </div>
            <span className="mt-1 text-center text-[10px] tracking-wide text-muted uppercase">
              {text(observation.metric)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const ResetCountdown = () => {
  const copy = useAppStore(({ copy }) => copy)
  const { snapshot } = useLeaderboardState()
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
  const dispatch_app = useLeaderboardDispatch()
  const copy = useAppStore(({ copy }) => copy)
  const { error } = useLeaderboardState()
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
  const { snapshot, observation, error } = useLeaderboardState()
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
      <div role="table" aria-label={text(observation.metric)} className="leaderboard-table">
        <div role="row" className="sr-only">
          <span role="columnheader">#</span>
          <span role="columnheader">{text('user')}</span>
          <span role="columnheader" className="text-right">
            {text('score')}
          </span>
        </div>
        <div className="leaderboard-entries" role="rowgroup">
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
  const { metric } = useLeaderboardState().observation
  if (!copy) return null
  const text = copy_text(copy.leaderboard_page)
  return (
    <section className="leaderboard-page" aria-label={copy.leaderboard}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-medium text-text">{copy.leaderboard}</h1>
        <ResetCountdown />
      </header>
      <LeaderboardCategories />
      <p className="leaderboard-description text-[10px] leading-5 text-muted">{text(`${metric}_description`)}</p>
      <ErrorNotice />
      <Rankings />
      <PlayerProfileModal />
      <p className="leaderboard-hint text-[9px] leading-5 text-muted">{text('suins_hint')}</p>
    </section>
  )
}
