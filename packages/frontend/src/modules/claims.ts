// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Claims get one durable automatic attempt. Explicit inventory recovery uses the same SDK
// entrypoint, including its persisted uncertainty barrier. Markers are intent, never entitlement.

import type { ClaimRow } from '@aresrpg/protocol'
import { item_template_id } from '@aresrpg/sdk/seed-ids'
import { resolve_pins } from '@aresrpg/sdk/pins'
import { LOOT_BOX_BATCH_LIMIT } from '@aresrpg/sdk/character'

import { encyclopedia_catalog } from '../content/catalog.ts'
import { env } from '../env.ts'
import { crush_results, projected_crush_items, type PendingCrushResult } from '../crush_result.ts'
import { browser_auth_storage } from '../auth_storage.ts'
import { toast } from '../toast.ts'
import type { AppModule } from '../store.ts'
import { is_rune } from '../characters/forge_eligibility.ts'
import { encumbered_asset_ids, stack_merge_target } from '../inventory_stacks.ts'

import { create_claim_attempts } from './giftcard_attempts.ts'

export type ClaimsInput =
  | Readonly<{ type: 'claims/redeem'; claim_id: string }>
  | Readonly<{ type: 'claims/failed' | 'claims/started'; claim_ids: readonly string[] }>

/** template id → item_type over the authored catalog — PURE derivation, zero chain reads. */
export const rolled_item_types = (() => {
  let map: Map<string, string> | null = null
  return (): Map<string, string> => {
    if (map) return map
    const pins = resolve_pins(env.network) as { content_root?: { id?: string }; seed_package_original?: string }
    const content_root = pins?.content_root?.id
    const seed_original = pins?.seed_package_original
    map = new Map(
      content_root && seed_original
        ? encyclopedia_catalog.items.map(({ item_type }) => [
            item_template_id(content_root, seed_original, item_type),
            item_type,
          ])
        : []
    )
    return map
  }
})()

/** A BOX CLAIM WITHOUT ITS ROLL IS NOT READY — IT IS NOT BROKEN (2026-08-22). The open receipt
 *  names the CLAIM, never its contents: what it rolled is the PROJECTION's to tell, and it
 *  arrives on the streamed row. Settling before then threw "not in the authored catalog" — a
 *  lie, the catalog was fine — and left the reveal spinning on Collecting… forever. */
export const claim_is_settleable = (claim: Readonly<ClaimRow>): boolean =>
  claim.kind !== 'box' || !!claim.rolled_template

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state, signal }) => {
  const attempts = create_claim_attempts(browser_auth_storage(), env.network, 'claim')
  const pending_crush_results = new Map<string, PendingCrushResult>()
  let active_claim_id: string | null = null
  let lifetime = 0

  const publish_ready_crush_results = (): void => {
    const { inventory } = get_state().session
    for (const [claim_id, pending] of pending_crush_results) {
      const items = projected_crush_items(pending, inventory)
      if (items === null) continue
      crush_results.publish(Object.freeze({ digest: pending.digest, items }))
      pending_crush_results.delete(claim_id)
      if (active_claim_id === claim_id) active_claim_id = null
    }
    if (!active_claim_id) sweep()
  }

  const settle = async (batch: readonly ClaimRow[]): Promise<PendingCrushResult | null> => {
    const claim = batch[0]!
    const state = get_state()
    const { wallet, inventory } = state.session
    if (!wallet) return null
    const kiosk = state.session.characters[0]?.kiosk ?? inventory[0]?.kiosk
    const character = state.session.characters.find((row) => row.kiosk === kiosk)
    const custody = kiosk ? { kiosk, kiosk_cap: character?.kiosk_cap } : undefined
    const encumbered = encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows)
    if (claim.kind === 'box') {
      const claims = batch.map((row) => {
        const rolled_item_type = row.rolled_template ? rolled_item_types().get(row.rolled_template) : null
        if (!rolled_item_type)
          throw new Error(`The rolled template ${row.rolled_template} is not in the authored catalog`)
        return {
          claim_id: row.id,
          rolled_item_type,
          existing: stack_merge_target(inventory, encumbered, rolled_item_type, kiosk),
        }
      })
      if (claims.length === 1) await wallet.character.claim_loot({ ...claims[0]!, custody })
      else await wallet.character.claim_loot_batch({ claims, custody })
      return null
    }
    const runes = encyclopedia_catalog.items
      .filter((item) => item.category === 'rune')
      .map(({ item_type }) => ({
        item_type,
        existing: stack_merge_target(inventory.filter(is_rune), encumbered, item_type, kiosk),
      }))
    const previous_amounts = Object.freeze(Object.fromEntries(inventory.map(({ id, amount }) => [id, amount])))
    const { digest, item_ids } = await wallet.character.redeem_crush({
      claim_id: claim.id,
      runes,
      custody,
    })
    return Object.freeze({ digest, item_ids, previous_amounts })
  }

  const redeem = (claim: Readonly<ClaimRow>, automatic: boolean): void => {
    const { session } = get_state()
    const { wallet } = session
    if (!wallet || signal.aborted || session.link_status !== 'ready' || active_claim_id || !claim_is_settleable(claim))
      return
    const batch =
      claim.kind === 'box'
        ? session.claims
            .filter(
              (row) =>
                row.kind === 'box' && claim_is_settleable(row) && (!automatic || !attempts.has(wallet.address, row.id))
            )
            .slice(0, LOOT_BOX_BATCH_LIMIT)
        : [claim]
    const retained = batch.map(({ id }) => attempts.remember(wallet.address, id))
    if (!batch.length || (automatic && retained.some((value) => !value))) return
    active_claim_id = claim.id
    dispatch({ type: 'claims/started', claim_ids: batch.map(({ id }) => id) })
    const attempt_lifetime = lifetime
    const current = (): boolean => !signal.aborted && lifetime === attempt_lifetime
    void settle(batch)
      .then((pending) => {
        if (!current()) return
        if (pending) pending_crush_results.set(claim.id, pending)
        else active_claim_id = null
        dispatch({ type: 'inventory/claims_settled', claim_ids: batch.map(({ id }) => id) })
        publish_ready_crush_results()
      })
      .catch((error: Readonly<Error>) => {
        if (!current()) {
          console.error('Claim settlement failed after the account changed.', error)
          return
        }
        if (claim.kind === 'crush') crush_results.fail(error)
        dispatch({ type: 'claims/failed', claim_ids: batch.map(({ id }) => id) })
        toast.add(error)
        if (active_claim_id === claim.id) active_claim_id = null
      })
      .finally(() => {
        if (current()) sweep()
      })
  }

  const sweep = (): void => {
    const { session } = get_state()
    if (!session.wallet || signal.aborted || session.link_status !== 'ready' || active_claim_id) return
    const { address } = session.wallet
    const claim = session.claims.find(
      (candidate) => claim_is_settleable(candidate) && !attempts.has(address, candidate.id)
    )
    if (claim) redeem(claim, true)
    else {
      const failed = session.claims.filter(({ id }) => attempts.has(address, id)).map(({ id }) => id)
      if (failed.length) dispatch({ type: 'claims/failed', claim_ids: failed })
    }
  }

  events.on('claims/redeem', ({ claim_id }) => {
    const claim = get_state().session.claims.find(({ id }) => id === claim_id)
    if (claim) redeem(claim, false)
  })

  events.on('STATE_UPDATED', (state, previous) => {
    if (state.session.wallet !== previous.session.wallet) {
      lifetime++
      active_claim_id = null
      pending_crush_results.clear()
    }
    if (state.session.inventory !== previous.session.inventory) publish_ready_crush_results()
    if (state.session.claims !== previous.session.claims || state.session.link_status !== previous.session.link_status)
      sweep()
  })
}

const reduce: NonNullable<AppModule['reduce']> = (state, input) => {
  if (input.type === 'auth/disconnected') return { ...state, claim_failures: [] }
  if (input.type === 'claims/failed') {
    const failed = [...new Set([...state.claim_failures, ...input.claim_ids])]
    return failed.length === state.claim_failures.length ? state : { ...state, claim_failures: failed }
  }
  if (input.type === 'claims/started') {
    const pending = new Set(input.claim_ids)
    return { ...state, claim_failures: state.claim_failures.filter((id) => !pending.has(id)) }
  }
  return state
}
export default Object.freeze({ name: 'claims', reduce, observe }) satisfies AppModule
