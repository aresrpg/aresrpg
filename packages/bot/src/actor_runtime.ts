// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { SDK } from '@aresrpg/sdk'
import { create_agent_multisig } from '@aresrpg/sdk/agent-multisig'
import { create_agent_transaction_signer } from '@aresrpg/sdk/agent-transactions'
import type { TransactionJournal } from '@aresrpg/sdk/transaction-execution'
import type { ClientPacket } from '@aresrpg/protocol'
import { fromBase64 } from '@mysten/sui/utils'
import { ZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { create_actor_locomotion } from './actor_locomotion.ts'
import { gameplay_observation_ready } from './gameplay_context.ts'
import { wait_for_contract } from './command_wait.ts'
import { bind_action_baseline, reconcile_action } from './action_reconciliation.ts'
import { assert_fight_reconciled, retire_fight_replays } from './fight_runtime.ts'
import { empty_snapshot, actor_snapshot_transition, type ActorSnapshot } from './actor_snapshot.ts'
import { create_bot_actor, bun_transport } from './actor.ts'
import {
  assert_lease,
  lane_owned_elsewhere,
  create_control_service,
  lane_key_for,
  type Command,
  type Lane,
  type Observe,
} from './control.ts'
import { assert_live_grant, type Bot, type Grant } from './model.ts'
import { run_pairing_proof, run_provisioning, type ProvisionRequest } from './provisioning.ts'
import { has_pending_work } from './store.ts'
import { abandon_unsubmitted, create_transaction_journal } from './transaction_journal.ts'
import { profession_tick, profession_observation } from './profession_runtime.ts'
import { active_profession_id, type ProfessionRun } from './profession_control.ts'
import { actor_observation } from './actor_observation.ts'
import { execute_gameplay, validate_gameplay } from './gameplay.ts'
export { reduce_actor_snapshot, type ActorSnapshot } from './actor_snapshot.ts'
export type { ActorRuntimeOptions } from './actor_runtime_options.ts'
import type { ActorRuntimeOptions } from './actor_runtime_options.ts'
export const create_actor_runtime = (options: ActorRuntimeOptions) => {
  const { store, config } = options
  const now = options.now ?? Date.now
  const monotonic_now = options.monotonic_now ?? (() => performance.now())
  const control = create_control_service(store, config, options.observation_freshness_ms, now)
  type Session = Awaited<ReturnType<typeof open_session>>
  const sessions = new Map<string, Session>()
  let cursor = ''
  const opening = new Map<string, Promise<Session>>()
  const work = new Map<string, Promise<void>>()
  let stopped = false
  let ticking: Promise<void> | null = null
  let renewing: Promise<void> | null = null
  const live_bot = async (bot_id: string, grant_id: string, scope?: string) => {
    const bot = await store.read<Bot>(`bot:${bot_id}`)
    const grant = await store.read<Grant>(`grant:${grant_id}`)
    if (!grant) throw new Error('invalid_token')
    assert_live_grant(config, grant, bot, now())
    if (scope && !grant.scopes.includes(scope)) throw new Error('insufficient_scope')
    return bot!
  }
  const grant_is_live = async (bot_id: string, grant_id: string, scope?: string) => {
    try {
      await live_bot(bot_id, grant_id, scope)
      return true
    } catch (error) {
      if (error instanceof Error && ['invalid_token', 'insufficient_scope'].includes(error.message)) return false
      throw error
    }
  }
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
      const lane = assert_lease(await store.read<Lane>(lane_key), options.actor_id, lease.fence, now())
      if (lane.transport_stopped) throw new Error('ACTOR_TERMINAL')
      const valid = await Promise.all([...connector_grants].map((grant_id) => grant_is_live(bot.id, grant_id)))
      if (!valid.some(Boolean)) throw new Error('invalid_token')
    }
    const journal_for = () =>
      create_transaction_journal(
        store,
        config,
        options.cipher,
        { command, actor_id: options.actor_id, fence: lease.fence },
        now
      )
    const journal: TransactionJournal = {
      read: () => journal_for().read(),
      admit: async (stage) => {
        await journal_for().admit(stage)
        if (stage !== 'prepare') validate_gameplay(gameplay_context())
      },
      prepared: (record) => journal_for().prepared(record),
      signed: (record) => journal_for().signed(record),
      mark_submitting: (record) => journal_for().mark_submitting(record),
      settled: async (receipt, record) => {
        await journal_for().settled(receipt, record)
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
    const reconcile = () =>
      reconcile_action(
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
    let sdk = build_sdk()
    let recovered = false
    let terminal_server = lease.transport_stopped === true
    const actor = create_bot_actor({
      connection: {
        endpoint: options.endpoint,
        origin: options.origin,
        signer: identity,
        transport: options.transport ?? bun_transport,
      },
      authorize,
      authorize_observation: async (owner) => {
        await live_bot(bot.id, owner)
      },
      needs_resync: () => control.observed(lane_key, options.actor_id, lease.fence, false),
      observe: async (state) => {
        locomotion.observe(state.status)
        const transition = actor_snapshot_transition(snapshot, state, monotonic_now(), options.event_limit)
        ;({ snapshot } = transition)
        await control.observed(lane_key, options.actor_id, lease.fence, snapshot.ready, transition.changed)
        const lane = assert_lease(await store.read<Lane>(lane_key), options.actor_id, lease.fence, now())
        snapshot = { ...snapshot, observation_revision: lane.observation_revision }
        await reconcile()
        for (const character_id of transition.track_ids)
          await actor.send({ type: 'packet/track_character', character_id, tracked: true })
        for (const fight of transition.resync_fights) await actor.send({ type: 'packet/fight_resync', fight })
        if (state.last_packet?.type === 'packet/characters' && snapshot.ready)
          await store.transaction([lane_key], async (tx) => {
            const current = assert_lease(await tx.get<Lane>(lane_key), options.actor_id, lease.fence, now())
            const next = retire_fight_replays(current, snapshot.characters)
            if (next !== current) await tx.put(lane_key, next)
          })
        if (transition.terminal_server) terminal_server = true
        if (terminal_server)
          await store.transaction([lane_key], async (tx) => {
            const current = assert_lease(await tx.get<Lane>(lane_key), options.actor_id, lease.fence, now())
            await tx.put(lane_key, { ...current, paused: true, needs_resync: true, transport_stopped: true })
          })
      },
      report_failure: options.report_failure,
    })
    const locomotion = create_actor_locomotion({
      context: gameplay_context,
      available: () => !stopped && actor.state().status === 'ready',
      admit: () => journal.admit('sign'),
      send: actor.send,
      report_failure: options.report_failure,
      idle_lane: async () => {
        if (stopped || work.has(lane_key)) return null
        const valid = await Promise.all([...connector_grants].map((id) => grant_is_live(bot.id, id, 'bot:play')))
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
    return {
      bot,
      lease,
      actor,
      terminal_server: () => terminal_server,
      get sdk() {
        return sdk
      },
      recovered: () => {
        recovered = true
        actor.disconnect()
      },
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
      walk: locomotion.walk,
      idle: locomotion.idle,
      settle_idle: locomotion.settle_idle,
      snapshot: () => snapshot,
    }
  }
  const session_reusable = (session: Session, lane: Lane | null) =>
    [
      session.actor.state().status !== 'stopped',
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
      if (session_reusable(existing, lane)) return existing
      const recovery = lane?.pending?.command_id === command.id
      const explicit_read = [!existing.terminal_server(), command.kind === 'observe'].every(Boolean)
      if ([!recovery, !explicit_read].every(Boolean)) return existing
      if (!recovery) await live_bot(bot.id, command.grant_id)
      // Receipt reconciliation owns a lease even when gameplay/socket authority is revoked.
      // The pending phase still decides cancellation versus receipt-only recovery.
      await existing.actor.stop()
      sessions.delete(key)
    }
    const in_flight = opening.get(key)
    if (in_flight) return in_flight
    const pending = open_session(bot, command).then((session) => {
      sessions.set(key, session)
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
    await store.transaction([command.lane_key, `command:${command.id}`], async (tx) => {
      const lane = assert_lease(await tx.get<Lane>(command.lane_key), options.actor_id, session.lease.fence, now())
      const current = await tx.get<Command>(`command:${command.id}`)
      if (!current || ['completed', 'failed', 'cancelled'].includes(current.status)) return
      await tx.put(`command:${command.id}`, {
        ...current,
        status: lane.pending ? 'uncertain' : 'failed',
        error: String(error),
      })
      await tx.put(command.lane_key, {
        ...lane,
        needs_resync: true,
        active_command: lane.pending ? lane.active_command : null,
      })
    })
  }
  const apply_watches = async (
    session: Pick<Session, 'actor' | 'lease' | 'bot'>,
    command: Pick<Command, 'grant_id' | 'payload'>
  ) => {
    for (const [name, type] of [
      ['market', 'packet/market_observe'],
      ['prices', 'packet/market_prices_observe'],
    ] as const) {
      if (Object.hasOwn(command.payload, name)) {
        await session.actor.observe(command.grant_id, { type, observation: command.payload[name] } as Extract<
          ClientPacket,
          { type: typeof type }
        >)
      }
    }
  }
  const observe_session = async (session: Session, command: Command) => {
    if (session.terminal_server()) throw new Error('ACTOR_TERMINAL')
    await session.actor.connect()
    await session.actor.settle_observations()
    const snapshot = session.snapshot()
    if (!gameplay_observation_ready(session_context(session, command))) return { status: 'pending' } // Wait for the authenticated baseline, never fabricate one.
    await apply_watches(session, command)
    const lane = await store.read<Lane>(command.lane_key)
    return {
      ...actor_observation({ ...session_context(session, command), snapshot }, session.lease.fence),
      decision_revision: lane?.decision_revision,
      profession_run_id: await active_profession_id(store, lane, command),
      event_fence: session.lease.fence,
      sampled_at: monotonic_now(),
      state: 'awaiting_ai',
    }
  }
  const session_context = (session: Session, command: Command) => ({
    address: session.bot.address,
    pins: session.sdk.pins,
    command,
    snapshot: session.snapshot(),
    now: monotonic_now(),
    freshness_ms: options.observation_freshness_ms,
  })
  const refresh_signed_command = async (session: Session, original: Command, digest: string) => {
    const snapshot = session.snapshot()
    const refreshed = bind_action_baseline(
      { ...original, observation_revision: snapshot.observation_revision },
      session_context(session, original)
    )
    validate_gameplay(session_context(session, refreshed))
    const keys = [original.lane_key, `command:${original.id}`, `grant:${original.grant_id}`, `bot:${original.bot_id}`]
    return store.transaction(keys, async (tx) => {
      const lane = assert_lease(await tx.get<Lane>(original.lane_key), options.actor_id, session.lease.fence, now())
      const current = await tx.get<Command>(`command:${original.id}`)
      const grant = await tx.get<Grant>(`grant:${original.grant_id}`)
      if (!current || !grant) throw new Error('PENDING_COMMAND_MISSING')
      assert_live_grant(config, grant, await tx.get<Bot>(`bot:${original.bot_id}`), now())
      const unchanged = [
        lane.pending?.phase === 'signed',
        lane.pending?.digest === digest,
        lane.pending?.command_id === original.id,
        lane.pending?.grant_id === original.grant_id,
        lane.observation_revision === snapshot.observation_revision,
        lane.decision_revision === original.decision_revision,
        current.fingerprint === original.fingerprint,
        current.observation_revision === original.observation_revision,
        !lane.paused,
        !lane.needs_resync,
      ]
      if (!unchanged.every(Boolean)) throw new Error('SIGNED_RESUME_CONFLICT')
      const next = { ...current, ...refreshed }
      await tx.put(`command:${original.id}`, next)
      return next
    })
  }
  const reconcile_receipt = async (session: Session) => {
    if (await session.sdk.recover_pending_transaction()) session.recovered()
  }
  const recover_envelope = async (session: Session, lane: Lane) => {
    const envelope = lane.pending!
    const original = await store.read<Command>(`command:${envelope.command_id}`)
    if (!original || original.grant_id !== envelope.grant_id) throw new Error('PENDING_COMMAND_MISSING')
    session.bind(original)
    if (envelope.phase === 'prepared') {
      const binding = { command: original, actor_id: options.actor_id, fence: session.lease.fence }
      await abandon_unsubmitted(store, binding, envelope.digest, 'prepared', now())
      session.recovered()
      return
    }
    if (envelope.phase !== 'signed') {
      await reconcile_receipt(session)
      return
    }
    const cancel = async () => {
      await abandon_unsubmitted(
        store,
        { command: original, actor_id: options.actor_id, fence: session.lease.fence },
        envelope.digest,
        'signed',
        now()
      )
      session.recovered()
    }
    const invalidated = [
      lane.paused,
      lane.decision_revision !== original.decision_revision,
      !(await grant_is_live(original.bot_id, original.grant_id)),
    ].some(Boolean)
    if (invalidated) return cancel()
    await session.actor.connect()
    await session.actor.settle_observations()
    if (!gameplay_observation_ready(session_context(session, original))) return
    session.bind(await refresh_signed_command(session, original, envelope.digest))
    if (await session.sdk.resume_pending_transaction()) session.recovered()
  }
  const bind_execution = (session: Session, command: Command, lane: Lane) => {
    const context = session_context(session, command)
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
      await live_bot(bot.id, command.grant_id)
      await session.actor.connect()
      await session.actor.settle_observations()
      const binding = { command, actor_id: options.actor_id, fence: session.lease.fence }
      const ready = await wait_for_contract(store, binding, session_context(session, command), now())
      if (!ready) return
      if (session.actor.state().status !== 'ready') throw new Error('needs_resync')
      session.refresh_execution()
      bind_execution(session, ready, lane)
      if (!(await session.walk())) return
      await execute_gameplay({ ...session_context(session, ready), sdk: session.sdk, send: session.actor.send })
    } catch (error) {
      if (!recovering) await fail_command(session, command, error)
      options.report_failure(error)
    }
  }
  const process_profession = async (key: string) => {
    const run = await store.read<ProfessionRun>(key)
    if (!run || !['active', 'waiting'].includes(run.status)) return
    const bot = await store.read<Bot>(`bot:${run.bot_id}`)
    if (!bot) throw new Error('BOT_MISSING')
    const command = profession_observation(run)
    const session = await session_for(bot, command)
    const status = await profession_tick({
      store,
      config,
      run,
      actor_id: options.actor_id,
      fence: session.lease.fence,
      context: session_context(session, { ...command, observation_revision: session.snapshot().observation_revision }),
      now: now(),
    })
    if (['active', 'waiting'].includes(String(status))) await session.actor.connect()
  }
  const processors: Readonly<Record<string, (key: string) => Promise<void>>> = {
    profession: process_profession,
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
      if (!command) return
      if (['accepted', 'executing', 'uncertain'].includes(command.status)) await process_command(command)
    },
  }
  const process_key = (key: string) => processors[key.split(':')[0]!]!(key)
  const renew_sessions = async () => {
    for (const session of sessions.values()) {
      try {
        if ([session.actor.state().status === 'stopped', session.terminal_server()].some(Boolean)) continue
        await control.heartbeat(lane_key_for(session.bot), options.actor_id, session.lease.fence, options.lease_ms)
        await session.actor.check_lease()
        if (['disconnected', 'failed'].includes(session.actor.state().status)) await session.actor.connect()
      } catch (error) {
        await session.actor.stop()
        options.report_failure(error)
      }
    }
  }
  const renew = async () => {
    if (stopped || config.recovery_mode) return
    if (renewing) return renewing
    renewing = renew_sessions()
    try {
      await renewing
    } finally {
      renewing = null
    }
  }
  const schedule_key = async (key: string, wait_for_lane = false): Promise<void> => {
    const record = await store.read<{ lane_key?: string; bot_id?: string; status?: string }>(key)
    if (!record || !has_pending_work(key, record)) return
    if (record.lane_key) {
      const owner = await store.read<Lane>(record.lane_key)
      if (lane_owned_elsewhere(owner, options.actor_id, now())) return
    }
    const lane = record.lane_key ?? record.bot_id ?? key
    const running = work.get(lane)
    if (running) {
      if (!wait_for_lane) return
      await running
      return schedule_key(key, true)
    }
    if (stopped || work.size >= options.scan_limit) return
    const task = process_key(key)
      .catch(options.report_failure)
      .finally(() => {
        work.delete(lane)
      })
    work.set(lane, task)
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
    for (const session of sessions.values()) session.idle()
  }
  const observe: Observe = async (grant, payload, expected) => {
    if ([stopped, config.recovery_mode].some(Boolean)) throw new Error('observation_unavailable')
    const bot = await live_bot(grant.bot_id, grant.id)
    if (expected) assert_lease(await store.read<Lane>(lane_key_for(bot)), expected.actor_id, expected.fence, now())
    const current = await store.read<Grant>(`grant:${grant.id}`)
    if (!current?.scopes.includes('bot:observe')) throw new Error('insufficient_scope')
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
    const session = await session_for(bot, command)
    if (stopped) throw new Error('observation_unavailable')
    const binding = expected ?? session.lease
    session.add_grant(current.id)
    const result = await observe_session(session, command)
    await live_bot(bot.id, current.id)
    assert_lease(await store.read<Lane>(command.lane_key), binding.actor_id, binding.fence, now())
    if (stopped) throw new Error('observation_unavailable')
    return result
  }
  return {
    observe,
    renew,
    wake: (key: string) => (stopped || config.recovery_mode ? Promise.resolve() : schedule_key(key, true)),
    settle: async () => {
      await Promise.all([...work.values()])
      await Promise.all([...sessions.values()].map((session) => session.actor.settle_observations()))
    },
    tick: async () => {
      if (ticking) return ticking
      ticking = run_tick()
      try {
        await ticking
      } finally {
        ticking = null
      }
    },
    stop: async () => {
      stopped = true
      if (renewing) await renewing
      if (ticking) await ticking
      await Promise.all([...work.values()])
      await Promise.allSettled([...opening.values()])
      for (const session of sessions.values()) await session.actor.stop()
      await Promise.all([...sessions.values()].map((session) => session.settle_idle()))
    },
  }
}
