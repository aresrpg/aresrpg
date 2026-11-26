// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What a wallet does by itself, whatever its runs and its assistant do: it collects its sale proceeds
// it gives up a fight it could not win (owner ruling 2026-11-26: "I'd expect a bot to forfeit if he
// can't win after 15min, the AI should be aware of that") and it settles an ended fight no run plays
// (owner, same day). A hero left in a fight nobody finishes is lost to every run and blocks the wallet,
// so the wallet frees it.
import type { ServerPacket } from '@aresrpg/protocol'

import type { ActorSnapshot } from './actor_snapshot.ts'
import type { create_control_service } from './control.ts'
import { fight_checkpoint_id, hydrate_gameplay_fight } from './gameplay_context.ts'
import { create_market_collector } from './market_collection.ts'
import type { Bot } from './model.ts'
import { create_own_sender, refused_for_now, type OwnSender } from './own_commands.ts'
import type { ControlStore } from './store.ts'

/** A fight still not won this long after it started is given up (owner, 2026-11-26). */
export const FORFEIT_AFTER_MS = 15 * 60_000

type Overdue = Readonly<{ character_id: string; fight: string }>
/**
 * The heroes to free now: seated in a fight that started (or, still in placement, opened) more than
 * `FORFEIT_AFTER_MS` of chain time ago and has not ended. An ended fight is settled, never given up. A
 * fight with a stake (a Kolizeum pledge, a tournament match) is never given up here: that loses the
 * owner's money, so it stays their decision.
 * A fight whose row or clock is not observed yet is not judged.
 */
export const overdue_fights = (snapshot: ActorSnapshot): readonly Overdue[] => {
  const { clock } = snapshot
  if (!clock) return []
  return snapshot.characters.flatMap(({ id, active_fight }) => {
    const row = active_fight && snapshot.fights[active_fight.id]
    if (!row || row.kolizeum || row.tournament) return []
    const { contract } = hydrate_gameplay_fight(row)
    // Counted from the start of the fight, or from its opening while it is still in placement. An
    // unarmed placement clock is zero: nothing has opened yet.
    const since = contract.started_ms ?? contract.placement_ms
    const overdue =
      !contract.ended && since !== 0n && BigInt(clock.chain_ms) >= BigInt(since) + BigInt(FORFEIT_AFTER_MS)
    return overdue ? [{ character_id: id, fight: active_fight.id }] : []
  })
}

type Unsettled = Overdue & Readonly<{ payload: Readonly<Record<string, unknown>> }>
/**
 * The heroes still seated in a fight that has ended, each with the settlement that frees it (owner
 * ruling 2026-11-26). A run settles the fight it plays, so its hero is left to it: see `fight_duty`.
 */
export const unsettled_fights = (snapshot: ActorSnapshot): readonly Unsettled[] =>
  snapshot.characters.flatMap(({ id, active_fight }) => {
    const row = active_fight && snapshot.fights[active_fight.id]
    if (!row) return []
    const { contract } = hydrate_gameplay_fight(row)
    if (!contract.ended) return []
    const payload = {
      character_id: id,
      fight: active_fight.id,
      fighter_idx: String(active_fight.seat),
      checkpoint_id: fight_checkpoint_id(row),
      ...(contract.dungeon ? { dungeon: contract.dungeon } : {}),
    }
    return [{ character_id: id, fight: active_fight.id, payload }]
  })

/** One command of `kind` per hero and fight, sent again only while a refusal said "not now". */
const fight_duty = (
  kind: 'fight_forfeit' | 'fight_settle',
  send: OwnSender,
  due: () => readonly (Overdue & Partial<Unsettled>)[],
  report_failure: (error: unknown) => void
) => {
  let issued: ReadonlySet<string> = new Set()
  return async () => {
    for (const { character_id, fight, payload } of due()) {
      const key = `${kind}:${fight}:${character_id}`
      if (issued.has(key)) continue
      try {
        // A settlement is the run's own last step: the wallet settles only for a hero no run holds.
        const sent = await send((lane) =>
          kind === 'fight_settle' && lane.runs?.[character_id]
            ? null
            : { idempotency_key: key, kind, payload: payload ?? { character_id } }
        )
        if (sent) issued = new Set([...issued, key])
      } catch (error) {
        if (refused_for_now(error)) continue
        // An unexpected refusal is reported once and this fight is left to the owner.
        issued = new Set([...issued, key])
        report_failure(error)
      }
    }
  }
}

type Control = Pick<ReturnType<typeof create_control_service>, 'accept'>
/** The duties of one wallet session, fed with every packet of its socket in arrival order. Never throws. */
export const create_wallet_duties = (
  wallet: Readonly<{
    store: ControlStore
    control: Control
    bot: Pick<Bot, 'network' | 'address'>
    grants: ReadonlySet<string>
    share: () => Promise<void>
    snapshot: () => ActorSnapshot
    report_failure: (error: unknown) => void
  }>
) => {
  const send = create_own_sender(wallet.store, wallet.control, wallet.bot, wallet.grants, wallet.share)
  const collect = create_market_collector(send, wallet.report_failure)
  const give_up = fight_duty('fight_forfeit', send, () => overdue_fights(wallet.snapshot()), wallet.report_failure)
  const settle = fight_duty('fight_settle', send, () => unsettled_fights(wallet.snapshot()), wallet.report_failure)
  return async (packet: ServerPacket | null | undefined) => {
    await collect(packet)
    await settle()
    await give_up()
  }
}
