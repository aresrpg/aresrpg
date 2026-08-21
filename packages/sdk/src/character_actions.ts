// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The character builder — the app's ONE door to the character's own upkeep transactions:
// equipment changes, stat allocation, spell raises, consumables, and rune scribing. Every
// action composes the PTB against the wallet's personal kiosk (the character's custody home)
// and executes; the caller folds the proven receipt client-side — the server streams only
// facts this player's own transactions did not cause.

import type { KioskOwnerCap } from '@mysten/kiosk'

import type { SDK } from './client.ts'
import { receipt_digest, receipt_event, type Receipt } from './cache.ts'
import { create_kiosk_runner, type KioskCapLoader } from './kiosk_runner.ts'
import { item_template_id, recipe_id, spell_template_id } from './seed_ids.ts'

type GameSdk = ReturnType<typeof SDK>

export type CharacterReceipt = { digest: string }

export type EquipChange = Readonly<{ slot: string; item_id: string }>

/** The RuneScribed event, projected — the ONLY truth about a scribe's random outcome. */
export type ScribeOutcome = Readonly<{
  digest: string
  /** catalog stat id (stat_names order) the rune targeted */
  stat: number
  /** 0 = success, then the degraded outcomes (forge.move outcome codes) */
  outcome: number
  applied_value: number
  lost_stat: number
  lost_amount: number
}>

const created_object_id = (receipt: Receipt, suffix: string): string | null => {
  const transaction = receipt.Transaction
  const types = transaction?.objectTypes ?? {}
  const created = transaction?.effects?.changedObjects?.filter(({ idOperation }) => idOperation === 'Created') ?? []
  return (
    created.find(({ objectId }) => typeof objectId === 'string' && types[objectId]?.endsWith(suffix))?.objectId ?? null
  )
}

const registry_of = (sdk: GameSdk): { registry: string; package_id: string } => {
  const registry = sdk.pins.template_registry
  const package_id = sdk.pins.package
  const id = typeof registry === 'object' && registry !== null ? Reflect.get(registry, 'id') : registry
  if (typeof id !== 'string' || typeof package_id !== 'string')
    throw new Error('Character transaction unavailable: pins.json has no template registry for this network.')
  return { registry: id, package_id }
}

export type CharacterActionsCtx = {
  /** async loader — the session's cached personal kiosk caps (kiosks are for life) */
  kiosk_cap: KioskCapLoader
}

/** The builder: every character-upkeep chain action. */
export const character_actions = (sdk: GameSdk, { kiosk_cap }: CharacterActionsCtx) => {
  // the ONE kiosk execution bracket, shared with fight.ts (kiosk_runner.ts owns the why)
  const { with_kiosk, with_terminal_kiosk } = create_kiosk_runner(sdk, kiosk_cap)

  return {
    /** Apply one staged equipment change-set in ONE transaction: unequips first (freeing
     *  slots), then equips. Unequipped items are Receiving<Item> off the character, so their
     *  exact owned refs hydrate first. */
    equip: async ({
      character_id,
      to_equip,
      to_unequip,
    }: {
      character_id: string
      to_equip: readonly EquipChange[]
      to_unequip: readonly EquipChange[]
    }): Promise<CharacterReceipt> => {
      if (!to_equip.length && !to_unequip.length) throw new Error('The equipment change-set is empty')
      await sdk.hydrate_unknown(to_unequip.map(({ item_id }) => item_id))
      const receipt = await with_kiosk((tx, kiosk, cap) => {
        for (const { slot, item_id } of to_unequip)
          sdk.doors.unequip_item(tx, { kiosk, cap, character_id, slot, receiving: item_id })
        for (const { slot, item_id } of to_equip) sdk.doors.equip_item(tx, { kiosk, cap, character_id, slot, item_id })
      })
      return { digest: receipt_digest(receipt) }
    },

    /** Spend stat points: one raise_stat call per staged characteristic, ONE transaction. */
    raise_stats: async ({
      character_id,
      allocation,
    }: {
      character_id: string
      allocation: Readonly<Record<string, number>>
    }): Promise<CharacterReceipt> => {
      const rows = Object.entries(allocation).filter(([, amount]) => Number.isSafeInteger(amount) && amount > 0)
      if (!rows.length) throw new Error('The stat allocation is empty')
      const receipt = await with_kiosk((tx, kiosk, cap) => {
        for (const [stat, amount] of rows) sdk.doors.raise_stat(tx, { kiosk, cap, character_id, stat, amount })
      })
      return { digest: receipt_digest(receipt) }
    },

    /** Raise one spell a level (n → n+1 costs n points — the chain re-asserts every rule). */
    raise_spell: async ({
      character_id,
      spell,
    }: {
      character_id: string
      spell: string
    }): Promise<CharacterReceipt> => {
      const { registry, package_id } = registry_of(sdk)
      const template = spell_template_id(registry, package_id, spell)
      await sdk.hydrate_unknown([template])
      const receipt = await with_kiosk((tx, kiosk, cap) =>
        sdk.doors.raise_spell(tx, { kiosk, cap, character_id, spell: template })
      )
      return { digest: receipt_digest(receipt) }
    },

    /** Drink/use one consumable unit on the character. */
    use_consumable: async ({
      character_id,
      item_id,
      item_type,
    }: {
      character_id: string
      item_id: string
      item_type: string
    }): Promise<CharacterReceipt> => {
      const { registry } = registry_of(sdk)
      const template = item_template_id(registry, item_type)
      await sdk.hydrate_unknown([template])
      const receipt = await with_kiosk((tx, kiosk, cap) =>
        sdk.doors.use_consumable(tx, { kiosk, cap, character_id, item_id, template })
      )
      return { digest: receipt_digest(receipt) }
    },

    /** Scribe ONE rune onto a gear item — the outcome is the chain's random roll; the
     *  RuneScribed event is the one truth the caller folds (honest-data law: no local odds). */
    scribe_rune: async ({
      character_id,
      gear_id,
      gear_item_type,
      rune_item_id,
    }: {
      character_id: string
      gear_id: string
      gear_item_type: string
      rune_item_id: string
    }): Promise<ScribeOutcome> => {
      const { registry } = registry_of(sdk)
      const gear_template = item_template_id(registry, gear_item_type)
      await sdk.hydrate_unknown([gear_template])
      const receipt = await with_terminal_kiosk((tx, kiosk, personal) =>
        sdk.doors.scribe_rune(tx, { kiosk, personal, character_id, gear_id, gear_template, rune_item_id })
      )
      const event = receipt_event(receipt, '::forgemagie::RuneScribed')
      if (!event) throw new Error('The scribe receipt carried no RuneScribed event')
      // the event's applied_value is the rune's NOMINAL value — the chain writes the CAPPED
      // gain; the gear's real block reaches the client through the server's item stream
      return Object.freeze({
        digest: receipt_digest(receipt),
        stat: Number(event.stat),
        outcome: Number(event.outcome),
        applied_value: Number(event.applied_value),
        lost_stat: Number(event.lost_stat),
        lost_amount: Number(event.lost_amount),
      })
    },

    /** Feed the pet ONE unit of a diet food (pet.move: once per UTC day, 60 feeds max —
     *  the chain re-asserts both; predict them client-side so a doomed tx never fires). */
    feed_pet: async ({
      pet_id,
      pet_item_type,
      food_id,
    }: {
      pet_id: string
      pet_item_type: string
      food_id: string
    }): Promise<CharacterReceipt> => {
      const { registry } = registry_of(sdk)
      const pet_template = item_template_id(registry, pet_item_type)
      await sdk.hydrate_unknown([pet_template])
      const receipt = await with_kiosk((tx, kiosk, cap) =>
        sdk.doors.feed_kiosk_pet(tx, { kiosk, cap, pet_template, pet_id, food_id })
      )
      return { digest: receipt_digest(receipt) }
    },

    /** Open a gacha box: burn one unit, roll on-chain, land a soulbound BoxClaim. The
     *  LootBoxOpened event + the created claim id are the reveal — claiming is a second,
     *  terminal transaction (grind-safe two-phase, loot_box.move). */
    open_loot_box: async ({
      box_item_id,
      box_item_type,
    }: {
      box_item_id: string
      box_item_type: string
    }): Promise<Readonly<{ digest: string; claim_id: string; rolled_template: string; amount: number }>> => {
      const { registry } = registry_of(sdk)
      const box_template = item_template_id(registry, box_item_type)
      await sdk.hydrate_unknown([box_template])
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) => sdk.doors.open_loot_box(tx, { kiosk, personal, box_item_id, box_template }),
        { include: { objectTypes: true } }
      )
      const event = receipt_event(receipt, '::loot_box::LootBoxOpened')
      const claim_id = created_object_id(receipt, '::loot_box::BoxClaim')
      if (!event || !claim_id) throw new Error('The open receipt carried no LootBoxOpened reveal')
      return Object.freeze({
        digest: receipt_digest(receipt),
        claim_id,
        rolled_template: String(event.rolled_template),
        amount: Number(event.amount),
      })
    },

    /** Redeem a BoxClaim: mint the rolled item (stats roll here for gear) and burn the claim. */
    claim_loot: async ({
      claim_id,
      rolled_item_type,
      existing,
    }: {
      claim_id: string
      rolled_item_type: string
      existing: string | null
    }): Promise<Readonly<{ digest: string }>> => {
      const { registry } = registry_of(sdk)
      const template = item_template_id(registry, rolled_item_type)
      await sdk.hydrate_unknown([claim_id, template])
      const receipt = await with_terminal_kiosk((tx, kiosk, personal) =>
        sdk.doors.claim_loot(tx, { claim: claim_id, rolled_template: template, existing, kiosk, personal })
      )
      return Object.freeze({ digest: receipt_digest(receipt) })
    },

    /** Crush gear into a soulbound CrushClaim (phase 1 — fixed cost, the yield stays sealed). */
    crush_gear: async ({
      gear_ids,
    }: {
      gear_ids: readonly string[]
    }): Promise<Readonly<{ digest: string; claim_id: string }>> => {
      if (!gear_ids.length) throw new Error('The crush set is empty')
      // crush is a &Random door — the potato bracket is illegal for it (terminal shape only)
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) => sdk.doors.crush_gear(tx, { kiosk, personal, gear_ids }),
        { include: { objectTypes: true } }
      )
      const claim_id = created_object_id(receipt, '::forgemagie::CrushClaim')
      if (!claim_id) throw new Error('The crush receipt carried no CrushClaim')
      return Object.freeze({ digest: receipt_digest(receipt), claim_id })
    },

    /** Redeem a CrushClaim (phase 2, deterministic): one redeem_rune call PER AUTHORED RUNE
     *  TYPE — zero-owed types no-op on-chain — then discard the emptied claim. The proven
     *  yield is read off the receipt's touched rune stacks. */
    redeem_crush: async ({
      claim_id,
      runes,
    }: {
      claim_id: string
      runes: readonly Readonly<{ item_type: string; existing: string | null }>[]
    }): Promise<Readonly<{ digest: string }>> => {
      if (!runes.length) throw new Error('The rune roster is empty')
      const { registry } = registry_of(sdk)
      const templates = runes.map(({ item_type }) => item_template_id(registry, item_type))
      await sdk.hydrate_unknown([claim_id, ...templates])
      const receipt = await with_kiosk((tx, kiosk, cap) => {
        runes.forEach(({ existing }, index) =>
          sdk.doors.redeem_rune(tx, { claim: claim_id, template: templates[index]!, existing, kiosk, cap })
        )
        sdk.doors.discard_crush_claim(tx, { claim: claim_id })
      })
      return Object.freeze({ digest: receipt_digest(receipt) })
    },

    /** Craft ONE unit: burn the exact ingredient stacks, roll the chain's success curve, mint
     *  the output on a pass (crafting.move — xp credits either way). The Crafted event is the
     *  roll's one truth; the minted output STREAMS from the server (projection-driven). */
    craft: async ({
      character_id,
      output_type,
      input_item_ids,
      existing,
    }: {
      character_id: string
      output_type: string
      input_item_ids: readonly string[]
      existing: string | null
    }): Promise<Readonly<{ digest: string; success: boolean; job_xp_gained: number }>> => {
      if (!input_item_ids.length) throw new Error('The craft has no ingredients')
      const { registry, package_id } = registry_of(sdk)
      const recipe = recipe_id(registry, package_id, output_type)
      const output_template = item_template_id(registry, output_type)
      await sdk.hydrate_unknown([recipe, output_template])
      const receipt = await with_terminal_kiosk((tx, kiosk, personal) =>
        sdk.doors.craft(tx, { recipe, kiosk, personal, character_id, input_item_ids, output_template, existing })
      )
      const event = receipt_event(receipt, '::crafting::Crafted')
      if (!event) throw new Error('The craft receipt carried no Crafted event')
      return Object.freeze({
        digest: receipt_digest(receipt),
        success: Boolean(event.success),
        job_xp_gained: Number(event.job_xp_gained),
      })
    },

    /** Destroy (burn) units of a held item — irreversible; the chain owns the guardrails. */
    destroy_item: async ({ item_id, amount }: { item_id: string; amount: number }): Promise<CharacterReceipt> => {
      if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('The burn amount must be a positive integer')
      const receipt = await with_kiosk((tx, kiosk, cap) => sdk.doors.burn_item(tx, { kiosk, cap, item_id, amount }))
      return { digest: receipt_digest(receipt) }
    },
  }
}

export type CharacterActions = ReturnType<typeof character_actions>
