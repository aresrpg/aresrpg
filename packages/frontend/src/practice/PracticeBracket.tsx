// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CopyText } from '../i18n/copy.ts'
import type { PracticeState } from '../modules/practice.ts'
import { BracketCard, BracketTeam, BracketTree } from '../tournament/BracketView.tsx'
import { round_label } from '../tournament/presentation.ts'

import { next_practice_match, practice_feeders } from './bracket.ts'

export const PracticeBracket = ({ practice, t }: Readonly<{ practice: PracticeState; t: CopyText }>) => {
  const selected = next_practice_match(practice.matches)
  const indices = practice.matches.length ? [[0, 1, 2, 3], [4, 5], [6]] : []
  const rounds = indices.map((indices, round) => ({
    depth: 2 - round,
    title: round_label(2 - round, t),
    summary: t('round_counts', {
      live: 0,
      done: indices.filter((index) => practice.matches[index]!.done).length,
      count: indices.length,
    }),
    matches: indices.map((index) => {
      const match = practice.matches[index]!
      const kind = match.done ? ([match.a, match.b].includes(null) ? 'bye' : 'done') : 'waiting'
      return (
        <BracketCard
          key={index}
          id={`practice-match-${index}`}
          index={index}
          kind={kind}
          own={index === selected}
          label={t(`match_${kind}`)}
        >
          {[match.a, match.b].map((entrant, side) => (
            <BracketTeam
              key={side}
              t={t}
              unresolved={entrant === null}
              own={entrant === 0}
              won={entrant !== null && match.winner === entrant}
              lost={entrant !== null && match.done && match.winner !== entrant}
              name={
                entrant !== null
                  ? practice.entrants[entrant]!.source.name
                  : index < 4
                    ? t('empty_bracket')
                    : t('from_winner', { match: practice_feeders(index)[side]! + 1 })
              }
            />
          ))}
        </BracketCard>
      )
    }),
  }))
  return <BracketTree identity={String(practice.seed)} selected={selected} rounds={rounds} t={t} />
}
