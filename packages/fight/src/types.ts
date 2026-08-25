// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ITEM_STAT_FIELDS } from './move_contract.gen.ts'

/** Every integer mirrored from Move is decoded once and remains bigint throughout the simulator. */
export type MoveInteger = bigint

export type ItemStatField = (typeof ITEM_STAT_FIELDS)[number]

export type SpellEffect = {
  kind: MoveInteger
  element: string
  value: MoveInteger
  value_max: MoveInteger
  area_shape: MoveInteger
  area_size: MoveInteger
  target_filter: MoveInteger
  chance_bp: MoveInteger
  turns: MoveInteger
  stat: MoveInteger
}

export type SpellLevel = {
  ap_cost: MoveInteger
  range_min: MoveInteger
  range_max: MoveInteger
  modifiable_range: boolean
  line_of_sight: boolean
  line_launch: boolean
  free_cell: boolean
  casts_per_turn: MoveInteger
  casts_per_target: MoveInteger
  cooldown_turns: MoveInteger
  crit_1_in: MoveInteger
  effects: SpellEffect[]
  crit_effects: SpellEffect[]
}

export type KitSpell = {
  name: string
  ordinal: MoveInteger
  level: SpellLevel
}

export type MobLoot = {
  item_type: string
  chance_bp: MoveInteger
  min_qty: MoveInteger
  max_qty: MoveInteger
  [key: string]: unknown
}

export type MobSnapshot = {
  mob_type: string
  level: MoveInteger
  max_hp: MoveInteger
  ap: MoveInteger
  mp: MoveInteger
  agility: MoveInteger
  wisdom: MoveInteger
  earth_res: MoveInteger
  fire_res: MoveInteger
  water_res: MoveInteger
  air_res: MoveInteger
  kit: KitSpell[]
  xp: MoveInteger
  loot: MobLoot[]
}

export type ActiveEffect = {
  kind: MoveInteger
  element: string
  value: MoveInteger
  turns_left: MoveInteger
  source: MoveInteger
  stat: MoveInteger
}

export type Cooldown = { spell: string; left: MoveInteger }
export type RolledDrop = { item_type: string; qty: MoveInteger }
export type TurnCast = { spell: string; target: MoveInteger }

export type PlayerFighterKind = {
  type: 'player'
  character: string
  owner: string
  level: MoveInteger
}

export type MobFighterKind = {
  type: 'mob'
  snapshot: MobSnapshot
}

export type FighterKind = PlayerFighterKind | MobFighterKind

export type Fighter = {
  team: MoveInteger
  kind: FighterKind
  cell: MoveInteger
  ready: boolean
  dead: boolean
  settled: boolean
  forfeited: boolean
  hp: MoveInteger
  ap: MoveInteger
  mp: MoveInteger
  drops: RolledDrop[]
  effects: ActiveEffect[]
  cooldowns: Cooldown[]
}

export type PlayerFighter = Fighter & { kind: PlayerFighterKind }
export type MobFighter = Fighter & { kind: MobFighterKind }

export type FightBoard = {
  width: MoveInteger
  height: MoveInteger
  shape_mask: MoveInteger[]
  obstacles: MoveInteger[]
  holes: MoveInteger[]
  start_cells_a: MoveInteger[]
  start_cells_b: MoveInteger[]
}

export type BoardZone = {
  owner_fighter: MoveInteger
  trap: boolean
  shape: MoveInteger
  size: MoveInteger
  anchor: MoveInteger
  turns_left: MoveInteger
  effects: SpellEffect[]
}

/** The complete normalized fight object mirrored from Move, plus indexed lifecycle clocks. */
export type FightContract = {
  id: string
  world: string
  x: MoveInteger
  z: MoveInteger
  board: FightBoard
  closed: MoveInteger[]
  access_a: MoveInteger
  access_b: MoveInteger
  opener_a: string | null
  opener_b: string | null
  fighters: Fighter[]
  zones: BoardZone[]
  queue: MoveInteger[]
  turn_ptr: MoveInteger
  round: MoveInteger
  ended: boolean
  winner: MoveInteger | null
  dungeon: MoveInteger | null
  managed: boolean
  wagered: boolean
  drops_rolled: boolean
  turn_seed: MoveInteger
  turn_slot: MoveInteger
  turn_casts: TurnCast[]
  placement_ms: MoveInteger
  /** Checkpoint timestamps persisted by the indexer from lifecycle event envelopes. */
  started_ms: MoveInteger | null
  ended_ms: MoveInteger | null
  turn_started_ms: MoveInteger
}

export type WeaponDamage = {
  element: string
  from: MoveInteger
  to: MoveInteger
}

export type WeaponSource = {
  category: string
  damages: WeaponDamage[]
}

export type PlayerSource = {
  name: string
  classe: string
  level: MoveInteger
  experience: MoveInteger
  vitality: MoveInteger
  wisdom: MoveInteger
  strength: MoveInteger
  intelligence: MoveInteger
  chance: MoveInteger
  agility: MoveInteger
  spell_levels: Record<string, MoveInteger>
  folded_stats: Record<ItemStatField, MoveInteger>
  weapon: WeaponSource | null
}

export type SpellSource = {
  classe: string
  unlock_level: MoveInteger
  levels: SpellLevel[]
}

export type FightSources = {
  players: Record<string, PlayerSource>
  spells: Record<string, SpellSource>
}

export type FightCheckpoint = {
  contract: FightContract | null
  sources: FightSources
}

export type HydratedFightCheckpoint = FightCheckpoint & { contract: FightContract }

export type JoinAction = {
  type: 'join'
  team: MoveInteger
  hp: MoveInteger
  character: string
  owner: string
  source: PlayerSource
  access?: MoveInteger
  party_members?: string[]
}

export type PlaceAction = { type: 'place'; fighter: MoveInteger; cell: MoveInteger }
export type ReadyAction = { type: 'ready'; fighter: MoveInteger }
export type StartAction = { type: 'start' }
export type MoveAction = Readonly<{ type: 'move_to'; fighter: MoveInteger; path: readonly MoveInteger[] }>
export type CastAction = { type: 'cast_spell'; fighter: MoveInteger; spell: string; target_cell: MoveInteger }
export type StrikeAction = { type: 'weapon_strike'; fighter: MoveInteger; target_cell: MoveInteger }
export type BoundaryAction = { type: 'end_turn'; fighter: MoveInteger } | { type: 'crank' }
export type ForfeitAction = { type: 'forfeit'; fighter: MoveInteger }

export type FightCommand =
  | JoinAction
  | PlaceAction
  | ReadyAction
  | StartAction
  | MoveAction
  | CastAction
  | StrikeAction
  | BoundaryAction
  | ForfeitAction

export type FightEventPayloads = {
  fighter_joined: { fighter: MoveInteger; team: MoveInteger; cell: MoveInteger }
  fighter_placed: { fighter: MoveInteger; from: MoveInteger; to: MoveInteger }
  fighter_ready: { fighter: MoveInteger }
  fight_started: { queue: MoveInteger[]; round: MoveInteger }
  fighter_forfeited: { fighter: MoveInteger; team: MoveInteger }
  fighter_settled: {
    fighter: MoveInteger
    won: boolean
    survived: boolean
    xp: MoveInteger
    persistent_hp: MoveInteger | null
  }
  spell_cast: {
    caster: MoveInteger
    spell: string
    cast_level: MoveInteger
    target_cell: MoveInteger
    slot: MoveInteger
    ap_cost: MoveInteger
    critical: boolean
    weapon: boolean
  }
  fighter_moved: {
    fighter: MoveInteger
    from: MoveInteger
    to: MoveInteger
    mode: string
    source: MoveInteger
    mp_spent: MoveInteger
  }
  ap_mp_change: {
    fighter: MoveInteger
    ap_before: MoveInteger
    ap_after: MoveInteger
    mp_before: MoveInteger
    mp_after: MoveInteger
    reason: string
    source: MoveInteger
  }
  tackle_resolved: {
    runner: MoveInteger
    cell: MoveInteger
    lockers: MoveInteger[]
    escaped: boolean
    ap_lost: MoveInteger
    mp_lost: MoveInteger
  }
  push_collided: { source: MoveInteger; target: MoveInteger; blocked_cells: MoveInteger; damage: MoveInteger }
  damage_number: {
    source: MoveInteger
    target: MoveInteger
    amount: MoveInteger
    hp_before: MoveInteger
    hp_after: MoveInteger
    element: string
    cause: string
  }
  damage_reduced: {
    source: MoveInteger
    target: MoveInteger
    prevented: MoveInteger
    remaining: MoveInteger
    effect_ids: string[]
  }
  damage_redirected: {
    source: MoveInteger
    original_target: MoveInteger
    final_target: MoveInteger
    amount: MoveInteger
  }
  spell_returned: { caster: MoveInteger; target: MoveInteger; amount: MoveInteger; cast_level: MoveInteger }
  damage_reflected: { source: MoveInteger; target: MoveInteger; amount: MoveInteger }
  heal_number: {
    source: MoveInteger
    target: MoveInteger
    amount: MoveInteger
    hp_before: MoveInteger
    hp_after: MoveInteger
    cause: string
  }
  fighter_died: { fighter: MoveInteger; source: MoveInteger; cause: string; cell: MoveInteger }
  fight_ended: { winner: MoveInteger | null }
  chatiment_triggered: {
    fighter: MoveInteger
    stance_effect_id: string
    added_effect_id: string
    channel: MoveInteger
    value: MoveInteger
    turns: MoveInteger
  }
  effect_applied: {
    target: MoveInteger
    effect_id: string
    kind: MoveInteger
    channel: MoveInteger
    element: string
    value: MoveInteger
    turns: MoveInteger
    source: MoveInteger
  }
  // The wisdom contest over an AP/MP removal, dodges included — emitted even when nothing
  // lands, so a full dodge is visible truth instead of silence.
  points_contested: {
    source: MoveInteger
    target: MoveInteger
    channel: MoveInteger
    attempted: MoveInteger
    removed: MoveInteger
    stolen: boolean
  }
  effect_expired: { target: MoveInteger; effect_id: string; kind: MoveInteger; channel: MoveInteger }
  effects_dispelled: { target: MoveInteger; removed_effect_ids: string[] }
  invisibility_changed: { fighter: MoveInteger; invisible: boolean; reason: string }
  cooldown_changed: {
    fighter: MoveInteger
    spell: string
    before: MoveInteger
    after: MoveInteger
    reason: string
  }
  trap_placed: {
    zone_id: string
    owner: MoveInteger
    anchor: MoveInteger
    shape: MoveInteger
    size: MoveInteger
    visibility: 'owner'
  }
  glyph_placed: {
    zone_id: string
    owner: MoveInteger
    anchor: MoveInteger
    shape: MoveInteger
    size: MoveInteger
    turns: MoveInteger
  }
  trap_triggered: {
    zone_id: string
    owner: MoveInteger
    fighter: MoveInteger
    from: MoveInteger
    cell: MoveInteger
  }
  glyph_triggered: { zone_id: string; owner: MoveInteger; fighter: MoveInteger; cell: MoveInteger }
  zone_removed: { zone_id: string; kind: 'trap' | 'glyph'; reason: string }
  turn_switched: {
    from: MoveInteger | null
    to: MoveInteger
    round: MoveInteger
    skipped: MoveInteger[]
    reason: string
  }
}

export type FightEventType = keyof FightEventPayloads
export type FightEvent = {
  [Type in FightEventType]: { type: Type; payload: FightEventPayloads[Type] }
}[FightEventType]

export type FightRuntimeError = {
  code: string
  detail: unknown
}

export type FightRuntime = HydratedFightCheckpoint & {
  render_actions: FightEvent[]
  error: FightRuntimeError | null
  render_ids: RenderIdentityState
}

export type RenderIdentityState = {
  next: MoveInteger
  effects: string[][]
  zones: string[]
}

export type SeedWitness = { seed: MoveInteger; witnessed: boolean }
export type SeedProvider = (actor: MoveInteger, mob: boolean) => SeedWitness | null
export type MobTurnObserver = (seat: MoveInteger, seed: MoveInteger) => void

export type CommandOptions = {
  observed_ms?: MoveInteger | null
  seed_for?: SeedProvider
  on_mob_turn?: MobTurnObserver | null
}

export type FightSheet = {
  strength: MoveInteger
  intelligence: MoveInteger
  chance: MoveInteger
  agility: MoveInteger
  wisdom: MoveInteger
  raw_damage: MoveInteger
  critical: MoveInteger
  range_bonus: MoveInteger
  level: MoveInteger
}

export type PrngCursor = { state: MoveInteger }
export type PrngResult = { state: MoveInteger; value: MoveInteger }

export type ResolveRowsInput = {
  runtime: FightRuntime
  caster: MoveInteger
  sheet: FightSheet
  rows: readonly SpellEffect[]
  anchor: MoveInteger
  origin: MoveInteger
  cursor: PrngCursor
  cast_level: MoveInteger
  cause: string
}

export type ResolveRows = (input: ResolveRowsInput) => void

export type CharacterSourceInput = {
  name?: string
  classe: string
  level?: MoveInteger
  experience?: MoveInteger
  vitality?: MoveInteger
  wisdom?: MoveInteger
  strength?: MoveInteger
  intelligence?: MoveInteger
  chance?: MoveInteger
  agility?: MoveInteger
  spell_levels?: Record<string, MoveInteger>
  folded_stats?: Partial<Record<ItemStatField, MoveInteger>>
  weapon?: WeaponSource | null
}

export type FightPlayerInput = {
  character: string
  owner: string
  team?: MoveInteger
  cell?: MoveInteger
  ready?: boolean
  hp: MoveInteger
  source: PlayerSource
}

export type FightMobInput = {
  team?: MoveInteger
  cell?: MoveInteger
  template: MobTemplateSource
  scalar: MoveInteger
}

export type MobTemplateSource = {
  mob_type: string
  level_min: MoveInteger
  level_max: MoveInteger
  hp: MoveInteger
  ap: MoveInteger
  mp: MoveInteger
  agility: MoveInteger
  wisdom: MoveInteger
  earth_res: MoveInteger
  fire_res: MoveInteger
  water_res: MoveInteger
  air_res: MoveInteger
  spells: { name: string; level: SpellLevel }[]
  loot: MobLoot[]
  xp: MoveInteger
}

export type FightSetup = {
  fight_id?: string
  world?: string
  x?: MoveInteger
  z?: MoveInteger
  board_seed?: MoveInteger
  /** an AUTHORED board (a fight_boards.json catalog row, bigint-shaped) — when present it
   * wins over board_seed generation; live fights always read their stored board instead */
  board?: FightBoard
  players: FightPlayerInput[]
  mobs: FightMobInput[]
  spells?: Record<string, SpellSource>
  placement_ms?: MoveInteger
}
