// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// Uniform-weight WFC on an explicit adjacency graph. Planning owns the graph;
// propagation owns local compatibility. Backtracking never relaxes a constraint.
const propagate = (domains, edges, compatible) => {
  const wave = domains.map((domain) => [...domain])
  let changed = true
  while (changed) {
    changed = false
    for (const [a, b] of edges) {
      const left = wave[a].filter((x) => wave[b].some((y) => compatible(x, y)))
      const right = wave[b].filter((y) => left.some((x) => compatible(x, y)))
      if (!left.length || !right.length) return null
      changed ||= left.length !== wave[a].length || right.length !== wave[b].length
      wave[a] = left
      wave[b] = right
    }
  }
  return wave
}

export const collapse_layout = ({ domains, edges, compatible, seed, max_decisions = 10_000 }) => {
  if (!Number.isSafeInteger(seed) || domains.some((domain) => !domain.length))
    throw new TypeError('Layout requires an integer seed and nonempty domains')
  if (edges.some((edge) => edge.length !== 2 || edge.some((index) => !Number.isInteger(index) || !domains[index])))
    throw new TypeError('Layout edge references an absent parcel')
  let state = seed >>> 0
  let decisions = 0
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  const solve = (input) => {
    if (++decisions > max_decisions) throw new Error('Layout decision budget exhausted')
    const wave = propagate(input, edges, compatible)
    if (!wave) return null
    const index = wave.reduce((best, domain, i) => {
      if (domain.length <= 1) return best
      return best < 0 || domain.length < wave[best].length ? i : best
    }, -1)
    if (index < 0) return wave.map(([choice]) => choice)
    const choices = wave[index].map((choice) => ({ choice, order: random() })).toSorted((a, b) => a.order - b.order)
    for (const { choice } of choices) {
      const result = solve(wave.map((domain, i) => (i === index ? [choice] : domain)))
      if (result) return result
    }
    return null
  }
  const result = solve(domains)
  if (!result) throw new Error('No compatible layout exists')
  return result
}
