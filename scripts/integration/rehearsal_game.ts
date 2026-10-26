// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import assert from 'node:assert/strict'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { requestSuiFromFaucetV2 } from '@mysten/sui/faucet'
import { Transaction } from '@mysten/sui/transactions'

import type { Pins } from '../../packages/sdk/src/client.ts'
import { receipt_personal_kiosk_cap } from '../../packages/sdk/src/ptb.ts'
import {
  create_deployment_bootstrap_transaction,
  project_bootstrap_deployment,
} from '../../packages/sdk/src/deployment_admin.ts'
import { seed_sdk, board_value } from '../../packages/sdk/src/seed.ts'
import { kares_payment } from '../../packages/sdk/src/kares_ptb.ts'
import boards from '../../seed/content/fight_boards.json'

import { local_packages, object_of, shared_of } from './local_packages.ts'

type Environment = Awaited<ReturnType<typeof local_packages>>
export const prepare_game = async (env: Environment, economy: { id: string; shared_version: string }) => {
  const published: Record<string, Awaited<ReturnType<Environment['publish']>>> = {}
  for (const slot of ['math', 'control', 'combat', 'seed', 'kares']) published[slot] = await env.publish(slot)
  await env.prepare_kiosk()
  const game_receipt = await env.publish('game')
  const game = env.publications.game!
  const prefix = (slot: string) => (slot === 'game' ? '' : slot === 'rewards' ? 'kares_rewards_' : `${slot}_`)
  let pins: Pins = {
    ...Object.fromEntries(
      Object.entries(env.publications).flatMap(([slot, row]) => [
        [`${prefix(slot)}package`, row.package],
        [`${prefix(slot)}package_original`, row.original],
        [`${prefix(slot)}upgrade_cap`, row.cap],
      ])
    ),
    version: shared_of(game_receipt, '::version::Version'),
    name_registry: shared_of(game_receipt, '::character::NameRegistry'),
    friend_registry: shared_of(game_receipt, '::friends::FriendRegistry'),
    content_root: shared_of(published.seed!, '::registry::Registry'),
    kares_economy: economy,
    publisher: object_of(game_receipt, '::package::Publisher'),
  }
  const admin = object_of(published.control!, '::admin::AdminCap')
  let sdk = env.sdk_for(env.owner, pins)
  await sdk.hydrate([String(pins.publisher), '0xd'])
  const boot = await env.send(
    'bootstrap game',
    await create_deployment_bootstrap_transaction({
      sdk,
      package_id: game.package,
      kiosk_package: env.publications.kiosk!.package,
      publisher: String(pins.publisher),
      recipient: env.owner.toSuiAddress(),
    }),
    sdk
  )
  pins = { ...pins, ...project_bootstrap_deployment(boot, game.original) }
  sdk = env.sdk_for(env.owner, pins)
  const seed = seed_sdk(sdk)
  await seed.hydrate([admin, (pins.content_root as { id: string }).id])
  const world_tx = new Transaction()
  const world_value = seed.seed_doors.create(world_tx, {
    cap: admin,
    root: (pins.content_root as { id: string }).id,
    name: 'nauvis',
    entry_level: 1,
  })
  seed.seed_doors.share(world_tx, { world_content: world_value })
  const world_receipt = await env.send('create starting world', world_tx, seed)
  const world = object_of(world_receipt, '::world_content::WorldContent')
  const board_tx = new Transaction()
  seed.seed_doors.create_catalog(board_tx, { cap: admin, root: (pins.content_root as { id: string }).id })
  const catalog = object_of(await env.send('create board catalog', board_tx, seed), '::board_catalog::BoardCatalog')
  await seed.hydrate([catalog])
  const add_board = new Transaction()
  seed.seed_doors.add_board(add_board, {
    cap: admin,
    root: (pins.content_root as { id: string }).id,
    catalog,
    board: board_value(seed, add_board, boards.boards[0]!),
  })
  await env.send('seed tournament board', add_board, seed)
  const create_player = async (signer: Ed25519Keypair, name: string, { fund = true } = {}) => {
    if (fund && signer !== env.owner)
      await requestSuiFromFaucetV2({ host: env.faucet_url, recipient: signer.toSuiAddress() })
    const sdk = env.sdk_for(signer, pins)
    await sdk.hydrate([
      world,
      ...['version', 'name_registry', 'character_policy'].map((key) => (pins[key] as { id: string }).id),
    ])
    const tx = new Transaction()
    sdk.with_personal_kiosk(tx, null, (kiosk, cap) =>
      sdk.doors.create_character(tx, {
        payment: sdk.coin_of(tx, 1_000_000_000n),
        kiosk,
        cap,
        raw_name: name,
        classe: 'senshi',
        male: true,
        color_1: 1,
        color_2: 2,
        color_3: 3,
        first_world: world,
      })
    )
    const receipt = await env.send(`create ${name}`, tx, sdk)
    const cap = receipt_personal_kiosk_cap(receipt)
    assert.ok(cap)
    const character = object_of(receipt, '::character::Character')
    await sdk.hydrate([cap.objectId, cap.kioskId, character])
    return { sdk, signer, cap, character }
  }
  const players = [
    await create_player(env.owner, 'rehearsalalpha'),
    await create_player(Ed25519Keypair.generate(), 'rehearsalbeta'),
  ]
  await sdk.hydrate([admin])
  return { sdk, pins, admin, catalog, players, create_player }
}
export type RehearsalGame = Awaited<ReturnType<typeof prepare_game>>

export const play_tournament = async (
  env: Environment,
  game: RehearsalGame,
  kares?: { coin_type: string; amount: bigint }
) => {
  const { sdk, admin, players, catalog } = game
  const tx = new Transaction()
  sdk.doors.tournament_create(tx, {
    admin,
    name: kares ? 'KARES rehearsal' : 'SUI rehearsal',
    format: 1,
    start_before_ms: BigInt(Date.now() + 1_800_000),
    sui_bps: [10000, 0, 0, 0, 0],
    token_bps: [10000, 0, 0, 0, 0],
    rewards: sdk.doors.tournament_rewards(tx, {}),
  })
  const tournament = object_of(await env.send('create tournament', tx, sdk), '::tournament::Tournament')
  await sdk.hydrate([tournament])
  const donate = new Transaction()
  sdk.doors.tournament_donate_sui(donate, { t: tournament, payment: sdk.coin_of(donate, 10_000_000_000n) })
  await env.send('fund SUI prize', donate, sdk)
  let kares_pool: string | undefined
  if (kares) {
    const fund = new Transaction()
    sdk.doors.tournament_create_kares_pool(fund, { t: tournament, payment: kares_payment(sdk, fund, kares.amount) })
    kares_pool = object_of(await env.send('fund token prize', fund, sdk), `::tournament::KaresPool<${kares.coin_type}>`)
  }
  for (const [index, player] of players.entries()) {
    await player.sdk.hydrate([tournament])
    const join = new Transaction()
    player.sdk.with_owner_kiosk(join, player.cap, (kiosk, cap) =>
      player.sdk.doors.create_tournament_team(join, {
        tournament,
        name: `Team ${index}`,
        allowed: [],
        kiosk,
        cap,
        character_id: player.character,
      })
    )
    await env.send(`register team ${index}`, join, player.sdk)
  }
  const start = new Transaction()
  sdk.doors.start_tournament(start, { tournament, admin })
  await env.send('start tournament', start, sdk)
  const first = players[0]!
  await first.sdk.hydrate([catalog, (game.pins.character_protected_policy as { id: string }).id])
  const open = new Transaction()
  first.sdk.doors.open_tournament_match(open, {
    tournament,
    index: 0,
    kiosk: first.cap.kioskId,
    personal: first.cap.objectId,
    character_id: first.character,
    catalog,
  })
  const fight = object_of(await env.send('open tournament match', open, first.sdk), '::fight::Fight')
  const second = players[1]!
  await second.sdk.hydrate([fight, (game.pins.character_protected_policy as { id: string }).id])
  const join = new Transaction()
  second.sdk.with_owner_kiosk(join, second.cap, (kiosk, cap) =>
    second.sdk.doors.join_tournament_match(join, {
      tournament,
      index: 0,
      fight_object: fight,
      kiosk,
      cap,
      character_id: second.character,
    })
  )
  await env.send('join tournament match', join, second.sdk)
  for (const [index, player] of players.entries()) {
    const ready = new Transaction()
    player.sdk.doors.ready_tournament_match(ready, {
      tournament,
      index: 0,
      fight_object: fight,
      fighter_indices: [index],
    })
    await env.send(`ready fighter ${index}`, ready, player.sdk)
  }
  const forfeit = new Transaction()
  second.sdk.doors.forfeit_tournament_match(forfeit, {
    fight_object: fight,
    fighter_idx: 1,
    kiosk: second.cap.kioskId,
    personal: second.cap.objectId,
  })
  await env.send('finish tournament match', forfeit, second.sdk)
  const settle = new Transaction()
  first.sdk.doors.settle_tournament_match(settle, {
    tournament,
    index: 0,
    fight_object: fight,
    fighter_idx: 0,
    kiosk: first.cap.kioskId,
    personal: first.cap.objectId,
  })
  first.sdk.doors.close_tournament_match(settle, { tournament, index: 0, fight_object: fight })
  await env.send('settle tournament', settle, first.sdk)
  const result = await env.json(tournament)
  assert.equal(result.status, 'finished')
  const claim = new Transaction()
  first.sdk.doors.tournament_claim_sui(claim, { t: tournament, team: 0, seat: 0 })
  await env.send('claim SUI prize', claim, first.sdk)
  const claimed = await env.json(tournament)
  assert.equal((claimed.teams as { seats: { sui_claimed: boolean }[] }[])[0]!.seats[0]!.sui_claimed, true)
  if (kares_pool) {
    await first.sdk.hydrate([kares_pool])
    const claim_token = new Transaction()
    first.sdk.doors.tournament_claim_kares(claim_token, { t: tournament, pool: kares_pool, team: 0, seat: 0 })
    await env.send('claim token prize', claim_token, first.sdk)
    assert.equal(((await env.json(kares_pool)).funds as { balance: string }).balance, '0')
  }
  console.log(
    kares
      ? 'SUI and token tournament prizes claimed.'
      : 'SUI tournament completed and prize claimed without a token type.'
  )
  return tournament
}
