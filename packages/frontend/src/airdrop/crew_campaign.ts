// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import source from '../../../../seed/content/crew.json'
import { content_catalog } from '../content/catalog.ts'
import type { BlastState } from '../kares/blast.ts'
import { blast_phase } from '../kares/blast.ts'

export const crew = Object.freeze(source)
export const crew_path = `/claim/${crew.campaign}`
export const crew_campaign = content_catalog.airdrop.campaigns.find(({ id }) => id === crew.campaign)!
export const crew_item_type = crew_campaign.items[0]!

export type CrewDialogue = 'intro' | 'connect' | 'checking' | 'ready' | 'claiming' | 'claimed' | 'empty' | 'unavailable'

const sale_dialogue: Partial<Record<ReturnType<typeof blast_phase>, CrewDialogue>> = {
  soon: 'intro',
  live: 'intro',
  loading: 'checking',
  unavailable: 'unavailable',
}

/** Presentation of existing sale, wallet and gift state; absence never invents eligibility history. */
export const crew_dialogue = (
  input: Readonly<{
    sale: BlastState
    connected: boolean
    loaded: boolean
    ready: boolean
    claimed: boolean
    pending: string | null
    error: string | null
  }>
): CrewDialogue => {
  const phase = sale_dialogue[blast_phase(input.sale)]
  const states: readonly (readonly [boolean, CrewDialogue])[] = [
    [input.error !== null, 'unavailable'],
    [input.pending === 'load', 'checking'],
    [input.pending !== null, 'claiming'],
    [input.ready, 'ready'],
    [input.claimed, 'claimed'],
    [phase !== undefined, phase ?? 'checking'],
    [!input.connected, 'connect'],
  ]
  return states.find(([matches]) => matches)?.[1] ?? (input.loaded ? 'empty' : 'checking')
}
