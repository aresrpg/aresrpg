// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { run_live } from '@aresrpg/protocol/strategies'

import { assert_live_grant, type Bot, type BotConfig, type Grant } from './model.ts'
import type { ControlStore, ControlTransaction } from './store.ts'
import { lane_key_for } from './command_admission.ts'
import type { Command, Lane } from './control.ts'
import { hash_secret } from './security.ts'
import { parse_behavior_script, type BehaviorRun } from './behavior_script.ts'
import { behavior_actor } from './behavior_projection.ts'
import { empty_behavior_memory } from './behavior_tree.ts'
import { MAX_WALLET_RUNS, released_run, run_hosted, run_key } from './run_ref.ts'

type Revisions = Readonly<{ decision_revision: number; observation_revision: number }>
type Start = Revisions & Readonly<{ idempotency_key: string; script: unknown }>
type Replace = Revisions & Readonly<{ character_id: string; expected_revision: number; script: unknown }>
/** A hero has one run, so its identity is the hero. Any live grant of the wallet's one verified
 * owner sees and manages it; the grant that set its tree is the authority it executes under. */
const hero_run_id = (bot_id: string, character_id: string) => hash_secret(`${bot_id}:hero:${character_id}`)
const assert_revision = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_argument')
}
/** Signing, an unsettled envelope or an unreconciled effect of this run's own last command. */
const unresolved = (lane: Lane, run: BehaviorRun) =>
  Boolean(run.last_command_id) &&
  [lane.active_command, lane.pending?.command_id, lane.reconciliation_command].includes(run.last_command_id)
export const create_behavior_control = (store: ControlStore, config: BotConfig, now: () => number) => {
  const keys = (grant: Grant, character_id: string) => [
    `bot:${grant.bot_id}`,
    `grant:${grant.id}`,
    lane_key_for(grant),
    `behavior:${hero_run_id(grant.bot_id, character_id)}`,
  ]
  const authorize = async (tx: ControlTransaction, grant: Grant, scope: string) => {
    const current = await tx.get<Grant>(`grant:${grant.id}`)
    if (!current || current.bot_id !== grant.bot_id || current.address !== grant.address)
      throw new Error('invalid_token')
    assert_live_grant(config, current, await tx.get<Bot>(`bot:${grant.bot_id}`), now())
    if (!current.scopes.includes(scope)) throw new Error('insufficient_scope')
    return current
  }
  const hero_run = async (tx: ControlTransaction, grant: Grant, character_id: string) => {
    const run = await tx.get<BehaviorRun>(`behavior:${hero_run_id(grant.bot_id, character_id)}`)
    if (!run) throw new Error('behavior_run_not_found')
    return run
  }
  /** A hero takes its own slot beside its neighbours and never needs the signing queue idle.
   * Wallet decisions still fence it; another hero's newer observation does not. */
  const host = (retained: Lane | null, run: BehaviorRun, prior: BehaviorRun | null, revisions: Revisions): Lane => {
    assert_revision(revisions.decision_revision)
    assert_revision(revisions.observation_revision)
    if (!retained || retained.transport_stopped) throw new Error('needs_resync')
    const lane = { ...retained, ...released_run(retained, run.id) }
    if ([lane.paused, prior && unresolved(retained, prior)].some(Boolean)) throw new Error('bot_busy_or_paused')
    if (
      [
        lane.lease_until <= now(),
        lane.observed_at + config.observation_freshness_ms <= now(),
        lane.decision_revision !== revisions.decision_revision,
        lane.observation_revision < revisions.observation_revision,
      ].some(Boolean)
    )
      throw new Error('needs_resync')
    if (Object.keys(lane.runs).length >= MAX_WALLET_RUNS) throw new Error('run_limit_reached')
    return { ...lane, runs: { ...lane.runs, [run.character_id]: run.id } }
  }
  /** Every start and replacement begins a new traversal of the accepted tree under the acting grant. */
  const accept = (grant: Grant, lane_key: string, script: BehaviorRun['script'], prior: BehaviorRun | null) => {
    const character_id = behavior_actor(script)
    return {
      id: hero_run_id(grant.bot_id, character_id),
      bot_id: grant.bot_id,
      grant_id: grant.id,
      lane_key,
      character_id,
      fingerprint: '',
      script,
      revision: (prior?.revision ?? 0) + 1,
      memory: empty_behavior_memory(),
      pending_node: null,
      activation: null,
      consumed_command_id: null,
      status: 'active',
      // Command identities continue across trees of one actor lifetime; they never restart at zero.
      actions_started: prior?.actions_started ?? 0,
      last_command_id: null,
      created_at: now(),
    } satisfies BehaviorRun
  }
  const validate_behavior = async (grant: Grant, value: unknown) => {
    const script = parse_behavior_script(value)
    const character_id = behavior_actor(script)
    await store.transaction(keys(grant, character_id), (tx) => authorize(tx, grant, 'bot:observe'))
    return {
      valid: true,
      script,
      character_id,
      simulation: 'not_run',
      limits: { default_action_limit: null, default_deadline: null, wallet_runs: MAX_WALLET_RUNS },
    }
  }
  const behavior_status = (grant: Grant, character_id: string) =>
    store.transaction(keys(grant, character_id), async (tx) => {
      await authorize(tx, grant, 'bot:observe')
      return hero_run(tx, grant, character_id)
    })
  const start_behavior = async (grant: Grant, input: Start) => {
    if (!input.idempotency_key) throw new Error('invalid_argument')
    const script = parse_behavior_script(input.script)
    const fingerprint = hash_secret(JSON.stringify(input))
    const tree_keys = keys(grant, behavior_actor(script))
    return store.transaction(tree_keys, async (tx) => {
      const current = await authorize(tx, grant, 'bot:play')
      const prior = await tx.get<BehaviorRun>(tree_keys[3]!)
      if (prior?.fingerprint === fingerprint) return prior
      const retained = await tx.get<Lane>(tree_keys[2]!)
      // A playing hero keeps its tree until it is stopped or explicitly replaced at its revision.
      if (prior && run_live(prior) && retained?.runs?.[prior.character_id]) throw new Error('bot_busy_or_paused')
      const accepted = { ...accept(current, tree_keys[2]!, script, prior), fingerprint }
      const lane = host(retained, accepted, prior, input)
      const run = { ...accepted, execution_fence: lane.fence }
      await tx.put(tree_keys[3]!, run)
      await tx.put(run.lane_key, lane)
      return run
    })
  }
  const replace_behavior = async (grant: Grant, input: Replace) => {
    const script = parse_behavior_script(input.script)
    assert_revision(input.expected_revision)
    assert_revision(input.expected_revision + 1)
    if (behavior_actor(script) !== input.character_id) throw new Error('behavior_character_changed')
    const tree_keys = keys(grant, input.character_id)
    return store.transaction(tree_keys, async (tx) => {
      const current = await authorize(tx, grant, 'bot:play')
      const prior = await hero_run(tx, current, input.character_id)
      if (prior.revision !== input.expected_revision) throw new Error('behavior_revision_conflict')
      const { fingerprint, execution_fence } = prior
      const run = { ...accept(current, prior.lane_key, script, prior), fingerprint, execution_fence }
      await tx.put(run.lane_key, host(await tx.get<Lane>(run.lane_key), run, prior, input))
      await tx.put(tree_keys[3]!, run)
      return run
    })
  }
  /** Stop is durable authority any process may write, so it touches only the hero's own record:
   * a lane write here would race the owner process's signing of a neighbour. The stopped run fences
   * itself at once, and the owner's next queue pass frees its slot. */
  const stop_behavior = (grant: Grant, character_id: string) =>
    store.transaction(keys(grant, character_id).toSpliced(2, 1), async (tx) => {
      await authorize(tx, grant, 'bot:pause')
      const run = await hero_run(tx, grant, character_id)
      const next: BehaviorRun = { ...run, status: 'stopped', issue: 'explicit_stop' }
      await tx.put(run_key(run.id), next)
      return next
    })
  return { validate_behavior, behavior_status, start_behavior, replace_behavior, stop_behavior }
}
/** Rechecked before preparation, signing and submission; receipt recovery remains unconditional.
 * A direct command has no run; a run command needs its hero's run hosted, current and waiting on it. */
export const assert_run_admission = async (tx: ControlTransaction, command: Command, lane: Lane) => {
  if (!run_hosted(command, lane)) throw new Error('execution_not_authorized')
  if (!command.run_id) return
  const run = await tx.get<BehaviorRun>(run_key(command.run_id))
  const binding = command.behavior_binding
  const valid =
    run &&
    binding &&
    [
      command.grant_id === run.grant_id,
      command.bot_id === run.bot_id,
      run.last_command_id === command.id,
      run.revision === binding.revision,
      run.pending_node === binding.node,
      ['active', 'waiting'].includes(run.status),
    ].every(Boolean)
  if (!valid) throw new Error('behavior_execution_not_authorized')
}
