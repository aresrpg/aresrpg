// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'

import type { CopyText } from '../i18n/copy.ts'

import { team_initial } from './presentation.ts'

export const BracketTeam = ({
  name,
  own,
  won,
  lost,
  unresolved,
  children,
  t,
}: Readonly<{
  name: string
  own?: boolean
  won?: boolean
  lost?: boolean
  unresolved?: boolean
  children?: ReactNode
  t: CopyText
}>) => (
  <div
    className={`tourney-match-team${own ? ' is-own' : ''}${lost ? ' is-lost' : ''}${unresolved ? ' is-unresolved' : ''}`}
  >
    <span className="tourney-monogram" aria-hidden="true">
      {unresolved ? '—' : team_initial(name)}
    </span>
    <span title={name}>{name}</span>
    {won && <span aria-label={t('winner')}>✓</span>}
    {children}
  </div>
)

export const BracketCard = ({
  id,
  index,
  kind,
  own,
  label,
  deadline,
  action,
  children,
}: Readonly<{
  id: string
  index: number
  kind: string
  own: boolean
  label: string
  deadline?: ReactNode
  action?: ReactNode
  children: ReactNode
}>) => (
  <article id={id} data-match-index={index} className={`tourney-match is-${kind}${own ? ' is-own' : ''}`}>
    <header>
      <span>
        M{index + 1} · {label}
      </span>
      {deadline}
    </header>
    {children}
    {action && <div className="tourney-match-action">{action}</div>}
  </article>
)

export const BracketTree = ({
  identity,
  selected,
  rounds,
  placement,
  t,
}: Readonly<{
  identity: string
  selected: number
  rounds: readonly Readonly<{ depth: number; title: string; summary: string; matches: readonly ReactNode[] }>[]
  placement?: ReactNode
  t: CopyText
}>) => {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    root.current
      ?.querySelector(`[data-match-index="${selected}"]`)
      ?.scrollIntoView({ block: 'center', inline: 'center' })
  }, [identity, selected])
  const leaves = rounds[0]?.matches.length ?? 1
  if (!rounds.length) return <p className="tourney-empty">{t('no_matches')}</p>
  return (
    <div className="tourney-bracket-scroll" ref={root} tabIndex={0} role="region" aria-label={t('bracket')}>
      <div
        className={`tourney-tree${leaves >= 8 ? ' is-dense' : ''}`}
        style={{ '--tourney-leaves': leaves } as CSSProperties}
      >
        {rounds.map((round, index) => (
          <section className="tourney-round" key={round.depth}>
            <header>
              <b>{round.title}</b>
              <span>{round.summary}</span>
            </header>
            <div className="tourney-round-matches">
              {round.matches.map((match, ordinal) => (
                <div
                  className={`tourney-match-slot${index > 0 ? ' has-feeders' : ''}${index < rounds.length - 1 ? ' has-parent' : ''}`}
                  key={ordinal}
                  style={{ gridRow: `${ordinal * 2 ** index + 1} / span ${2 ** index}` }}
                >
                  {match}
                </div>
              ))}
            </div>
          </section>
        ))}
        {placement}
      </div>
    </div>
  )
}
