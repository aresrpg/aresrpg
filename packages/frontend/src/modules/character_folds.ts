// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Own-transaction character receipt folds — the exact state transitions a PROVEN receipt
// executed, nothing invented (the server never re-sends what a player's own transaction
// caused; chain-initialized state still arrives through the stream). Pure: session in,
// session out.

import type { CharacterRow, ClaimRow, ItemRow } from '@aresrpg/protocol'

import { character_max_hp, fold_equipment_stats, projected_hp } from '../game/character_stats.ts'
import type { AppInput } from '../store.ts'

import type { SessionState } from './session.ts'

const with_character = (
  session: SessionState,
  character_id: string,
  update: (character: Readonly<CharacterRow>) => CharacterRow
): SessionState => {
  const character = session.characters.find(({ id }) => id === character_id)
  if (!character) return session
  return Object.freeze({
    ...session,
    characters: session.characters.map((row) => (row.id === character_id ? update(row) : row)),
  })
}

/** One consumed unit off a stack — the last unit removes the row. */
const with_item_spent = (items: readonly ItemRow[], item_id: string): readonly ItemRow[] => {
  const item = items.find(({ id }) => id === item_id)
  if (!item) return items
  if (item.amount <= 1) return items.filter(({ id }) => id !== item_id)
  return items.map((row) => (row.id === item_id ? { ...row, amount: row.amount - 1 } : row))
}

/** Fold a PROVEN character receipt — the exact state transition the transaction executed,
 *  nothing invented (chain-initialized state still arrives through the server stream). */
export const fold_character_receipt = (session: SessionState, input: AppInput): SessionState => {
  if (input.type === 'character/equip_folded') {
    const character = session.characters.find(({ id }) => id === input.character_id)
    if (!character) return session
    const unequip_slots = new Set(input.unequipped.map(({ slot }) => slot))
    const freed = character.equipment
      .filter(({ slot }) => unequip_slots.has(slot))
      .map(({ slot: _slot, ...item }) => ({ ...item, kiosk: character.kiosk }))
    const worn = input.equipped.flatMap(({ slot, item_id }) => {
      const item = session.inventory.find(({ id }) => id === item_id)
      if (!item) return []
      const { kiosk: _kiosk, ...row } = item
      return [{ slot, ...row }]
    })
    const equipment = [...character.equipment.filter(({ slot }) => !unequip_slots.has(slot)), ...worn]
    const equipped_ids = new Set(input.equipped.map(({ item_id }) => item_id))
    const next = Object.freeze({ ...character, equipment, folded_stats: fold_equipment_stats(equipment) })
    return Object.freeze({
      ...session,
      characters: session.characters.map((row) => (row.id === input.character_id ? next : row)),
      inventory: Object.freeze([...session.inventory.filter(({ id }) => !equipped_ids.has(id)), ...freed]),
    })
  }
  if (input.type === 'character/stats_raised')
    return with_character(session, input.character_id, (character) => {
      const spent = Object.values(input.allocation).reduce((total, amount) => total + Math.max(0, amount), 0)
      return Object.freeze({
        ...character,
        vitality: character.vitality + (input.allocation.vitality ?? 0),
        wisdom: character.wisdom + (input.allocation.wisdom ?? 0),
        strength: character.strength + (input.allocation.strength ?? 0),
        intelligence: character.intelligence + (input.allocation.intelligence ?? 0),
        chance: character.chance + (input.allocation.chance ?? 0),
        agility: character.agility + (input.allocation.agility ?? 0),
        available_points: Math.max(0, character.available_points - spent),
      })
    })
  if (input.type === 'character/spell_raised')
    return with_character(session, input.character_id, (character) => {
      const current = character.spells[input.spell] ?? 1
      return Object.freeze({
        ...character,
        spells: Object.freeze({ ...character.spells, [input.spell]: current + 1 }),
        available_spell_points: Math.max(0, character.available_spell_points - current),
      })
    })
  if (input.type === 'character/consumed') {
    const now = Date.now()
    const consumed = with_character(session, input.character_id, (character) => {
      if (input.effect === 'heal')
        return Object.freeze({
          ...character,
          hp: String(Math.min(character_max_hp(character), projected_hp(character, now) + input.heal)),
          hp_ms: now,
        })
      // character.move reset_stats: every allocated point returns to the pool
      if (input.effect === 'reset_stats')
        return Object.freeze({
          ...character,
          available_points:
            character.available_points +
            character.vitality +
            character.wisdom +
            character.strength +
            character.intelligence +
            character.chance +
            character.agility,
          vitality: 0,
          wisdom: 0,
          strength: 0,
          intelligence: 0,
          chance: 0,
          agility: 0,
        })
      // progression.move reset_spells: the book clears, the pool refills to level − 1
      if (input.effect === 'reset_spells')
        return Object.freeze({ ...character, spells: {}, available_spell_points: Math.max(0, character.level - 1) })
      // recall moves the character in the world — world facts arrive through the stream
      return character
    })
    return Object.freeze({
      ...consumed,
      inventory: Object.freeze(with_item_spent(consumed.inventory, input.item_id)),
    })
  }
  if (input.type === 'character/rune_scribed')
    // the receipt proves only the rune spend — the gear's CAPPED new block arrives through
    // the server's item stream (packet/item_updated), never local math
    return Object.freeze({
      ...session,
      inventory: Object.freeze(with_item_spent(session.inventory, input.rune_item_id)),
    })
  if (input.type === 'character/world_joined')
    // the star gate: the receipt's own WorldJoined event (world + arrival AT the destination's
    // portal) — the checkpoint timestamp stays the stream's truth, never a local invention
    return with_character(session, input.character_id, (character) =>
      Object.freeze({
        ...character,
        world: input.joined.world,
        checkpoint_world: input.joined.world,
        x: input.joined.x,
        z: input.joined.z,
      })
    )
  return fold_inventory_receipt(session, input)
}

const with_claim_added = (session: SessionState, claim: Readonly<ClaimRow>): SessionState =>
  Object.freeze({ ...session, claims: Object.freeze([...session.claims.filter(({ id }) => id !== claim.id), claim]) })

const without_claim = (claims: readonly ClaimRow[], claim_id: string | null): readonly ClaimRow[] =>
  claim_id === null ? claims : claims.filter(({ id }) => id !== claim_id)

/** Inventory-shaped own-transaction receipts: boxes, claims, crushes, feeding, burning. */
const fold_inventory_receipt = (session: SessionState, input: AppInput): SessionState => {
  if (input.type === 'inventory/box_opened')
    return with_claim_added(
      Object.freeze({ ...session, inventory: Object.freeze(with_item_spent(session.inventory, input.box_item_id)) }),
      { id: input.claim_id, kind: 'box' }
    )
  if (input.type === 'inventory/claim_settled')
    return Object.freeze({ ...session, claims: Object.freeze(without_claim(session.claims, input.claim_id)) })
  if (input.type === 'inventory/gear_crushed') {
    const crushed = new Set(input.gear_ids)
    return with_claim_added(
      Object.freeze({ ...session, inventory: Object.freeze(session.inventory.filter(({ id }) => !crushed.has(id))) }),
      { id: input.claim_id, kind: 'crush' }
    )
  }
  if (input.type === 'inventory/pet_fed') {
    const today = Math.floor(Date.now() / 86_400_000)
    return Object.freeze({
      ...session,
      inventory: Object.freeze(
        with_item_spent(session.inventory, input.food_id).map((row) =>
          row.id === input.pet_id ? { ...row, pet_power: (row.pet_power ?? 0) + 1, pet_last_day: today } : row
        )
      ),
    })
  }
  if (input.type === 'character/crafted') {
    // burn the exact ingredient amounts + bank the job xp (crafting.move credits it roll or no roll);
    // the minted output's row arrives through the per-item stream
    const spent = new Map(input.inputs.map(({ item_id, amount }) => [item_id, amount]))
    const inventory = session.inventory.flatMap((row) => {
      const amount = spent.get(row.id)
      if (amount === undefined) return [row]
      if (row.amount <= amount) return []
      return [{ ...row, amount: row.amount - amount }]
    })
    const characters = session.characters.map((character) =>
      character.id === input.character_id
        ? Object.freeze({
            ...character,
            jobs: Object.freeze({
              ...character.jobs,
              [input.job]: String(Number(character.jobs[input.job] ?? 0) + input.xp),
            }),
          })
        : character
    )
    return Object.freeze({ ...session, inventory: Object.freeze(inventory), characters: Object.freeze(characters) })
  }
  if (input.type === 'inventory/destroyed')
    return Object.freeze({
      ...session,
      inventory: Object.freeze(
        session.inventory.flatMap((row) => {
          if (row.id !== input.item_id) return [row]
          if (row.amount <= input.amount) return []
          return [{ ...row, amount: row.amount - input.amount }]
        })
      ),
    })
  return session
}
