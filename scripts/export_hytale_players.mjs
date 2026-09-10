// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Run against an isolated restored backup. Every graph query is read-only and projects only reward inputs.

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const exec_file = promisify(execFile)
export const HYTALE_REWARD_QUERIES = Object.freeze({
  players:
    'MATCH (p:Player) WHERE p.suiAddress IS NOT NULL AND p.suiAddress <> "" RETURN p.uuid AS player_id, p.name AS name, p.rank AS role, p.suiAddress AS address, p.timePlayed AS time_played_ms, p.bannedUntil AS banned_until, p.masteryDataJson AS mastery_data',
  characters:
    'MATCH (p:Player)-[:HAS]->(c:Character) WHERE p.suiAddress IS NOT NULL AND p.suiAddress <> "" RETURN p.uuid AS player_id, c.uuid AS character_id, c.experience AS experience, c.jobs AS jobs, c.craftJob AS craft_job, c.craftJobXp AS craft_xp, c.gatherJob AS gather_job, c.gatherJobXp AS gather_xp',
  inventory:
    'MATCH (p:Player)-[:HAS]->(c:Character)-[r]->(i:Item) WHERE p.suiAddress IS NOT NULL AND p.suiAddress <> "" AND type(r) IN ["IN_INVENTORY","EQUIPPED","IN_LOOT_BUFFER"] RETURN DISTINCT p.uuid AS player_id, i.id AS item_id, i.templateKey AS item_type, i.quantity AS quantity',
  bank: 'MATCH (p:Player)-[:IN_BANK]->(i:Item) WHERE p.suiAddress IS NOT NULL AND p.suiAddress <> "" RETURN DISTINCT p.uuid AS player_id, i.id AS item_id, i.templateKey AS item_type, i.quantity AS quantity',
})

export const export_hytale_players = async ({ container, graph, backup_path, snapshot_ms, output_path }) => {
  assert(/^[a-zA-Z0-9][\w.-]*$/u.test(container), 'Invalid isolated container name')
  assert(/^[a-zA-Z0-9_]+$/u.test(graph), 'Invalid graph name')
  assert(Number.isSafeInteger(snapshot_ms) && snapshot_ms > 0, 'Provide the backup creation timestamp in milliseconds')
  const backup = await readFile(backup_path)
  const result = {
    schema: 1,
    source: { sha256: createHash('sha256').update(backup).digest('hex'), graph, snapshot_ms },
  }
  for (const [name, query] of Object.entries(HYTALE_REWARD_QUERIES)) {
    const { stdout } = await exec_file(
      'docker',
      ['exec', container, 'redis-cli', '--json', 'GRAPH.RO_QUERY', graph, query],
      { maxBuffer: 32 * 1024 * 1024 }
    )
    const response = JSON.parse(stdout)
    assert(
      Array.isArray(response) && response.length === 3 && Array.isArray(response[1]),
      `Invalid ${name} query response`
    )
    const rows = response[1].map((row) => Object.fromEntries(response[0].map((key, index) => [key, row[index]])))
    result[name] =
      name === 'players'
        ? rows.map(({ mastery_data, ...player }) => ({
            ...player,
            sui_spent_cents: JSON.parse(mastery_data || '{}').milestones?.sui_spent ?? 0,
          }))
        : rows
  }
  await writeFile(output_path, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
  return { players: result.players.length, characters: result.characters.length }
}

if (import.meta.main) {
  const [container, graph, backup_path, timestamp, output_path] = process.argv.slice(2)
  assert(
    container && graph && backup_path && timestamp && output_path,
    'Usage: bun scripts/export_hytale_players.mjs <isolated-container> <graph> <backup.rdb> <snapshot-ms> <private-output.json>'
  )
  console.log(
    await export_hytale_players({ container, graph, backup_path, snapshot_ms: Number(timestamp), output_path })
  )
}
