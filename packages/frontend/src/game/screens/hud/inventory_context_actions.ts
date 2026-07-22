// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type inventory_context_action =
  | 'equip'
  | 'use'
  | 'clear'
  | 'feed'
  | 'open'
  | 'crush'
  | 'split'
  | 'merge'
  | 'send'
  | 'explorer'

export type inventory_context_stack = {
  readonly id: string
  readonly template_id: string | null
  readonly amount: number
  readonly stackable: boolean
}

export type inventory_stack_context = {
  readonly stack: inventory_context_stack
  readonly stacks: readonly inventory_context_stack[]
}

export type equip_slot_kind =
  | 'weapon'
  | 'helmet'
  | 'chestplate'
  | 'belt'
  | 'gauntlets'
  | 'pants'
  | 'boots'
  | 'amulet'
  | 'ring'
  | 'pet'
  | 'relic'
  | 'title'
  | 'hat'
  | 'cloak'

export type equip_preflight_reason =
  | 'errors.equip_template_mismatch'
  | 'errors.equip_not_equippable'
  | 'errors.equip_wrong_slot'
  | 'errors.equip_level_too_low'
  | 'errors.equip_relic_duplicate'

export type equip_preflight_item = {
  readonly id?: string | null
  readonly item_category?: string | null
  readonly category?: string | null
  readonly item_type?: string | null
  readonly template_id?: string | null
  readonly template?: string | null
  readonly level?: number | null
}

export type equip_preflight_template = {
  readonly id?: string | null
  readonly level?: number | null
}

export type equip_preflight_context = {
  readonly item: equip_preflight_item | null | undefined
  readonly character_level: number | null | undefined
  /** Deliberately not a gate: equipment.move makes every weapon family class-universal. */
  readonly character_class?: string | null
  /** UI target only. Move derives its slot from Item.category and receives no physical slot argument. */
  readonly slot?: string | null
  readonly equipment?: Readonly<Record<string, equip_preflight_item | null | undefined>>
  readonly template_id_map?: ReadonlyMap<string, equip_preflight_template>
  readonly template_map?: ReadonlyMap<string, equip_preflight_template>
}

export type equip_preflight_result =
  | { readonly allowed: true; readonly reason: null }
  | { readonly allowed: false; readonly reason: equip_preflight_reason }

// Exact mirror of equipment.move's slot_kind_of category table. These are the immutable categories stamped from
// the authored ItemTemplate onto Item and projected unchanged as /v1/owner-items.item_category. Do not route this
// through @aresrpg/sdk/items: that legacy helper collapses fine weapon/armour categories and admits non-Move rows.
const MOVE_SLOT_BY_CATEGORY: Readonly<Record<string, equip_slot_kind>> = Object.freeze({
  longsword: 'weapon',
  daggers: 'weapon',
  battleaxe: 'weapon',
  spear: 'weapon',
  staff: 'weapon',
  spellbook: 'weapon',
  bow: 'weapon',
  axe: 'weapon',
  mace: 'weapon',
  club: 'weapon',
  sword: 'weapon',
  tool_farmer: 'weapon',
  tool_herbalist: 'weapon',
  tool_miner: 'weapon',
  helmet: 'helmet',
  chestplate: 'chestplate',
  belt: 'belt',
  gauntlets: 'gauntlets',
  pants: 'pants',
  boots: 'boots',
  amulet: 'amulet',
  ring: 'ring',
  pet: 'pet',
  relic: 'relic',
  title: 'title',
  hat: 'hat',
  cloak: 'cloak',
})

const PHYSICAL_SLOTS_BY_KIND: Readonly<Record<equip_slot_kind, readonly string[]>> = Object.freeze({
  weapon: Object.freeze(['weapon']),
  helmet: Object.freeze(['helmet']),
  chestplate: Object.freeze(['chestplate']),
  belt: Object.freeze(['belt']),
  gauntlets: Object.freeze(['gauntlets']),
  pants: Object.freeze(['pants']),
  boots: Object.freeze(['boots']),
  amulet: Object.freeze(['amulet']),
  ring: Object.freeze(['left_ring', 'right_ring']),
  pet: Object.freeze(['pet']),
  relic: Object.freeze(['relic_1', 'relic_2', 'relic_3', 'relic_4', 'relic_5', 'relic_6']),
  title: Object.freeze(['title']),
  hat: Object.freeze(['hat']),
  cloak: Object.freeze(['cloak']),
})

const ALLOWED_EQUIP: equip_preflight_result = Object.freeze({ allowed: true, reason: null })

const refused_equip = (reason: equip_preflight_reason): equip_preflight_result => ({ allowed: false, reason })

const item_category_of = (item: equip_preflight_item | null | undefined): string =>
  String(item?.item_category ?? item?.category ?? '').toLowerCase()

const item_template_id_of = (item: equip_preflight_item | null | undefined): string | null => {
  const template_id = item?.template_id ?? item?.template
  return typeof template_id === 'string' && template_id ? template_id : null
}

const item_template_of = (
  item: equip_preflight_item | null | undefined,
  template_id_map: ReadonlyMap<string, equip_preflight_template> | undefined,
  template_map: ReadonlyMap<string, equip_preflight_template> | undefined
): equip_preflight_template | null => {
  const template_id = item_template_id_of(item)
  if (template_id) return template_id_map?.get(template_id) ?? null
  const item_type = typeof item?.item_type === 'string' ? item.item_type : ''
  return item_type ? (template_map?.get(item_type) ?? null) : null
}

/** Move-derived slot kind for an Item.category, or null for equipment::ENotEquippable. */
export const equip_slot_kind_of = (item: equip_preflight_item | null | undefined): equip_slot_kind | null =>
  MOVE_SLOT_BY_CATEGORY[item_category_of(item)] ?? null

/** Client-target twin of Move's category-derived slot. The target never crosses the transaction boundary. */
export const equip_slot_accepts = (slot: string, item: equip_preflight_item | null | undefined): boolean => {
  const slot_kind = equip_slot_kind_of(item)
  return !!slot_kind && PHYSICAL_SLOTS_BY_KIND[slot_kind].includes(slot)
}

const target_slot_of = (
  item: equip_preflight_item,
  slot_kind: equip_slot_kind,
  requested_slot: string | null | undefined,
  equipment: Readonly<Record<string, equip_preflight_item | null | undefined>> | undefined
): string => {
  if (requested_slot) return requested_slot
  const item_id = item.id
  const slots = PHYSICAL_SLOTS_BY_KIND[slot_kind]
  return slots.find((slot) => !equipment?.[slot] || equipment[slot]?.id === item_id) ?? slots[slots.length - 1]
}

const duplicate_relic_remains = (
  item: equip_preflight_item,
  target_slot: string,
  equipment: Readonly<Record<string, equip_preflight_item | null | undefined>> | undefined
): boolean => {
  const template_id = item_template_id_of(item)
  if (!template_id || !equipment) return false
  return PHYSICAL_SLOTS_BY_KIND.relic.some((slot) => {
    const equipped = equipment[slot]
    return (
      slot !== target_slot &&
      equipped?.id !== item.id &&
      item_template_id_of(equipped) === template_id
    )
  })
}

/**
 * Pure pre-flight for the locally knowable equipment.move gates. Category and required level come from the same
 * Item/ItemTemplate fields the chain reads; unknown template data fails open. Occupied/full slots are legal in
 * this UI because Accept unequips the replaced target first. The one surviving occupancy refusal is a duplicate
 * relic template elsewhere in the final staged loadout. Cross-class weapons intentionally remain legal.
 */
export function equip_preflight({
  item,
  character_level,
  slot,
  equipment,
  template_id_map,
  template_map,
}: equip_preflight_context): equip_preflight_result {
  const template = item_template_of(item, template_id_map, template_map)
  const template_id = item_template_id_of(item)
  if (template_id && template?.id && template.id !== template_id)
    return refused_equip('errors.equip_template_mismatch')

  const slot_kind = equip_slot_kind_of(item)
  if (!slot_kind) return refused_equip('errors.equip_not_equippable')
  if (slot && !equip_slot_accepts(slot, item)) return refused_equip('errors.equip_wrong_slot')

  const required_level = typeof template?.level === 'number' ? template.level : Number.NaN
  const current_level = typeof character_level === 'number' ? character_level : Number.NaN
  if (
    Number.isFinite(required_level) &&
    required_level > 0 &&
    Number.isFinite(current_level) &&
    current_level < required_level
  )
    return refused_equip('errors.equip_level_too_low')

  const target_slot = target_slot_of(item ?? {}, slot_kind, slot, equipment)
  if (slot_kind === 'relic' && duplicate_relic_remains(item ?? {}, target_slot, equipment))
    return refused_equip('errors.equip_relic_duplicate')
  return ALLOWED_EQUIP
}

const is_mergeable_stack = (stack: inventory_context_stack, candidate: inventory_context_stack): boolean =>
  stack.stackable &&
  candidate.stackable &&
  candidate.id !== stack.id &&
  Boolean(stack.template_id) &&
  candidate.template_id === stack.template_id

const is_stack_action_visible = (
  action: inventory_context_action,
  stack_context: inventory_stack_context | undefined
): boolean => {
  if (action !== 'split' && action !== 'merge') return true
  if (!stack_context || stack_context.stack.amount <= 1) return false
  if (action === 'split') return stack_context.stack.stackable
  return stack_context.stacks.some((candidate) => is_mergeable_stack(stack_context.stack, candidate))
}

/**
 * Add the common SEND action to an inventory menu without disturbing that surface's existing actions. SEND is
 * projected immediately before Explorer so the on-chain navigation escape hatch remains the final row.
 */
export function project_inventory_context_actions(
  existing_actions: readonly inventory_context_action[],
  stack_context?: inventory_stack_context
): inventory_context_action[] {
  const unique_actions = [
    ...new Set(
      existing_actions.filter(
        (action) => action !== 'send' && is_stack_action_visible(action, stack_context)
      )
    ),
  ]
  const explorer_index = unique_actions.indexOf('explorer')
  if (explorer_index < 0) return [...unique_actions, 'send']
  return [...unique_actions.slice(0, explorer_index), 'send', ...unique_actions.slice(explorer_index)]
}
