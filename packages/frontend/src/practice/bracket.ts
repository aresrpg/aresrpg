// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { draw } from '@aresrpg/fight/prng'

export type PracticeMatch = Readonly<{ a: number | null; b: number | null; winner: number | null; done: boolean }>

export const practice_bracket = (seed: bigint): readonly PracticeMatch[] => {
  const cursor = { state: seed }
  const order = Array.from({ length: 6 }, (_, entrant) => ({ entrant, order: draw(cursor) }))
    .sort((a, b) => Number(a.order - b.order))
    .map(({ entrant }) => entrant)
  const slots = [order[0]!, order[1]!, order[2]!, null, order[3]!, order[4]!, order[5]!, null]
  return Array.from({ length: 7 }, (_, index) => ({
    a: index < 4 ? slots[index * 2]! : null,
    b: index < 4 ? slots[index * 2 + 1]! : null,
    winner: null,
    done: false,
  }))
}

export const practice_feeders = (index: number): readonly number[] =>
  index < 4 ? [] : index === 6 ? [4, 5] : [(index - 4) * 2, (index - 4) * 2 + 1]

/** Resolve byes and unrelated bot matches once, leaving only the player's next match open. */
export const advance_practice = (matches: readonly PracticeMatch[], seed: bigint): readonly PracticeMatch[] => {
  const next = [...matches]
  const cursor = { state: seed }
  next.forEach((match, index) => {
    const parents = practice_feeders(index).map((parent) => next[parent]!)
    if (match.done || parents.some(({ done }) => !done)) return
    const [a = null, b = null] = parents.length ? parents.map(({ winner }) => winner) : [match.a, match.b]
    const entrants = [a, b].filter((entrant): entrant is number => entrant !== null)
    const done = entrants.length < 2 || !entrants.includes(0)
    const winner = done ? entrants[Number(draw(cursor) % BigInt(entrants.length))]! : null
    // eslint-disable-next-line functional/immutable-data -- Construction mutates only the fresh local bracket array.
    next[index] = { a, b, done, winner }
  })
  return next
}

export const next_practice_match = (matches: readonly PracticeMatch[]): number =>
  matches.findIndex(({ a, b, done }) => !done && a !== null && b !== null && (a === 0 || b === 0))
