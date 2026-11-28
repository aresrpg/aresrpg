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
import { proves_transaction_conflict, proves_transaction_executed } from '@aresrpg/sdk/transaction-execution'
import { gas_mist_from_receipt } from '@aresrpg/sdk'

import { assert_run_admission } from './behavior_control.ts'
import { settled_market_receipts } from './market_recovery.ts'
import { settled_fight_replays } from './fight_runtime.ts'
import { run_key, run_keys } from './run_ref.ts'
import type { BehaviorRun } from './behavior_script.ts'
import { charge_run } from './behavior_tally.ts'
import { assert_lease, type Command, type Envelope, type Lane } from './control.ts'
import { assert_live_grant, type Bot, type BotConfig, type Grant } from './model.ts'
import type { ControlStore, ControlTransaction } from './store.ts'

export type JournalBinding = Readonly<{ command: Command; actor_id: string; fence: number }>
const as_json = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? String(item) : item))

/** Execution evidence lives only in the ControlStore's process-local execution partition.
 * Durable lane/grant/run CAS checks still authorize every transition. */
export const create_transaction_lifecycle = (
  store: ControlStore,
  config: BotConfig,
  binding: () => JournalBinding,
  now = Date.now
): TransactionJournal => {
  const current = () => bound_transaction_lifecycle(store, config, binding(), now)
  return {
    read: () => current().read(),
    admit: (stage) => current().admit(stage),
    prepared: (record) => current().prepared(record),
    signed: (record) => current().signed(record),
    mark_submitting: (record) => current().mark_submitting(record),
    conflicted: (proof, record) => current().conflicted!(proof, record),
    executed: (written, record) => current().executed!(written, record),
    settled: (receipt, record) => current().settled(receipt, record),
  }
}

const bound_transaction_lifecycle = (
  store: ControlStore,
  config: BotConfig,
  binding: JournalBinding,
  now = Date.now
): TransactionJournal => {
  const { command, actor_id, fence } = binding
  const keys = [
    command.lane_key,
    `command:${command.id}`,
    `grant:${command.grant_id}`,
    `bot:${command.bot_id}`,
    ...run_keys(command),
  ]
  const lane_for = async (tx: ControlTransaction) =>
    assert_lease(await tx.get<Lane>(command.lane_key), actor_id, fence, now())
  const authorize = async (tx: ControlTransaction) => {
    const lane = await lane_for(tx)
    const grant = await tx.get<Grant>(`grant:${command.grant_id}`)
    const current = await tx.get<Command>(`command:${command.id}`)
    // Only receipt recovery settles an uncertain command; nothing prepares, signs or submits it again.
    if (!grant || !current || !['accepted', 'executing'].includes(current.status)) throw new Error('command_not_active')
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
    await assert_run_admission(tx, command, lane)
    return { lane, grant }
  }
  const change_envelope = async (record: SignedTransaction, phase: 'signed' | 'submitting') => {
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
      if (
        !Buffer.from(pending.bytes, 'base64').equals(record.bytes) ||
        (phase === 'submitting' && JSON.stringify(pending.signatures) !== JSON.stringify(record.signatures))
      )
        throw new Error('envelope_changed')
      await tx.put(command.lane_key, { ...lane, pending: { ...pending, phase, signatures: [...record.signatures] } })
    })
  }
  return {
    read: async () => {
      const lane = assert_lease(await store.read<Lane>(command.lane_key), actor_id, fence, now())
      const { pending } = lane
      if (!pending) return null
      const prepared = {
        digest: pending.digest,
        bytes: new Uint8Array(Buffer.from(pending.bytes, 'base64')),
        gas_budget_mist: pending.gas_budget_mist,
        include: pending.include,
        gas_scope: pending.gas_scope,
        gas_payer: pending.gas_payer,
      }
      if (pending.phase === 'prepared') return { ...prepared, phase: 'prepared' } satisfies JournalTransaction
      if (!Array.isArray(pending.signatures) || !pending.signatures.every((signature) => typeof signature === 'string'))
        throw new Error('invalid_signed_envelope')
      return { ...prepared, phase: pending.phase, signatures: pending.signatures } satisfies JournalTransaction
    },
    admit: async () =>
      store.transaction(keys, async (tx) => {
        await authorize(tx)
      }),
    prepared: async (record: PreparedTransaction) => {
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
          bytes: Buffer.from(record.bytes).toString('base64'),
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
    conflicted: async (proof, record) =>
      store.transaction(keys, async (tx) => {
        const lane = await lane_for(tx)
        const current = await tx.get<Command>(`command:${command.id}`)
        if (!current) throw new Error('envelope_transition_conflict')
        const result = (current.result ?? {}) as { digest?: string; conflicting_receipt?: Receipt }
        if (
          [
            !lane.pending,
            current.status === 'failed',
            current.error === 'transaction_input_consumed',
            current.lane_key === command.lane_key,
            current.grant_id === command.grant_id,
            result.digest === record.digest,
            as_json(result.conflicting_receipt) === as_json(proof),
          ].every(Boolean)
        )
          return
        const { pending } = lane
        if (
          !pending ||
          ![
            pending.phase === 'submitting',
            pending.digest === record.digest,
            pending.command_id === command.id,
            pending.grant_id === command.grant_id,
            current.lane_key === command.lane_key,
            current.grant_id === command.grant_id,
            lane.active_command === command.id,
            ['executing', 'uncertain'].includes(current.status),
          ].every(Boolean)
        )
          throw new Error('envelope_transition_conflict')
        if (
          !proves_transaction_conflict(
            { digest: pending.digest, bytes: new Uint8Array(Buffer.from(pending.bytes, 'base64')) },
            proof
          )
        )
          throw new Error('transaction_conflict_unproven')
        await tx.put(`command:${command.id}`, {
          ...current,
          status: 'failed',
          error: 'transaction_input_consumed',
          result: { digest: pending.digest, executed: false, conflicting_receipt: JSON.parse(as_json(proof)) },
        })
        await tx.put(command.lane_key, {
          ...lane,
          pending: null,
          active_command: null,
          needs_resync: true,
          decision_revision: lane.decision_revision + 1,
        })
      }),
    /** The transaction ran and its receipt is lost. The command ends with that fact and no result, and
     * the wallet reads the game again: what the action changed is observed, never assumed. */
    executed: async (written, record) =>
      store.transaction(keys, async (tx) => {
        const lane = await lane_for(tx)
        const current = await tx.get<Command>(`command:${command.id}`)
        if (!current) throw new Error('envelope_transition_conflict')
        const done = [
          !lane.pending,
          current.error === 'executed_without_receipt',
          (current.result as { digest?: string } | undefined)?.digest === record.digest,
        ]
        if (done.every(Boolean)) return
        const { pending } = lane
        if (
          !pending ||
          ![
            pending.phase === 'submitting',
            pending.digest === record.digest,
            pending.command_id === command.id,
            pending.grant_id === command.grant_id,
            current.grant_id === command.grant_id,
            lane.active_command === command.id,
            ['executing', 'uncertain'].includes(current.status),
          ].every(Boolean)
        )
          throw new Error('envelope_transition_conflict')
        const envelope = { digest: pending.digest, bytes: new Uint8Array(Buffer.from(pending.bytes, 'base64')) }
        if (!proves_transaction_executed(envelope, written)) throw new Error('transaction_execution_unproven')
        await tx.put(`command:${command.id}`, {
          ...current,
          status: 'failed',
          error: 'executed_without_receipt',
          result: { digest: pending.digest, executed: true },
        })
        await tx.put(command.lane_key, {
          ...lane,
          pending: null,
          active_command: null,
          needs_resync: true,
          decision_revision: lane.decision_revision + 1,
        })
      }),
    settled: async (receipt, record) => {
      const digest = receipt_digest(receipt)
      if (digest !== record.digest) throw new Error('receipt_digest_mismatch')
      const lane = assert_lease(await store.read<Lane>(command.lane_key), actor_id, fence, now())
      const { pending } = lane
      const command_key = `command:${pending?.command_id ?? command.id}`
      // The settled command may be another one than the bound one: its run is charged in the same commit.
      const settling = await store.read<Command>(command_key)
      await settle_envelope(
        store,
        [...keys, `grant:${pending?.grant_id ?? command.grant_id}`, command_key, ...run_keys(settling ?? {})],
        command_key,
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
  command_key: string,
  lane_key: string,
  actor_id: string,
  fence: number,
  receipt: Receipt,
  now: number
) =>
  store.transaction(keys, async (tx) => {
    const digest = receipt_digest(receipt)
    const lane = assert_lease(await tx.get<Lane>(lane_key), actor_id, fence, now)
    // The receipt is carried by its command; a second delivery of the same receipt is a no-op.
    if (settled_with(await tx.get<Command>(command_key), digest)) return
    const { pending } = lane
    if (!pending || pending.digest !== digest) throw new Error('receipt_envelope_mismatch')
    const grant = await tx.get<Grant>(`grant:${pending.grant_id}`)
    const command = await tx.get<Command>(`command:${pending.command_id}`)
    const net_gas = gas_mist_from_receipt(receipt)
    if (!grant || !command || net_gas === null) throw new Error('receipt_settlement_incomplete')
    const outcome = receipt_outcome(receipt)
    await tx.put(`command:${command.id}`, {
      ...command,
      ...outcome,
      receipt: JSON.parse(as_json(receipt)),
      result: { digest, gas_mist: String(net_gas), success: outcome.status === 'completed' },
    })
    await charge_signer(tx, command, net_gas)
    const settled = settled_lane(lane, command, receipt, outcome.status === 'completed')
    await tx.put(lane_key, { ...settled, fees_mist: String(BigInt(lane.fees_mist ?? 0) + net_gas) })
  })

/** The fee of a settled receipt is charged once, here, to the run that signed it: a failed execution
 * paid gas too. A tree accepted since then is another run and starts its own tally. */
const charge_signer = async (tx: ControlTransaction, command: Command, net_gas: bigint) => {
  if (!command.run_id) return
  const key = run_key(command.run_id)
  const run = await tx.get<BehaviorRun>(key)
  if (run && run.revision === command.behavior_binding?.revision) await tx.put(key, charge_run(run, net_gas))
}

const settled_with = (command: Command | null, digest: string) =>
  Boolean(command?.receipt && receipt_digest(command.receipt) === digest)
const settled_lane = (lane: Lane, command: Command, receipt: Receipt, completed: boolean): Lane => {
  return {
    ...lane,
    fight_replays: settled_fight_replays(lane, command, receipt, completed),
    catalogue_receipts: settled_market_receipts(lane, command, receipt),
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
