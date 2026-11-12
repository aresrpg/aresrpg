// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { assert_live_grant, type Bot, type BotConfig, type Grant } from './model.ts'
import type { ControlStore, ControlTransaction } from './store.ts'
import { admit_command, lane_key_for } from './command_admission.ts'
import type { Command, Lane } from './control.ts'
import { hash_secret } from './security.ts'
import { parse_behavior_script, type BehaviorRun } from './behavior_script.ts'
import { empty_behavior_memory } from './behavior_tree.ts'
import { cleared_run, run_ref_of } from './run_ref.ts'

type Revisions = Readonly<{ decision_revision: number; observation_revision: number }>
const owned = (run: BehaviorRun | null, grant: Grant): BehaviorRun => {
  if (!run || run.bot_id !== grant.bot_id || run.grant_id !== grant.id) throw new Error('behavior_run_not_found')
  return run
}
const assert_revision = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_argument')
}
export const create_behavior_control = (store: ControlStore, config: BotConfig, now: () => number) => {
  const keys = (grant: Grant) => [`bot:${grant.bot_id}`, `grant:${grant.id}`, lane_key_for(grant)]
  const authorize = async (tx: ControlTransaction, grant: Grant, scope: string) => {
    const current = await tx.get<Grant>(`grant:${grant.id}`)
    if (!current || current.bot_id !== grant.bot_id || current.address !== grant.address)
      throw new Error('invalid_token')
    assert_live_grant(config, current, await tx.get<Bot>(`bot:${grant.bot_id}`), now())
    if (!current.scopes.includes(scope)) throw new Error('insufficient_scope')
    return current
  }
  const admit = (grant: Grant, lane: Lane | null, revisions: Revisions) => {
    assert_revision(revisions.decision_revision)
    assert_revision(revisions.observation_revision)
    if (!lane || lane.transport_stopped) throw new Error('needs_resync')
    admit_command(grant, lane, { kind: 'gather', ...revisions }, now(), config.observation_freshness_ms)
    return lane
  }
  const validate_behavior = async (grant: Grant, value: unknown) => {
    const script = parse_behavior_script(value)
    await store.transaction(keys(grant), (tx) => authorize(tx, grant, 'bot:observe'))
    return {
      valid: true,
      script,
      simulation: 'not_run',
      limits: { default_action_limit: null, default_deadline: null },
    }
  }
  const behavior_status = (grant: Grant, id: string) =>
    store.transaction([...keys(grant), `behavior:${id}`], async (tx) => {
      await authorize(tx, grant, 'bot:observe')
      return owned(await tx.get<BehaviorRun>(`behavior:${id}`), grant)
    })
  const start_behavior = async (
    grant: Grant,
    input: Revisions & Readonly<{ idempotency_key: string; script: unknown }>
  ) => {
    if (!input.idempotency_key) throw new Error('invalid_argument')
    const script = parse_behavior_script(input.script)
    const id = hash_secret(`${grant.id}:behavior:${input.idempotency_key}`)
    const key = `behavior:${id}`
    const fingerprint = hash_secret(JSON.stringify(input))
    return store.transaction([...keys(grant), key], async (tx) => {
      const current = await authorize(tx, grant, 'bot:play')
      const prior = await tx.get<BehaviorRun>(key)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new Error('idempotency_conflict')
        return owned(prior, current)
      }
      const lane_key = lane_key_for(current)
      const lane = admit(current, await tx.get<Lane>(lane_key), input)
      const run: BehaviorRun = {
        id,
        bot_id: current.bot_id,
        grant_id: current.id,
        lane_key,
        fingerprint,
        script,
        revision: 1,
        memory: empty_behavior_memory(),
        pending_node: null,
        activation: null,
        consumed_command_id: null,
        status: 'active',
        actions_started: 0,
        last_command_id: null,
        created_at: now(),
      }
      await tx.put(key, run)
      await tx.put(lane_key, {
        ...lane,
        run_ref: { kind: 'behavior', id },
        decision_revision: lane.decision_revision + 1,
      })
      return run
    })
  }
  const replace_behavior = async (
    grant: Grant,
    input: Revisions & Readonly<{ run_id: string; expected_revision: number; script: unknown }>
  ) => {
    const script = parse_behavior_script(input.script)
    assert_revision(input.expected_revision)
    assert_revision(input.expected_revision + 1)
    const key = `behavior:${input.run_id}`
    return store.transaction([...keys(grant), key], async (tx) => {
      const current = await authorize(tx, grant, 'bot:play')
      const run = owned(await tx.get<BehaviorRun>(key), current)
      if (run.revision !== input.expected_revision) throw new Error('behavior_revision_conflict')
      const retained = await tx.get<Lane>(run.lane_key)
      const reference = retained && run_ref_of(retained)
      const lane = admit(
        current,
        reference?.kind === 'behavior' && reference.id === run.id ? { ...retained!, ...cleared_run } : retained,
        input
      )
      const updated: BehaviorRun = {
        ...run,
        script,
        revision: run.revision + 1,
        memory: empty_behavior_memory(),
        pending_node: null,
        activation: null,
        consumed_command_id: null,
        last_command_id: null,
        status: 'active',
        issue: undefined,
      }
      await tx.put(key, updated)
      await tx.put(run.lane_key, {
        ...lane,
        run_ref: { kind: 'behavior', id: run.id },
        decision_revision: lane.decision_revision + 1,
      })
      return updated
    })
  }
  const stop_behavior = (grant: Grant, id: string) =>
    store.transaction([...keys(grant), `behavior:${id}`], async (tx) => {
      await authorize(tx, grant, 'bot:pause')
      const run = owned(await tx.get<BehaviorRun>(`behavior:${id}`), grant)
      const lane = await tx.get<Lane>(run.lane_key)
      const next: BehaviorRun = { ...run, status: 'stopped', issue: 'explicit_stop' }
      await tx.put(`behavior:${id}`, next)
      const reference = lane && run_ref_of(lane)
      if (reference?.kind === 'behavior' && reference.id === id)
        await tx.put(run.lane_key, { ...lane!, ...cleared_run, decision_revision: lane!.decision_revision + 1 })
      return next
    })
  return { validate_behavior, behavior_status, start_behavior, replace_behavior, stop_behavior }
}
/** Rechecked before preparation, signing and submission; receipt recovery remains unconditional. */
export const assert_behavior_admission = (run: BehaviorRun | null, command: Command, lane: Lane) => {
  const reference = run_ref_of(lane)
  const binding = command.behavior_binding
  const valid =
    run &&
    binding &&
    [
      reference?.kind === 'behavior',
      reference?.id === run.id,
      command.run_ref?.id === run.id,
      command.grant_id === run.grant_id,
      command.bot_id === run.bot_id,
      run.last_command_id === command.id,
      run.revision === binding.revision,
      run.pending_node === binding.node,
      ['active', 'waiting'].includes(run.status),
    ].every(Boolean)
  if (!valid) throw new Error('behavior_execution_not_authorized')
}
