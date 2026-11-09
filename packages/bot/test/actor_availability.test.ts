// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { MultiSigPublicKey } from '@mysten/sui/multisig'
import { fromBase64 } from '@mysten/sui/utils'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { SuiTransport } from '@aresrpg/sdk'

import { create_actor_runtime } from '../src/actor_runtime.ts'
import { request_provisioning } from '../src/provisioning.ts'
import { empty_lane, lane_key_for, type Command } from '../src/control.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { put } from './helpers/control_fixture.ts'

test('an unresolved wallet receipt does not block provisioning another wallet', async () => {
  const f = await runtime_fixture()
  let release: () => void = () => undefined
  let entered: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const transport = {
    core: {
      waitForTransaction: async () => {
        entered()
        await waiting
        throw new Error('fixture receipt still unavailable')
      },
    },
  } as unknown as SuiTransport
  const lane_key = lane_key_for(f.bot)
  const command: Command = {
    id: 'pending',
    bot_id: f.bot.id,
    grant_id: f.grant.id,
    lane_key,
    fingerprint: 'fixture',
    kind: 'fight_turn',
    payload: {},
    decision_revision: 1,
    observation_revision: 1,
    status: 'uncertain',
  }
  await put(f.store, 'command:pending', command)
  const tx = new Transaction()
  tx.setSender(f.bot.address)
  tx.setGasPrice(1)
  tx.setGasBudget(1000)
  tx.setGasPayment([{ objectId: `0x${'1'.repeat(64)}`, version: '1', digest: '11111111111111111111111111111111' }])
  const bytes = await tx.build()
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  const member = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9))
  const signed = await member.signTransaction(bytes)
  const signature = new MultiSigPublicKey(fromBase64(f.bot.multisig_public_key)).combinePartialSignatures([
    signed.signature,
  ])
  const encrypted = await f.options.cipher.encrypt(
    JSON.stringify({ bytes: Buffer.from(bytes).toString('base64'), signatures: [signature] }),
    JSON.stringify([lane_key, command.id, digest])
  )
  await put(f.store, lane_key, {
    ...empty_lane(f.bot),
    pending: {
      command_id: command.id,
      grant_id: f.grant.id,
      digest,
      phase: 'submitting',
      encrypted,
      gas_budget_mist: '1000',
    },
    active_command: command.id,
    decision_revision: 1,
  })
  const other = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8))
  const reference = {
    key_id: 'fixture:signing:second-known-test-key',
    public_key: other.getPublicKey().toBase64(),
  }
  const provider = {
    ...f.options.provider,
    prepare: async () => ({ key: reference, sealed: 'public-test-fixture' }),
    signer: (key: typeof reference) =>
      key.key_id !== reference.key_id
        ? f.options.provider.signer(key)
        : {
            storage: 'persistent' as const,
            public_key: other.getPublicKey(),
            sign_personal_message: (bytes: Uint8Array) => other.signPersonalMessage(bytes),
            sign_transaction: (bytes: Uint8Array) => other.signTransaction(bytes),
          },
  }
  const runtime = create_actor_runtime({ ...f.options, provider, sdk_options: { client: transport } })
  try {
    await runtime.tick()
    expect(await Promise.race([started.then(() => true), Bun.sleep(100).then(() => false)])).toBe(true)
    expect(f.errors).toEqual([])
    await request_provisioning(f.store, {
      id: 'second',
      owner: f.bot.owner,
      zklogin_public_identifier: f.bot.zklogin_public_identifier,
      policy: f.bot.policy,
    })
    await runtime.tick()
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await f.store.read('bot:second')) break
      await Bun.sleep(1)
    }
    expect(await f.store.read('bot:second')).not.toBeNull()
    expect((await f.store.read<Command>('command:pending'))!.status).toBe('uncertain')
  } finally {
    release()
    await runtime.stop()
  }
})
