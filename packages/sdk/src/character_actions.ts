// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Custody-proven character actions. The SDK composes PTBs; Move verifies their effects.

import type { KioskOwnerCap } from '@mysten/kiosk'
import { craft_stackable_batch_limit, type CharacteristicName } from '@aresrpg/immutable'
import { zone_of } from '@aresrpg/protocol'

import type { SDK } from './client.ts'
import { changed_object_ids, created_object_id, spending_receipt, receipt_digest, receipt_event } from './cache.ts'
import { character_delete, type CharacterDeleteInput } from './character.ts'
import { living_content } from './client.ts'
import { crush_owed_from_receipt, rune_coordinates, scribe_losses } from './forgemagie.ts'
import { create_kiosk_runner, type KioskCapLoader, type KioskCustody } from './kiosk_runner.ts'
import { created_fight_id, type FightCreatedReceipt } from './fight.ts'
import { event_boolean, event_integer, event_string, event_u64 } from './receipt_decode.ts'
import {
  board_catalog_id,
  item_template_id,
  mob_template_id,
  recipe_id,
  spell_template_id,
  world_content_id,
  world_id,
  zone_id,
} from './seed_ids.ts'

type GameSdk = ReturnType<typeof SDK>
export type CharacterReceipt = { digest: string }

export type EquipChange = Readonly<{ slot: string; item_id: string }>

const craft_outcome = (
  receipt: Parameters<typeof receipt_event>[0],
  expected: Readonly<{ recipe: string; character: string; output_template: string; attempts: number }>
): Readonly<{ attempts: number; successes: number; job_xp_gained: number }> => {
  const event = receipt_event(receipt, '::crafting::Crafted')
  if (!event) throw new Error('The craft receipt carried no Crafted event')
  const attempts = event_integer(event, 'attempts')
  const successes = event_integer(event, 'successes')
  const job_xp_gained = event_integer(event, 'job_xp_gained')
  const identity_matches = [
    event.recipe === expected.recipe,
    event.character === expected.character,
    event.output_template === expected.output_template,
    attempts === expected.attempts,
  ].every(Boolean)
  const totals_are_valid = [
    Number.isSafeInteger(successes),
    successes >= 0,
    successes <= attempts,
    Number.isSafeInteger(job_xp_gained),
    job_xp_gained >= 0,
  ].every(Boolean)
  if (!identity_matches || !totals_are_valid) throw new Error('The craft receipt did not match the submitted batch')
  return Object.freeze({ attempts, successes, job_xp_gained })
}

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

export type CharacterActionsCtx = {
  /** async loader — the session's cached personal kiosk caps (kiosks are for life) */
  kiosk_cap: KioskCapLoader
}

export const character_actions = (sdk: GameSdk, { kiosk_cap }: CharacterActionsCtx) => {
  const { with_kiosk, with_terminal_kiosk } = create_kiosk_runner(sdk, kiosk_cap)

  return {
    delete: (input: CharacterDeleteInput) => character_delete(sdk, kiosk_cap, input),
    /** Hydrate receiving items, then unequip and equip atomically. */
    equip: async ({
      character_id,
      to_equip,
      to_unequip,
      custody,
    }: {
      character_id: string
      to_equip: readonly EquipChange[]
      to_unequip: readonly EquipChange[]
      custody?: KioskCustody
    }): Promise<CharacterReceipt> => {
      if (!to_equip.length && !to_unequip.length) throw new Error('The equipment change-set is empty')
      await sdk.hydrate_unknown(to_unequip.map(({ item_id }) => item_id))
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => {
          for (const { slot, item_id } of to_unequip)
            sdk.doors.unequip_item(tx, { kiosk, cap, character_id, slot, receiving: item_id })
          for (const { slot, item_id } of to_equip)
            sdk.doors.equip_item(tx, { kiosk, cap, character_id, slot, item_id })
        },
        { custody }
      )
      return { digest: receipt_digest(receipt) }
    },

    /** Spend exact capital: one class-priced characteristic row per Move call, ONE transaction. */
    raise_stats: async ({
      character_id,
      spending,
      custody,
    }: {
      character_id: string
      spending: Readonly<Partial<Record<CharacteristicName, number>>>
      custody?: KioskCustody
    }): Promise<CharacterReceipt> => {
      const rows = Object.entries(spending).filter(([, points]) => Number.isSafeInteger(points) && points > 0)
      if (!rows.length) throw new Error('The stat allocation is empty')
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => {
          for (const [stat, points] of rows) sdk.doors.raise_stat(tx, { kiosk, cap, character_id, stat, points })
        },
        { custody }
      )
      return { digest: receipt_digest(receipt) }
    },

    /** Raise one spell a level (n → n+1 costs n points — the chain re-asserts every rule). */
    raise_spell: async ({
      character_id,
      spell,
      custody,
    }: {
      character_id: string
      spell: string
      custody?: KioskCustody
    }): Promise<CharacterReceipt> => {
      const { content_root, seed_package_original } = living_content(sdk, 'Spell transaction')
      const template = spell_template_id(content_root, seed_package_original, spell)
      await sdk.hydrate_unknown([template])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => sdk.doors.raise_spell(tx, { kiosk, cap, character_id, spell: template }),
        { custody }
      )
      return { digest: receipt_digest(receipt) }
    },

    /** Drink/use one consumable unit through its template's current live effect. */
    use_consumable: async ({
      character_id,
      item_id,
      item_type,
      world,
      custody,
      merge_sources = [],
    }: {
      character_id: string
      item_id: string
      item_type: string
      world?: string
      merge_sources?: readonly string[]
      custody?: KioskCustody
    }): Promise<ReturnType<typeof spending_receipt>> => {
      const { content_root, seed_package_original } = living_content(sdk, 'Character transaction')
      const template = item_template_id(content_root, seed_package_original, item_type)
      const world_content = world ? world_content_id(content_root, seed_package_original, world) : null
      await sdk.hydrate_unknown([template, ...(world_content ? [world_content] : [])])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => {
          if (world_content)
            sdk.doors.use_city_consumable(tx, { kiosk, cap, character_id, item_id, template, world_content })
          else sdk.doors.use_consumable(tx, { kiosk, cap, character_id, item_id, template })
        },
        { custody, merges: [{ target_id: item_id, source_ids: merge_sources }] }
      )
      return spending_receipt(receipt)
    },

    /** Scribe one rune and return its certified stat and quantity changes. */
    scribe_rune: async ({
      character_id,
      gear_id,
      gear_item_type,
      rune_item_id,
      rune_item_type,
      custody,
      merge_sources = [],
    }: {
      character_id: string
      gear_id: string
      gear_item_type: string
      rune_item_id: string
      rune_item_type: string
      merge_sources?: readonly string[]
      custody?: KioskCustody
    }): Promise<ScribeOutcome> => {
      const rune = rune_coordinates(rune_item_type)
      const { content_root, seed_package_original } = living_content(sdk, 'Character transaction')
      const gear_template = item_template_id(content_root, seed_package_original, gear_item_type)
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) =>
          sdk.doors.scribe_rune(tx, {
            kiosk,
            personal,
            character_id,
            gear_id,
            gear_template,
            rune_item_id,
            rune_stat: rune.stat,
            rune_tier: rune.tier,
          }),
        { custody, inputs: [gear_template], merges: [{ target_id: rune_item_id, source_ids: merge_sources }] }
      )
      const event = receipt_event(receipt, '::forgemagie::RuneScribed')
      if (!event) throw new Error('The scribe receipt carried no RuneScribed event')
      // The event carries exact net gain/loss and the new puits. The client folds those
      // certified deltas immediately; the streamed Item remains the complete reconciliation.
      return Object.freeze({
        ...spending_receipt(receipt),
        stat: event_integer(event, 'stat'),
        outcome: event_integer(event, 'outcome'),
        applied_value: event_integer(event, 'applied_value'),
        lost_amounts: scribe_losses(event),
        new_puits: event_u64(event, 'new_puits'),
      })
    },

    /** Feed one food unit; Move enforces the daily limit. */
    feed_pet: async ({
      pet_id,
      pet_item_type,
      food_id,
      custody,
      merge_sources = [],
    }: {
      pet_id: string
      pet_item_type: string
      food_id: string
      merge_sources?: readonly string[]
      custody?: KioskCustody
    }): Promise<ReturnType<typeof spending_receipt>> => {
      const { content_root, seed_package_original } = living_content(sdk, 'Character transaction')
      const pet_template = item_template_id(content_root, seed_package_original, pet_item_type)
      await sdk.hydrate_unknown([pet_template])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => sdk.doors.feed_kiosk_pet(tx, { kiosk, cap, pet_template, pet_id, food_id }),
        { custody, merges: [{ target_id: food_id, source_ids: merge_sources }] }
      )
      return spending_receipt(receipt)
    },

    /** Burn a box and return its durable reveal claim. */
    open_loot_box: async ({
      box_item_id,
      box_item_type,
      custody,
      merge_sources = [],
    }: {
      box_item_id: string
      box_item_type: string
      merge_sources?: readonly string[]
      custody?: KioskCustody
    }): Promise<
      Readonly<ReturnType<typeof spending_receipt> & { claim_id: string; rolled_template: string; amount: number }>
    > => {
      const { content_root, seed_package_original } = living_content(sdk, 'Character transaction')
      const box_template = item_template_id(content_root, seed_package_original, box_item_type)
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) => sdk.doors.open_loot_box(tx, { kiosk, personal, box_item_id, box_template }),
        {
          include: { objectTypes: true },
          custody,
          inputs: [box_template],
          merges: [{ target_id: box_item_id, source_ids: merge_sources }],
        }
      )
      const event = receipt_event(receipt, '::loot_box::LootBoxOpened')
      const claim_id = created_object_id(receipt, '::loot_box::BoxClaim')
      if (!event || !claim_id) throw new Error('The open receipt carried no LootBoxOpened reveal')
      return Object.freeze({
        ...spending_receipt(receipt),
        claim_id,
        rolled_template: event_string(event, 'rolled_template'),
        amount: event_integer(event, 'amount'),
      })
    },

    /** Redeem a BoxClaim: mint the rolled item (stats roll here for gear) and burn the claim. */
    claim_loot: async ({
      claim_id,
      rolled_item_type,
      existing,
      custody,
    }: {
      claim_id: string
      rolled_item_type: string
      existing: string | null
      custody?: KioskCustody
    }): Promise<Readonly<{ digest: string }>> => {
      const { content_root, seed_package_original } = living_content(sdk, 'Character transaction')
      const template = item_template_id(content_root, seed_package_original, rolled_item_type)
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) =>
          sdk.doors.claim_loot(tx, { claim: claim_id, rolled_template: template, existing, kiosk, personal }),
        { custody, inputs: [claim_id, template] }
      )
      return Object.freeze({ digest: receipt_digest(receipt) })
    },

    /** Crush gear into a soulbound CrushClaim (phase 1 — fixed cost, the yield stays sealed). */
    crush_gear: async ({
      gear_ids,
      custody,
    }: {
      gear_ids: readonly string[]
      custody?: KioskCustody
    }): Promise<Readonly<{ digest: string; claim_id: string }>> => {
      if (!gear_ids.length) throw new Error('The crush set is empty')
      // crush is a &Random door — the potato bracket is illegal for it (terminal shape only)
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) => sdk.doors.crush_gear(tx, { kiosk, personal, gear_ids }),
        { include: { objectTypes: true }, custody }
      )
      const claim_id = created_object_id(receipt, '::forgemagie::CrushClaim')
      if (!claim_id) throw new Error('The crush receipt carried no CrushClaim')
      return Object.freeze({ digest: receipt_digest(receipt), claim_id })
    },

    /** Reveal a CrushClaim, redeem only nonzero rune types, discard it, and return final touched stacks. */
    redeem_crush: async ({
      claim_id,
      runes,
      custody,
    }: {
      claim_id: string
      runes: readonly Readonly<{ item_type: string; existing: string | null }>[]
      custody?: KioskCustody
    }): Promise<Readonly<{ digest: string; item_ids: readonly string[] }>> => {
      if (!runes.length) throw new Error('The rune roster is empty')
      const rune_by_index = new Map(runes.map((rune) => [rune_coordinates(rune.item_type).index, rune]))
      if (rune_by_index.size !== runes.length) throw new Error('The rune roster contains duplicate catalog entries')
      const reveal_tx = sdk.tx()
      sdk.doors.reveal_crush_claim(reveal_tx, { claim: claim_id })
      const owed = crush_owed_from_receipt(await sdk.execute(reveal_tx), claim_id)
      const missing = owed.findIndex((amount, index) => amount > 0 && !rune_by_index.has(index))
      if (missing >= 0) throw new Error(`The rune roster cannot redeem committed catalog entry ${missing}`)
      const awarded = owed.flatMap((amount, index) => (amount > 0 ? [rune_by_index.get(index)!] : []))
      if (!awarded.length) {
        const close_tx = sdk.tx()
        sdk.doors.discard_crush_claim(close_tx, { claim: claim_id })
        return Object.freeze({ digest: receipt_digest(await sdk.execute(close_tx)), item_ids: Object.freeze([]) })
      }
      const { content_root, seed_package_original } = living_content(sdk, 'Character transaction')
      const templates = awarded.map(({ item_type }) => item_template_id(content_root, seed_package_original, item_type))
      await sdk.hydrate_unknown(templates)
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => {
          awarded.forEach(({ item_type, existing }, index) => {
            const rune = rune_coordinates(item_type)
            sdk.doors.redeem_rune(tx, {
              claim: claim_id,
              template: templates[index]!,
              stat: rune.stat,
              tier: rune.tier,
              existing,
              kiosk,
              cap,
            })
          })
          sdk.doors.discard_crush_claim(tx, { claim: claim_id })
        },
        { include: { objectTypes: true }, custody }
      )
      return Object.freeze({ digest: receipt_digest(receipt), item_ids: changed_object_ids(receipt, '::item::Item') })
    },

    /** Craft a bounded batch with optional merge preparation and exact receipt outcomes. */
    craft: async ({
      character_id,
      output_type,
      input_item_ids,
      existing,
      attempts,
      custody,
      merges = [],
    }: {
      character_id: string
      output_type: string
      input_item_ids: readonly string[]
      existing: string | null
      attempts: number
      merges?: readonly Readonly<{ target_id: string; source_ids: readonly string[] }>[]
      custody?: KioskCustody
    }): Promise<
      Readonly<ReturnType<typeof spending_receipt> & { attempts: number; successes: number; job_xp_gained: number }>
    > => {
      if (!input_item_ids.length) throw new Error('The craft has no ingredients')
      if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > craft_stackable_batch_limit)
        throw new Error(`Craft attempts must be an integer from 1 to ${craft_stackable_batch_limit}`)
      const { content_root, seed_package_original } = living_content(sdk, 'Character transaction')
      const recipe = recipe_id(content_root, seed_package_original, output_type)
      const output_template = item_template_id(content_root, seed_package_original, output_type)
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) =>
          sdk.doors.craft(tx, {
            recipe,
            kiosk,
            personal,
            character_id,
            input_item_ids,
            output_template,
            existing,
            attempts,
          }),
        { custody, inputs: [recipe, output_template], merges }
      )
      const outcome = craft_outcome(receipt, { recipe, character: character_id, output_template, attempts })
      return Object.freeze({
        ...spending_receipt(receipt),
        ...outcome,
      })
    },

    /** Destroy (burn) units of a held item — irreversible; the chain owns the guardrails. */
    destroy_item: async ({
      item_id,
      amount,
      custody,
      merge_sources = [],
    }: {
      item_id: string
      amount: number
      merge_sources?: readonly string[]
      custody?: KioskCustody
    }): Promise<ReturnType<typeof spending_receipt>> => {
      if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('The burn amount must be a positive integer')
      const receipt = await with_kiosk((tx, kiosk, cap) => sdk.doors.burn_item(tx, { kiosk, cap, item_id, amount }), {
        custody,
        merges: [{ target_id: item_id, source_ids: merge_sources }],
      })
      return spending_receipt(receipt)
    },

    /** Join the destination world after Move verifies travel to the current gate. */
    join_world: async ({
      character_id,
      world,
      custody,
    }: {
      character_id: string
      world: string
      custody?: KioskCustody
    }): Promise<
      Readonly<{ digest: string; joined: Readonly<{ world: string; x: number; z: number; first_join: boolean }> }>
    > => {
      const { content_root, seed_package_original } = living_content(sdk, 'Travel transaction')
      const destination = world_content_id(content_root, seed_package_original, world)
      await sdk.hydrate_unknown([destination])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => sdk.doors.join_world(tx, { kiosk, cap, character_id, destination }),
        { custody }
      )
      const event = receipt_event(receipt, '::world::WorldJoined')
      if (!event) throw new Error('The travel receipt carried no WorldJoined event')
      return Object.freeze({
        digest: receipt_digest(receipt),
        joined: Object.freeze({
          world: event_string(event, 'world'),
          x: event_integer(event, 'x'),
          z: event_integer(event, 'z'),
          first_join: event_boolean(event, 'first_join'),
        }),
      })
    },

    /** Discover or refresh the zone at the character's chain-proven pose. */
    search_zone: async ({
      character_id,
      world,
      x,
      z,
      refresh,
      custody,
    }: {
      character_id: string
      world: string
      x: number
      z: number
      /** false for first discovery; true when the derived Zone object already exists */
      refresh: boolean
      custody?: KioskCustody
    }): Promise<CharacterReceipt> => {
      const { content_root, seed_package_original } = living_content(sdk, 'World transaction')
      const game_original = sdk.game_type_package
      if (!game_original) throw new Error('World transaction unavailable: pins.json has no original game package')
      const world_object = world_id(content_root, game_original, world)
      const { zx, zz } = zone_of(x, z)
      const zone_object = zone_id(world_object, game_original, zx, zz)
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) =>
          refresh
            ? sdk.doors.refresh_zone(tx, { kiosk, personal, character_id, x, z, zone_object })
            : sdk.doors.create_zone(tx, { kiosk, personal, character_id, x, z, world_object }),
        { custody, inputs: [refresh ? zone_object : world_object] }
      )
      return Object.freeze({ digest: receipt_digest(receipt) })
    },

    /** Harvest one node; the receipt reports the chain's yield and protector verdict. */
    gather: async ({
      character_id,
      world,
      zone_x,
      zone_z,
      pack_index,
      item_type,
      rare_item_type,
      existing,
      existing_rare,
      custody,
    }: {
      character_id: string
      world: string
      zone_x: number
      zone_z: number
      pack_index: number
      item_type: string
      /** the row's linked rare, or null when it has none */
      rare_item_type: string | null
      existing: string | null
      existing_rare: string | null
      custody?: KioskCustody
    }): Promise<Readonly<{ digest: string; quantity: number; ambushed: boolean }>> => {
      const { content_root, seed_package_original } = living_content(sdk, 'Character transaction')
      const template = item_template_id(content_root, seed_package_original, item_type)
      // No rare link uses the base template; Move validates a linked rare before its jackpot draw.
      const rare_template = rare_item_type
        ? item_template_id(content_root, seed_package_original, rare_item_type)
        : template
      const game_original = sdk.game_type_package
      if (!game_original) throw new Error('Character transaction unavailable: pins.json has no original game package')
      const world_object = world_id(content_root, game_original, world)
      const zone_object = zone_id(world_object, game_original, zone_x, zone_z)
      const world_content = world_content_id(content_root, seed_package_original, world)
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) =>
          sdk.doors.gather(tx, {
            zone_object,
            world_content,
            kiosk,
            personal,
            character_id,
            pack_index,
            template,
            rare_template,
            existing,
            existing_rare,
          }),
        { custody, inputs: [template, rare_template, zone_object, world_content] }
      )
      const event = receipt_event(receipt, '::gathering::ResourceGathered')
      if (!event) throw new Error('The gather receipt carried no ResourceGathered event')
      return Object.freeze({
        digest: receipt_digest(receipt),
        quantity: event_integer(event, 'quantity'),
        ambushed: event_boolean(event, 'protector'),
      })
    },

    /** Face the protector a gather woke — the ONLY exit from a fired verdict's root. It seats
     *  the character in the fight it creates, so the board mounts off the seat like any other.
     *  No randomness: everything was drawn at the gather, and a failed attempt re-rolls nothing.
     */
    resolve_ambush: async ({
      character_id,
      protector_mob_type,
      custody,
    }: {
      character_id: string
      protector_mob_type: string
      custody?: KioskCustody
    }): Promise<FightCreatedReceipt> => {
      const { content_root, seed_package_original } = living_content(sdk, 'Ambush transaction')
      const protector_template = mob_template_id(content_root, seed_package_original, protector_mob_type)
      const catalog = board_catalog_id(content_root, seed_package_original)
      await sdk.hydrate_unknown([protector_template, catalog])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => sdk.doors.resolve_ambush(tx, { kiosk, cap, character_id, protector_template, catalog }),
        { custody }
      )
      return Object.freeze({ digest: receipt_digest(receipt), fight: created_fight_id(receipt) })
    },
  }
}

export type CharacterActions = ReturnType<typeof character_actions>
