// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The fight doors: Move parity, construction, the wire, join, placement, start, forfeit, death and settlement.

import { describe, expect, test } from 'bun:test'

import {
  amplify_damage,
  apply_centered_resistance,
  crit_denominator,
  ln_e6,
  push_collision_damage,
  remove_points,
  retro_group_coefficient_tenths,
  xp_for_player,
} from '../src/fight_math.ts'
import {
  create_character_source,
  create_fight,
  create_fight_state,
  decode_fight_action,
  encode_fight_action,
  end_turn_submission_after_reconcile,
  fight_action_to_wire,
  fight_loot_types,
  fight_path_to,
  fight_turn_identity,
  hydrate_fight_checkpoint,
  manhattan,
  mob_scalar_for_level,
  movement_points_of,
  parse_fight_wire_action,
  placement_plan,
  point_removal_chance,
  project_board_cells,
  reachable_fight_cells,
  same_fight_turn,
  seated_player_health,
  xp_award_of,
  type HydratedFightCheckpoint,
  type JoinAction,
  type MobFighter,
  type MobTemplateSource,
  type PlayerFighter,
} from '../src/index.ts'
import { CHANNELS, EFFECT_KINDS } from '../src/move_contract.gen.ts'

import { MOVE_MATH_FIXTURE } from './fixtures/move_math.ts'
import { active, effect_row, fixture, spell_level, started } from './helpers.ts'

const seats = (checkpoint: HydratedFightCheckpoint) =>
  checkpoint.contract.fighters as [PlayerFighter, MobFighter, ...PlayerFighter[]]

describe('Move parity', () => {
  test('the twin answers every Move-pinned math row', () => {
    const { damage, dodge, push, ln_e6: logs, crit_denominator: crits } = MOVE_MATH_FIXTURE
    const amplified = amplify_damage(damage.base, damage.primary, damage.raw_damage)
    expect(apply_centered_resistance(amplified, damage.centered_resistance, damage.center)).toBe(damage.expected)
    const { rng, value, caster_wisdom, target_wisdom, current, maximum } = dodge
    expect(remove_points({ rng, value, dodge: true, caster_wisdom, target_wisdom, current, maximum })).toEqual({
      state: dodge.expected_state,
      removed: dodge.expected_removed,
    })
    for (const row of push)
      expect(push_collision_damage(row.caster_level, row.blocked_cells, row.roll)).toBe(row.expected)
    for (const row of logs) expect(ln_e6(row.x)).toBe(row.expected)
    for (const row of crits) expect(crit_denominator(row.crit_1_in, row.cri, row.agility)).toBe(row.expected)
    // Retro XP balances the whole fight and splits it by player level.
    expect([1n, 2n, 3n, 4n, 5n, 6n].map(retro_group_coefficient_tenths)).toEqual([10n, 11n, 15n, 23n, 31n, 36n])
    expect(xp_for_player(1_970n, 0n, 12n, 12n, 12n, 12n, 1n)).toBe(1_970n)
    expect(xp_for_player(1_970n, 0n, 5n, 30n, 12n, 12n, 6n)).toBe(472n)
    expect(xp_for_player(1_000n, 0n, 5n, 15n, 15n, 15n, 2n)).toBe(366n)
    expect(xp_for_player(1_000n, 0n, 10n, 15n, 15n, 15n, 2n)).toBe(733n)
    expect(xp_for_player(1_200n, 0n, 1n, 1n, 12n, 12n, 1n)).toBe(1_100n)
    expect(xp_for_player(1_200n, 0n, 20n, 20n, 12n, 12n, 1n)).toBe(720n)
    expect(xp_for_player(1_200n, 0n, 40n, 40n, 12n, 12n, 1n)).toBe(270n)
    expect(xp_for_player(1_000n, 100n, 12n, 12n, 12n, 12n, 1n)).toBe(2_000n)
    // The content dodge baseline is the full-pool wisdom contest.
    const contest = (wisdom: bigint) =>
      point_removal_chance({ caster_wisdom: 0n, target_wisdom: wisdom, current: 1n, maximum: 1n })
    expect([0n, 30n, 80n].map(contest)).toEqual([50n, 16n, 10n])
  })

  test('a mob is born from its template and scalar with the exact Move band', () => {
    const level = spell_level([effect_row({ value: 100n, value_max: 120n, target_filter: 1n })], {
      ap_cost: 3n,
      range_max: 1n,
    })
    const template: MobTemplateSource = {
      mob_type: 'banded',
      level_min: 10n,
      level_max: 20n,
      hp: 1_000n,
      ap: 6n,
      mp: 3n,
      agility: 4n,
      wisdom: 5n,
      earth_res: 32_868n,
      fire_res: 32_668n,
      water_res: 32_768n,
      air_res: 32_768n,
      spells: [{ name: 'bite', level }],
      loot: [{ item_type: 'fang', chance_bp: 5_000n, min_qty: 1n, max_qty: 2n }],
      xp: 500n,
    }
    // A mob joins a fight as the snapshot its template and level scalar give, exactly as Move builds it.
    const born = (scalar: bigint) =>
      create_fight_state({ players: [], mobs: [{ template, scalar }] }).contract.fighters[0]!.kind
    expect(born(0n)).toMatchObject({ type: 'mob' })
    expect((born(0n) as MobFighter['kind']).snapshot).toMatchObject({
      level: 10n,
      max_hp: 600n,
      ap: 6n,
      mp: 3n,
      agility: 2n,
      wisdom: 3n,
      earth_res: 32_828n,
      fire_res: 32_608n,
      water_res: 32_768n,
      xp: 300n,
      loot: [{ item_type: 'fang', chance_bp: 4_000n, min_qty: 1n, max_qty: 2n }],
      kit: [{ ordinal: 1n, level: { ap_cost: 3n, effects: [{ value: 60n, value_max: 72n }] } }],
    })
    expect((born(100n) as MobFighter['kind']).snapshot).toMatchObject({
      level: 20n,
      max_hp: 1_600n,
      ap: 8n,
      mp: 4n,
      agility: 6n,
      wisdom: 8n,
      earth_res: 32_928n,
      fire_res: 32_708n,
      xp: 800n,
      loot: [{ item_type: 'fang', chance_bp: 6_000n, min_qty: 1n, max_qty: 2n }],
      kit: [{ ordinal: 1n, level: { ap_cost: 3n, effects: [{ value: 160n, value_max: 192n }] } }],
    })
    for (let wanted = template.level_min; wanted <= template.level_max; wanted += 1n)
      expect((born(mob_scalar_for_level(template, wanted)) as MobFighter['kind']).snapshot.level).toBe(wanted)
  })
})

describe('fight doors', () => {
  test('a local fight is built deterministically and untrusted checkpoints decode once', () => {
    const checkpoint = fixture()
    expect(checkpoint).toEqual(fixture())
    const cells = project_board_cells(checkpoint.contract.board)
    expect(cells.filter(({ kind }) => kind === 'start_a')).toHaveLength(6)
    expect(cells.filter(({ kind }) => kind === 'start_b')).toHaveLength(6)
    expect(cells.filter(({ kind }) => kind === 'obstacle')).toHaveLength(checkpoint.contract.board.obstacles.length)
    expect(cells.filter(({ kind }) => kind === 'hole')).toHaveLength(checkpoint.contract.board.holes.length)
    const wire = {
      ...checkpoint,
      contract: { ...checkpoint.contract, dungeon: 'tangled_aftermath', dungeon_room: '2' },
    }
    expect(hydrate_fight_checkpoint(wire).contract).toMatchObject({ dungeon: 'tangled_aftermath', dungeon_room: 2n })
    expect(() => hydrate_fight_checkpoint({ ...wire, contract: { ...wire.contract, x: -1 } })).toThrow(/unsigned/)
    expect(() => hydrate_fight_checkpoint({ ...wire, contract: { ...wire.contract, round: '1e3' } })).toThrow(
      /unsigned/
    )
  })

  test('the wire round-trips live actions exactly and refuses everything else', () => {
    const witnesses = [{ fighter: 1n, seed: 18_446_744_073_709_551_615n }]
    const actions = [
      { type: 'move_to', fighter: 1n, path: [9n, 10n, 11n], observed_ms: 63_000n },
      { type: 'cast_spell', fighter: 1n, spell: 'Pressure Point', target_cell: 20n, turn_witnesses: witnesses },
      { type: 'weapon_strike', fighter: 1n, target_cell: 20n },
    ] as const
    for (const action of actions) expect(decode_fight_action(encode_fight_action(action))).toEqual(action)
    const canonical = parse_fight_wire_action({ type: 'weapon_strike', fighter: '1', target_cell: '20', extra: '-' })
    expect(canonical).toEqual({ type: 'weapon_strike', fighter: '1', target_cell: '20' })
    expect(fight_action_to_wire(actions[2])).toEqual(canonical)
    expect(fight_action_to_wire({ type: 'end_turn', fighter: 1n })).toBeNull()

    expect(() => encode_fight_action({ type: 'start' })).toThrow(/not streamable/)
    expect(() => encode_fight_action({ type: 'ready', fighter: 1n })).toThrow(/not streamable/)
    expect(() => decode_fight_action({ type: 'forfeit', fighter: '1' })).toThrow(/not streamable/)
    expect(() => decode_fight_action([])).toThrow(/object/)
    expect(() => decode_fight_action({ type: 'move_to', fighter: '1', path: ['nope'] })).toThrow(/decimal/)
    expect(() => decode_fight_action({ type: 'move_to', fighter: '01', path: [] })).toThrow(/decimal/)
    expect(() => decode_fight_action({ type: 'cast_spell', fighter: '1', spell: '', target_cell: '2' })).toThrow(
      /spell/
    )
    // Size caps guard the relay: a board has 380 cells and a boundary never needs more than 32 witnesses.
    const path = (length: number) => Array.from({ length }, () => '1')
    expect(decode_fight_action({ type: 'move_to', fighter: '1', path: path(380) })).toMatchObject({ fighter: 1n })
    expect(() => decode_fight_action({ type: 'move_to', fighter: '1', path: path(381) })).toThrow(/path/)
    const seeds = (length: number) => Array.from({ length }, () => ({ fighter: '1', seed: '2' }))
    const strike = { type: 'weapon_strike', fighter: '1', target_cell: '2' }
    expect(decode_fight_action({ ...strike, turn_witnesses: seeds(32) }).turn_witnesses).toHaveLength(32)
    expect(() => decode_fight_action({ ...strike, turn_witnesses: seeds(33) })).toThrow(/turn_witnesses/)
    expect(() => decode_fight_action({ ...strike, observed_ms: 1 })).toThrow(/observed_ms/)
  })

  test('join keeps the access, group, side and capacity contracts of the Move door', () => {
    const checkpoint = fixture()
    const source = checkpoint.sources.players['0xc1']!
    const joiner = { type: 'join', team: 0n, hp: 100n, character: '0xc2', owner: '0xa2', source } as const
    const alone = fixture()
    alone.contract.fighters = [alone.contract.fighters[0]!]
    expect(create_fight({ state: alone }).apply({ ...joiner, team: 1n, access: 2n }).error?.code).toBe('bad_access')
    const opened = create_fight({ state: alone }).apply({ ...joiner, team: 1n, access: 1n })
    expect(opened.error).toBeNull()
    expect(opened.state.contract).toMatchObject({ access_b: 1n, opener_b: '0xc2' })

    checkpoint.contract.access_a = 1n
    expect(create_fight({ state: checkpoint }).apply(joiner).error?.code).toBe('group_only')
    const grouped = create_fight({ state: checkpoint }).apply({ ...joiner, party_members: ['0xc1', '0xc2'] })
    expect(grouped.error).toBeNull()
    expect(grouped.events).toEqual([{ type: 'fighter_joined', payload: expect.objectContaining({ fighter: 2n }) }])
    const refusals = [
      [{ ...joiner, team: 2n }, 'bad_team'],
      [{ ...joiner, team: 1n, access: 0n }, 'mob_side'],
      [{ ...joiner, character: '0xc1', party_members: ['0xc1'] }, 'already_seated'],
    ] satisfies [JoinAction, string][]
    for (const [action, code] of refusals)
      expect(create_fight({ state: checkpoint }).apply(action).error?.code).toBe(code)

    // Each side's six start cells bound its lifetime admissions: a forfeit returns the character, not the seat.
    const game = create_fight({ state: fixture() })
    for (let index = 2; index <= 6; index++)
      expect(game.apply({ ...joiner, character: `0xc${index}`, owner: '0xa1' }).error).toBeNull()
    expect(game.apply({ type: 'forfeit', fighter: 2n }).error).toBeNull()
    const full = game.apply({ ...joiner, character: '0xc7', owner: '0xa1' })
    expect(full.error?.code).toBe('team_full')
    expect(full.state.contract.fighters).toHaveLength(7)
    expect(started(fixture()).apply({ ...joiner, character: '0xc9' }).error?.code).toBe('not_placement')
  })

  test('placement swaps an owned teammate atomically and refuses every other move', () => {
    const party = () => {
      const checkpoint = fixture()
      const [player, mob] = seats(checkpoint)
      player.ready = false
      const players = checkpoint.contract.board.start_cells_a.map((cell, index) => ({
        ...structuredClone(player),
        cell,
        kind: { ...player.kind, character: `0xc${index}` },
      }))
      checkpoint.contract.fighters = [...players, mob]
      return checkpoint
    }
    const initial = party()
    const [from, to] = initial.contract.board.start_cells_a as [bigint, bigint]
    const swapped = create_fight({ state: initial }).apply({ type: 'place', fighter: 0n, cell: to })
    expect(swapped.error).toBeNull()
    expect(swapped.events.map(({ payload }) => payload)).toEqual([
      { fighter: 0n, from, to },
      { fighter: 1n, from: to, to: from },
    ])
    expect(new Set(swapped.state.contract.fighters.map(({ cell }) => cell)).size).toBe(7)

    const refusals: readonly ((checkpoint: HydratedFightCheckpoint) => void)[] = [
      (checkpoint) => {
        ;(checkpoint.contract.fighters[1] as PlayerFighter).kind.owner = '0xb'
      },
      (checkpoint) => {
        checkpoint.contract.fighters[0]!.ready = true
      },
      (checkpoint) => {
        checkpoint.contract.fighters[1]!.ready = true
      },
      (checkpoint) => {
        checkpoint.contract.fighters[1]!.settled = true
      },
      (checkpoint) => {
        checkpoint.contract.round = 1n
      },
    ]
    for (const refuse of refusals) {
      const checkpoint = party()
      refuse(checkpoint)
      const result = create_fight({ state: checkpoint }).apply({ type: 'place', fighter: 0n, cell: to })
      expect(result.error).not.toBeNull()
      expect(result.events).toEqual([])
      expect(result.state.contract.fighters).toEqual(checkpoint.contract.fighters)
    }
    expect(placement_plan(initial.contract, 0n, initial.contract.fighters[6]!.cell)).toBe('bad_cell')
    expect(placement_plan(initial.contract, 0n, from)).toBe('bad_cell')
    expect(placement_plan(initial.contract, 6n, from)).toBe('not_your_fighter')

    // A forfeited seat frees its cell for the living and can never be placed again.
    const game = create_fight({ state: party() })
    expect(game.apply({ type: 'forfeit', fighter: 1n }).error).toBeNull()
    expect(game.apply({ type: 'place', fighter: 0n, cell: to }).error).toBeNull()
    expect(game.apply({ type: 'place', fighter: 1n, cell: from }).error?.code).toBe('bad_cell')
    expect(game.apply({ type: 'ready', fighter: 999n }).error?.code).toBe('not_your_fighter')
    expect(game.apply({ type: 'forfeit', fighter: 999n }).error?.code).toBe('already_settled')
  })

  test('start waits for every living player, never force-starts an unarmed clock, and refusals are atomic', () => {
    const unready = fixture()
    unready.contract.fighters[0]!.ready = false
    const remote = create_fight({ state: unready, mode: 'remote' }).apply({ type: 'start', observed_ms: 1_000_000n })
    expect(remote.error?.code).toBe('not_ready')
    expect(remote.state.contract.round).toBe(0n)
    unready.contract.placement_ms = 1_000n
    const forced = create_fight({ state: unready, mode: 'local', seed: 91n })
    expect(forced.apply({ type: 'start', observed_ms: 60_999n }).error?.code).toBe('not_ready')
    expect(forced.apply({ type: 'start', observed_ms: 61_000n }).error).toBeNull()

    // The same action has the same result whoever delivers it.
    const local = create_fight({ state: fixture(), mode: 'local', seed: 91n })
    const relayed = create_fight({ state: fixture(), mode: 'local', seed: 91n })
    const first = local.apply({ type: 'start', observed_ms: 60_000n })
    expect(relayed.apply({ type: 'start', observed_ms: 60_000n })).toEqual(first)
    expect(first.events[0]).toEqual({ type: 'fight_started', payload: { queue: [0n, 1n], round: 1n } })
    expect(local.apply({ type: 'start', observed_ms: 60_000n }).error?.code).toBe('not_placement')

    const before = local.state()
    const refused = (input: Parameters<typeof local.apply>[0]) => local.apply(input).error?.code
    expect(local.apply({ type: 'move_to', fighter: 0n, path: [379n, 0n] })).toEqual({
      state: before,
      events: [],
      error: expect.objectContaining({ code: 'no_path' }),
    })
    expect(refused({ type: 'end_turn', fighter: 0n, observed_ms: 62_000n })).toBe('too_soon')
    expect(refused({ type: 'crank', observed_ms: 62_000n })).toBe('too_soon')
    expect(refused({ type: 'cast_spell', fighter: 1n, spell: 'slash', target_cell: 0n })).toBe('not_your_fighter')
    expect(refused({ type: 'cast_spell', fighter: 0n, spell: 'missing', target_cell: 0n })).toBe('not_your_spell')
    expect(refused({ type: 'place', fighter: 0n, cell: 0n })).toBe('not_placement')
    expect(refused({ type: 'ready', fighter: 0n })).toBe('not_placement')
    expect(local.state()).toEqual(before)

    const replacement = structuredClone(before)
    replacement.contract.round = 7n
    expect(local.replace(replacement)).toEqual([])
    expect(local.state().contract.round).toBe(7n)
  })

  test('movement range and paths stay within the points, the board and the living', () => {
    const checkpoint = fixture()
    const fighter = checkpoint.contract.fighters[0]!
    fighter.mp = 3n
    const cells = reachable_fight_cells(checkpoint, 0n)
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every((cell) => cell !== fighter.cell && manhattan(cell, fighter.cell) <= 3n)).toBeTrue()
    expect(cells.some((cell) => checkpoint.contract.fighters.some((other) => other.cell === cell))).toBeFalse()
    const far = cells.find((cell) => fight_path_to(checkpoint, 0n, cell)?.length === 3)!
    expect(fight_path_to(checkpoint, 0n, far)?.at(-1)).toBe(far)
    expect(fight_path_to(checkpoint, 0n, checkpoint.contract.fighters[1]!.cell)).toBeNull()
    expect(fight_path_to(checkpoint, 0n, 0xffffn)).toBeNull()
    // An inactive fighter is projected from the points its next turn refills.
    expect(movement_points_of(checkpoint, 1n)).toBe(3n)
    expect(reachable_fight_cells(checkpoint, 1n, 3n).length).toBeGreaterThan(0)
    checkpoint.sources.players['0xc1']!.folded_stats.movement = 32_769n
    fighter.mp = movement_points_of(checkpoint, 0n)
    expect(fighter.mp).toBe(4n)
    expect(cells.length).toBeLessThan(reachable_fight_cells(checkpoint, 0n).length)
    fighter.mp = 0n
    expect(reachable_fight_cells(checkpoint, 0n)).toEqual([])
    Object.assign(fighter, { mp: 3n, dead: true })
    expect(reachable_fight_cells(checkpoint, 0n)).toEqual([])
  })
})

describe('leaving and settling', () => {
  const pair = () => {
    const game = create_fight({ state: fixture(), mode: 'local', seed: 91n })
    const source = game.state().sources.players['0xc1']!
    game.apply({ type: 'join', team: 0n, character: '0xc2', owner: '0xa2', hp: 100n, source })
    game.apply({ type: 'ready', fighter: 2n })
    game.apply({ type: 'start', observed_ms: 60_000n })
    return game
  }

  test('forfeits hand off the turn, leave other turns alone, and end a wiped side at once', () => {
    const handed_off = pair().apply({ type: 'forfeit', fighter: 0n, observed_ms: 60_001n })
    expect(handed_off.error).toBeNull()
    expect(handed_off.state.contract.fighters[0]).toMatchObject({ dead: true, settled: true, forfeited: true, hp: 0n })
    expect(handed_off.state.contract.queue[Number(handed_off.state.contract.turn_ptr)]).toBe(2n)
    expect(handed_off.events.filter(({ type }) => type === 'turn_switched')).toHaveLength(2)
    expect(handed_off.state.contract.turn_started_ms).toBe(63_001n)

    const game = pair()
    const before = game.state().contract
    const waiting = game.apply({ type: 'forfeit', fighter: 2n, observed_ms: 60_001n })
    expect(waiting.state.contract).toMatchObject({
      turn_ptr: before.turn_ptr,
      turn_seed: before.turn_seed,
      turn_started_ms: before.turn_started_ms,
    })
    expect(waiting.events.some(({ type }) => type === 'turn_switched')).toBeFalse()
    expect(game.apply({ type: 'forfeit', fighter: 2n })).toMatchObject({ events: [], error: null })

    const last = started(fixture()).apply({ type: 'forfeit', fighter: 0n, observed_ms: 60_001n })
    expect(last.state.contract).toMatchObject({ ended: true, winner: 1n })
    expect(last.events.some(({ type }) => type === 'turn_switched')).toBeFalse()
    // Only a fight against mobs writes persistent health back.
    expect(last.events).toContainEqual({
      type: 'fighter_settled',
      payload: { fighter: 0n, won: false, survived: false, xp: 0n, persistent_hp: 1n },
    })
    const duel = fixture()
    duel.contract.fighters[1] = {
      ...structuredClone(duel.contract.fighters[0]!),
      team: 1n,
      kind: { type: 'player', character: '0xc2', owner: '0xa2', level: 10n },
    }
    duel.sources.players['0xc2'] = duel.sources.players['0xc1']!
    expect(create_fight({ state: duel }).apply({ type: 'forfeit', fighter: 0n }).events).toContainEqual(
      expect.objectContaining({ type: 'fighter_settled', payload: expect.objectContaining({ persistent_hp: null }) })
    )
    expect(create_fight({ state: last.state }).apply({ type: 'forfeit', fighter: 1n }).error?.code).toBe(
      'already_ended'
    )
  })

  test('a dead active player can still end its turn, whatever killed it', () => {
    for (const cause of ['self_damage', 'reflection', 'trap'] as const) {
      const checkpoint = fixture()
      const [player, enemy] = seats(checkpoint)
      const [destination] = reachable_fight_cells(checkpoint, 0n, 1n)
      const teammate_cell = checkpoint.contract.board.start_cells_a.find(
        (cell) => cell !== destination && !checkpoint.contract.fighters.some((fighter) => fighter.cell === cell)
      )!
      checkpoint.contract.fighters.push({
        ...structuredClone(player),
        cell: teammate_cell,
        kind: { ...player.kind, character: '0xc2' },
      })
      checkpoint.sources.players['0xc2'] = checkpoint.sources.players['0xc1']!
      const self = cause === 'self_damage'
      const row = self
        ? effect_row({ kind: EFFECT_KINDS.caster_damage, value: 100n, value_max: 100n, target_filter: 4n })
        : effect_row({ value: 1n, value_max: 1n })
      checkpoint.sources.spells.slash!.levels = [spell_level([row])]
      if (cause === 'reflection') enemy.effects = [active(EFFECT_KINDS.reflect, CHANNELS.hp, 100n, 5n)]
      if (cause === 'trap') {
        const payload = [effect_row({ value: 1_000n, value_max: 1_000n })]
        const trap = { owner_fighter: 1n, trap: true, shape: 0n, size: 0n, anchor: destination!, turns_left: 0n }
        checkpoint.contract.zones = [{ ...trap, effects: payload }]
      }
      const fight = started(checkpoint)
      const killed =
        cause === 'trap'
          ? fight.apply({ type: 'move_to', fighter: 0n, path: [destination!] })
          : fight.apply({ type: 'cast_spell', fighter: 0n, spell: 'slash', target_cell: enemy.cell })
      expect(killed.error, cause).toBeNull()
      expect(killed.state.contract.fighters[0]!.dead, cause).toBeTrue()
      expect(killed.state.contract.ended).toBeFalse()
      const cast = { type: 'cast_spell', fighter: 0n, spell: 'slash', target_cell: enemy.cell } as const
      expect(fight.apply(cast).error?.code).toBe('not_your_fighter')
      const ended = fight.apply({ type: 'end_turn', fighter: 0n, observed_ms: 63_000n })
      expect(ended.error, cause).toBeNull()
      expect(ended.state.contract.queue[Number(ended.state.contract.turn_ptr)]).toBe(2n)
    }
  })

  test('settlement awards Retro XP from level snapshots and loot templates only to eligible winners', () => {
    const checkpoint = fixture()
    const [player, mob] = seats(checkpoint)
    player.kind.level = 5n
    checkpoint.sources.players['0xc1'] = { ...checkpoint.sources.players['0xc1']!, level: 5n }
    mob.kind.snapshot.level = 12n
    mob.kind.snapshot.xp = 1_970n
    mob.kind.snapshot.loot = ['silk', 'silk', 'fang'].map((item_type) => ({
      item_type,
      chance_bp: 100n,
      min_qty: 1n,
      max_qty: 1n,
    }))
    for (let index = 2; index <= 6; index += 1) {
      const character = `0xc${index}`
      checkpoint.contract.fighters.push({ ...structuredClone(player), kind: { ...player.kind, character } })
      checkpoint.sources.players[character] = checkpoint.sources.players['0xc1']!
    }
    checkpoint.contract.ended = true
    checkpoint.contract.winner = 0n
    expect([0n, 6n, 1n].map((seat) => xp_award_of(checkpoint, seat))).toEqual([472n, 472n, 0n])
    expect(fight_loot_types(checkpoint, 0)).toEqual(['silk', 'fang'])
    player.dead = true
    expect(fight_loot_types(checkpoint, 0)).toEqual(['silk', 'fang'])
    player.forfeited = true
    expect(fight_loot_types(checkpoint, 0)).toEqual([])
    player.forfeited = false
    for (const winner of [1n, null]) {
      checkpoint.contract.winner = winner
      expect([0, 1, 99].map((seat) => fight_loot_types(checkpoint, seat))).toEqual([[], [], []])
    }
  })

  test('a seat reports its live hero health and turn identity, never another owner', () => {
    const checkpoint = fixture()
    const seat = { character: '0xc1', owner: '0xa1', seat: 0 }
    expect(seated_player_health(checkpoint, seat)).toEqual({ current: 100n, maximum: 100n })
    const sturdy = create_character_source({
      classe: 'senshi',
      level: 10n,
      vitality: 30n,
      folded_stats: { vitality: 32_778n },
    })
    const geared = { ...checkpoint, sources: { ...checkpoint.sources, players: { '0xc1': sturdy } } }
    expect(seated_player_health(geared, seat)).toEqual({ current: 100n, maximum: 140n })
    expect(seated_player_health(checkpoint, { ...seat, owner: '0xb' })).toBeNull()
    expect(seated_player_health(checkpoint, { ...seat, seat: 1 })).toBeNull()
    checkpoint.contract.fighters[0]!.settled = true
    expect(seated_player_health(checkpoint, seat)).toBeNull()

    const turn = { round: 2n, turn_ptr: 1n, turn_started_ms: 63_000n }
    expect(fight_turn_identity(turn)).toBe('2:1:63000')
    expect(same_fight_turn(undefined, turn)).toBeFalse()
    expect(same_fight_turn({ round: 2, turn_ptr: 1, turn_started_ms: 63_000 }, turn)).toBeTrue()
    expect(end_turn_submission_after_reconcile({ end_turn_submitted: true }, false, true)).toBeTrue()
    expect(end_turn_submission_after_reconcile({ end_turn_submitted: true }, false, false)).toBeFalse()
  })
})
