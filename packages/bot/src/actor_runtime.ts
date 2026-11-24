// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { SDK, type SdkOptions } from '@aresrpg/sdk'
import { create_agent_multisig } from '@aresrpg/sdk/agent-multisig'
import { create_agent_transaction_signer } from '@aresrpg/sdk/agent-transactions'
import type { TransactionJournal } from '@aresrpg/sdk/transaction-execution'
import { transaction_failure_kind } from '@aresrpg/sdk/transaction-error'
import type { ClientPacket } from '@aresrpg/protocol'
import { fromBase64 } from '@mysten/sui/utils'
import { ZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import type { AgentTransport } from '@aresrpg/sdk/agent-connection'

import { create_actor_locomotion } from './actor_locomotion.ts'
import { gameplay_observation_ready, type GameplayContext } from './gameplay_context.ts'
import { bind_action_baseline, reconcile_action } from './action_reconciliation.ts'
import { assert_fight_reconciled, retire_fight_replays } from './fight_runtime.ts'
import { empty_snapshot, actor_snapshot_transition } from './actor_snapshot.ts'
import { create_bot_actor, bun_transport } from './actor.ts'
import {
  assert_lease,
  lane_owned_elsewhere,
  lane_work_key,
  create_control_service,
  lane_key_for,
  type Command,
  type Lane,
  type Observe,
} from './control.ts'
import { authority_fault, authorize, CONTROL_SCOPES, type Bot, type Scope, type BotConfig } from './model.ts'
import { run_pairing_proof, run_provisioning, type ProvisionRequest } from './provisioning.ts'
import { has_pending_work, type ControlStore } from './store.ts'
import { abandon_unsubmitted, create_transaction_lifecycle } from './transaction_lifecycle.ts'
import { record_command_failure, ready_gameplay_command, wait_for_contract } from './run_runtime.ts'
import { process_lane_runs, retire_run } from './run_actor.ts'
import { retired_run } from './store_projection.ts'
import { read_market_receipts, fold_market_receipts } from './market_recovery.ts'
import { empty_inventory } from './actor_inventory.ts'
import { run_keys } from './run_ref.ts'
import { apply_actor_watches, observation_reply, owned_run_observation } from './actor_observation.ts'
import { create_status_sharer } from './status_sharer.ts'
import { execute_gameplay, validate_gameplay } from './gameplay.ts'
import { create_market_collector } from './market_collection.ts'
import { SLEEP_AFTER_IDLE_MS, wallet_idle } from './idle.ts'
import { read_actor_balance } from './character_observability.ts'
import type { ManagedProvider } from './managed_signer.ts'

/** One run of a task at a time: a caller during a run joins it, and `idle` waits for it to end. */
const one_at_a_time = (task: () => Promise<void>) => {
  let current: Promise<void> | null = null
  return {
    run: () => (current ??= task().finally(() => (current = null))),
    idle: async () => void (await current),
  }
}
export const create_actor_runtime = (options: ActorRuntimeOptions) => {
  const { store, config } = options
  const now = options.now ?? Date.now
  const monotonic_now = options.monotonic_now ?? (() => performance.now())
  const control = create_control_service(store, config, options.observation_freshness_ms, now)
  type Session = Awaited<ReturnType<typeof open_session>>
  const sessions = new Map<string, Session>()
  let cursor = ''
  const opening = new Map<string, Promise<Session>>()
  /** Process-local, like every session fact: when each open seat's wallet last had work, and when each
   * seat this process closed for idleness did so. A restarted process knows neither. */
  const idle_since = new Map<string, number>()
  const asleep_since = new Map<string, number>()
  const work = new Map<string, Promise<void>>()
  let stopped = false
  const live_bot = (bot: Bot, grant_id: string, scope: Scope | null = null) =>
    authorize(store.read, config, { id: grant_id, bot_id: bot.id, address: bot.address }, scope, now())
  const grant_is_live = (bot: Bot, grant_id: string, scope: Scope | null = null) =>
    live_bot(bot, grant_id, scope).then(
      () => true,
      (error: unknown) => !authority_fault(error)
    )
  const open_session = async (bot: Bot, first_command: Command) => {
    const lane_key = lane_key_for(bot)
    const lease = await control.acquire(bot, options.actor_id, options.lease_ms)
    const provision = await store.read<ProvisionRequest>(`provision:${bot.id}`)
    if (!provision?.key || provision.key.key_id !== bot.key_id) throw new Error('MANAGED_KEY_REFERENCE_MISSING')
    const member = options.provider.signer(provision.key)
    const identity = create_agent_multisig({
      agent_public_key: member.public_key,
      zklogin_public_identifier: ZkLoginPublicIdentifier.fromBytes(fromBase64(bot.zklogin_public_identifier)),
      sign_personal_message: member.sign_personal_message,
    })
    if (identity.address !== bot.address || identity.public_key.toBase64() !== bot.multisig_public_key)
      throw new Error('BOT_IDENTITY_MISMATCH')
    let command = first_command
    const connector_grants = new Set([first_command.grant_id])
    let snapshot = empty_snapshot()
    const gameplay_context = () => ({
      address: bot.address,
      pins: options.sdk_options.pins,
      command,
      snapshot,
      now: monotonic_now(),
      freshness_ms: options.observation_freshness_ms,
    })
    const authorize = async () => {
      assert_lease(await store.read<Lane>(lane_key), options.actor_id, lease.fence, now())
      const valid = await Promise.all([...connector_grants].map((grant_id) => grant_is_live(bot, grant_id)))
      if (!valid.some(Boolean)) throw new Error('invalid_token')
    }
    const lifecycle = create_transaction_lifecycle(
      store,
      config,
      () => ({ command, actor_id: options.actor_id, fence: lease.fence }),
      now
    )
    const journal: TransactionJournal = {
      read: () => lifecycle.read(),
      admit: async (stage) => {
        await lifecycle.admit(stage)
        if (stage !== 'prepare') validate_gameplay(gameplay_context())
      },
      prepared: (record) => lifecycle.prepared(record),
      signed: (record) => lifecycle.signed(record),
      mark_submitting: (record) => lifecycle.mark_submitting(record),
      conflicted: (proof, record) => lifecycle.conflicted!(proof, record).finally(invalidate_execution),
      settled: async (receipt, record) => {
        await lifecycle.settled(receipt, record)
        await reconcile()
      },
    }
    const build_sdk = () =>
      SDK({
        ...options.sdk_options,
        network: 'mainnet',
        address: bot.address,
        transaction_storage: null,
        transaction_journal: journal,
        sign_transaction: create_agent_transaction_signer(identity, async (bytes) => {
          await journal.admit('sign')
          return member.sign_transaction(bytes)
        }),
      })
    const restore_market = async () => {
      const retained = assert_lease(await store.read<Lane>(lane_key), options.actor_id, lease.fence, now())
      const proofs = await read_market_receipts(store, retained)
      const inventory = fold_market_receipts(proofs, snapshot.inventory ?? empty_inventory())
      if (inventory === snapshot.inventory) return
      snapshot = { ...snapshot, inventory }
      await control.observed(lane_key, options.actor_id, lease.fence, snapshot.ready)
      const current = assert_lease(await store.read<Lane>(lane_key), options.actor_id, lease.fence, now())
      snapshot = { ...snapshot, observation_revision: current.observation_revision }
    }
    const reconcile = async () => {
      await restore_market()
      await reconcile_action(
        store,
        lane_key,
        options.actor_id,
        lease.fence,
        {
          address: bot.address,
          command,
          snapshot,
          now: monotonic_now(),
          freshness_ms: options.observation_freshness_ms,
        },
        now()
      )
      const lane = await store.read<Lane>(lane_key)
      if (lane && [run_keys(lane).length, lane.direct].some(Boolean))
        void schedule_lane(lane_key, true).catch(options.report_failure)
    }
    let sdk = build_sdk()
    let recovered = false
    const actor = create_bot_actor({
      connection: {
        endpoint: options.endpoint,
        origin: options.origin,
        signer: identity,
        transport: options.transport ?? bun_transport,
      },
      authorize,
      authorize_observation: async (owner) => {
        await live_bot(bot, owner)
      },
      needs_resync: () => control.observed(lane_key, options.actor_id, lease.fence, false),
      observe: async (state) => {
        locomotion.observe(state.status)
        await restore_market()
        const transition = actor_snapshot_transition(snapshot, state, monotonic_now())
        ;({ snapshot } = transition)
        await control.observed(lane_key, options.actor_id, lease.fence, snapshot.ready, transition.changed)
        const lane = assert_lease(await store.read<Lane>(lane_key), options.actor_id, lease.fence, now())
        snapshot = { ...snapshot, observation_revision: lane.observation_revision }
        await reconcile()
        for (const fight of transition.resync_fights) await actor.send({ type: 'packet/fight_resync', fight })
        if (state.last_packet?.type === 'packet/characters' && snapshot.ready)
          await store.transaction([lane_key], async (tx) => {
            const current = assert_lease(await tx.get<Lane>(lane_key), options.actor_id, lease.fence, now())
            const next = retire_fight_replays(current, snapshot.characters)
            if (next !== current) await tx.put(lane_key, next)
          })
        // A server close, takeover included, is a fact: the next pass reconnects it and its reason is logged.
        if (state.status === 'disconnected' && state.error)
          options.report_failure(new Error(`connection_closed: ${state.error}`))
        await status.observed(state.last_packet)
        await collect(state.last_packet)
      },
      report_failure: options.report_failure,
    })
    const invalidate_execution = () => {
      recovered = true
      actor.disconnect()
    }
    const locomotion = create_actor_locomotion({
      context: gameplay_context,
      available: () => !stopped && actor.state().status === 'ready',
      admit: () => journal.admit('sign'),
      send: actor.send,
      report_failure: options.report_failure,
      idle_lane: async () => {
        if (stopped || work.has(lane_key)) return null
        const valid = await Promise.all(
          [...connector_grants].map((id) => grant_is_live(bot, id, CONTROL_SCOPES.accept))
        )
        if (!valid.some(Boolean)) return null
        return assert_lease(await store.read<Lane>(lane_key), options.actor_id, lease.fence, now())
      },
      wait_for_resume: () =>
        wait_for_contract(
          store,
          { command, actor_id: options.actor_id, fence: lease.fence },
          gameplay_context(),
          now()
        ),
    })
    const status = create_status_sharer(store, bot, lease.fence, () => snapshot.ready, now, monotonic_now, actor.send)
    const collect = create_market_collector(store, control, bot, connector_grants, status.share, options.report_failure)
    return {
      bot,
      lease,
      actor,
      share_status: () => status.share().catch(options.report_failure),
      get sdk() {
        return sdk
      },
      recovered: invalidate_execution,
      refresh_execution: () => {
        if (!recovered) return
        if (!snapshot.ready) throw new Error('needs_resync')
        sdk = build_sdk()
        recovered = false
      },
      add_grant: (grant_id: string) => {
        connector_grants.add(grant_id)
      },
      bind: (next: Command) => {
        command = next
        connector_grants.add(next.grant_id)
      },
      send_gameplay: async (packet: ClientPacket) => {
        // Rollback must survive a refused draft; the authenticated transport still owns delivery.
        if (packet.type !== 'packet/fight_resync') await journal.admit('prepare')
        return actor.send(packet)
      },
      walk: locomotion.walk,
      idle: locomotion.idle,
      settle_idle: locomotion.settle_idle,
      snapshot: () => snapshot,
    }
  }
  const session_reusable = (session: Session, lane: Lane | null, command: Command) =>
    [
      // A stopped socket does not retire this process's unresolved SDK receipt tracking.
      session.actor.state().status !== 'stopped' || lane?.pending?.command_id === command.id,
      lane?.actor_id === options.actor_id,
      lane?.fence === session.lease.fence,
      (lane?.lease_until ?? 0) > now(),
    ].every(Boolean)
  const session_for = async (bot: Bot, command: Command) => {
    const key = lane_key_for(bot)
    const existing = sessions.get(key)
    if (existing) {
      await existing.actor.settle_observations()
      const lane = await store.read<Lane>(key)
      if (session_reusable(existing, lane, command)) return existing
      const recovery = lane?.pending?.command_id === command.id
      if ([!recovery, command.kind !== 'observe'].every(Boolean)) return existing
      if (!recovery) await live_bot(bot, command.grant_id)
      // Receipt reconciliation owns a lease even when gameplay/socket authority is revoked.
      // Only this process retains transaction evidence; new owners re-evaluate the saved tree.
      await existing.actor.stop()
      sessions.delete(key)
    }
    const in_flight = opening.get(key)
    if (in_flight) return in_flight
    const pending = open_session(bot, command).then((session) => {
      sessions.set(key, session)
      asleep_since.delete(key)
      return session
    })
    opening.set(key, pending)
    try {
      return await pending
    } finally {
      opening.delete(key)
    }
  }
  const fail_command = async (session: Session, command: Command, error: unknown) => {
    const funding = transaction_failure_kind(error) === 'funding'
    const balance = funding ? await read_actor_balance(session.sdk, monotonic_now, options.report_failure) : null
    const binding = { command, actor_id: options.actor_id, fence: session.lease.fence }
    await record_command_failure(store, binding, error, balance?.balance_mist, now())
  }
  const observe_session = async (session: Session, command: Command) => {
    await session.actor.connect()
    await session.actor.settle_observations()
    if (!gameplay_observation_ready(session_context(session, command))) return { status: 'pending' }
    const balance = await read_actor_balance(session.sdk, monotonic_now, options.report_failure)
    const snapshot = session.snapshot()
    if (!gameplay_observation_ready(session_context(session, command))) return { status: 'pending' } // Wait for the authenticated baseline, never fabricate one.
    await apply_actor_watches(session.actor, command)
    const [sampled_at, lane] = [monotonic_now(), await store.read<Lane>(command.lane_key)] // Stamped before its reads.
    return observation_reply({ ...session_context(session, command), snapshot, balance }, async () => ({
      ...(await owned_run_observation(store, lane, command)),
      decision_revision: lane?.decision_revision,
      event_fence: session.lease.fence,
      sampled_at,
    }))
  }
  const session_context = (session: Session, command: Command) => ({
    address: session.bot.address,
    pins: session.sdk.pins,
    command,
    snapshot: session.snapshot(),
    now: monotonic_now(),
    freshness_ms: options.observation_freshness_ms,
  })
  const reconcile_receipt = async (session: Session) => {
    if (await session.sdk.recover_pending_transaction()) session.recovered()
  }
  const recover_envelope = async (session: Session, lane: Lane) => {
    const envelope = lane.pending!
    const original = await store.read<Command>(`command:${envelope.command_id}`)
    if (!original || original.grant_id !== envelope.grant_id) throw new Error('PENDING_COMMAND_MISSING')
    session.bind(original)
    if (envelope.phase === 'submitting') {
      await reconcile_receipt(session)
      return
    }
    // These local phases never crossed submission. Discard them, never replay a signed action.
    await abandon_unsubmitted(
      store,
      { command: original, actor_id: options.actor_id, fence: session.lease.fence },
      envelope.digest,
      envelope.phase,
      now()
    )
    session.recovered()
  }

  const bind_execution = (session: Session, command: Command, lane: Lane, balance: GameplayContext['balance']) => {
    const context = { ...session_context(session, command), balance }
    validate_gameplay(context)
    if (command.kind === 'fight_turn')
      assert_fight_reconciled(
        lane.fight_replays?.[String(command.payload.fight)],
        context.snapshot.fights[String(command.payload.fight)]!
      )
    session.bind(bind_action_baseline(command, context))
  }
  const process_command = async (command: Command) => {
    const bot = await store.read<Bot>(`bot:${command.bot_id}`)
    if (!bot) throw new Error('BOT_MISSING')
    const session = await session_for(bot, command)
    await session.settle_idle()
    session.bind(command)
    let recovering = false
    try {
      const lane = assert_lease(await store.read<Lane>(command.lane_key), options.actor_id, session.lease.fence, now())
      if (lane.pending) {
        recovering = true
        await recover_envelope(session, lane)
        return
      }
      await live_bot(bot, command.grant_id)
      await session.actor.connect()
      await session.actor.settle_observations()
      const binding = { command, actor_id: options.actor_id, fence: session.lease.fence }
      const balance = await read_actor_balance(session.sdk, monotonic_now, options.report_failure)
      const context = { ...session_context(session, command), balance }
      const ready = await ready_gameplay_command(store, config, binding, context, now())
      if (!ready) return
      if (session.actor.state().status !== 'ready') throw new Error('needs_resync')
      session.refresh_execution()
      bind_execution(session, ready, lane, balance)
      if (!(await session.walk())) return
      await execute_gameplay({ ...session_context(session, ready), sdk: session.sdk, send: session.send_gameplay })
    } catch (error) {
      if (!recovering) await fail_command(session, command, error)
      options.report_failure(error)
    }
  }
  /** One queue pass; a direct command that took the signing slot executes in that same turn. */
  const process_lane = async (key: string) => {
    const direct = await ask_lane(key)
    if (direct) await process_command(direct)
  }
  const ask_lane = (key: string) =>
    process_lane_runs(key, {
      snapshot: () => sessions.get(key)?.snapshot(),
      report_failure: options.report_failure,
      store,
      config,
      actor_id: options.actor_id,
      now,
      session: async (bot, command) => {
        const session = await session_for(bot, command)
        const balance = await read_actor_balance(session.sdk, monotonic_now, options.report_failure)
        return {
          fence: session.lease.fence,
          connect: async () => {
            await session.actor.connect()
            if (session.actor.state().status === 'ready') await apply_actor_watches(session.actor, command)
          },
          context: {
            ...session_context(session, {
              ...command,
              observation_revision: session.snapshot().observation_revision,
            }),
            balance,
          },
        }
      },
    })
  const processors: Readonly<Record<string, (key: string) => Promise<void>>> = {
    lane: process_lane,
    provision: async (key) => {
      const request = await store.read<ProvisionRequest>(key)
      if (!request || request.status === 'ready') return
      await run_provisioning(store, options.provider, request.id)
    },
    proof: async (key) => {
      const request = await store.read<{ status: string }>(key)
      if (request?.status === 'pending') await run_pairing_proof(store, options.provider, key)
    },
    command: async (key) => {
      const command = await store.read<Command>(key)
      if (!command || !has_pending_work(key, command)) return
      // Only a retained envelope can resolve uncertainty; without one the outcome stays uncertain.
      const lane = command.status === 'uncertain' ? await store.read<Lane>(command.lane_key) : null
      if (command.status === 'uncertain' && lane?.pending?.command_id !== command.id) return
      await process_command(command)
    },
  }
  const process_key = (key: string) => processors[key.split(':')[0]!]!(key)
  const renew_sessions = async () => {
    for (const [key, session] of sessions) {
      try {
        const live = session.actor.state().status !== 'stopped'
        // Only this process can reconcile its envelope, so the lease outlives socket authority until it settles.
        if (!live && !(await store.read<Lane>(key))?.pending) continue
        await control.heartbeat(key, options.actor_id, session.lease.fence, options.lease_ms)
        if (!live) continue
        await Promise.all([session.actor.check_lease(), session.share_status()]) // Another process may have stopped or paused it.
        if (['disconnected', 'failed'].includes(session.actor.state().status)) await session.actor.connect()
      } catch (error) {
        await session.actor.stop()
        options.report_failure(error)
      }
    }
  }
  const renewal = one_at_a_time(renew_sessions)
  const renew = () => (stopped || config.recovery_mode ? Promise.resolve() : renewal.run())
  /** What this process may do next for a lane: its in-flight command first, otherwise a queue pass. */
  const owned_work = async (lane_key: string) => {
    const owner = await store.read<Lane>(lane_key)
    return lane_owned_elsewhere(owner, options.actor_id, now()) ? null : lane_work_key(lane_key, owner)
  }
  /** One task per slot. A waiting caller runs again after the task that held the slot. */
  const enqueue = async (slot: string, dispatch: string | null, again: (() => Promise<void>) | null) => {
    if (!dispatch) return
    const running = work.get(slot)
    if (running) {
      if (!again) return
      await running
      return again()
    }
    if (stopped || work.size >= options.scan_limit) return
    const task = process_key(dispatch)
      .catch(options.report_failure)
      .finally(() => {
        work.delete(slot)
        void sessions.get(slot)?.share_status()
      })
    work.set(slot, task)
  }
  /** The lane is the signing queue, so the lane is what is woken and scheduled, never one of its runs. */
  const schedule_lane = async (lane_key: string, wait = false): Promise<void> =>
    enqueue(lane_key, await owned_work(lane_key), wait ? () => schedule_lane(lane_key, true) : null)
  const schedule_key = async (key: string, wait = false): Promise<void> => {
    const record = await store.read<{ lane_key?: string; bot_id?: string; status?: string }>(key)
    if (retired_run(key, record)) return retire_run(store, key, options.report_failure)
    if (!record || !has_pending_work(key, record)) return
    if (record.lane_key) return schedule_lane(record.lane_key, wait)
    return enqueue(record.bot_id ?? key, key, wait ? () => schedule_key(key, true) : null)
  }
  /** An idle seat wanders. One idle for SLEEP_AFTER_IDLE_MS leaves the game as any stop does: its socket
   * closes and its lease lapses. Whatever next needs the seat, a read or pending work, opens it again. */
  const rest = async (key: string, session: Session) => {
    const lane = await store.read<Lane>(key)
    const idle = [lane && wallet_idle(lane), !work.has(key), session.actor.state().status !== 'stopped'].every(Boolean)
    if (!idle) return void idle_since.delete(key)
    const since = idle_since.get(key) ?? now()
    idle_since.set(key, since)
    if (now() - since < SLEEP_AFTER_IDLE_MS) return session.idle()
    idle_since.delete(key)
    sessions.delete(key)
    asleep_since.set(key, now())
    await session.actor.stop()
    await session.settle_idle()
  }
  const run_tick = async () => {
    if (stopped || config.recovery_mode) return
    await renew()
    const keys = await store.scan_pending(options.scan_limit, cursor)
    cursor = keys.length === options.scan_limit ? keys.at(-1)! : ''
    for (const key of keys) {
      if (stopped) return
      try {
        await schedule_key(key)
      } catch (error) {
        options.report_failure(error)
      }
    }
    for (const [key, session] of sessions) await rest(key, session)
  }
  const ticks = one_at_a_time(run_tick)
  const observe: Observe = async (grant, payload, expected) => {
    if ([stopped, config.recovery_mode].some(Boolean)) throw new Error('observation_unavailable')
    const { bot, grant: current } = await authorize(store.read, config, grant, CONTROL_SCOPES.observe, now())
    if (expected) assert_lease(await store.read<Lane>(lane_key_for(bot)), expected.actor_id, expected.fence, now())
    const command: Command = {
      id: 'observation',
      grant_id: current.id,
      bot_id: bot.id,
      lane_key: lane_key_for(bot),
      fingerprint: '',
      kind: 'observe',
      payload,
      decision_revision: 0,
      observation_revision: 0,
      status: 'accepted',
    }
    const slept = asleep_since.get(command.lane_key)
    const session = await session_for(bot, command)
    if (stopped) throw new Error('observation_unavailable')
    const binding = expected ?? session.lease
    session.add_grant(current.id)
    const result = await observe_session(session, command)
    await authorize(store.read, config, current, CONTROL_SCOPES.observe, now())
    assert_lease(await store.read<Lane>(command.lane_key), binding.actor_id, binding.fence, now())
    if (stopped) throw new Error('observation_unavailable')
    // The first read after a sleep says when the wallet left the game.
    return slept === undefined ? result : { ...result, asleep_since: new Date(slept).toISOString() }
  }
  return {
    observe,
    renew,
    wake: (key: string) => (stopped || config.recovery_mode ? Promise.resolve() : schedule_key(key, true)),
    settle: async () => {
      await Promise.all([...work.values()])
      await Promise.all([...sessions.values()].map((session) => session.actor.settle_observations()))
    },
    tick: ticks.run,
    stop: async () => {
      stopped = true
      await renewal.idle()
      await ticks.idle()
      await Promise.all([...work.values()])
      await Promise.allSettled([...opening.values()])
      for (const session of sessions.values()) await session.actor.stop()
      await Promise.all([...sessions.values()].map((session) => session.settle_idle()))
    },
  }
}
type ActorRuntimeOptions = Readonly<{
  store: ControlStore
  config: BotConfig
  provider: ManagedProvider
  endpoint: string
  origin: string
  actor_id: string
  lease_ms: number
  scan_limit: number
  observation_freshness_ms: number
  sdk_options: Pick<SdkOptions, 'client' | 'rpc_url' | 'pins'>
  transport?: AgentTransport
  monotonic_now?: () => number
  now?: () => number
  report_failure: (error: unknown) => void
}>
