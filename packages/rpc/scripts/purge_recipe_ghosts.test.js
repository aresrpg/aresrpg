// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Unit suite for the one-time RECIPE-GHOST PURGE (#1814).
//
// Run targeted: `bun test scripts/purge_recipe_ghosts.test.js` from packages/rpc
// (NEVER a bare `bun test` in packages/rpc — see gas-pool/generate-config.test.js).
//
// NO NETWORK, NO STORE: the pure core is the whole surface under test. Ids here are SYNTHETIC
// (scripts/check-chain-ids.mjs bans hand-typed live chain ids in source) — the real ghost list is
// the operator's runtime input, never a committed constant.
import { describe, expect, test } from 'bun:test'

import {
  RECIPES_INDEX_KEY,
  parse_purge_oracle,
  purge_commands,
  recipe_doc_key,
  served_count,
} from './purge_recipe_ghosts.mjs'

const id = (short) => `0x${short.padStart(64, '0')}`
const ghost_a = id('c0f1a')
const ghost_b = id('c0f1b')

const oracle_text = (rows, meta = {}) =>
  JSON.stringify({
    _meta: { purpose: 'test oracle', ...meta },
    purge: rows.map((recipe_id) => ({ recipe_id, reason: 'rejob-superseded', label: null })),
  })

describe('parse_purge_oracle', () => {
  test('reads the ceremony oracle shape and its expected post-purge count', () => {
    const parsed = parse_purge_oracle(oracle_text([ghost_a, ghost_b], { expected_served_after_purge: 1434 }))
    expect(parsed.error).toBe(null)
    expect(parsed.ids).toEqual([ghost_a, ghost_b])
    expect(parsed.invalid).toEqual([])
    expect(parsed.expected_served).toBe(1434)
  })

  test('deduplicates and canonicalises, so a doubled row never doubles the writes', () => {
    const parsed = parse_purge_oracle(oracle_text([ghost_a, ghost_a.toUpperCase(), ` ${ghost_a} `]))
    expect(parsed.ids).toEqual([ghost_a])
  })

  test('REPORTS malformed rows instead of purging the parseable subset', () => {
    // A truncated / non-string id must never be silently dropped: purging 37 of 38 ids while
    // reporting success is exactly the lying-green the row exists to kill.
    const parsed = parse_purge_oracle(oracle_text([ghost_a, '0xdead', 12]))
    expect(parsed.ids).toEqual([ghost_a])
    expect(parsed.invalid).toEqual(['0xdead', 12])
  })

  test('a non-JSON or shapeless oracle is a named error, never an empty purge', () => {
    expect(parse_purge_oracle('not json').error).toBe('the oracle is not JSON')
    expect(parse_purge_oracle('{"_meta":{}}').error).toBe('no `purge` array')
    expect(parse_purge_oracle('{"purge":[]}').expected_served).toBe(null)
  })
})

describe('purge_commands', () => {
  test('drops the served doc FIRST, then the index membership, per id', () => {
    expect(purge_commands([ghost_a, ghost_b])).toEqual([
      ['JSON.DEL', [recipe_doc_key(ghost_a), '$']],
      ['SREM', [RECIPES_INDEX_KEY, ghost_a]],
      ['JSON.DEL', [recipe_doc_key(ghost_b), '$']],
      ['SREM', [RECIPES_INDEX_KEY, ghost_b]],
    ])
  })

  test('writes the SAME key contract the indexer does (snapshot.rs k_recipe / K_RECIPES)', () => {
    expect(recipe_doc_key(ghost_a)).toBe(`rpc:recipe:${ghost_a}`)
    expect(RECIPES_INDEX_KEY).toBe('rpc:idx:recipes')
  })

  test('an empty oracle issues no writes at all', () => {
    expect(purge_commands([])).toEqual([])
  })
})

describe('served_count', () => {
  test('counts what the encyclopedia serves: index members whose doc still exists', () => {
    // read_index (api/views.js) SMEMBERs then MGETs and drops nulls — a lingering membership
    // whose doc is gone is already invisible, which is why the doc DEL is the load-bearing write.
    expect(served_count([ghost_a, ghost_b, id('c0f1c')], [1, 0, 1])).toBe(2)
    expect(served_count([], [])).toBe(0)
  })
})
