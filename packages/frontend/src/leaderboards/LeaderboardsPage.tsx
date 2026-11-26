// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The rankings page, on the page's ground: a left lane with the title, the reset line and the categories as a quiet
// index, then the board: its metric, the podium as three cards and the ranked rows. A visitor reads it signed out.
// Every place is there at once and the board fills it; a board the server refuses is a toast with a retry, never a
// line in the page.
import { useEffect } from 'react'
import {
  LEADERBOARD_LIMIT,
  LEADERBOARD_METRICS,
  type LeaderboardEntry,
  type LeaderboardMetric,
} from '@aresrpg/protocol'

import podium_first from '../assets/leaderboards/podium-1.png'
import podium_second from '../assets/leaderboards/podium-2.png'
import podium_third from '../assets/leaderboards/podium-3.png'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { Choice } from '../marketplace/MarketParts.tsx'
import { board_metric, FIRST_BOARD, shown_snapshot } from '../modules/leaderboards.ts'
import { dispatch_app, useSiteStore } from '../store.ts'

import { AgentBadge } from './AgentBadge.tsx'
import { is_agent_entry, player_name, leaderboard_score, compact_leaderboard_score } from './presentation.ts'
import { PlayerProfileModal } from './PlayerProfileModal.tsx'
import { BadgeRow } from './BadgeRow.tsx'
import './leaderboards.css'

/** A ranked row: rank, player, badges, score, over a hairline that fades at both ends. A phone drops the badges. */
const ROW =
  'leaderboard-row grid h-11 min-w-0 grid-cols-[40px_minmax(0,200px)_minmax(0,1fr)_auto] items-center gap-x-4 rounded-[4px] bg-[linear-gradient(90deg,transparent,var(--aui-hair)_10%,var(--aui-hair)_90%,transparent)] bg-size-[100%_1px] bg-bottom bg-no-repeat px-3 transition-colors duration-150 hover:bg-text/[3.5%] max-[600px]:grid-cols-[26px_minmax(0,1fr)_auto] max-[600px]:gap-x-2.5 max-[600px]:px-1.5'
const RANK = 'text-right font-mono text-[13px] text-faint tabular-nums'
const SCORE = 'text-right font-mono text-sm font-semibold text-soft tabular-nums'
/** A player's name opens their profile; a touch screen gets the full target. */
const NAME =
  '-ml-1.25 block max-w-full cursor-pointer truncate rounded-[3px] px-1.25 py-0.75 text-left font-bold text-text transition-colors duration-150 hover:bg-hair hover:text-gold-light disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-text pointer-coarse:min-h-11'
/** A podium card: the medal beside the name and the score; on a phone they stack, centred. */
const PODIUM =
  'leaderboard-podium grid grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto] items-center gap-x-3.5 gap-y-0.5 rounded-md border border-line px-5 py-4.5 data-[rank=1]:border-line-strong data-[rank=1]:py-7.5 max-[600px]:grid-cols-[minmax(0,1fr)] max-[600px]:justify-items-center max-[600px]:px-1.5 max-[600px]:py-3 max-[600px]:text-center max-[600px]:data-[rank=1]:py-4.5'

const useMetric = (): LeaderboardMetric => board_metric(useSiteStore((state) => state.leaderboards))
const inspect = (entry: LeaderboardEntry) => () =>
  dispatch_app({ type: 'leaderboards/inspect', address: entry.address, name: entry.name })

const EntryBadges = ({ entry, copy }: Readonly<{ entry: LeaderboardEntry; copy: AppCopy }>) => {
  const metric = useMetric()
  const text = copy_text(copy.leaderboard_page)
  const characters = metric === 'xp'
  const badges = characters
    ? entry.characters.map(({ name, classe, level }) => ({ key: name, label: classe, level, title: name }))
    : entry.jobs.map(({ job, level }) => ({ key: job, label: text(`job_${job}`), level, title: text(`job_${job}`) }))
  const total = characters ? entry.character_count : entry.jobs.length
  return <BadgeRow badges={badges} total={total} title={text(characters ? 'current_characters' : 'current_jobs')} />
}

/** A ranked account's name. A hosted bot carries its badge before it. */
const LeaderboardName = ({ entry, fallback = '' }: Readonly<{ entry?: LeaderboardEntry; fallback?: string }>) => {
  if (!entry) return fallback
  return (
    <>
      {is_agent_entry(entry) && <AgentBadge />}
      {player_name(entry)}
    </>
  )
}

const EntryRow = ({ entry, copy }: Readonly<{ entry: LeaderboardEntry; copy: AppCopy }>) => {
  const metric = useMetric()
  const address = useSiteStore(({ session }) => session.wallet?.address)
  const locale = useSiteStore(({ locale }) => locale)
  const self = entry.address === address
  return (
    <div role="row" className={`${ROW} ${self ? 'bg-surface-raised' : ''}`}>
      <span role="cell" className={RANK}>
        {entry.rank}
      </span>
      <span role="cell" className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={inspect(entry)}
          title={[entry.name, entry.address].filter(Boolean).join(' · ')}
          className={`${NAME} text-sm/[1.2]`}
        >
          <LeaderboardName entry={entry} />
        </button>
        {self && <span className="shrink-0 text-xs text-cyan">{copy_text(copy.leaderboard_page)('you')}</span>}
      </span>
      <span className="min-w-0 max-[600px]:hidden">
        {(metric === 'xp' || metric === 'jobs') && <EntryBadges entry={entry} copy={copy} />}
      </span>
      <span role="cell" className={SCORE} title={leaderboard_score(entry.score, metric, locale)}>
        {compact_leaderboard_score(entry.score, metric, locale)}
      </span>
    </div>
  )
}

/** A place nobody holds yet, or not known yet: the row keeps its height. */
const EmptyRow = ({ rank }: Readonly<{ rank: number }>) => (
  <div role="row" className={`${ROW} text-faint`}>
    <span role="cell" className={RANK}>
      {rank}
    </span>
    <span role="cell">—</span>
    <span className="max-[600px]:hidden" />
    <span role="cell" className={SCORE}>
      —
    </span>
  </div>
)

const MEDALS = [podium_first, podium_second, podium_third] as const

const Podium = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const snapshot = shown_snapshot(useSiteStore((state) => state.leaderboards))
  const metric = useMetric()
  const locale = useSiteStore(({ locale }) => locale)
  const text = copy_text(copy.leaderboard_page)
  return (
    <div className="grid grid-cols-[1fr_1.12fr_1fr] items-end gap-3 max-[600px]:gap-1.5" aria-label={text(metric)}>
      {[1, 0, 2].map((position) => {
        const entry = snapshot?.entries[position]
        const first = position === 0
        return (
          <div key={position} className={PODIUM} data-rank={position + 1}>
            <img
              className="row-span-2 size-10 max-[600px]:row-span-1 max-[600px]:mb-1 max-[600px]:size-7.5"
              src={MEDALS[position]}
              alt=""
              width={128}
              height={128}
              draggable={false}
            />
            <button
              type="button"
              disabled={!entry}
              onClick={entry && inspect(entry)}
              title={[entry?.name, entry?.address].filter(Boolean).join(' · ')}
              className={`${NAME} text-[15px]/[1.3] font-extrabold max-[600px]:mx-auto max-[600px]:text-xs`}
            >
              <LeaderboardName entry={entry} fallback={text('unclaimed')} />
            </button>
            <span
              className={`font-mono font-semibold tabular-nums ${first ? 'text-[30px]/[1.15] max-[600px]:text-[17px]' : 'text-2xl/[1.15] max-[600px]:text-[15px]'}`}
              title={entry ? leaderboard_score(entry.score, metric, locale) : undefined}
            >
              {entry ? compact_leaderboard_score(entry.score, metric, locale) : '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** When the month's rankings reset. Before the board arrives, a skeleton holds the line. */
const ResetCountdown = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const snapshot = shown_snapshot(useSiteStore((state) => state.leaderboards))
  const locale = useSiteStore(({ locale }) => locale)
  if (!snapshot) return <span aria-hidden="true" className="aui-skeleton h-[calc(11px*1.4)] w-35" />
  const days = Math.max(0, Math.ceil((snapshot.reset_at_ms - snapshot.timestamp_ms) / 86_400_000))
  const time = new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(days, 'day')
  return (
    <p className="text-[11px]/[1.4] font-bold tracking-[0.12em] whitespace-nowrap text-faint uppercase">
      {copy_text(copy.leaderboard_page)('reset_in', { time })}
    </p>
  )
}

/** The ranks under the podium, to the last place, then the player's own row when it ranks lower. */
const Rankings = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const snapshot = shown_snapshot(useSiteStore((state) => state.leaderboards))
  const metric = useMetric()
  const text = copy_text(copy.leaderboard_page)
  const self = snapshot?.self
  const outside = self && !snapshot.entries.some(({ address }) => address === self.address)
  return (
    <>
      <div role="table" aria-label={text(metric)} aria-busy={!snapshot} className="grid">
        <div role="row" className="sr-only">
          <span role="columnheader">#</span>
          <span role="columnheader">{text('user')}</span>
          <span role="columnheader">{text('score')}</span>
        </div>
        {Array.from({ length: LEADERBOARD_LIMIT - 3 }, (_, index) => {
          const entry = snapshot?.entries[index + 3]
          return entry ? <EntryRow key={index} entry={entry} copy={copy} /> : <EmptyRow key={index} rank={index + 4} />
        })}
      </div>
      {outside && (
        <div role="table" aria-label={text('you')}>
          <EntryRow entry={self} copy={copy} />
        </div>
      )}
    </>
  )
}

/** The categories as a quiet index: a column in the lane, one row that scrolls sideways on a phone. */
const Categories = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const current = useMetric()
  const text = copy_text(copy.leaderboard_page)
  return (
    <nav
      className={
        'mt-4 flex flex-col bg-[linear-gradient(90deg,transparent,var(--aui-line-strong)_18%,var(--aui-line-strong)_82%,transparent)] bg-size-[100%_1px] bg-top bg-no-repeat pt-3.5 max-[760px]:-mx-(--site-gutter) max-[760px]:mt-3 max-[760px]:flex-row max-[760px]:gap-5 max-[760px]:overflow-x-auto max-[760px]:px-(--site-gutter) max-[760px]:pt-2.5 max-[760px]:scrollbar-none max-[760px]:*:flex-none'
      }
      aria-label={text('category')}
    >
      {LEADERBOARD_METRICS.map((metric) => (
        <Choice
          key={metric}
          chosen={metric === current}
          pick={() => dispatch_app({ type: 'leaderboards/observed', metric })}
        >
          {text(metric)}
        </Choice>
      ))}
    </nav>
  )
}

const LeaderboardsPage = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const metric = useMetric()
  // The page says what it shows while it is on screen; the socket observes the rankings only meanwhile.
  useEffect(() => dispatch_app({ type: 'leaderboards/observed', metric: FIRST_BOARD }), [])
  useEffect(() => () => dispatch_app({ type: 'leaderboards/observed', metric: null }), [])
  const text = copy_text(copy.leaderboard_page)
  return (
    <div className="grid grid-cols-[232px_minmax(0,1fr)] items-start gap-x-10 max-[760px]:grid-cols-1">
      <aside className="flex min-w-0 flex-col gap-1.5 pt-1 min-[1001px]:sticky min-[1001px]:top-18">
        <h1 className="font-title text-[34px]/[1.1] font-bold tracking-[-0.01em] max-[760px]:text-[28px]">
          {copy.site.leaderboards}
        </h1>
        <ResetCountdown copy={copy} />
        <Categories copy={copy} />
      </aside>
      <section className="grid min-w-0 gap-5 pt-2 max-[760px]:gap-3.5 max-[760px]:pt-3.5" aria-label={text(metric)}>
        <header>
          <h2 className="mb-1 font-title text-[22px]/[1.2] font-bold max-[760px]:text-lg">{text(metric)}</h2>
          <p className="text-[13px]/normal text-muted">{text(`${metric}_description`)}</p>
        </header>
        <Podium copy={copy} />
        <Rankings copy={copy} />
        <p className="text-xs text-faint">{text('suins_hint')}</p>
      </section>
      <PlayerProfileModal />
    </div>
  )
}
export default LeaderboardsPage
