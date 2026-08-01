#!/usr/bin/env bun
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ONE-TIME RECIPE-GHOST PURGE (#1814) — the operator's hand for the backlog the fix cannot reach.
//
// WHY IT EXISTS (2026-08-01): the indexer's Recipe mirror had no deletion path, so every recipe
// `crafting::retire_recipe` deleted on chain kept being SERVED by `/v1/encyclopedia?kind=recipes`
// — 1,470 rows against 1,434 live objects. The handler fix (snapshot.rs `remove_recipe`) closes
// the LEAK: every future retirement reaps its own mirror. It cannot heal the ghosts already in the
// store — those checkpoints are long past the watermark and will never be replayed. This script is
// the one-time sweep for exactly those ids, run ONCE by the operator after the fixed indexer ships.
//
// It is not a scan and it does not guess: it purges EXACTLY the ids in an oracle file derived
// off-chain (served snapshot minus live custody, each remaining id chain-probed not-found). The
// oracle is the caller's input, so this script never decides what is dead.
//
// Idempotent by construction: `JSON.DEL` and `SREM` of an absent key are no-ops, so a re-run after
// a partial failure — or after a fresh ghost was already reaped by the fixed handler — is safe.
//
// Usage (dry-run is the default — nothing is written without --apply):
//
//   PURGE_LIST=~/dev/aresrpg-seed/ceremony/recipe_ghost_purge_2026-08-01.json \
//   PURGE_REDIS_URL=redis://…  bun packages/rpc/scripts/purge_recipe_ghosts.mjs
//
//   …same, plus --apply, to actually write. There is NO default redis url on purpose: the target
//   store is always named by the operator, never inherited from an ambient REDIS_URL.
//
// Exit codes (mirroring standby_parity.mjs's convention):
//   0  done — dry-run reported cleanly, or the apply landed and the post-purge count matched
//   1  refused / verification failed (a malformed oracle, or a served count ≠ the expected one)
//   2  could not be evaluated (missing config, unreadable oracle, unreachable store)

import { RedisClient } from 'bun'

// --- pure core ---------------------------------------------------------------------------------

const OBJECT_ID = /^0x[0-9a-f]{64}$/

/** The two mirror keys one recipe occupies — the SAME contract snapshot.rs writes (k_recipe /
 *  K_RECIPES). Written twice would be a future bug, so the shape lives here once. */
export const recipe_doc_key = (id) => `rpc:recipe:${id}`
export const RECIPES_INDEX_KEY = 'rpc:idx:recipes'

/** The purge oracle → its canonical id list plus everything that failed to parse. Never throws:
 *  callers report the invalid rows instead of silently purging a subset. */
export function parse_purge_oracle(text) {
  const doc = (() => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  })()
  if (doc === null || typeof doc !== 'object')
    return { ids: [], invalid: [], expected_served: null, error: 'the oracle is not JSON' }
  if (!Array.isArray(doc.purge)) return { ids: [], invalid: [], expected_served: null, error: 'no `purge` array' }

  // Rows are `{ recipe_id, reason, label }` (the ceremony oracle) or a bare id string; anything
  // else lands in `invalid` as the offending value, never quietly skipped.
  const rows = doc.purge.map((row) => {
    const raw = typeof row === 'string' ? row : row?.recipe_id
    return typeof raw === 'string' ? raw.trim().toLowerCase() : raw
  })
  const expected = doc._meta?.expected_served_after_purge
  return {
    ids: [...new Set(rows.filter((row) => typeof row === 'string' && OBJECT_ID.test(row)))],
    invalid: rows.filter((row) => typeof row !== 'string' || !OBJECT_ID.test(row)),
    expected_served: Number.isInteger(expected) ? expected : null,
    error: null,
  }
}

/** The exact redis commands one id costs: drop the served doc, then leave the index. Doc FIRST —
 *  the read edge (`read_index` MGETs the members and drops nulls) stops serving the row on the
 *  DEL alone, so an interrupted run never leaves a half-purged row visible. */
export function purge_commands(ids) {
  return ids.flatMap((id) => [
    ['JSON.DEL', [recipe_doc_key(id), '$']],
    ['SREM', [RECIPES_INDEX_KEY, id]],
  ])
}

/** What `/v1/encyclopedia?kind=recipes` would serve: index members whose doc still exists.
 *  `exists_flags[i]` is the EXISTS reply for `members[i]`. */
export function served_count(members, exists_flags) {
  return members.filter((_, index) => Number(exists_flags[index]) > 0).length
}

// --- effects (the edge) -------------------------------------------------------------------------

function required(env, name) {
  const value = env[name]
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${name} is not set — see the usage header of this script`)
  return value.trim()
}

async function measure_served(client) {
  const members = await client.send('SMEMBERS', [RECIPES_INDEX_KEY])
  const flags = await Promise.all(members.map((id) => client.send('EXISTS', [recipe_doc_key(id)])))
  return { members: members.length, served: served_count(members, flags) }
}

if (import.meta.main) {
  const apply = process.argv.includes('--apply')
  console.log(`== recipe-ghost purge (#1814) — ${apply ? 'APPLY' : 'DRY-RUN'} ==`)

  const inputs = await (async () => {
    try {
      const list_path = required(process.env, 'PURGE_LIST')
      const redis_url = required(process.env, 'PURGE_REDIS_URL')
      const oracle = parse_purge_oracle(await Bun.file(list_path).text())
      if (oracle.error) throw new Error(`${list_path}: ${oracle.error}`)
      return { oracle, redis_url, list_path }
    } catch (error) {
      console.error(`CANNOT EVALUATE — ${error.message}`)
      return null
    }
  })()
  if (inputs === null) process.exit(2)

  const { oracle, redis_url, list_path } = inputs
  if (oracle.invalid.length > 0) {
    console.error(`REFUSED — ${oracle.invalid.length} unparseable row(s) in ${list_path}; fix the oracle first`)
    process.exit(1)
  }
  console.log(`oracle: ${oracle.ids.length} ghost id(s) from ${list_path}`)

  const client = new RedisClient(redis_url)
  try {
    const before = await measure_served(client)
    console.log(`before: ${before.served} served / ${before.members} index member(s)`)

    if (!apply) {
      console.log(`DRY-RUN — would issue ${purge_commands(oracle.ids).length} write(s); re-run with --apply`)
      process.exit(0)
    }

    // Sequential on purpose (doc DEL before its SREM, id after id): an interrupted run must never
    // leave a doc alive with its membership already gone.
    await purge_commands(oracle.ids).reduce(
      (chain, [command, args]) => chain.then(() => client.send(command, args)),
      Promise.resolve()
    )

    const after = await measure_served(client)
    console.log(`after:  ${after.served} served / ${after.members} index member(s)`)

    if (oracle.expected_served !== null && after.served !== oracle.expected_served) {
      console.error(
        `VERIFY FAILED — served ${after.served}, oracle expected ${oracle.expected_served}. ` +
          'The purge landed; the delta means the oracle is stale or another ghost class is in play.'
      )
      process.exit(1)
    }
    console.log(`OK — served ${after.served}${oracle.expected_served === null ? '' : ' (matches the oracle)'}`)
  } catch (error) {
    console.error(`CANNOT EVALUATE — ${error.message}`)
    process.exit(2)
  } finally {
    client.close()
  }
}
