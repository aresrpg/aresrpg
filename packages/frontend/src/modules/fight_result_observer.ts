// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { coalesced_stack_groups, encumbered_asset_ids, stack_merge_target } from '../inventory_stacks.ts'
import { content_catalog } from '../content/catalog.ts'
import { mastery_dungeon_slug } from '../mastery/model.ts'
import { toast } from '../toast.ts'
import type { AppModule, AppState } from '../store.ts'
import { retry_after_version_race, retry_close_after_projection_lag } from '../transaction_guard.ts'

import { fight_resolution_dungeon, fight_result_available } from './fight_result_view.ts'
import { fight_result_error_text } from './fight_result_error.ts'

type Attempt = Readonly<{ latched: boolean }>

const mastery_completion = (
  state: Readonly<AppState>,
  dungeon: Readonly<{ dungeon: string; room: number }> | null,
  candidates: readonly Readonly<{ fighter: number; won: boolean }>[]
): Readonly<{ id: string; fighter_idx: bigint }> | null => {
  const mastery = state.mastery.row
  const { current_epoch } = state.session
  const final_room = dungeon ? content_catalog.dungeon(dungeon.dungeon)?.rooms.length : null
  const winner = candidates.find(({ won }) => won)
  if (!mastery || !winner) return null
  const { id, quest_completed, quest_dungeon, quest_epoch } = mastery
  const eligible = [
    current_epoch !== null,
    quest_epoch === current_epoch,
    !quest_completed,
    dungeon?.dungeon === mastery_dungeon_slug(quest_dungeon),
    dungeon?.room === final_room,
  ].every(Boolean)
  return eligible ? Object.freeze({ id, fighter_idx: BigInt(winner.fighter) }) : null
}

export const settlement_needs_close = (receipt: unknown): boolean =>
  typeof receipt === 'object' &&
  receipt !== null &&
  Reflect.get(receipt, 'closable') === true &&
  Reflect.get(receipt, 'closed') !== true

export const settlement_is_final = (
  result: Readonly<{
    participants: readonly Readonly<{
      seat: number
      character_id: string | null
      forfeited: boolean
      settled: boolean
    }>[]
  }>,
  settling: ReadonlySet<number>
): boolean =>
  result.participants.every(
    ({ seat, character_id, forfeited, settled }) => character_id === null || forfeited || settled || settling.has(seat)
  )

const settlement_batch_is_final = (
  state: Readonly<AppState>,
  character_id: string,
  settlements: readonly Readonly<{ fighter_idx: bigint }>[]
): boolean => {
  const result = state.fight_result.current_by_character[character_id]
  return !!result && settlement_is_final(result, new Set(settlements.map(({ fighter_idx }) => Number(fighter_idx))))
}

const kolizeum_payment = (kolizeum: string | null, receipt: unknown): bigint | null => {
  if (!kolizeum || typeof receipt !== 'object' || receipt === null) return null
  return BigInt(String(Reflect.get(receipt, 'paid_mist') ?? 0))
}

/** Settlement is a frontend effect boundary: live terminal truth starts immediately, while
 * RESULT_FOR is only the reconnect fallback. A certified receipt completes presentation. */
const observe_with_wait = (
  { events, dispatch, get_state, signal }: Parameters<NonNullable<AppModule['observe']>>[0],
  wait: (milliseconds: number) => Promise<void>
): void => {
  const attempts = new Map<string, Attempt>()
  const closing = new Set<string>()
  const close_notices = new Map<string, () => void>()
  const settled_kiosks = new Set<string>()
  let active: string | null = null
  const locks = globalThis.navigator?.locks
  let settlement_owner = !locks
  let lease_address: string | null = null
  let release_lease: (() => void) | null = null
  let normalizing_kiosk: string | null = null
  let observed_inventory = get_state().session.inventory
  const close_once = (row: Readonly<{ fight: string; kolizeum: string | null }>): void => {
    const { fight } = row
    const { wallet } = get_state().session
    if (!settlement_owner || !wallet || closing.has(fight)) return
    closing.add(fight)
    close_notices.get(fight)?.()
    close_notices.delete(fight)
    const transaction = () =>
      row.kolizeum ? wallet.kolizeum.close({ kolizeum: row.kolizeum, fight }) : wallet.fight.close({ fight })
    void retry_close_after_projection_lag(() => retry_after_version_race(transaction, wait), wait)
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

  const normalize_settled_stacks = (): void => {
    const state = get_state()
    if (active || normalizing_kiosk || state.session.inventory === observed_inventory) return
    observed_inventory = state.session.inventory
    const { wallet } = state.session
    if (!wallet) return
    const encumbered = encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows)
    const duplicate_groups = coalesced_stack_groups(state.session.inventory, encumbered).filter(
      ({ target, source_ids }) => settled_kiosks.has(target.kiosk) && source_ids.length > 0
    )
    const kiosk = duplicate_groups[0]?.target.kiosk
    if (!kiosk) return
    const plan = duplicate_groups
      .filter(({ target }) => target.kiosk === kiosk)
      .map(({ target, source_ids }) => Object.freeze({ kiosk, target_id: target.id, source_ids }))
    normalizing_kiosk = kiosk
    void wallet.stacks
      .merge_many(plan)
      .then(() => {
        dispatch({ type: 'inventory/stacks_merged', groups: plan })
        return true
      })
      .catch((error: unknown) => {
        toast.add(error)
        return false
      })
      .then((normalized) => {
        normalizing_kiosk = null
        if (normalized) normalize_settled_stacks()
      })
  }

  const sweep = (): void => {
    if (!settlement_owner || active) return
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
              won: result.winner !== null && result.winner === own.team,
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
        won: row.winner !== null && row.winner === row.team,
      })
    )
    const pending_rows = [
      ...new Map(
        [...live, ...recoveries].map((candidate) => [`${candidate.fight}:${candidate.fighter}:settle`, candidate])
      ).values(),
    ].filter((candidate) => {
      const key = `${candidate.fight}:${candidate.fighter}:settle`
      return !attempts.get(key)?.latched && fight_result_available(state.fight, candidate.fight)
    })
    const [first] = pending_rows
    if (!first) return
    const first_character = characters.find(({ id }) => id === first.character)
    if (!first_character) return
    const batch = pending_rows.filter((candidate) => {
      const character = characters.find(({ id }) => id === candidate.character)
      return (
        !first.kolizeum &&
        !candidate.kolizeum &&
        candidate.fight === first.fight &&
        candidate.dungeon?.dungeon === first.dungeon?.dungeon &&
        character?.kiosk === first_character.kiosk
      )
    })
    const pending = batch.length > 0 ? batch : [first]
    const keys = pending.map(({ fight, fighter }) => `${fight}:${fighter}:settle`)
    active = keys.join('|')
    const custody = { kiosk: first_character.kiosk, kiosk_cap: first_character.kiosk_cap }
    const encumbered = encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows)
    const settlements = pending.map((candidate) =>
      Object.freeze({
        fighter_idx: BigInt(candidate.fighter),
        loot: candidate.loot_types.map((item_type) => ({
          item_type,
          existing: stack_merge_target(inventory, encumbered, item_type, custody.kiosk),
        })),
      })
    )
    const mastery = mastery_completion(state, first.dungeon, pending)
    const final_settlement = settlement_batch_is_final(state, first.character, settlements)
    const transaction = () =>
      first.kolizeum
        ? wallet.kolizeum.settle({
            kolizeum: first.kolizeum,
            fight: first.fight,
            fighter_idx: BigInt(first.fighter),
            custody,
            last: final_settlement,
          })
        : first.dungeon
          ? wallet.dungeon.settle({
              fight: first.fight,
              dungeon: first.dungeon.dungeon,
              settlements,
              custody,
              mastery,
              last: final_settlement,
            })
          : wallet.fight.settle({ fight: first.fight, settlements, custody, last: final_settlement })
    void retry_after_version_race(transaction, wait)
      .then((receipt) => {
        const mastery_row = typeof receipt === 'object' && receipt !== null ? Reflect.get(receipt, 'mastery') : null
        if (mastery_row) dispatch({ type: 'mastery/reconciled', mastery: mastery_row })
        if (!first.kolizeum) settled_kiosks.add(custody.kiosk)
        pending.forEach((candidate, index) => {
          attempts.set(keys[index]!, Object.freeze({ latched: true }))
          dispatch({
            type: 'fight_result/settled',
            character_id: candidate.character,
            fight: candidate.fight,
            paid_mist: kolizeum_payment(candidate.kolizeum, receipt),
          })
        })
        if (settlement_needs_close(receipt)) close_once({ fight: first.fight, kolizeum: first.kolizeum })
        return true
      })
      .catch((error: unknown) => {
        // Every refusal waits for the explicit Retry action. Re-entering sweep here would
        // reopen signing or dry-run the same doomed bytes in a tight loop.
        const raw_error = error instanceof Error ? error.message : String(error)
        pending.forEach((candidate, index) => {
          attempts.set(keys[index]!, Object.freeze({ latched: true }))
          dispatch({
            type: 'fight_result/claim_failed',
            character_id: candidate.character,
            fight: candidate.fight,
            error: raw_error,
          })
        })
        const copy = get_state().copy?.fight_hud
        toast.add(copy ? new Error(fight_result_error_text(copy, raw_error)) : error)
        return false
      })
      .then((settled) => {
        const gas_spent_mist = get_state().session.wallet?.fight.gas_spent(first.fight)
        if (gas_spent_mist !== undefined)
          pending.forEach((candidate) =>
            dispatch({
              type: 'fight_result/gas_updated',
              character_id: candidate.character,
              fight: candidate.fight,
              gas_spent_mist,
            })
          )
        active = null
        if (settled) sweep()
        if (!active) normalize_settled_stacks()
      })
  }

  const ready_wallet_address = (): string | null => {
    const { session } = get_state()
    return session.link_status === 'ready' ? (session.wallet?.address ?? null) : null
  }
  const ensure_settlement_lease = (): void => {
    if (!locks || signal.aborted) return
    const address = ready_wallet_address()
    if (lease_address && lease_address !== address) release_lease?.()
    if (!address || lease_address) return
    lease_address = address
    void locks
      .request(`aresrpg:fight-settlement:${address}`, async () => {
        if (signal.aborted || ready_wallet_address() !== address) {
          lease_address = null
          ensure_settlement_lease()
          return
        }
        settlement_owner = true
        get_state().fight_result.closable_fights.forEach(close_once)
        sweep()
        await new Promise<void>((resolve) => {
          release_lease = resolve
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => resolve(), { once: true })
        })
        settlement_owner = false
        release_lease = null
        lease_address = null
        ensure_settlement_lease()
      })
      .catch((error: unknown) => {
        lease_address = null
        console.error('Fight settlement tab lease failed.', error)
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
    ensure_settlement_lease()
    if (state.fight_result.closable_fights !== previous.fight_result.closable_fights)
      state.fight_result.closable_fights.forEach(close_once)
    normalize_settled_stacks()
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
  ensure_settlement_lease()
}

export const create_fight_result_observer =
  (
    wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds))
  ): NonNullable<AppModule['observe']> =>
  (context) =>
    observe_with_wait(context, wait)

export const observe_fight_results = create_fight_result_observer()
