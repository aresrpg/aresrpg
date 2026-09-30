// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { rune_effect, stat_names, type RuneTier } from '@aresrpg/immutable'

import type { Receipt, spending_receipt } from './cache.ts'
import { receipt_event } from './cache.ts'
import { event_integer, event_string } from './receipt_decode.ts'

/** The RuneScribed event, projected — the ONLY truth about a scribe's random outcome. */
export type ScribeOutcome = Readonly<
  Partial<ReturnType<typeof spending_receipt>> & {
    digest: string
    /** catalog stat id (stat_names order) the rune targeted */
    stat: number
    /** 0 = success, then the degraded outcomes (forge.move outcome codes) */
    outcome: number
    applied_value: number
    lost_amounts: readonly number[]
    new_puits: string
  }
>

const RUNE_TIERS: readonly RuneTier[] = Object.freeze(['ba', 'pa', 'ra'])

export const rune_coordinates = (item_type: string): Readonly<{ stat: number; tier: number; index: number }> => {
  const rune = rune_effect(item_type)
  if (!rune) throw new Error(`Invalid rune template: ${item_type}`)
  const stat = stat_names.indexOf(rune.stat)
  const tier = RUNE_TIERS.indexOf(rune.tier) + 1
  return Object.freeze({ stat, tier, index: stat * RUNE_TIERS.length + tier - 1 })
}

export const scribe_losses = (event: Readonly<Record<string, unknown>>): readonly number[] => {
  if (!Array.isArray(event.lost_amounts) || event.lost_amounts.length !== stat_names.length)
    throw new Error('The scribe receipt carried an invalid stat-loss vector')
  return Object.freeze(event.lost_amounts.map((value) => event_integer({ value }, 'value')))
}

export const crush_owed_from_receipt = (receipt: Receipt, claim_id: string): readonly number[] => {
  const event = receipt_event(receipt, '::forgemagie::CrushRevealed')
  if (!event || event_string(event, 'claim') !== claim_id)
    throw new Error('The crush reveal receipt did not match its claim')
  const raw = event.owed
  if (!Array.isArray(raw) || raw.length !== stat_names.length * RUNE_TIERS.length)
    throw new Error('The crush reveal receipt carried an invalid rune vector')
  return Object.freeze(raw.map((value) => event_integer({ value }, 'value')))
}
