// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE SILENT CLAIMER — pending grind-safe claims (loot-box rolls, crush yields) redeem
// themselves the moment the session sees them: on load the server pushes whatever is
// unclaimed, and every own-transaction fold that lands a claim re-enters here through
// STATE_UPDATED. The player never manages claims. Failure is LOUD (one error toast per
// attempt) and chain-safe — a soulbound claim survives everything and retries on the next
// pass. TX-RETRY law: an EXECUTED failure latches its claim for the whole session (gas
// burned twice is the crime); a pre-flight refusal (e.g. an empty gas tank) retries after
// a cooldown, so a top-up resumes the redeem on its own.

import type { ClaimRow } from '@aresrpg/protocol'
import { item_template_id } from '@aresrpg/sdk/seed-ids'

import PINS from '../../../../pins.json' with { type: 'json' }
import { encyclopedia_catalog } from '../content/catalog.ts'
import { env } from '../env.ts'
import { toast } from '../toast.ts'
import type { AppModule } from '../store.ts'
import { is_rune } from '../characters/forge_eligibility.ts'

const RETRY_COOLDOWN_MS = 30_000
/** the indexer projects a yield a beat after finality — one per-item request covers it */

/** template id → item_type over the authored catalog — PURE derivation, zero chain reads. */
export const rolled_item_types = (() => {
  let map: Map<string, string> | null = null
  return (): Map<string, string> => {
    if (map) return map
    const registry = (PINS as unknown as Record<string, { template_registry?: { id?: string } }>)[env.network]
      ?.template_registry?.id
    map = new Map(
      registry
        ? encyclopedia_catalog.items.map(({ item_type }) => [item_template_id(registry, item_type), item_type])
        : []
    )
    return map
  }
})()

type Attempt = Readonly<{ tried_at_ms: number; latched: boolean }>

/** An EXECUTED failure carries a digest in the SDK's error message — gas burned, never refire. */
const is_executed_failure = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('failed on-chain')

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state, signal }) => {
  const attempts = new Map<string, Attempt>()
  const in_flight = new Set<string>()

  const settle = async (claim: Readonly<ClaimRow>): Promise<void> => {
    const { wallet, inventory } = get_state().session
    if (!wallet) return
    if (claim.kind === 'box') {
      const rolled_item_type = claim.rolled_template ? rolled_item_types().get(claim.rolled_template) : null
      if (!rolled_item_type) throw new Error('The rolled item is not in the authored catalog')
      const existing = inventory.find((row) => row.item_type === rolled_item_type)?.id ?? null
      // the yield's CONTENTS stream from the server (ItemWritten — projection-driven);
      // the receipt only settles the claim locally
      await wallet.character.claim_loot({ claim_id: claim.id, rolled_item_type, existing })
      dispatch({ type: 'inventory/claim_settled', claim_id: claim.id })
      return
    }
    const runes = encyclopedia_catalog.items
      .filter((item) => item.category === 'rune')
      .map(({ item_type }) => ({
        item_type,
        existing: inventory.find((row) => row.item_type === item_type && is_rune(row))?.id ?? null,
      }))
    await wallet.character.redeem_crush({ claim_id: claim.id, runes })
    dispatch({ type: 'inventory/claim_settled', claim_id: claim.id })
  }

  const sweep = (): void => {
    const { session } = get_state()
    if (!session.wallet || session.link_status !== 'ready') return
    const now = Date.now()
    for (const claim of session.claims) {
      if (in_flight.has(claim.id)) continue
      const attempt = attempts.get(claim.id)
      if (attempt && (attempt.latched || now - attempt.tried_at_ms < RETRY_COOLDOWN_MS)) continue
      in_flight.add(claim.id)
      attempts.set(claim.id, Object.freeze({ tried_at_ms: now, latched: false }))
      void settle(claim)
        .catch((error: Readonly<Error>) => {
          if (is_executed_failure(error)) attempts.set(claim.id, Object.freeze({ tried_at_ms: now, latched: true }))
          toast.add(error)
        })
        .finally(() => in_flight.delete(claim.id))
    }
  }

  events.on('STATE_UPDATED', (state, previous) => {
    if (state.session.claims !== previous.session.claims || state.session.link_status !== previous.session.link_status)
      sweep()
  })
}

// the no-op reduce keeps the MODULES union uniform (fight_chain precedent)
export default Object.freeze({ name: 'claims', reduce: (state) => state, observe }) satisfies AppModule
