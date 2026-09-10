// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Offline selection only. Existing giftcard publication owns issuance and delivery.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { job_level_from_xp } from '../packages/immutable/src/experience.ts'

const METRICS = ['unique_item_types', 'time_played_ms', 'character_xp', 'profession_levels']
const STAFF = new Set(['ADMIN', 'BUILDER'])
const CAMPAIGN = 'hytale_veterans'

const natural = (value, label) => {
  const number = Number(value ?? 0)
  assert(Number.isSafeInteger(number) && number >= 0, `Invalid ${label}`)
  return number
}

const address_of = (value) => {
  assert(typeof value === 'string' && /^0x[\da-f]{1,64}$/iu.test(value), 'Invalid recorded Sui address')
  const address = `0x${value.slice(2).toLowerCase().padStart(64, '0')}`
  assert(!/^0x0+$/u.test(address), 'The zero address cannot receive rewards')
  return address
}

const profession_levels = (character) => {
  const jobs = JSON.parse(character.jobs || '{}')
  assert(jobs && !Array.isArray(jobs) && typeof jobs === 'object', 'Invalid Hytale jobs')
  const progression = Object.keys(jobs).length
    ? Object.values(jobs).flatMap((job) => [job.xp, job.runeXp])
    : [character.craft_xp, character.gather_xp]
  // Learning an unused profession grants no points. The archived game uses this same XP curve.
  return progression.reduce((sum, xp) => sum + job_level_from_xp(natural(xp, 'profession XP')) - 1, 0)
}

const player_metrics = (snapshot, player) => {
  const characters = new Map(
    snapshot.characters.filter((row) => row.player_id === player.player_id).map((row) => [row.character_id, row])
  )
  const items = new Map(
    [...snapshot.inventory, ...snapshot.bank]
      .filter((row) => row.player_id === player.player_id && natural(row.quantity, 'item quantity') > 0)
      .map((row) => [row.item_id, row])
  )
  return {
    address: address_of(player.address),
    players: [player.name],
    time_played_ms: natural(player.time_played_ms, 'playtime'),
    character_xp: [...characters.values()].reduce((sum, row) => sum + natural(row.experience, 'character XP'), 0),
    profession_levels: [...characters.values()].reduce((sum, row) => sum + profession_levels(row), 0),
    item_types: [...new Set([...items.values()].map((row) => row.item_type))],
    item_quantity: [...items.values()].reduce((sum, row) => sum + natural(row.quantity, 'item quantity'), 0),
    character_count: characters.size,
  }
}

const merge_wallet = (left, right) => ({
  address: right.address,
  players: [...left.players, ...right.players].sort(),
  time_played_ms: left.time_played_ms + right.time_played_ms,
  character_xp: left.character_xp + right.character_xp,
  profession_levels: left.profession_levels + right.profession_levels,
  item_types: [...new Set([...left.item_types, ...right.item_types])],
  item_quantity: left.item_quantity + right.item_quantity,
  character_count: left.character_count + right.character_count,
})

const rank_points = (values, value) =>
  value === 0
    ? 0
    : values.filter((entry) => entry < value).length * 2 + values.filter((entry) => entry === value).length - 1

export const rank_hytale_players = (snapshot, limit = 100) => {
  assert.equal(snapshot.schema, 1, 'Unsupported Hytale export schema')
  assert(/^[\da-f]{64}$/u.test(snapshot.source?.sha256), 'The backup SHA-256 is required')
  const excluded = snapshot.players.filter(
    (player) => STAFF.has(player.role) || Number(player.banned_until) > snapshot.source.snapshot_ms
  )
  const excluded_ids = new Set(excluded.map((player) => player.player_id))
  const wallets = new Map()
  for (const player of snapshot.players.filter((row) => !excluded_ids.has(row.player_id))) {
    const metrics = player_metrics(snapshot, player)
    const previous = wallets.get(metrics.address)
    wallets.set(metrics.address, previous ? merge_wallet(previous, metrics) : metrics)
  }
  const candidates = [...wallets.values()].map(({ item_types, ...row }) => ({
    ...row,
    unique_item_types: item_types.length,
  }))
  assert(candidates.length >= limit, `Only ${candidates.length} eligible wallets; cannot select ${limit}`)
  const populations = Object.fromEntries(METRICS.map((metric) => [metric, candidates.map((row) => row[metric])]))
  const ranked = candidates
    .map((row) => {
      const points = Object.fromEntries(
        METRICS.map((metric) => [metric, rank_points(populations[metric], row[metric])])
      )
      return { ...row, points, score: Object.values(points).reduce((sum, value) => sum + value, 0) }
    })
    .sort(
      (left, right) =>
        right.score - left.score || right.character_xp - left.character_xp || left.address.localeCompare(right.address)
    )
  return {
    source: snapshot.source,
    policy: {
      version: 1,
      equal_weight_metrics: METRICS,
      excluded_roles: [...STAFF],
      tie_break: ['character_xp_desc', 'address_asc'],
    },
    candidates: candidates.length,
    excluded: excluded.map(({ name, role, player_id }) => ({ name, role, player_id })),
    players: ranked.slice(0, limit).map((row, index) => ({
      rank: index + 1,
      ...row,
      score_percent: Math.round((row.score * 10_000) / Math.max(1, 8 * (candidates.length - 1))) / 100,
    })),
  }
}

export const hytale_gift_batches = (campaign, ranking) => {
  assert.equal(campaign.id, CAMPAIGN)
  assert.equal(ranking.players.length, campaign.tiers.at(-1).to)
  assert.equal(new Set(ranking.players.map(({ address }) => address)).size, ranking.players.length)
  return campaign.tiers.flatMap((tier) =>
    campaign.items.map((item_type) => ({
      id: `${CAMPAIGN}_${tier.from}_${tier.to}_${item_type}`,
      item_type,
      campaign: CAMPAIGN,
      amount: tier.amount,
      network: 'mainnet',
      recipients: ranking.players
        .filter(({ rank }) => rank >= tier.from && rank <= tier.to)
        .map(({ address }) => address)
        .sort(),
    }))
  )
}

export const append_hytale_gifts = (content, batches) => {
  const existing = new Map((content.giftcard_batches ?? []).map((batch) => [batch.id, batch]))
  for (const batch of batches) {
    if (existing.has(batch.id))
      assert.deepEqual(
        existing.get(batch.id),
        batch,
        'Hytale allocations are already frozen; do not rerank an issued campaign'
      )
  }
  const missing = batches.filter(({ id }) => !existing.has(id))
  return missing.length ? { ...content, giftcard_batches: [...(content.giftcard_batches ?? []), ...missing] } : content
}

export const hytale_supporters = (snapshot, threshold_sui) => {
  const wallets = new Map()
  for (const player of snapshot.players) {
    const address = address_of(player.address)
    const cents = natural(player.sui_spent_cents, 'recorded SUI spending')
    wallets.set(address, (wallets.get(address) ?? 0) + cents)
  }
  return [...wallets]
    .filter(([, cents]) => cents > natural(threshold_sui, 'SUI threshold') * 100)
    .map(([address, cents]) => ({ address, spent_sui: cents / 100 }))
    .sort((left, right) => right.spent_sui - left.spent_sui)
}

export const prepare_hytale_gifts = async ({ snapshot_path, report_path, airdrop_path }) => {
  const source = await readFile(snapshot_path, 'utf8')
  const snapshot = JSON.parse(source)
  const ranking = { ...rank_hytale_players(snapshot), export_sha256: createHash('sha256').update(source).digest('hex') }
  const before = await readFile(airdrop_path, 'utf8')
  const content = JSON.parse(before)
  const campaign = content.campaigns.find(({ id }) => id === CAMPAIGN)
  assert(campaign, 'The Hytale campaign must be authored first')
  const supporter_campaign = content.campaigns.find(({ id }) => id === 'hytale_supporters')
  assert(supporter_campaign, 'The Hytale supporter campaign must be authored first')
  const supporters = hytale_supporters(snapshot, supporter_campaign.spending_threshold_sui)
  const batches = [
    ...hytale_gift_batches(campaign, ranking),
    ...supporter_campaign.items.map((item_type) => ({
      id: `hytale_supporters_${item_type}`,
      item_type,
      campaign: supporter_campaign.id,
      amount: 1,
      network: 'mainnet',
      recipients: supporters.map(({ address }) => address).sort(),
    })),
  ]
  const next = append_hytale_gifts(content, batches)
  await writeFile(report_path, `${JSON.stringify({ ...ranking, supporters }, null, 2)}\n`, { mode: 0o600 })
  assert.equal(await readFile(airdrop_path, 'utf8'), before, 'Airdrop content changed during preparation')
  if (next !== content) await writeFile(airdrop_path, `${JSON.stringify(next, null, 2)}\n`)
  return {
    selected: ranking.players.length,
    eligible: ranking.candidates,
    excluded: ranking.excluded.length,
    supporters: supporters.length,
    batches: batches.length,
  }
}

if (import.meta.main) {
  const [snapshot_path, report_path] = process.argv.slice(2)
  assert(
    snapshot_path && report_path,
    'Usage: bun scripts/prepare_hytale_gifts.mjs <private-export.json> <private-report.json>'
  )
  console.log(
    await prepare_hytale_gifts({ snapshot_path, report_path, airdrop_path: resolve('seed/content/airdrop.json') })
  )
}
