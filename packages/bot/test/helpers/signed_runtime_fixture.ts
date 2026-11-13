// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction, TransactionDataBuilder, type TransactionPlugin } from '@mysten/sui/transactions'
import { MultiSigPublicKey } from '@mysten/sui/multisig'
import { fromBase64 } from '@mysten/sui/utils'
import type { SuiTransport } from '@aresrpg/sdk'
import type { FightStateRow } from '@aresrpg/protocol'

import { create_fight } from '../../../fight/src/index.ts'
import { create_fixture } from '../../../fight/test/helpers.ts'
import { create_actor_runtime } from '../../src/actor_runtime.ts'
import { fight_checkpoint_id, gameplay_json } from '../../src/gameplay.ts'
import { create_control_service, empty_lane, lane_key_for, type Command, type Lane } from '../../src/control.ts'
import type { ControlStore } from '../../src/store.ts'

import { runtime_fixture } from './runtime_fixture.ts'
import { put } from './control_fixture.ts'

export const signed_fixture = async (store?: ControlStore) => {
  const f = await runtime_fixture(store)
  const character = `0x${'2'.repeat(64)}`,
    fight = `0x${'3'.repeat(64)}`
  const initial = create_fixture().checkpoint
  const first = initial.contract.fighters[0]!
  if (first.kind.type !== 'player') throw new Error('fixture requires player')
  const local = create_fight({
    state: {
      ...initial,
      contract: {
        ...initial.contract,
        id: fight,
        fighters: [
          { ...first, kind: { ...first.kind, owner: f.bot.address, character } },
          ...initial.contract.fighters.slice(1),
        ],
      },
      sources: { ...initial.sources, players: { [character]: initial.sources.players['0xc1']! } },
    },
    mode: 'local',
    seed: 91n,
  })
  const started = local.apply({ type: 'start', observed_ms: 60000n })
  if (started.error) throw new Error(started.error.code)
  const row = JSON.parse(
    gameplay_json({ contract: started.state.contract, players: started.state.sources.players, kolizeum: null })
  ) as FightStateRow
  const seat = started.state.contract.queue[Number(started.state.contract.turn_ptr)]!
  const lane_key = lane_key_for(f.bot)
  const command: Command = {
    fight_baseline: row,
    id: 'signed',
    bot_id: f.bot.id,
    grant_id: f.grant.id,
    lane_key,
    fingerprint: 'original-fixed-intent',
    kind: 'fight_turn',
    payload: {
      character_id: character,
      fight,
      fighter_idx: String(seat),
      checkpoint_id: fight_checkpoint_id(row),
      actions: [],
    },
    decision_revision: 1,
    observation_revision: 7,
    status: 'executing',
  }
  const tx = new Transaction()
  tx.setSender(f.bot.address)
  tx.setGasPrice(1)
  tx.setGasBudget(1000)
  tx.setGasPayment([{ objectId: `0x${'1'.repeat(64)}`, version: '1', digest: '11111111111111111111111111111111' }])
  const bytes = await tx.build(),
    digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9))
  const signature = new MultiSigPublicKey(fromBase64(f.bot.multisig_public_key)).combinePartialSignatures([
    (await key.signTransaction(bytes)).signature,
  ])
  const encrypted = await f.options.cipher.encrypt(
    JSON.stringify({ bytes: Buffer.from(bytes).toString('base64'), signatures: [signature] }),
    JSON.stringify([lane_key, command.id, digest])
  )
  await put(f.store, `command:${command.id}`, command)
  await put(f.store, lane_key, {
    ...empty_lane(f.bot),
    observation_revision: 7,
    decision_revision: 1,
    active_command: command.id,
    pending: {
      command_id: command.id,
      grant_id: f.grant.id,
      digest,
      phase: 'signed',
      encrypted,
      gas_budget_mist: '1000',
    },
  })
  const submissions: Uint8Array[] = []
  const receipt = {
    Transaction: {
      digest,
      effects: {
        status: { success: true },
        changedObjects: [],
        gasUsed: { computationCost: '20', storageCost: '5', storageRebate: '2' },
      },
      events: [],
    },
  }
  const resolve: TransactionPlugin = async (data, options, next) => {
    const { inputs, gasData: gas_data } = data
    inputs.forEach((input, index) => {
      const unresolved = (input as { UnresolvedObject?: { objectId: string } }).UnresolvedObject
      if (unresolved)
        inputs[index] = {
          $kind: 'Object',
          Object: {
            $kind: 'SharedObject',
            SharedObject: { objectId: unresolved.objectId, initialSharedVersion: '1', mutable: true },
          },
        } as never
    })
    if (!options.onlyTransactionKind) {
      gas_data.price = '1'
      gas_data.budget = '1000'
      gas_data.payment = [{ objectId: `0x${'1'.repeat(64)}`, version: '1', digest: '11111111111111111111111111111111' }]
    }
    await next()
  }
  const client = {
    core: {
      getBalance: async () => ({ balance: { balance: '10000000000' } }),
      resolveTransactionPlugin: () => resolve,
      getObjects: async ({ objectIds: object_ids }: { objectIds: string[] }) => ({
        objects: object_ids.map((object_id) => ({
          objectId: object_id,
          version: '1',
          digest: '11111111111111111111111111111111',
          owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
        })),
      }),
      executeTransaction: async (input: { transaction: Uint8Array }) => {
        submissions[submissions.length] = input.transaction
        return {
          Transaction: { ...receipt.Transaction, digest: TransactionDataBuilder.getDigestFromBytes(input.transaction) },
        }
      },
      waitForTransaction: async () => receipt,
    },
  } as unknown as SuiTransport
  const runtime = create_actor_runtime({ ...f.options, sdk_options: { client } })
  const admit = async () => {
    await f.send({ type: 'packet/signature_request', payload: '11111111-1111-4111-8111-111111111111' })
    await f.send({ type: 'packet/game_state', frozen: false })
    await f.send({ type: 'packet/connection_accepted', address: f.bot.address })
    await f.send({
      type: 'packet/server_info',
      online: 1,
      online_characters: 1,
      indexing_lag: 0,
      current_epoch: '1',
      chain_timestamp_ms: 63000,
      chain_sample_age_ms: 0,
    })
    await f.send({ type: 'packet/fight_state', fight, state: row, seats: { [character]: Number(seat) } })
    await f.send({
      type: 'packet/characters',
      characters: [{ id: character, custody: 'fight', active_fight: { id: fight, seat: Number(seat) } }],
    })
  }
  return { ...f, runtime, admit, bytes, digest, command, lane_key, submissions, client }
}
