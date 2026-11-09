// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type {
  TransactionJournal,
  PreparedTransaction,
  SignedTransaction,
  Receipt,
  JournalTransaction,
} from '@aresrpg/sdk/transaction-execution'
import { receipt_digest } from '@aresrpg/sdk/cache'
import { gas_mist_from_receipt } from '@aresrpg/sdk'

import { settled_fight_replays } from './fight_runtime.ts'
import type { ProfessionRun } from './profession_control.ts'
import { assert_lease, type Command, type Envelope, type Lane } from './control.ts'
import { assert_live_grant, type Bot, type BotConfig, type Grant } from './model.ts'
import type { ControlStore, ControlTransaction } from './store.ts'

export type EnvelopeCipher = Readonly<{
  encrypt: (plaintext: string, context: string) => Promise<string>
  decrypt: (ciphertext: string, context: string) => Promise<string>
}>
export type JournalBinding = Readonly<{ command: Command; actor_id: string; fence: number }>
const as_json = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? String(item) : item))

export const create_transaction_journal = (
  store: ControlStore,
  config: BotConfig,
  cipher: EnvelopeCipher,
  binding: JournalBinding,
  now = Date.now
): TransactionJournal => {
  const { command, actor_id, fence } = binding
  const context = (digest: string, command_id = command.id) => JSON.stringify([command.lane_key, command_id, digest])
  const keys = [
    command.lane_key,
    `command:${command.id}`,
    `grant:${command.grant_id}`,
    `bot:${command.bot_id}`,
    ...(command.profession_run_id ? [`profession:${command.profession_run_id}`] : []),
  ]
  const lane_for = async (tx: ControlTransaction) =>
    assert_lease(await tx.get<Lane>(command.lane_key), actor_id, fence, now())
  const authorize = async (tx: ControlTransaction) => {
    const lane = await lane_for(tx)
    const grant = await tx.get<Grant>(`grant:${command.grant_id}`)
    const current = await tx.get<Command>(`command:${command.id}`)
    if (!grant || !current || !['accepted', 'executing', 'uncertain'].includes(current.status))
      throw new Error('command_not_active')
    assert_live_grant(config, grant, await tx.get<Bot>(`bot:${command.bot_id}`), now())
    if (
      [
        lane.paused,
        lane.needs_resync,
        lane.active_command !== command.id,
        lane.observation_revision !== command.observation_revision,
        lane.observed_at + config.observation_freshness_ms <= now(),
        lane.decision_revision !== command.decision_revision,
        !grant.scopes.includes('bot:play'),
      ].some(Boolean)
    )
      throw new Error('execution_not_authorized')
    if (command.profession_run_id)
      assert_profession_admission(
        await tx.get<ProfessionRun>(`profession:${command.profession_run_id}`),
        command,
        lane,
        now()
      )
    return { lane, grant }
  }
  const change_envelope = async (record: SignedTransaction, phase: 'signed' | 'submitting') => {
    const encrypted = await cipher.encrypt(
      as_json({ bytes: Buffer.from(record.bytes).toString('base64'), signatures: record.signatures }),
      context(record.digest)
    )
    await store.transaction(keys, async (tx) => {
      const { lane } = await authorize(tx)
      const { pending } = lane
      const expected = phase === 'signed' ? 'prepared' : 'signed'
      if (
        !pending ||
        ![pending.command_id === command.id, pending.digest === record.digest, pending.phase === expected].every(
          Boolean
        )
      )
        throw new Error('envelope_transition_conflict')
      const previous = JSON.parse(
        await cipher.decrypt(pending.encrypted, context(pending.digest, pending.command_id))
      ) as {
        bytes: string
        signatures?: readonly string[]
      }
      if (
        previous.bytes !== Buffer.from(record.bytes).toString('base64') ||
        (phase === 'submitting' && JSON.stringify(previous.signatures) !== JSON.stringify(record.signatures))
      )
        throw new Error('envelope_changed')
      await tx.put(command.lane_key, { ...lane, pending: { ...pending, phase, encrypted } })
    })
  }
  return {
    read: async () => {
      const lane = await store.read<Lane>(command.lane_key)
      const pending = lane?.pending
      if (!pending) return null
      const envelope = JSON.parse(
        await cipher.decrypt(pending.encrypted, context(pending.digest, pending.command_id))
      ) as { bytes: string; signatures?: readonly string[] }
      const prepared = {
        digest: pending.digest,
        bytes: new Uint8Array(Buffer.from(envelope.bytes, 'base64')),
        gas_budget_mist: pending.gas_budget_mist,
        include: pending.include,
        gas_scope: pending.gas_scope,
        gas_payer: pending.gas_payer,
      }
      if (pending.phase === 'prepared') return { ...prepared, phase: 'prepared' } satisfies JournalTransaction
      if (
        !Array.isArray(envelope.signatures) ||
        !envelope.signatures.every((signature) => typeof signature === 'string')
      )
        throw new Error('invalid_signed_envelope')
      return { ...prepared, phase: pending.phase, signatures: envelope.signatures } satisfies JournalTransaction
    },
    admit: async () =>
      store.transaction(keys, async (tx) => {
        await authorize(tx)
      }),
    prepared: async (record: PreparedTransaction) => {
      const encrypted = await cipher.encrypt(
        as_json({ bytes: Buffer.from(record.bytes).toString('base64') }),
        context(record.digest)
      )
      await store.transaction(keys, async (tx) => {
        const { lane, grant } = await authorize(tx)
        if (lane.pending) throw new Error('unresolved_envelope')
        if (!/^[1-9][0-9]*$/.test(record.gas_budget_mist)) throw new Error('invalid_gas_budget')
        const gas = BigInt(record.gas_budget_mist)
        // Sui GasData.budget is a positive u64, not a service spending allowance.
        if (gas > 18446744073709551615n) throw new Error('invalid_gas_budget')
        const pending: Envelope = {
          command_id: command.id,
          grant_id: grant.id,
          digest: record.digest,
          phase: 'prepared',
          encrypted,
          gas_budget_mist: String(gas),
          include: record.include,
          gas_scope: record.gas_scope,
          gas_payer: record.gas_payer,
        }
        await tx.put(command.lane_key, { ...lane, pending })
        await tx.put(`command:${command.id}`, { ...command, status: 'executing' })
      })
    },
    signed: (record) => change_envelope(record, 'signed'),
    mark_submitting: (record) => change_envelope(record, 'submitting'),
    settled: async (receipt, record) => {
      const digest = receipt_digest(receipt)
      if (digest !== record.digest) throw new Error('receipt_digest_mismatch')
      const lane = await store.read<Lane>(command.lane_key)
      const pending = lane?.pending
      if (!pending) {
        if (await store.read(`receipt:${digest}`)) return
        throw new Error('envelope_missing')
      }
      await settle_envelope(
        store,
        [...keys, `grant:${pending.grant_id}`, `command:${pending.command_id}`, `receipt:${digest}`],
        command.lane_key,
        actor_id,
        fence,
        receipt,
        now()
      )
    },
  }
}

/** Only prepared/signed phases have not crossed the consuming submission gate.
 * Cancellation races that gate in the same fenced CAS; submitting ambiguity is never cleared. */
export const abandon_unsubmitted = async (
  store: ControlStore,
  { command, actor_id, fence }: JournalBinding,
  digest: string,
  phase: 'prepared' | 'signed',
  now: number
) =>
  store.transaction([command.lane_key, `command:${command.id}`], async (tx) => {
    const lane = assert_lease(await tx.get<Lane>(command.lane_key), actor_id, fence, now)
    const current = await tx.get<Command>(`command:${command.id}`)
    const { pending } = lane
    if (
      !current ||
      !pending ||
      ![
        pending.phase === phase,
        pending.command_id === command.id,
        pending.grant_id === command.grant_id,
        pending.digest === digest,
        lane.active_command === command.id,
      ].every(Boolean)
    )
      throw new Error('envelope_transition_conflict')
    await tx.put(`command:${command.id}`, {
      ...current,
      status: phase === 'prepared' ? 'failed' : 'cancelled',
      error: phase === 'prepared' ? 'preparation_abandoned' : 'cancelled_before_submission',
    })
    await tx.put(command.lane_key, { ...lane, pending: null, active_command: null, needs_resync: true })
  })

const settle_envelope = async (
  store: ControlStore,
  keys: readonly string[],
  lane_key: string,
  actor_id: string,
  fence: number,
  receipt: Receipt,
  now: number
) =>
  store.transaction(keys, async (tx) => {
    const digest = receipt_digest(receipt)
    if (await tx.get(`receipt:${digest}`)) return
    const lane = assert_lease(await tx.get<Lane>(lane_key), actor_id, fence, now)
    const { pending } = lane
    if (!pending || pending.digest !== digest) throw new Error('receipt_envelope_mismatch')
    const grant = await tx.get<Grant>(`grant:${pending.grant_id}`)
    const command = await tx.get<Command>(`command:${pending.command_id}`)
    const net_gas = gas_mist_from_receipt(receipt)
    if (!grant || !command || net_gas === null) throw new Error('receipt_settlement_incomplete')
    await tx.put(`receipt:${digest}`, {
      digest,
      receipt: JSON.parse(as_json(receipt)),
      settled_at: now,
      gas_mist: String(net_gas),
    })
    const outcome = receipt_outcome(receipt)
    await tx.put(`command:${command.id}`, {
      ...command,
      ...outcome,
      result: { digest, gas_mist: String(net_gas), success: outcome.status === 'completed' },
    })
    await tx.put(lane_key, settled_lane(lane, command, receipt, outcome.status === 'completed'))
  })

const settled_lane = (lane: Lane, command: Command, receipt: Receipt, completed: boolean): Lane => {
  return {
    ...lane,
    fight_replays: settled_fight_replays(lane, command, receipt, completed),
    reconciliation_command: completed ? command.id : lane.reconciliation_command,
    pending: null,
    active_command: null,
    needs_resync: completed || lane.needs_resync,
  }
}

const receipt_outcome = (receipt: Receipt): Readonly<{ status: 'completed' | 'failed'; error?: string }> => {
  const result = [receipt.FailedTransaction, receipt.Transaction, receipt].find((value) => value !== undefined)!
  const status = result.effects?.status
  if (!status || typeof status.success !== 'boolean') throw new Error('receipt_outcome_missing')
  if (status.success) return { status: 'completed' }
  const failure = status.error
  const error = typeof failure === 'string' ? failure : (failure?.message ?? 'chain_execution_failed')
  return { status: 'failed', error }
}

const assert_profession_admission = (run: ProfessionRun | null, command: Command, lane: Lane, now: number) => {
  if (!run) throw new Error('profession_execution_not_authorized')
  const valid = [
    run.grant_id === command.grant_id,
    run.bot_id === command.bot_id,
    run.last_command_id === command.id,
    lane.profession_run_id === run.id,
    ['active', 'waiting'].includes(run.status),
    run.plan.deadline_ms > now,
    run.actions_started <= run.plan.max_actions,
  ]
  if (!valid.every(Boolean)) throw new Error('profession_execution_not_authorized')
}
