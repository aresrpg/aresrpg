// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ClientPacket, ServerPacket } from '@aresrpg/protocol'

import { run_observation, told_run } from './actor_observation.ts'
import { lane_key_for } from './command_admission.ts'
import { empty_lane, type Command, type Lane } from './control.ts'
import type { Bot } from './model.ts'
import { wallet_state } from './owner_activity.ts'
import type { ControlStore } from './store.ts'

/** A wallet that settled nothing yet has paid zero, never nothing. */
const wallet_fees = (lane: Lane | null) => lane?.fees_mist ?? '0'
/**
 * The owner's clients follow a hosted wallet from its own game socket, and from nowhere else. Its
 * status (wallet state and fees, runs with theirs, direct command, readiness) is sent when it differs
 * from the last one sent, and always to a new socket baseline or an owner who started watching; never on
 * a cadence. A run that ended by itself is in it with its reason until its hero starts again, so an owner
 * who watches later is told too. The
 * game server relays it and keeps nothing. A pass of the signing queue is what moves a run or a command,
 * so the runtime shares after each pass. A stop or a pause may be written by another process: the
 * runtime also shares at its lease heartbeat, which is when this process reads the wallet again.
 */
export const create_status_sharer = (
  store: ControlStore,
  bot: Bot,
  event_fence: number,
  ready: () => boolean,
  now: () => number,
  monotonic_now: () => number,
  send: (packet: ClientPacket) => Promise<boolean>
) => {
  let shared = ''
  let seen_ready = false
  let last: Promise<void> = Promise.resolve()
  const read_and_send = async (always: boolean) => {
    // The stamp is taken before the reads, so a status never claims to be newer than what it holds.
    const sampled_at = monotonic_now()
    const [lane, current] = await Promise.all([store.read<Lane>(lane_key_for(bot)), store.read<Bot>(`bot:${bot.id}`)])
    const { runs, direct } = await run_observation(store, lane, { bot_id: bot.id }, told_run)
    const command = lane?.active_command ? await store.read<Command>(`command:${lane.active_command}`) : null
    const statuses = runs.map(({ status }) => status)
    const state = wallet_state(current ?? bot, lane ?? empty_lane(bot), command, statuses, now())
    const status = { ready: ready(), event_fence, state, runs, direct, fees_mist: wallet_fees(lane) }
    const fingerprint = JSON.stringify(status)
    if (!always && fingerprint === shared) return
    // A status that did not leave is not shared: the next one is sent whatever it holds.
    shared = (await send({ type: 'packet/agent_status', status: { ...status, sampled_at } })) ? fingerprint : ''
  }
  /** One share at a time: two overlapping reads could otherwise send the older status last. */
  const share = (always = false): Promise<void> => {
    last = last.then(
      () => read_and_send(always),
      () => read_and_send(always)
    )
    return last
  }
  return {
    share,
    /** After each packet of the bot's socket: a watching owner is answered, a readiness change is told. */
    observed: async (packet?: Pick<ServerPacket, 'type'> | null) => {
      if (packet?.type === 'packet/agent_status_wanted') return share(true)
      if (ready() === seen_ready) return
      seen_ready = ready()
      // A readiness change is a new baseline, often on a new socket: it is told even when nothing else moved.
      await share(true)
    },
  }
}
