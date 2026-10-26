// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Run against a dedicated local node. Real receipts, unmodified game sources, disposable keys.
// bun scripts/integration/tournament_gas.ts <new-output-directory>
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { requestSuiFromFaucetV2 } from '@mysten/sui/faucet'
import { Transaction } from '@mysten/sui/transactions'

import type { Receipt } from '../../packages/sdk/src/cache.ts'
import manifest from '../../move-packages.json'

import { local_packages, object_of, shared_of, ROOT } from './local_packages.ts'
import { prepare_game, type RehearsalGame } from './rehearsal_game.ts'

type Environment = Awaited<ReturnType<typeof local_packages>>
type Player = Awaited<ReturnType<RehearsalGame['create_player']>>
type Scenario = Readonly<{ teams: number; format: number; tournament: string }>
type Match = Readonly<{ a: string | null; b: string | null; state: number; available_ms: string }>
type Tournament = Readonly<{
  status: string
  matches: readonly Match[]
  teams: readonly Readonly<{ place: number; seats: readonly Readonly<{ sui_claimed: boolean }>[] }>[]
}>
type Measurement = Scenario &
  Readonly<{
    operation: string
    team?: number
    seat?: number
    match?: number
    digest: string
    computation_mist: string
    storage_mist: string
    rebate_mist: string
    net_mist: string
    elapsed_ms: number
  }>
const json = (value: unknown): string =>
  JSON.stringify(value, (_, entry: unknown) => (typeof entry === 'bigint' ? entry.toString() : entry), 2)

const source_hashes = async () => {
  const rows = await Promise.all(
    manifest.packages.map(async ({ slot, path }) => {
      const files = (await readdir(join(ROOT, path, 'sources'))).filter((file) => file.endsWith('.move')).sort()
      const hash = createHash('sha256')
      for (const file of files) hash.update(file).update(await readFile(join(ROOT, path, 'sources', file)))
      return [slot, hash.digest('hex')]
    })
  )
  return Object.fromEntries(rows)
}

const instrument = (env: Environment, output: string, gas_price: string) => {
  const measurements: Measurement[] = []
  const measure = async (
    scenario: Scenario,
    operation: string,
    transaction: Transaction,
    actor = env.sdk,
    detail: Readonly<{ team?: number; seat?: number; match?: number }> = {}
  ): Promise<Receipt> => {
    transaction.setGasPrice(BigInt(gas_price))
    const began = performance.now()
    const receipt = await env.send(
      `${scenario.teams}x${scenario.format} ${operation} ${json(detail)}`,
      transaction,
      actor
    )
    const result = receipt.Transaction
    const gas = result?.effects?.gasUsed
    assert.ok(result?.digest && gas, 'Measurement requires certified gas effects')
    const computation = BigInt(gas.computationCost!)
    const storage = BigInt(gas.storageCost!)
    const rebate = BigInt(gas.storageRebate!)
    const row: Measurement = {
      ...scenario,
      ...detail,
      operation,
      digest: result.digest,
      computation_mist: String(computation),
      storage_mist: String(storage),
      rebate_mist: String(rebate),
      net_mist: String(computation + storage - rebate),
      elapsed_ms: Math.round(performance.now() - began),
    }
    measurements.push(row)
    await appendFile(join(output, 'measurements.jsonl'), JSON.stringify(row) + '\n')
    await writeFile(join(output, 'receipts', `${result.digest}.json`), json(receipt))
    return receipt
  }
  const snapshot = async (scenario: Scenario, stage: string): Promise<Tournament> => {
    const { object } = await env.client.core.getObject({
      objectId: scenario.tournament,
      include: { content: true, json: true },
    })
    await writeFile(
      join(output, `${scenario.teams}x${scenario.format}-${stage}.json`),
      json({ version: object.version, digest: object.digest, move_bytes: object.content.length, value: object.json })
    )
    return object.json as unknown as Tournament
  }
  return { measurements, measure, snapshot }
}
type Audit = ReturnType<typeof instrument>

const register = async (
  env: Environment,
  game: RehearsalGame,
  audit: Audit,
  players: readonly (readonly Player[])[],
  teams: number,
  format: number
) => {
  const tx = new Transaction()
  game.sdk.doors.tournament_create(tx, {
    admin: game.admin,
    name: 'Gas audit',
    format,
    start_before_ms: BigInt(Date.now() + 3_600_000),
    sui_bps: [10000, 0, 0, 0, 0],
    token_bps: [10000, 0, 0, 0, 0],
    rewards: game.sdk.doors.tournament_rewards(tx, {}),
  })
  const tournament = object_of(await env.send('create audit tournament', tx, game.sdk), '::tournament::Tournament')
  const scenario = { teams, format, tournament }
  await game.sdk.hydrate([tournament])
  const donate = new Transaction()
  game.sdk.doors.tournament_donate_sui(donate, { t: tournament, payment: game.sdk.coin_of(donate, 1_000_000_000n) })
  await audit.measure(scenario, 'donate', donate, game.sdk)
  for (let team = 0; team < teams; team++) {
    for (let seat = 0; seat < format; seat++) {
      const player = players[team]![seat]!
      await player.sdk.hydrate_unknown([tournament])
      const tx = new Transaction()
      player.sdk.with_owner_kiosk(tx, player.cap, (kiosk, cap) => {
        if (seat === 0)
          player.sdk.doors.create_tournament_team(tx, {
            tournament,
            name: `Team ${String(team).padStart(2, '0')}`,
            allowed: [],
            kiosk,
            cap,
            character_id: player.character,
          })
        else
          player.sdk.doors.join_tournament_team(tx, {
            tournament,
            team,
            revision: '0',
            kiosk,
            cap,
            character_id: player.character,
          })
      })
      await audit.measure(scenario, seat === 0 ? 'create_team' : 'join_team', tx, player.sdk, { team, seat })
    }
  }
  await audit.snapshot(scenario, 'registered')
  const start = new Transaction()
  game.sdk.doors.start_tournament(start, { tournament, admin: game.admin })
  await audit.measure(scenario, 'start', start, game.sdk)
  return scenario
}

const play = async (
  env: Environment,
  game: RehearsalGame,
  audit: Audit,
  players: readonly (readonly Player[])[],
  scenario: Scenario
) => {
  const row = await audit.snapshot(scenario, 'started')
  const index = scenario.teams / 2 - 1
  const match = row.matches[index]!
  const a = Number(match.a),
    b = Number(match.b)
  assert.equal(Number(match.state), 1, 'The fully registered first-round match must be available')
  const participants = [...players[a]!.slice(0, scenario.format), ...players[b]!.slice(0, scenario.format)]
  const first = participants[0]!
  for (const player of participants)
    await player.sdk.hydrate_unknown([game.catalog, (game.pins.character_protected_policy as { id: string }).id])
  const open = new Transaction()
  first.sdk.doors.open_tournament_match(open, {
    tournament: scenario.tournament,
    index,
    kiosk: first.cap.kioskId,
    personal: first.cap.objectId,
    character_id: first.character,
    catalog: game.catalog,
  })
  const fight = object_of(
    await audit.measure(scenario, 'open_match', open, first.sdk, { match: index }),
    '::fight::Fight'
  )
  for (let seat = 1; seat < participants.length; seat++) {
    const player = participants[seat]!
    await player.sdk.hydrate_unknown([fight])
    const tx = new Transaction()
    player.sdk.with_owner_kiosk(tx, player.cap, (kiosk, cap) =>
      player.sdk.doors.join_tournament_match(tx, {
        tournament: scenario.tournament,
        index,
        fight_object: fight,
        kiosk,
        cap,
        character_id: player.character,
      })
    )
    await audit.measure(scenario, 'join_match', tx, player.sdk, { seat, match: index })
  }
  for (const side of [0, 1]) {
    const player = participants[side * scenario.format]!
    const tx = new Transaction()
    player.sdk.doors.ready_tournament_match(tx, {
      tournament: scenario.tournament,
      index,
      fight_object: fight,
      fighter_indices: Array.from({ length: scenario.format }, (_, seat) => side * scenario.format + seat),
    })
    await audit.measure(scenario, side === 0 ? 'ready' : 'ready_start', tx, player.sdk, { match: index })
  }
  const state = (await env.json(fight)).combat as { queue: string[]; turn_pointer: string; turn_started_ms: string }
  const active = Number(state.queue[Number(state.turn_pointer)])
  await wait_until(env, Number(state.turn_started_ms) + 3000)
  const turn = new Transaction()
  participants[active]!.sdk.doors.end_fight_turn(turn, { fight_object: fight })
  await audit.measure(scenario, 'end_turn', turn, participants[active]!.sdk, { seat: active, match: index })
  for (let seat = scenario.format; seat < participants.length; seat++) {
    const player = participants[seat]!
    const tx = new Transaction()
    player.sdk.doors.forfeit_tournament_match(tx, {
      fight_object: fight,
      fighter_idx: seat,
      kiosk: player.cap.kioskId,
      personal: player.cap.objectId,
    })
    await audit.measure(scenario, 'forfeit', tx, player.sdk, { seat, match: index })
  }
  await game.sdk.hydrate_unknown([fight])
  const record = new Transaction()
  game.sdk.doors.crank_tournament_match(record, { tournament: scenario.tournament, index, fight_object: fight })
  await audit.measure(scenario, 'record_result', record, game.sdk, { match: index })
  for (let seat = 0; seat < scenario.format; seat++) {
    const player = participants[seat]!
    const tx = new Transaction()
    player.sdk.doors.settle_tournament_match(tx, {
      tournament: scenario.tournament,
      index,
      fight_object: fight,
      fighter_idx: seat,
      kiosk: player.cap.kioskId,
      personal: player.cap.objectId,
    })
    await audit.measure(scenario, 'settle_character', tx, player.sdk, { seat, match: index })
  }
  const close = new Transaction()
  first.sdk.doors.close_tournament_match(close, { tournament: scenario.tournament, index, fight_object: fight })
  await audit.measure(scenario, 'close_fight', close, first.sdk, { match: index })
  return { ...scenario, winner: a, available_ms: Number(match.available_ms) }
}

const wait_until = async (env: Environment, deadline: number): Promise<void> => {
  while (Number((await env.json('0x6')).timestamp_ms) < deadline) await Bun.sleep(500)
}

const finish = async (
  env: Environment,
  game: RehearsalGame,
  audit: Audit,
  players: readonly (readonly Player[])[],
  scenario: Scenario & { winner: number; available_ms: number }
) => {
  await wait_until(env, scenario.available_ms + 60_000)
  for (let index = scenario.teams / 2; index < scenario.teams - 1; index++) {
    const tx = new Transaction()
    game.sdk.doors.tournament_crank_unopened(tx, { t: scenario.tournament, index })
    const final = index === scenario.teams - 2
    await audit.measure(scenario, final ? 'finish_no_show' : 'crank_no_show', tx, game.sdk, { match: index })
  }
  const result = await audit.snapshot(scenario, 'finished')
  assert.equal(result.status, 'finished')
  assert.equal(result.teams[scenario.winner]!.place, 1)
  for (let seat = 0; seat < scenario.format; seat++) {
    const tx = new Transaction()
    const player = players[scenario.winner]![seat]!
    player.sdk.doors.tournament_claim_sui(tx, { t: scenario.tournament, team: scenario.winner, seat })
    await audit.measure(scenario, 'claim_sui', tx, player.sdk, { team: scenario.winner, seat })
  }
  const claimed = await audit.snapshot(scenario, 'claimed')
  assert.ok(claimed.teams[scenario.winner]!.seats.every((seat) => seat.sui_claimed))
}

const main = async () => {
  assert.ok(process.argv[2], 'Pass a new output directory for the audit evidence')
  const output = resolve(process.argv[2])
  await mkdir(output)
  await mkdir(join(output, 'receipts'))
  const env = await local_packages({
    rpc_url: 'http://127.0.0.1:29000',
    faucet_url: 'http://127.0.0.1:29123',
  })
  try {
    const gas = await env.client.core.getReferenceGasPrice()
    const protocol = await env.client.core.getProtocolConfig()
    const service = (await env.client.ledgerService.getServiceInfo({})).response
    await writeFile(
      join(output, 'metadata.json'),
      json({
        began_at: new Date().toISOString(),
        rpc_url: env.rpc_url,
        gas,
        protocol,
        service,
        sources: await source_hashes(),
        matrix: { teams: [8, 16, 64], formats: [1, 3, 6] },
        assumptions:
          'Level-one unequipped Senshi; fixed authored board; one played match, remaining first-round matches no-show; SUI-only winner-takes-all prizes. No gas-price bidding or contention.',
      })
    )
    const audit = instrument(env, output, gas.referenceGasPrice)
    const rewards = await env.publish('rewards')
    const game = await prepare_game(env, shared_of(rewards, '::economy::Economy'))
    await writeFile(join(output, 'packages.json'), json(env.publications))
    const players: Player[][] = []
    for (let team = 0; team < 64; team++) {
      const signer = Ed25519Keypair.generate()
      await requestSuiFromFaucetV2({ host: env.faucet_url, recipient: signer.toSuiAddress() })
      const members: Player[] = []
      for (let seat = 0; seat < 6; seat++)
        members.push(await game.create_player(signer, `gas${String(team).padStart(2, '0')}${seat}`, { fund: false }))
      players.push(members)
      console.log(`Prepared ${team + 1}/64 wallets with six characters each`)
    }
    const scenarios: Awaited<ReturnType<typeof play>>[] = []
    for (const format of [1, 3, 6]) {
      for (const teams of [8, 16, 64]) {
        const scenario = await register(env, game, audit, players, teams, format)
        scenarios.push(await play(env, game, audit, players, scenario))
      }
    }
    for (const scenario of scenarios) await finish(env, game, audit, players, scenario)
    await writeFile(join(output, 'measurements.json'), json(audit.measurements))
    await writeFile(
      join(output, 'completed.json'),
      json({ completed_at: new Date().toISOString(), receipts: env.receipts })
    )
    console.log(`Gas audit complete: ${audit.measurements.length} measured transactions. ${output}`)
  } finally {
    await env.cleanup()
  }
}
await main()
