// Proves the move-sources staleness anchor is well-formed + stable — the foundation of the RELEASE page's
// "never publish stale bytecode" guard. (The live-vs-manifest COMPARISON is proven in the frontend
// release_staleness.test.ts; asserting the current manifest is fresh here would flake against any in-flight
// Move edit, which is a deploy-time check the PAGE enforces, not a unit invariant.)
import { test, expect } from 'bun:test'

import { move_sources_hash, move_source_files } from './move_sources_hash.mjs'

test('hash is a deterministic 64-hex sha256', () => {
  const a = move_sources_hash()
  expect(a).toMatch(/^[0-9a-f]{64}$/)
  expect(move_sources_hash()).toBe(a) // pure function of the source bytes — stable across calls
})

test('the compile-input file set spans all 7 packages (sources/**.move + Move.toml only)', () => {
  const files = move_source_files()
  expect(files.length).toBeGreaterThan(7)
  for (const pkg of ['foundation', 'spells', 'social', 'engine', 'aresrpg', 'kolizeum', 'forgemagie'])
    expect(files.some((f) => f.includes(`/${pkg}/`))).toBe(true)
  // never a publish-state file (Published.toml / Move.lock / build/) — those change on publish, not on source edit
  expect(files.every((f) => f.endsWith('.move') || f.endsWith('Move.toml'))).toBe(true)
  expect(files.some((f) => f.includes('Published.toml') || f.includes('Move.lock') || f.includes('/build/'))).toBe(false)
})

test('the file list is sorted (deterministic fold order)', () => {
  const files = move_source_files()
  expect([...files].sort()).toEqual(files)
})
