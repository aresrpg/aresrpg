// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { encumbered_asset_ids, stack_merge_target } from '../inventory_stacks.ts'
import { toast } from '../toast.ts'
import type { AppModule } from '../store.ts'

import { fight_resolution_dungeon, fight_result_available } from './fight_result_view.ts'

type Attempt = Readonly<{ latched: boolean }>
const VERSION_RACE_RETRY_MS = 250

export const object_version_refusal = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return !message.includes('failed on-chain') && /provided version doesn't match/i.test(message)
}

export const settle_after_version_race = async <T>(
  transaction: () => Promise<T>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<T> => {
  try {
    return await transaction()
  } catch (error) {
    if (!object_version_refusal(error)) throw error
    await wait(VERSION_RACE_RETRY_MS)
    return transaction()
  }
}

/** Settlement is a frontend effect boundary: live terminal truth starts immediately, while
 * RESULT_FOR is only the reconnect fallback. A certified receipt completes presentation. */
const observe_with_wait = (
  { events, dispatch, get_state }: Parameters<NonNullable<AppModule['observe']>>[0],
  wait: (milliseconds: number) => Promise<void>
): void => {
  const attempts = new Map<string, Attempt>()
  const closing = new Set<string>()
  const close_notices = new Map<string, () => void>()
  let active: string | null = null
  const close_once = (row: Readonly<{ fight: string; kolizeum: string | null }>): void => {
    const { fight } = row
    const { wallet } = get_state().session
    if (!wallet || closing.has(fight)) return
    closing.add(fight)
    close_notices.get(fight)?.()
    close_notices.delete(fight)
    const transaction = row.kolizeum
      ? wallet.kolizeum.close({ kolizeum: row.kolizeum, fight })
      : wallet.fight.close({ fight })
    void transaction
      .then(() => dispatch({ type: 'fight_result/close_succeeded', fight }))
      .catch((error: unknown) => {
        closing.delete(fight)
        offer_close(row)
        console.warn('[fight_result] authoritative close failed; explicit retry is available', error)
      })
  }
  const offer_close = (row: Readonly<{ fight: string; kolizeum: string | null }>): void => {
    const { fight } = row
    if (closing.has(fight) || close_notices.has(fight)) return
    const copy = get_state().copy?.fight_hud
    if (!copy) return
    const dismiss = toast.persistent(copy.fight_finalize_pending, 'info', {
      label: copy.fight_finalize_button,
      onClick: () => close_once(row),
    })
    close_notices.set(fight, dismiss)
  }

  const sweep = (): void => {
    if (active) return
    const state = get_state()
    const { wallet, inventory, characters } = state.session
    if (!wallet || state.session.link_status !== 'ready') return
    const live = Object.values(state.fight_result.current_by_character).flatMap((result) => {
      const own = result.own_seat === null ? null : result.participants[result.own_seat]
      return own?.character_id && !own.forfeited && !result.settlement_confirmed
        ? [
            Object.freeze({
              fight: result.fight,
              fighter: own.seat,
              character: own.character_id,
              loot_types: result.loot_types,
              dungeon: result.dungeon,
              kolizeum: result.kolizeum,
            }),
          ]
        : []
    })
    const recoveries = state.fight_result.resolutions.map((row) =>
      Object.freeze({
        fight: row.fight,
        fighter: row.fighter,
        character: row.character,
        loot_types: row.loot_types,
        dungeon: fight_resolution_dungeon(row),
        kolizeum: row.kolizeum,
      })
    )
    const pending = [...live, ...recoveries].find((candidate) => {
      const key = `${candidate.fight}:${candidate.fighter}:settle`
      return !attempts.get(key)?.latched && fight_result_available(state.fight, candidate.fight)
    })
    if (!pending) return
    const key = `${pending.fight}:${pending.fighter}:settle`
    const character = characters.find(({ id }) => id === pending.character)
    if (!character) return
    active = key
    const custody = { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap }
    const encumbered = encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows)
    const loot = pending.loot_types.map((item_type) => ({
      item_type,
      existing: stack_merge_target(inventory, encumbered, item_type, custody.kiosk),
    }))
    const transaction = () =>
      pending.kolizeum
        ? wallet.kolizeum.settle({
            kolizeum: pending.kolizeum,
            fight: pending.fight,
            fighter_idx: BigInt(pending.fighter),
            custody,
          })
        : pending.dungeon
          ? wallet.dungeon.settle_fight({
              fight: pending.fight,
              fighter_idx: BigInt(pending.fighter),
              world: pending.dungeon.world,
              loot,
              custody,
            })
          : wallet.fight.settle({ fight: pending.fight, fighter_idx: BigInt(pending.fighter), loot, custody })
    void settle_after_version_race(transaction, wait)
      .then(() => {
        attempts.set(key, Object.freeze({ latched: true }))
        dispatch({ type: 'fight_result/settled', character_id: pending.character, fight: pending.fight })
        return true
      })
      .catch((error: unknown) => {
        // Every refusal waits for the explicit Retry action. Re-entering sweep here would
        // reopen signing or dry-run the same doomed bytes in a tight loop.
        attempts.set(key, Object.freeze({ latched: true }))
        dispatch({
          type: 'fight_result/claim_failed',
          character_id: pending.character,
          fight: pending.fight,
          error: error instanceof Error ? error.message : String(error),
        })
        toast.add(error)
        return false
      })
      .then((settled) => {
        const gas_spent_mist = get_state().session.wallet?.fight.gas_spent(pending.fight)
        if (gas_spent_mist !== undefined)
          dispatch({
            type: 'fight_result/gas_updated',
            character_id: pending.character,
            fight: pending.fight,
            gas_spent_mist,
          })
        active = null
        if (settled) sweep()
      })
  }

  events.on('fight/reconciled', ({ checkpoint, mode }) => {
    const character_id = get_state().session.selected_character_id
    if (mode === 'local' && character_id)
      dispatch({
        type: 'fight_result/checkpoint',
        character_id,
        checkpoint,
        observed_at_ms: Date.now(),
        gas_spent_mist: get_state().session.wallet?.fight.gas_spent(checkpoint.contract.id) ?? 0n,
      })
  })
  events.on('fight_result/retry', ({ character_id }) => {
    const fight = get_state().fight_result.current_by_character[character_id]?.fight
    if (fight) for (const key of [...attempts.keys()]) if (key.startsWith(`${fight}:`)) attempts.delete(key)
    sweep()
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.fight_result.closable_fights !== previous.fight_result.closable_fights || state.copy !== previous.copy)
      state.fight_result.closable_fights.forEach(offer_close)
    if (
      state.fight !== previous.fight ||
      state.fight_result.resolutions !== previous.fight_result.resolutions ||
      state.fight_result.current_by_character !== previous.fight_result.current_by_character ||
      state.session.inventory !== previous.session.inventory ||
      state.session.characters !== previous.session.characters ||
      state.session.link_status !== previous.session.link_status
    )
      sweep()
  })
}

export const create_fight_result_observer =
  (
    wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds))
  ): NonNullable<AppModule['observe']> =>
  (context) =>
    observe_with_wait(context, wait)

export const observe_fight_results = create_fight_result_observer()
